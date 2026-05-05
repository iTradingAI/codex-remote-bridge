import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { repairUtf8DecodedAsGbk } from "../../encoding/mojibake.js";

export interface PathGuardResult {
  allowed: boolean;
  resolvedPath?: string;
  reason?: string;
}

export class ProjectPathGuard {
  constructor(private readonly allowlist: string[]) {}

  async validate(projectPath: string): Promise<PathGuardResult> {
    const repairedProjectPath = repairUtf8DecodedAsGbk(projectPath);
    if (!isAbsolute(repairedProjectPath)) {
      return { allowed: false, reason: "Project path must be absolute" };
    }

    let resolvedPath: string;
    try {
      resolvedPath = repairUtf8DecodedAsGbk(await realpath(repairedProjectPath));
    } catch {
      return { allowed: false, reason: "Project path does not exist" };
    }

    if (isDangerousRoot(resolvedPath)) {
      return { allowed: false, resolvedPath, reason: "Project path is too broad to bind safely" };
    }

    if (this.allowlist.length > 0) {
      const allowedRoots = await Promise.all(
        this.allowlist.map(async (root) => {
          const repairedRoot = repairUtf8DecodedAsGbk(root);
          try {
            return normalizePath(await realpath(repairedRoot));
          } catch {
            return normalizePath(resolve(repairedRoot));
          }
        })
      );
      const normalizedProject = normalizePath(resolvedPath);

      const allowed = allowedRoots.some(
        (root) => normalizedProject === root || normalizedProject.startsWith(`${root}/`)
      );

      if (!allowed) {
        return { allowed: false, resolvedPath, reason: "Project path is outside allowlist" };
      }
    }

    return { allowed: true, resolvedPath };
  }
}

export function normalizePath(value: string): string {
  const normalized = repairUtf8DecodedAsGbk(value).replace(/\\/g, "/").toLowerCase();
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/g, "");
}

function isDangerousRoot(value: string): boolean {
  const normalized = normalizePath(value);
  return (
    /^[a-z]:$/i.test(normalized) ||
    normalized === "/" ||
    /^[a-z]:\/users$/i.test(normalized) ||
    /^[a-z]:\/windows$/i.test(normalized) ||
    /^[a-z]:\/program files$/i.test(normalized) ||
    normalized === "/home" ||
    normalized === "/users" ||
    normalized === "/usr" ||
    normalized === "/var" ||
    normalized === "/etc"
  );
}
