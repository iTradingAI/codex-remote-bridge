import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBridgeConfig } from "../src/config.js";
import {
  buildConversationId,
  buildSetupConfig,
  normalizeChannelId,
  normalizeGuildId,
  parseSetupAnswers,
  splitList,
  type SetupAnswers
} from "../src/cli/setup.js";
import { tempDir } from "./helpers.js";

const answers: SetupAnswers = {
  machineId: "win-main",
  dataDir: "./data",
  logDir: "./logs",
  tokenEnv: "DISCORD_BOT_TOKEN",
  applicationId: "app-123",
  guildId: "guild-123",
  channelId: "channel-456",
  authorizedUserIds: ["user-1", "user-2"],
  pathAllowlist: [],
  allowDirectInjection: false,
  useWsl: true,
  wslCommand: "wsl.exe",
  tmuxCommand: "tmux",
  codexCommand: "codex"
};

describe("setup config generation", () => {
  it("builds a bridge config that the runtime loader accepts", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "bridge.local.json");
    await writeFile(configPath, JSON.stringify(buildSetupConfig(answers), null, 2), "utf8");

    const loaded = await loadBridgeConfig(configPath);

    expect(loaded.machineId).toBe("win-main");
    expect(loaded.discord.applicationId).toBe("app-123");
    expect(loaded.discord.allowedScopes).toEqual([
      {
        workspaceId: "guild:guild-123",
        conversationId: "channel:channel-456"
      }
    ]);
    expect(loaded.pathAllowlist).toEqual([]);
    expect(loaded.policy.authorizedUserIds).toEqual(["user-1", "user-2"]);
    expect(loaded.runtime.windows.useWsl).toBe(true);
  });

  it("loads PowerShell-written bridge configs with a UTF-8 BOM", async () => {
    const dir = await tempDir();
    const configPath = join(dir, "bridge.local.json");
    await writeFile(configPath, `\ufeff${JSON.stringify(buildSetupConfig(answers), null, 2)}`, "utf8");

    await expect(loadBridgeConfig(configPath)).resolves.toMatchObject({
      machineId: "win-main",
      discord: { tokenEnv: "DISCORD_BOT_TOKEN" }
    });
  });

  it("keeps channel-only bindings valid when no thread is provided", () => {
    expect(buildConversationId("123")).toBe("channel:123");
    expect(buildConversationId("channel:123", "")).toBe("channel:123");
  });

  it("normalizes prefixed Discord scope IDs without double-prefixing", () => {
    expect(normalizeGuildId("123")).toBe("guild:123");
    expect(normalizeGuildId("guild:123")).toBe("guild:123");
    expect(normalizeChannelId("456")).toBe("channel:456");
    expect(normalizeChannelId("channel:456")).toBe("channel:456");
    expect(buildConversationId("channel:456", "thread:789")).toBe("channel:456/thread:789");
  });

  it("treats legacy answer-file path allowlists as optional", () => {
    const parsed = parseSetupAnswers(
      JSON.stringify({
        ...answers,
        pathAllowlist: undefined
      })
    );

    expect(parsed.pathAllowlist).toEqual([]);
  });

  it("splits comma separated setup values defensively", () => {
    expect(splitList(" user-1, user-2 ,, user-3 ")).toEqual(["user-1", "user-2", "user-3"]);
  });

  it("accepts PowerShell-written answer files with a UTF-8 BOM", () => {
    expect(parseSetupAnswers(`\ufeff${JSON.stringify(answers)}`)).toMatchObject({
      machineId: "win-main",
      applicationId: "app-123",
      wslCommand: "wsl.exe"
    });
  });

  it("keeps token values out of generated bridge config", () => {
    const config = buildSetupConfig({ ...answers, botToken: "fake-sensitive-value" });

    expect(JSON.stringify(config)).not.toContain("fake-sensitive-value");
    expect(config.discord.token_env).toBe("DISCORD_BOT_TOKEN");
  });

  it("repairs mojibake in setup path allowlists before writing config", () => {
    const config = buildSetupConfig({
      ...answers,
      pathAllowlist: ["E:\\KEHU\\202603鏄庤緣"]
    });

    expect(config.path_allowlist).toEqual(["E:\\KEHU\\202603明辉"]);
  });
});
