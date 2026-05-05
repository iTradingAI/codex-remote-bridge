import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname, platform } from "node:os";
import { dirname } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { isEnvVarName, looksLikeDiscordToken, upsertLocalEnvValue } from "./env.js";
import { runHealth, runRegisterCommands, runStart } from "./operations.js";
import { repairUtf8DecodedAsGbkList } from "../encoding/mojibake.js";

const CONFIRMATION_KEYWORDS = ["commit", "push", "merge", "delete", "deploy", "reset"];

export interface SetupAnswers {
  machineId: string;
  dataDir: string;
  logDir: string;
  tokenEnv: string;
  botToken?: string;
  applicationId: string;
  guildId: string;
  channelId: string;
  threadId?: string;
  authorizedUserIds: string[];
  pathAllowlist: string[];
  allowDirectInjection: boolean;
  useWsl: boolean;
  wslCommand: string;
  wslDistro?: string;
  tmuxCommand: string;
  codexCommand: string;
}

export interface SetupOptions {
  outputPath: string;
  force: boolean;
  answersPath?: string;
  postSetup?: boolean;
  startAfterSetup?: boolean;
}

export interface GeneratedSetupConfig {
  machine_id: string;
  data_dir: string;
  log_dir: string;
  discord: {
    token_env: string;
    application_id: string;
    guild_id: string;
    allowed_scopes: Array<{
      workspace_id: string;
      conversation_id: string;
    }>;
  };
  path_allowlist: string[];
  runtime: {
    kind: "codex-tmux";
    tmux_command: string;
    codex_command: string;
    windows: {
      use_wsl: boolean;
      wsl_command: string;
      distro: string | null;
    };
  };
  policy: {
    authorized_user_ids: string[];
    allow_direct_injection: boolean;
    require_confirmation_for: string[];
  };
}

export async function runSetupWizard(options: SetupOptions): Promise<void> {
  if (options.answersPath) {
    await writeSetupConfig(options, await readAnswersFile(options.answersPath));
    output.write(`Wrote ${options.outputPath}\n`);
    await runPostSetup(options);
    return;
  }

  const rl = createInterface({ input, output });
  try {
    if (existsSync(options.outputPath) && !options.force) {
      const overwrite = await askBoolean(
        rl,
        `Config already exists at ${options.outputPath}. Overwrite?`,
        false
      );
      if (!overwrite) {
        output.write("Setup cancelled.\n");
        return;
      }
    }

    const defaults = defaultSetupAnswers();
    output.write("Codex Channel setup\n");
    output.write("Leave a prompt blank to use the value in brackets.\n\n");

    const machineId = await askString(rl, "Machine ID", defaults.machineId);
    const dataDir = await askString(rl, "Data directory", defaults.dataDir);
    const logDir = await askString(rl, "Log directory", defaults.logDir);
    const tokenInput = await askString(
      rl,
      "Discord bot token env var name (name only; token value is asked next)",
      defaults.tokenEnv
    );
    const tokenEnv = normalizeTokenEnvInput(tokenInput, defaults.tokenEnv);
    const pastedToken = looksLikeDiscordToken(tokenInput) ? tokenInput.trim() : undefined;
    const botToken =
      pastedToken ??
      (await askOptional(
        rl,
        `Discord bot token value for ${tokenEnv} (blank to use existing env/.env.local)`
      ));
    const applicationId = await askRequired(rl, "Discord application ID");
    const guildId = await askRequired(rl, "Discord guild/server ID");
    const channelId = await askRequired(rl, "Discord parent channel/Forum ID");
    const authorizedUserIds = splitList(
      await askRequired(rl, "Authorized Discord user IDs (comma-separated)")
    );
    const usePathAllowlist = await askBoolean(
      rl,
      "Enable conservative project path allowlist?",
      false
    );
    const pathAllowlist = usePathAllowlist
      ? splitList(await askString(rl, "Allowed project roots (comma-separated)", ""))
      : [];
    const allowDirectInjection = await askBoolean(
      rl,
      "Allow ordinary messages to inject into Codex?",
      false
    );
    const useWsl =
      platform() === "win32" ? await askBoolean(rl, "Use WSL for tmux/Codex?", true) : false;

    const answers: SetupAnswers = {
      machineId,
      dataDir,
      logDir,
      tokenEnv,
      botToken,
      applicationId,
      guildId,
      channelId,
      authorizedUserIds,
      pathAllowlist,
      allowDirectInjection,
      useWsl,
      wslCommand: useWsl
        ? await askString(rl, "WSL command", defaults.wslCommand)
        : defaults.wslCommand,
      wslDistro: useWsl ? await askOptional(rl, "WSL distro name (blank for default)") : undefined,
      tmuxCommand: await askString(rl, "tmux command", defaults.tmuxCommand),
      codexCommand: await askString(rl, "Codex command", defaults.codexCommand)
    };

    await writeSetupConfig({ ...options, force: true }, answers);

    output.write(`\nWrote ${options.outputPath}\n\n`);
    await runPostSetup(options);
  } finally {
    rl.close();
  }
}

