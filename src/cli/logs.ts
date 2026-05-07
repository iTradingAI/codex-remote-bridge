import { join } from "node:path";
import { loadBridgeConfig } from "../config.js";
import { readRuntimeLogTail } from "../storage/runtime-log.js";
import { storagePaths } from "../storage/paths.js";

export interface LogsOptions {
  lines?: number;
  errorsOnly?: boolean;
  audit?: boolean;
}

export async function runLogs(configPath: string, options: LogsOptions = {}): Promise<void> {
  const config = await loadBridgeConfig(configPath);
  const path = options.audit ? storagePaths(config).audit : join(config.logDir, "bridge.jsonl");
  const lines = await readRuntimeLogTail(path, {
    lines: options.lines,
    errorsOnly: options.errorsOnly
  });
  if (lines.length === 0) {
    console.log(`No log entries found at ${path}.`);
    return;
  }
  for (const line of lines) {
    console.log(formatLogLine(line));
  }
}

function formatLogLine(line: string): string {
  try {
    const entry = JSON.parse(line) as { at?: string; level?: string; message?: string; summary?: string; action?: string };
    if (entry.message) {
      return `[${entry.at ?? "unknown"}] ${entry.level ?? "info"} ${entry.message}`;
    }
    if (entry.summary) {
      return `[${entry.at ?? "unknown"}] audit ${entry.action ?? "event"} ${entry.summary}`;
    }
  } catch {
    // Fall through to raw output.
  }
  return line;
}
