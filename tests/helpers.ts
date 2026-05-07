import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BridgeConfig } from "../src/types.js";

export async function tempDir(prefix = "codex-remote-bridge-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function testConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    machineId: "test-machine",
    dataDir: "./data-test",
    logDir: "./logs-test",
    pathAllowlist: [],
    ...overrides,
    discord: {
      tokenEnv: overrides.discord?.tokenEnv ?? "DISCORD_BOT_TOKEN",
      applicationId: overrides.discord?.applicationId ?? "app",
      guildId: overrides.discord?.guildId ?? "guild",
      allowedScopes: overrides.discord?.allowedScopes ?? [
        { workspaceId: "guild:1", conversationId: "channel:2" }
      ]
    },
    runtime: {
      kind: "codex-tmux",
      tmuxCommand: overrides.runtime?.tmuxCommand ?? "tmux",
      codexCommand: overrides.runtime?.codexCommand ?? "codex",
      windows: {
        useWsl: overrides.runtime?.windows?.useWsl ?? true,
        wslCommand: overrides.runtime?.windows?.wslCommand ?? "wsl.exe",
        distro: overrides.runtime?.windows?.distro
      }
    },
    policy: {
      authorizedUserIds: overrides.policy?.authorizedUserIds ?? ["user-1"],
      allowDirectInjection: overrides.policy?.allowDirectInjection ?? false,
      requireConfirmationFor: overrides.policy?.requireConfirmationFor ?? ["push", "delete"]
    }
  };
}
