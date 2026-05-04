import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

const LOCAL_ENV_FILES = [".env", ".env.local"];

export async function loadLocalEnvFiles(cwd = process.cwd()): Promise<void> {
  for (const file of LOCAL_ENV_FILES) {
    const path = `${cwd}/${file}`;
    if (!existsSync(path)) continue;
    const entries = parseEnvFile(await readFile(path, "utf8"));
    for (const [key, value] of Object.entries(entries)) {
      process.env[key] ??= value;
    }
  }
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of stripBom(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = unquoteEnvValue(line.slice(equals + 1).trim());
    if (isEnvVarName(key)) result[key] = value;
  }
  return result;
}

export async function upsertLocalEnvValue(name: string, value: string, path = ".env.local"): Promise<void> {
  if (!isEnvVarName(name)) {
    throw new Error(`${name} is not a valid environment variable name`);
  }
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const nextLine = `${name}=${quoteEnvValue(value)}`;
  const lines = existing ? stripBom(existing).split(/\r?\n/) : [];
  let replaced = false;
  const updated = lines.map((line) => {
    const equals = line.indexOf("=");
    const key = equals > 0 ? line.slice(0, equals).trim() : "";
    if (key === name) {
      replaced = true;
      return nextLine;
    }
    return line;
  });
  if (!replaced) updated.push(nextLine);
  await writeFile(path, `${updated.filter((line, index) => line || index < updated.length - 1).join("\n")}\n`, "utf8");
  process.env[name] = value;
}

export function isEnvVarName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function looksLikeDiscordToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}$/.test(value.trim());
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
