import { platform } from "node:os";
import type {
  BridgeConfig,
  ProjectBinding,
  RuntimeCapability,
  RuntimeSession,
  SessionStatus
} from "../../types.js";
import { JsonFileStore } from "../../storage/json-file-store.js";
import type { SessionsDocument } from "../../storage/documents.js";
import type { CommandRunner } from "../process.js";
import { ExecFileCommandRunner } from "../process.js";
import { TmuxCommandBuilder, type RuntimePlatform } from "./tmux-command-builder.js";

export interface CodexRuntime {
  detect(): Promise<RuntimeCapability>;
  ensureSession(binding: ProjectBinding): Promise<RuntimeSession>;
  discoverExisting(binding: ProjectBinding): Promise<RuntimeSession | null>;
  reconcile(binding: ProjectBinding): Promise<RuntimeSession>;
  send(session: RuntimeSession, text: string): Promise<void>;
  sendAndWaitForOutput(
    session: RuntimeSession,
    text: string,
    options?: SendAndWaitOptions
  ): Promise<string>;
  readRecent(session: RuntimeSession, lines?: number): Promise<string>;
  status(session: RuntimeSession): Promise<SessionStatus>;
  stop(session: RuntimeSession): Promise<void>;
}

export class CodexTmuxRuntime implements CodexRuntime {
  private readonly runtimePlatform: RuntimePlatform;
  private readonly builder: TmuxCommandBuilder;

  constructor(
    private readonly config: BridgeConfig,
    private readonly sessions: JsonFileStore<SessionsDocument>,
    private readonly runner: CommandRunner = new ExecFileCommandRunner()
  ) {
    this.runtimePlatform =
      platform() === "win32" && config.runtime.windows.useWsl ? "windows-wsl" : "posix";
    this.builder = new TmuxCommandBuilder(config, this.runtimePlatform);
  }

  async detect(): Promise<RuntimeCapability> {
    const tmux = await this.runBuilt(this.builder.detectTmux());
    const codex = await this.runBuilt(this.builder.detectCodex());
    return {
      platform: this.runtimePlatform,
      available: tmux.exitCode === 0 && codex.exitCode === 0,
      tmuxAvailable: tmux.exitCode === 0,
      codexAvailable: codex.exitCode === 0,
      detail: [tmux.stderr, codex.stderr].filter(Boolean).join("\n") || undefined
    };
  }

  async ensureSession(binding: ProjectBinding): Promise<RuntimeSession> {
    const existing = await this.discoverExisting(binding);
    if (existing) {
      return this.saveSession(existing);
    }

    const capability = await this.detect();
    if (!capability.available) {
      throw new Error(`Codex tmux runtime is unavailable: ${capability.detail ?? "unknown"}`);
    }

    const created = await this.runBuilt(this.builder.newSession(binding));
    if (created.exitCode !== 0) {
      throw new Error(`Failed to start tmux session: ${created.stderr || created.stdout}`);
    }

    return this.saveSession(this.sessionFromBinding(binding));
  }

  async discoverExisting(binding: ProjectBinding): Promise<RuntimeSession | null> {
    const sessionName = this.builder.sessionName(binding);
    const result = await this.runBuilt(this.builder.hasSession(sessionName));
    if (result.exitCode !== 0) return null;
    return this.sessionFromBinding(binding);
  }

  async reconcile(binding: ProjectBinding): Promise<RuntimeSession> {
    const existing = await this.discoverExisting(binding);
    if (!existing) {
      throw new Error(`No existing tmux session for ${binding.id}`);
    }
    return this.saveSession(existing);
  }

