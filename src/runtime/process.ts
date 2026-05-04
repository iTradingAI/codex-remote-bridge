import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(file: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export class ExecFileCommandRunner implements CommandRunner {
  async run(file: string, args: string[], options: { cwd?: string } = {}): Promise<CommandResult> {
    try {
      const result = await execFileAsync(file, args, {
        cwd: options.cwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        exitCode: typeof execError.code === "number" ? execError.code : 1,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message
      };
    }
  }
}
