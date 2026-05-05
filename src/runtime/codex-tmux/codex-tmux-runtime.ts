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
    options?: { timeoutMs?: number; pollMs?: number; lines?: number }
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
    options: { timeoutMs?: number; pollMs?: number; lines?: number } = {}
  ): Promise<string> {
    const before = await this.readRecent(session, options.lines ?? 80).catch(() => "");
    await this.send(session, text);

    const timeoutMs = options.timeoutMs ?? 120000;
    const pollMs = options.pollMs ?? 1000;
    const deadline = Date.now() + timeoutMs;
    let latest = "";
    let bestOutput = "";

    while (Date.now() < deadline) {
      await sleep(pollMs);
      latest = await this.readRecent(session, options.lines ?? 80).catch(() => latest);
      const output = outputAfterSend(before, latest, text);
      if (output) {
        bestOutput = output;
      }
      if (output && (looksComplete(output) || needsUserInput(output))) {
        return output;
      }
    }

    return bestOutput || outputAfterSend(before, latest, text) || latest || before;
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
    await this.sessions.update((document) => {
      const index = document.sessions.findIndex(
        (item) => item.bindingId === session.bindingId && item.machineId === session.machineId
      );
      if (index >= 0) {
        document.sessions[index] = session;
      } else {
        document.sessions.push(session);
      }
      return document;
    });
    return session;
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

export function outputAfterSend(before: string, latest: string, text: string): string {
  if (!latest || latest === before) return "";
  const added = latest.slice(commonPrefixLength(before, latest)).trim();
  if (!added) return "";
  const withoutEcho = stripPromptEcho(added, text).trim();
  return withoutEcho || "";
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
    /Press enter to continue/i,
    /Reply with .*code:/i,
    /Confirmation code/i
  ].some((pattern) => pattern.test(output));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
