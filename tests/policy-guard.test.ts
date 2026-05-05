import { describe, expect, it } from "vitest";
import { PolicyGuard } from "../src/core/policy/policy-guard.js";
import { normalizePath, ProjectPathGuard } from "../src/core/policy/project-path-guard.js";
import type { ProjectBinding } from "../src/types.js";
import { tempDir } from "./helpers.js";

describe("PolicyGuard", () => {
  it("normalizes invisible formatting characters for high-risk detection", () => {
    const guard = new PolicyGuard(binding.policy);
    const decision = guard.canSend({ id: "user-1" }, binding, "please p\u200Bush now");
    expect(decision.requiresConfirmation).toBe(true);
  });
});

describe("ProjectPathGuard", () => {
  it("allows arbitrary existing absolute paths when no allowlist is configured", async () => {
    const dir = await tempDir();

    await expect(new ProjectPathGuard([]).validate(dir)).resolves.toMatchObject({
      allowed: true,
      resolvedPath: dir
    });
  });

  it("keeps optional allowlist restriction when configured", async () => {
    const allowed = await tempDir();
    const outside = await tempDir();

    await expect(new ProjectPathGuard([allowed]).validate(outside)).resolves.toMatchObject({
      allowed: false,
      reason: "Project path is outside allowlist"
    });
  });

  it("rejects missing and relative paths", async () => {
    await expect(new ProjectPathGuard([]).validate("relative/path")).resolves.toMatchObject({
      allowed: false,
      reason: "Project path must be absolute"
    });
  });

  it("preserves POSIX root normalization for dangerous-root checks", () => {
    expect(normalizePath("/")).toBe("/");
  });
});

const binding: ProjectBinding = {
  id: "binding-1",
  provider: "discord",
  workspaceId: "guild:1",
  conversationId: "channel:2",
  projectPath: "/tmp/project",
  projectName: "project",
  aliases: [],
  machineId: "test-machine",
  runtime: { kind: "codex-tmux", tmuxSession: "codex-test" },
  sessionMode: "on_demand",
  policy: {
    authorizedUserIds: ["user-1"],
    allowDirectInjection: false,
    requireConfirmationFor: ["push"]
  },
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