export function buildSetupConfig(answers: SetupAnswers): GeneratedSetupConfig {
  return {
    machine_id: answers.machineId,
    data_dir: answers.dataDir,
    log_dir: answers.logDir,
    discord: {
      token_env: answers.tokenEnv,
      application_id: answers.applicationId,
      guild_id: answers.guildId,
      allowed_scopes: [
        {
          workspace_id: normalizeGuildId(answers.guildId),
          conversation_id: buildConversationId(answers.channelId)
        }
      ]
    },
    path_allowlist: repairUtf8DecodedAsGbkList(answers.pathAllowlist),
    runtime: {
      kind: "codex-tmux",
      tmux_command: answers.tmuxCommand,
      codex_command: answers.codexCommand,
      windows: {
        use_wsl: answers.useWsl,
        wsl_command: answers.wslCommand,
        distro: answers.wslDistro || null
      }
    },
    policy: {
      authorized_user_ids: answers.authorizedUserIds,
      allow_direct_injection: answers.allowDirectInjection,
      require_confirmation_for: CONFIRMATION_KEYWORDS
    }
  };
}

async function writeSetupConfig(options: SetupOptions, answers: SetupAnswers): Promise<void> {
  if (existsSync(options.outputPath) && !options.force) {
    throw new Error(`Config already exists at ${options.outputPath}. Use --force to overwrite it.`);
  }
  const config = buildSetupConfig(answers);
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (answers.botToken) {
    await upsertLocalEnvValue(answers.tokenEnv, answers.botToken);
    output.write(`Stored Discord bot token in .env.local as ${answers.tokenEnv}.\n`);
  }
}

async function runPostSetup(options: SetupOptions): Promise<void> {
  if (options.postSetup === false) {
    output.write(`Post-setup automation skipped. Use --config ${options.outputPath} for later commands.\n`);
    return;
  }

  output.write("Running health check...\n");
  await runHealth(options.outputPath);
  output.write("Registering Discord slash commands...\n");
  await runRegisterCommands(options.outputPath);

  if (options.startAfterSetup === false) {
    output.write(`Bridge is configured. Start later with: node dist/src/cli/index.js start --config ${options.outputPath}\n`);
    return;
  }

  output.write("Starting bridge. Leave this terminal open.\n");
  await runStart(options.outputPath);
}

async function readAnswersFile(path: string): Promise<SetupAnswers> {
  return parseSetupAnswers(await readFile(path, "utf8"));
}

