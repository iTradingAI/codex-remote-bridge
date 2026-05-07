import { existsSync } from "node:fs";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";
import { ExecFileCommandRunner, type CommandRunner } from "../runtime/process.js";

export interface UpdateOptions {
  configPath: string;
  force?: boolean;
  skipRegister?: boolean;
  skipRestart?: boolean;
  runner?: CommandRunner;
  cwd?: string;
  cliPath?: string;
}

interface UpdateStep {
  label: string;
  file: string;
  args: string[];
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const runner = options.runner ?? new ExecFileCommandRunner();
  const cliPath = resolve(options.cliPath ?? process.argv[1]);
  const cwd = resolve(options.cwd ?? inferProjectRoot(cliPath));

  if (!options.force) {
    await assertCleanWorktree(runner, cwd);
  }

  const steps: UpdateStep[] = [
    { label: "Pull latest changes", file: "git", args: ["pull", "--ff-only"] },
    { label: "Install dependencies", file: npmCommand(), args: ["install"] },
    { label: "Build project", file: npmCommand(), args: ["run", "build"] },
    { label: "Link crb command", file: npmCommand(), args: ["link"] }
  ];
  if (!options.skipRegister) {
    steps.push({
      label: "Register Discord slash commands",
      file: process.execPath,
      args: [cliPath, "register", "--config", options.configPath]
    });
  }
  if (!options.skipRestart) {
    steps.push({
      label: "Restart bridge daemon",
      file: process.execPath,
      args: [cliPath, "restart", "--config", options.configPath]
    });
  }

  for (const step of steps) {
    console.log(`\n==> ${step.label}`);
    const result = await runner.run(step.file, step.args, { cwd });
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    if (result.exitCode !== 0) {
      throw new Error(`${step.label} failed with exit code ${result.exitCode}.`);
    }
  }
  console.log("\nUpdate completed.");
}

function inferProjectRoot(cliPath: string): string {
  return resolve(dirname(cliPath), "../../..");
}

function npmCommand(): string {
  return platform() === "win32" ? "npm.cmd" : "npm";
}

async function assertCleanWorktree(runner: CommandRunner, cwd: string): Promise<void> {
  if (!existsSync(resolve(cwd, ".git"))) return;
  const result = await runner.run("git", ["status", "--porcelain"], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to inspect git status: ${result.stderr || result.stdout}`);
  }
  if (result.stdout.trim()) {
    throw new Error(
      "Worktree has local changes. Commit/stash them first, or rerun with --force if you intentionally want to update anyway."
    );
  }
}
