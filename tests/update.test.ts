import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runUpdate } from "../src/cli/update.js";
import type { CommandResult, CommandRunner } from "../src/runtime/process.js";
import { tempDir } from "./helpers.js";

class FakeRunner implements CommandRunner {
  calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
  gitStatus = "";

  async run(file: string, args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
    this.calls.push({ file, args, cwd: options.cwd });
    if (file === "git" && args.join(" ") === "status --porcelain") {
      return { exitCode: 0, stdout: this.gitStatus, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("crb update", () => {
  it("runs pull, install, build, link, register, and restart in order", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, ".git"));
    const runner = new FakeRunner();

    await runUpdate({
      configPath: "config/bridge.local.json",
      cwd: dir,
      cliPath: join(dir, "dist/src/cli/index.js"),
      runner
    });

    expect(runner.calls.map((call) => [call.file, ...call.args])).toEqual([
      ["git", "status", "--porcelain"],
      ["git", "pull", "--ff-only"],
      [expect.stringMatching(/^npm(\.cmd)?$/), "install"],
      [expect.stringMatching(/^npm(\.cmd)?$/), "run", "build"],
      [expect.stringMatching(/^npm(\.cmd)?$/), "link"],
      [process.execPath, join(dir, "dist/src/cli/index.js"), "register", "--config", "config/bridge.local.json"],
      [process.execPath, join(dir, "dist/src/cli/index.js"), "restart", "--config", "config/bridge.local.json"]
    ]);
  });

  it("refuses to update a dirty worktree unless forced", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, ".git"));
    await writeFile(join(dir, "README.md"), "changed", "utf8");
    const runner = new FakeRunner();
    runner.gitStatus = " M README.md\n";

    await expect(
      runUpdate({
        configPath: "config/bridge.local.json",
        cwd: dir,
        cliPath: join(dir, "dist/src/cli/index.js"),
        runner
      })
    ).rejects.toThrow(/Worktree has local changes/);
  });

  it("defaults to the repository root inferred from the built CLI path", async () => {
    const dir = await tempDir();
    const cliPath = join(dir, "dist", "src", "cli", "index.js");
    await mkdir(join(dir, ".git"));
    const runner = new FakeRunner();

    await runUpdate({
      configPath: "config/bridge.local.json",
      cliPath,
      runner,
      skipRegister: true,
      skipRestart: true
    });

    expect(runner.calls.every((call) => call.cwd === dir)).toBe(true);
  });
});