export function parseSetupAnswers(content: string): SetupAnswers {
  const raw = JSON.parse(stripBom(content)) as Partial<SetupAnswers>;
  const tokenEnvInput = raw.tokenEnv || "DISCORD_BOT_TOKEN";
  const answers: SetupAnswers = {
    machineId: requiredString(raw.machineId, "machineId"),
    dataDir: requiredString(raw.dataDir, "dataDir"),
    logDir: requiredString(raw.logDir, "logDir"),
    tokenEnv: normalizeTokenEnvInput(tokenEnvInput, "DISCORD_BOT_TOKEN"),
    botToken:
      optionalString(raw.botToken, "botToken") ??
      (looksLikeDiscordToken(tokenEnvInput) ? tokenEnvInput.trim() : undefined),
    applicationId: requiredString(raw.applicationId, "applicationId"),
    guildId: requiredString(raw.guildId, "guildId"),
    channelId: requiredString(raw.channelId, "channelId"),
    threadId: optionalString(raw.threadId, "threadId"),
    authorizedUserIds: requiredStringArray(raw.authorizedUserIds, "authorizedUserIds"),
    pathAllowlist: optionalStringArray(raw.pathAllowlist, "pathAllowlist"),
    allowDirectInjection: Boolean(raw.allowDirectInjection),
    useWsl: Boolean(raw.useWsl),
    wslCommand: raw.wslCommand || "wsl.exe",
    wslDistro: optionalString(raw.wslDistro, "wslDistro"),
    tmuxCommand: raw.tmuxCommand || "tmux",
    codexCommand: raw.codexCommand || "codex"
  };
  return answers;
}

function normalizeTokenEnvInput(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (looksLikeDiscordToken(trimmed)) {
    output.write(
      `Detected a token value in the env var name field; using ${fallback} as the env var name instead.\n`
    );
    return fallback;
  }
  if (!isEnvVarName(trimmed)) {
    throw new Error(
      `Discord bot token env var name must look like ${fallback}, not a token or arbitrary text.`
    );
  }
  return trimmed;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string when set`);
  }
  return value.trim();
}

function requiredStringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(`${name} must be a non-empty array of strings`);
  }
  return value.map((item) => item.trim());
}

function optionalStringArray(value: unknown, name: string): string[] {
  if (value == null) return [];
  return requiredStringArray(value, name);
}

export function buildConversationId(channelId: string, threadId?: string): string {
  const channel = normalizeChannelId(channelId);
  const thread = threadId?.trim();
  if (!thread) return channel;
  return `${channel}/thread:${stripPrefix(thread, "thread:")}`;
}

export function normalizeGuildId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("guild:") ? trimmed : `guild:${trimmed}`;
}

export function normalizeChannelId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("channel:") ? trimmed : `channel:${trimmed}`;
}

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function printSetupConfig(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function defaultSetupAnswers(): Pick<
  SetupAnswers,
  "machineId" | "dataDir" | "logDir" | "tokenEnv" | "pathAllowlist" | "useWsl" | "wslCommand" | "tmuxCommand" | "codexCommand"
> {
  return {
    machineId: hostname().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "codex-host",
    dataDir: "./data",
    logDir: "./logs",
    tokenEnv: "DISCORD_BOT_TOKEN",
    pathAllowlist: [],
    useWsl: platform() === "win32",
    wslCommand: "wsl.exe",
    tmuxCommand: "tmux",
    codexCommand: "codex"
  };
}

async function askRequired(rl: Interface, prompt: string): Promise<string> {
  while (true) {
    const value = (await rl.question(`${prompt}: `)).trim();
    if (value) return value;
    output.write("Required.\n");
  }
}

async function askOptional(rl: Interface, prompt: string): Promise<string | undefined> {
  const value = (await rl.question(`${prompt}: `)).trim();
  return value || undefined;
}

async function askString(rl: Interface, prompt: string, defaultValue: string): Promise<string> {
  const value = (await rl.question(`${prompt} [${defaultValue}]: `)).trim();
  return value || defaultValue;
}

async function askBoolean(rl: Interface, prompt: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const value = (await rl.question(`${prompt} [${suffix}]: `)).trim().toLowerCase();
  if (!value) return defaultValue;
  return ["y", "yes", "true", "1"].includes(value);
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