  async send(session: RuntimeSession, text: string): Promise<void> {
    const bufferName = `codex-channel-${session.tmuxSession}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const setBuffer = await this.runBuilt(this.builder.setBuffer(bufferName, text));
    if (setBuffer.exitCode !== 0) {
      throw new Error(`Failed to set tmux buffer: ${setBuffer.stderr || setBuffer.stdout}`);
    }

    try {
      const paste = await this.runBuilt(this.builder.pasteBuffer(session.tmuxSession, bufferName));
      if (paste.exitCode !== 0) {
        throw new Error(`Failed to paste tmux buffer: ${paste.stderr || paste.stdout}`);
      }

      const enter = await this.runBuilt(this.builder.sendEnter(session.tmuxSession));
      if (enter.exitCode !== 0) {
        throw new Error(`Failed to send Enter to tmux: ${enter.stderr || enter.stdout}`);
      }
    } finally {
      await this.runBuilt(this.builder.deleteBuffer(bufferName));
    }
  }

  async sendAndWaitForOutput(
    session: RuntimeSession,
    text: string,
    options: SendAndWaitOptions = {}
  ): Promise<string> {
    const storedCursor = await this.readStoredCursor(session);
    const before =
      storedCursor?.tail || (await this.readRecent(session, options.lines ?? 80).catch(() => ""));
    await this.send(session, text);

    const timeoutMs = options.timeoutMs ?? 120000;
    const pollMs = options.pollMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    let latest = "";
    let bestOutput = "";
    let lastUpdate = "";
    let lastUpdateAt = 0;
    let stableSince = 0;

    while (Date.now() < deadline) {
      await sleep(pollMs);
      latest = await this.readRecent(session, options.lines ?? 80).catch(() => latest);
      const rawOutput = rawOutputAfterSend(before, latest, text);
      const output = discordOutputFromRaw(rawOutput);
      if (output) {
        if (output !== bestOutput || stableSince === 0) {
          stableSince = Date.now();
        }
        bestOutput = output;
      }
      if (output && (looksComplete(rawOutput) || needsUserInput(rawOutput))) {
        await this.saveOutputCursor(session, latest, options.messageId);
        return output;
      }
      if (
        output &&
        options.onUpdate &&
        output !== lastUpdate &&
        Date.now() - lastUpdateAt >= (options.updateIntervalMs ?? 5000)
      ) {
        lastUpdate = output;
        lastUpdateAt = Date.now();
        await options.onUpdate(output);
        if (latest) {
          await this.saveOutputCursor(session, latest, options.messageId);
        }
      }
      if (
        output &&
        !isCodexStillWorking(rawOutput) &&
        Date.now() - stableSince >= (options.stableMs ?? 8000)
      ) {
        await this.saveOutputCursor(session, latest, options.messageId);
        return output;
      }
    }

    if (latest) {
      await this.saveOutputCursor(session, latest, options.messageId);
    }
    return bestOutput || outputAfterSend(before, latest, text);
  }

  async readRecent(session: RuntimeSession, lines = 80): Promise<string> {
    const result = await this.runBuilt(this.builder.capturePane(session.tmuxSession, lines));
    if (result.exitCode !== 0) {
      throw new Error(`Failed to capture tmux pane: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trimEnd();
  }

  async status(session: RuntimeSession): Promise<SessionStatus> {
    const result = await this.runBuilt(this.builder.hasSession(session.tmuxSession));
    if (result.exitCode !== 0) {
      return { state: "missing", detail: result.stderr || result.stdout, session };
    }
    return { state: "running", session };
  }

