import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface PathGuardResult {
  allowed: boolean;
  resolvedPath?: string;
  reason?: string;
}

export class ProjectPathGuard {
  constructor(private readonly allowlist: string[]) {}

  async validate(projectPath: string): Promise<PathGuardResult> {
    if (!isAbsolute(projectPath)) {
      return { allowed: false, reason: "Project path must be absolute" };
    }

    let resolvedPath: string;
    try {
      resolvedPath = await realpath(projectPath);
    } catch {
      return { allowed: false, reason: "Project path does not exist" };
    }

    const allowedRoots = await Promise.all(
      this.allowlist.map(async (root) => {
        try {
          return normalizePath(await realpath(root));
        } catch {
          return normalizePath(resolve(root));
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

    if (isDangerousRoot(resolvedPath)) {
      return { allowed: false, resolvedPath, reason: "Project path is too broad to bind safely" };
    }

    return { allowed: true, resolvedPath };
  }
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isDangerousRoot(value: string): boolean {
  const normalized = normalizePath(value);
  return /^[a-z]:$/i.test(normalized) || normalized === "/" || normalized.endsWith(":/users");
}
