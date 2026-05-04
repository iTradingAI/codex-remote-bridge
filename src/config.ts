import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BridgeConfig } from "./types.js";
import { repairUtf8DecodedAsGbkList } from "./encoding/mojibake.js";

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown, name: string): RawRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as RawRecord;
}

function stringField(source: RawRecord, snake: string, camel: string, fallback?: string): string {
  const value = source[snake] ?? source[camel] ?? fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${snake} must be a non-empty string`);
  }
  return value;
}

function optionalStringField(source: RawRecord, snake: string, camel: string): string | undefined {
  const value = source[snake] ?? source[camel];
  if (value == null) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${snake} must be a string when set`);
  }
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value;
}

function unknownArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

export async function loadBridgeConfig(configPath: string): Promise<BridgeConfig> {
  const absolutePath = resolve(configPath);
  const raw = JSON.parse(stripBom(await readFile(absolutePath, "utf8"))) as unknown;
  const root = asRecord(raw, "config");
  const discord = asRecord(root.discord, "discord");
  const runtime = asRecord(root.runtime, "runtime");
  const runtimeWindows = asRecord(runtime.windows ?? {}, "runtime.windows");
  const policy = asRecord(root.policy, "policy");

  return {
    machineId: stringField(root, "machine_id", "machineId"),
    dataDir: stringField(root, "data_dir", "dataDir", "./data"),
    logDir: stringField(root, "log_dir", "logDir", "./logs"),
    discord: {
      tokenEnv: stringField(discord, "token_env", "tokenEnv", "DISCORD_BOT_TOKEN"),
      applicationId: stringField(discord, "application_id", "applicationId"),
      guildId: optionalStringField(discord, "guild_id", "guildId"),
      allowedScopes: unknownArray(
        discord.allowed_scopes ?? discord.allowedScopes ?? [],
        "discord.allowed_scopes"
      ).map((scope, index) => {
          const record = asRecord(scope, `discord.allowed_scopes[${index}]`);
          return {
            workspaceId: stringField(record, "workspace_id", "workspaceId"),
            conversationId: optionalStringField(record, "conversation_id", "conversationId")
          };
        })
    },
    pathAllowlist: repairUtf8DecodedAsGbkList(
      stringArray(root.path_allowlist ?? root.pathAllowlist ?? [], "path_allowlist")
    ),
    runtime: {
      kind: "codex-tmux",
      tmuxCommand: stringField(runtime, "tmux_command", "tmuxCommand", "tmux"),
      codexCommand: stringField(runtime, "codex_command", "codexCommand", "codex"),
      windows: {
        useWsl: Boolean(runtimeWindows.use_wsl ?? runtimeWindows.useWsl ?? true),
        wslCommand: stringField(runtimeWindows, "wsl_command", "wslCommand", "wsl.exe"),
        distro: optionalStringField(runtimeWindows, "distro", "distro")
      }
    },
    policy: {
      authorizedUserIds: stringArray(
        policy.authorized_user_ids ?? policy.authorizedUserIds ?? [],
        "policy.authorized_user_ids"
      ),
      allowDirectInjection: Boolean(
        policy.allow_direct_injection ?? policy.allowDirectInjection ?? false
      ),
      requireConfirmationFor: stringArray(
        policy.require_confirmation_for ?? policy.requireConfirmationFor ?? [],
        "policy.require_confirmation_for"
      )
    }
  };
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
