import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isEnvVarName,
  loadLocalEnvFiles,
  looksLikeDiscordToken,
  parseEnvFile,
  upsertLocalEnvValue
} from "../src/cli/env.js";
import { maskProxyUrl, normalizeProxyUrl, selectProxyEnv } from "../src/cli/proxy.js";
import { tempDir } from "./helpers.js";

describe("local env handling", () => {
  it("parses local env files without overriding existing process env", async () => {
    const previous = process.env.CODEX_CHANNEL_TEST_TOKEN;
    process.env.CODEX_CHANNEL_TEST_TOKEN = "existing";
    try {
      const dir = await tempDir();
      await writeFile(join(dir, ".env.local"), 'CODEX_CHANNEL_TEST_TOKEN="from-file"\n', "utf8");

      await loadLocalEnvFiles(dir);

      expect(process.env.CODEX_CHANNEL_TEST_TOKEN).toBe("existing");
    } finally {
      if (previous == null) delete process.env.CODEX_CHANNEL_TEST_TOKEN;
      else process.env.CODEX_CHANNEL_TEST_TOKEN = previous;
    }
  });

  it("upserts quoted values that can be read back", async () => {
    const dir = await tempDir();
    const path = join(dir, ".env.local");
    await upsertLocalEnvValue("DISCORD_BOT_TOKEN", "abc.def/ghi", path);

    expect(parseEnvFile(await readFile(path, "utf8"))).toEqual({
      DISCORD_BOT_TOKEN: "abc.def/ghi"
    });
  });

  it("distinguishes env var names from Discord token-shaped values", () => {
    expect(isEnvVarName("DISCORD_BOT_TOKEN")).toBe(true);
    expect(isEnvVarName("not-a name")).toBe(false);
    expect(looksLikeDiscordToken("x".repeat(24) + "." + "y".repeat(6) + "." + "z".repeat(28))).toBe(
      true
    );
  });

  it("selects CXB proxy before generic proxy environment variables", () => {
    expect(
      selectProxyEnv({
        HTTPS_PROXY: "http://127.0.0.1:7890",
        CXB_PROXY: "127.0.0.1:7891"
      })?.url
    ).toBe("http://127.0.0.1:7891/");
  });

  it("normalizes and validates proxy URLs", () => {
    expect(normalizeProxyUrl("127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
    expect(() => normalizeProxyUrl("socks5://127.0.0.1:7890")).toThrow(/Unsupported proxy/);
  });

  it("masks proxy credentials for diagnostic output", () => {
    expect(maskProxyUrl("http://user:pass@127.0.0.1:7890")).toBe(
      "http://***:***@127.0.0.1:7890/"
    );
  });
});
