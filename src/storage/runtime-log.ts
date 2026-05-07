import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface RuntimeLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export class RuntimeLog {
  constructor(private readonly filePath: string) {}

  async append(level: RuntimeLogEntry["level"], message: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({ at: new Date().toISOString(), level, message })}\n`,
      "utf8"
    );
  }
}

export function installConsoleRuntimeLog(filePath: string): () => void {
  const runtimeLog = new RuntimeLog(filePath);
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  console.info = (...args: unknown[]) => {
    original.info(...args);
    void runtimeLog.append("info", formatConsoleArgs(args)).catch(() => undefined);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    void runtimeLog.append("warn", formatConsoleArgs(args)).catch(() => undefined);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    void runtimeLog.append("error", formatConsoleArgs(args)).catch(() => undefined);
  };

  return () => {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  };
}

export async function readRuntimeLogTail(
  filePath: string,
  options: { lines?: number; errorsOnly?: boolean } = {}
): Promise<string[]> {
  const raw = await readFile(filePath, "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const filtered = options.errorsOnly
    ? lines.filter((line) => {
        try {
          return (JSON.parse(line) as RuntimeLogEntry).level === "error";
        } catch {
          return /error/i.test(line);
        }
      })
    : lines;
  return filtered.slice(-(options.lines ?? 100));
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack ?? arg.message;
      if (typeof arg === "string") return arg;
      return JSON.stringify(arg);
    })
    .join(" ");
}
