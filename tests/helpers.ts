import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BridgeConfig } from "../src/types.js";

export async function tempDir(prefix = "codex-channel-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export function testConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    machineId: "test-machine",
    dataDir: "./data-test",
    logDir: "./logs-test",
    discord: {
      tokenEnv: "DISCORD_BOT_TOKEN",
      applicationId: "app",
      guildId: "guild",
      allowedScopes: [{ workspaceId: "guild:1", conversationId: "channel:2" }]
    },
    pathAllowlist: [],
    runtime: {
      kind: "codex-tmux",
      tmuxCommand: "tmux",
      codexCommand: "codex",
      windows: {
        useWsl: true,
        wslCommand: "wsl.exe"
      }
    },
    policy: {
      authorizedUserIds: ["user-1"],
      allowDirectInjection: false,
      requireConfirmationFor: ["push", "delete"]
    },
    ...overrides
  };
}
