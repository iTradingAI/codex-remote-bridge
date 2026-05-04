import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { hostname, platform, userInfo } from "node:os";
import { dirname } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const CONFIRMATION_KEYWORDS = ["commit", "push", "merge", "delete", "deploy", "reset"];

export interface SetupAnswers {
  machineId: string;
  dataDir: string;
  logDir: string;
  tokenEnv: string;
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
    const tokenEnv = await askString(rl, "Discord bot token env var", defaults.tokenEnv);
    const applicationId = await askRequired(rl, "Discord application ID");
    const guildId = await askRequired(rl, "Discord guild/server ID");
    const channelId = await askRequired(rl, "Discord channel ID");
    const threadId = await askOptional(rl, "Discord thread ID (blank for channel binding)");
    const authorizedUserIds = splitList(
      await askRequired(rl, "Authorized Discord user IDs (comma-separated)")
    );
    const pathAllowlist = splitList(
      await askString(
        rl,
        "Project path allowlist (comma-separated)",
        defaults.pathAllowlist.join(", ")
      )
    );
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
      applicationId,
      guildId,
      channelId,
      threadId,
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
    output.write("Next commands:\n");
    output.write(`  npm run build\n`);
    output.write(`  node dist/src/cli/index.js health --config ${options.outputPath}\n`);
    output.write(`  node dist/src/cli/index.js register-commands --config ${options.outputPath}\n`);
    output.write(`  node dist/src/cli/index.js start --config ${options.outputPath}\n\n`);
    output.write(`Set ${answers.tokenEnv} before register/start. Example:\n`);
    output.write(`  PowerShell: $env:${answers.tokenEnv} = "your-token"\n`);
    output.write(`  bash/zsh: export ${answers.tokenEnv}="your-token"\n`);
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
          conversation_id: buildConversationId(answers.channelId, answers.threadId)
        }
      ]
    },
    path_allowlist: answers.pathAllowlist,
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
}

async function readAnswersFile(path: string): Promise<SetupAnswers> {
  return parseSetupAnswers(await readFile(path, "utf8"));
}

export function parseSetupAnswers(content: string): SetupAnswers {
  const raw = JSON.parse(stripBom(content)) as Partial<SetupAnswers>;
  const answers: SetupAnswers = {
    machineId: requiredString(raw.machineId, "machineId"),
    dataDir: requiredString(raw.dataDir, "dataDir"),
    logDir: requiredString(raw.logDir, "logDir"),
    tokenEnv: raw.tokenEnv || "DISCORD_BOT_TOKEN",
    applicationId: requiredString(raw.applicationId, "applicationId"),
    guildId: requiredString(raw.guildId, "guildId"),
    channelId: requiredString(raw.channelId, "channelId"),
    threadId: optionalString(raw.threadId, "threadId"),
    authorizedUserIds: requiredStringArray(raw.authorizedUserIds, "authorizedUserIds"),
    pathAllowlist: requiredStringArray(raw.pathAllowlist, "pathAllowlist"),
    allowDirectInjection: Boolean(raw.allowDirectInjection),
    useWsl: Boolean(raw.useWsl),
    wslCommand: raw.wslCommand || "wsl.exe",
    wslDistro: optionalString(raw.wslDistro, "wslDistro"),
    tmuxCommand: raw.tmuxCommand || "tmux",
    codexCommand: raw.codexCommand || "codex"
  };
  return answers;
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
    pathAllowlist: defaultAllowlist(),
    useWsl: platform() === "win32",
    wslCommand: "wsl.exe",
    tmuxCommand: "tmux",
    codexCommand: "codex"
  };
}

function defaultAllowlist(): string[] {
  if (platform() === "win32") return ["E:\\Projects"];
  if (platform() === "darwin") return [`/Users/${userInfo().username}/Projects`];
  return ["/srv/projects"];
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