  async stop(session: RuntimeSession): Promise<void> {
    const result = await this.runBuilt(this.builder.killSession(session.tmuxSession));
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stop tmux session: ${result.stderr || result.stdout}`);
    }
  }

  private async saveSession(session: RuntimeSession): Promise<RuntimeSession> {
    let saved = session;
    await this.sessions.update((document) => {
      const index = document.sessions.findIndex(
        (item) => item.bindingId === session.bindingId && item.machineId === session.machineId
      );
      if (index >= 0) {
        saved = {
          ...document.sessions[index],
          ...session,
          outputCursor: session.outputCursor ?? document.sessions[index].outputCursor
        };
        document.sessions[index] = saved;
      } else {
        document.sessions.push(session);
      }
      return document;
    });
    return saved;
  }

  private async readStoredCursor(session: RuntimeSession) {
    const document = await this.sessions.read();
    return document.sessions.find(
      (item) => item.bindingId === session.bindingId && item.machineId === session.machineId
    )?.outputCursor;
  }

  private async saveOutputCursor(
    session: RuntimeSession,
    capturedPane: string,
    messageId?: string
  ): Promise<void> {
    const tail = capturedPane.slice(-6000);
    await this.sessions.update((document) => {
      const index = document.sessions.findIndex(
        (item) => item.bindingId === session.bindingId && item.machineId === session.machineId
      );
      if (index >= 0) {
        document.sessions[index] = {
          ...document.sessions[index],
          outputCursor: {
            tail,
            updatedAt: new Date().toISOString(),
            messageId
          }
        };
      }
      return document;
    });
  }

  private sessionFromBinding(binding: ProjectBinding): RuntimeSession {
    const now = new Date().toISOString();
    return {
      bindingId: binding.id,
      machineId: this.config.machineId,
      projectPath: binding.projectPath,
      tmuxSession: this.builder.sessionName(binding),
      lastSeenAt: now,
      startedAt: now
    };
  }

  private runBuilt(command: { file: string; args: string[]; cwd?: string }) {
    return this.runner.run(command.file, command.args, { cwd: command.cwd });
  }
}

export interface SendAndWaitOptions {
  timeoutMs?: number;
  pollMs?: number;
  lines?: number;
  stableMs?: number;
  updateIntervalMs?: number;
  messageId?: string;
  onUpdate?: (output: string) => Promise<void> | void;
}

export function outputAfterSend(before: string, latest: string, text: string): string {
  return discordOutputFromRaw(rawOutputAfterSend(before, latest, text));
}

function rawOutputAfterSend(before: string, latest: string, text: string): string {
  if (!latest || latest === before) return "";
  const anchored = outputAfterPromptEcho(latest, text);
  if (anchored != null) return anchored;
  const added = latest.slice(sharedBoundaryLength(before, latest)).trim();
  if (!added) return "";
  const withoutEcho = stripPromptEcho(added, text).trim();
  return withoutEcho || "";
}

function outputAfterPromptEcho(output: string, text: string): string | undefined {
  const normalizedText = text.trim();
  if (!normalizedText) return undefined;

  const lines = output.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isPromptEchoLine(lines[index]?.trim() ?? "", normalizedText)) {
      return lines.slice(index + 1).join("\n").trim();
    }
  }
  return undefined;
}

function stripPromptEcho(output: string, text: string): string {
  const normalizedText = text.trim();
  const lines = output.split(/\r?\n/);
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift();
  }
  const first = lines[0]?.trim();
  if (first === normalizedText || first === `› ${normalizedText}` || first === `> ${normalizedText}`) {
    lines.shift();
  }
  return lines.join("\n");
}

export function cleanCodexOutputForDiscord(output: string): string {
  return stripCodexTuiNoise(output);
}

function discordOutputFromRaw(output: string): string {
  const cleaned = cleanCodexOutputForDiscord(output);
  if (cleaned) return cleaned;
  return needsUserInput(output) ? output.trim() : "";
}

function stripCodexTuiNoise(output: string): string {
  const lines = truncateAtNextPrompt(output.split(/\r?\n/));
  const kept: string[] = [];
  let skippingTraceBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== "") {
        kept.push("");
      }
      continue;
    }

    if (
      isCodexSeparatorLine(trimmed) ||
      isCodexWorkedLine(trimmed) ||
      isCodexStatusLine(trimmed) ||
      isCodexStartupChromeLine(trimmed)
    ) {
      skippingTraceBlock = false;
      trimTrailingBlank(kept);
      continue;
    }

    if (isCodexTraceStart(trimmed)) {
      skippingTraceBlock = true;
      trimTrailingBlank(kept);
      continue;
    }

    if (skippingTraceBlock) {
      if (isAssistantMessageStart(trimmed)) {
        skippingTraceBlock = false;
      } else if (isCodexTraceContinuation(trimmed)) {
        continue;
      } else {
        skippingTraceBlock = false;
      }
    }

    if (!skippingTraceBlock) {
      kept.push(stripAssistantBullet(line).trimEnd());
    }
  }

  trimTrailingBlank(kept);
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function truncateAtNextPrompt(lines: string[]): string[] {
  const nextPrompt = lines.findIndex((line) => isCodexNextPromptLine(line.trim()));
  if (nextPrompt >= 0) {
    return lines.slice(0, nextPrompt);
  }
  return lines;
}

function isCodexNextPromptLine(line: string): boolean {
  return /^(›|鈥?|閳?)\s+\S/u.test(line);
}

function isCodexSeparatorLine(line: string): boolean {
  return /^[─━═\-_\s]{8,}$/u.test(line);
}

function isCodexWorkedLine(line: string): boolean {
  return /Worked for\s+\S+/i.test(line);
}

function isCodexStatusLine(line: string): boolean {
  return /^gpt-\S+\s+\S+\s+·\s+/u.test(line);
}

function isCodexStartupChromeLine(line: string): boolean {
  return (
    /^model:\s+/iu.test(line) ||
    /^directory:\s+/iu.test(line) ||
    /^approval:\s+/iu.test(line) ||
    /^sandbox:\s+/iu.test(line) ||
    /^account:\s+/iu.test(line) ||
    /^_ OpenAI Codex/i.test(line) ||
    /^[╭╰│]/u.test(line)
  );
}

function isCodexTraceStart(line: string): boolean {
  return /^(•|鈥?|閳?)\s*(Ran|Explored|Read|Search|Edited|Updated|Listed|Opened|Checked|Found|Grep)\b/i.test(line);
}

function isAssistantMessageStart(line: string): boolean {
  return /^(•|鈥?|閳?)\s+\S/u.test(line) && !isCodexTraceStart(line);
}

function isCodexTraceContinuation(line: string): boolean {
  return (
    /^[│└├┌┐┘┤╭╰╯╮]/u.test(line) ||
    /^… \+\d+ lines?/u.test(line) ||
    /^\d+ files? changed/u.test(line) ||
    /^(create|delete|rename) mode \d+/u.test(line) ||
    /^[MADRCU?!]{1,2}\s+\S/u.test(line)
  );
}

function stripAssistantBullet(line: string): string {
  return line.replace(/^\s*(•|鈥?|閳?)\s+/u, "");
}

function trimTrailingBlank(lines: string[]): void {
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
}

function isPromptEchoLine(line: string, text: string): boolean {
  return (
    line === text ||
    line === `> ${text}` ||
    line === `› ${text}` ||
    line === `鈥?${text}` ||
    line === `鈥? ${text}`
  );
}

function sharedBoundaryLength(left: string, right: string): number {
  if (right.startsWith(left)) return left.length;

  const maxLength = Math.min(left.length, right.length);
  for (let length = maxLength; length > 0; length -= 1) {
    if (left.endsWith(right.slice(0, length))) return length;
  }
  return commonPrefixLength(left, right);
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function looksComplete(output: string): boolean {
  return /Worked for\s+\S+/i.test(output);
}

function needsUserInput(output: string): boolean {
  return [
    /Do you trust the contents of this directory\?/i,
    /Would you like to run the following command/i,
    /Press enter to continue/i,
    /Reply with .*code:/i,
    /Confirmation code/i
  ].some((pattern) => pattern.test(output));
}

function isCodexStillWorking(output: string): boolean {
  return [
    /Working\s*\([^)]*esc to interrupt/i,
    /Running\s+[^]*esc to interrupt/i,
    /esc to interrupt/i
  ].some((pattern) => pattern.test(output));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
