import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(file: string, args: string[], options?: { cwd?: string; input?: string }): Promise<CommandResult>;
}

export class ExecFileCommandRunner implements CommandRunner {
  async run(
    file: string,
    args: string[],
    options: { cwd?: string; input?: string } = {}
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ exitCode: 1, stdout, stderr: stderr || error.message });
      });
      child.on("close", (code) => {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      });

      if (options.input != null) {
        child.stdin.end(options.input, "utf8");
      } else {
        child.stdin.end();
      }
    });
  }
}
