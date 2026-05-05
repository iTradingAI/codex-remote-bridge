import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBridge } from "../src/app.js";
import { ProcessLock } from "../src/storage/process-lock.js";
import { tempDir } from "./helpers.js";

describe("createBridge", () => {
  it("allows non-resident operations while the bridge data directory is locked", async () => {
    const dir = await tempDir();
    const dataDir = join(dir, "data");
    const configPath = join(dir, "bridge.json");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          machine_id: "test-machine",
          data_dir: dataDir,
          log_dir: join(dir, "logs"),
          discord: {
            token_env: "DISCORD_BOT_TOKEN",
            application_id: "app",
            guild_id: "guild",
            allowed_scopes: [{ workspace_id: "guild:1", conversation_id: "channel:2" }]
          },
          path_allowlist: [],
          runtime: {
            kind: "codex-tmux",
            tmux_command: "tmux",
            codex_command: "codex",
            windows: { use_wsl: false, wsl_command: "wsl.exe", distro: null }
          },
          policy: {
            authorized_user_ids: ["user-1"],
            allow_direct_injection: false,
            require_confirmation_for: []
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const lock = await ProcessLock.acquire(join(dataDir, ".bridge.lock"));
    try {
      await expect(createBridge(configPath)).rejects.toThrow(/already locked/);
      const bridge = await createBridge(configPath, { acquireLock: false });
      await bridge.release();
    } finally {
      await lock.release();
    }
  });
});
