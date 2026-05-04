import { describe, expect, it } from "vitest";
import { PolicyGuard } from "../src/core/policy/policy-guard.js";
import type { ProjectBinding } from "../src/types.js";

describe("PolicyGuard", () => {
  it("normalizes invisible formatting characters for high-risk detection", () => {
    const guard = new PolicyGuard(binding.policy);
    const decision = guard.canSend({ id: "user-1" }, binding, "please p\u200Bush now");
    expect(decision.requiresConfirmation).toBe(true);
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
  policy: {
    authorizedUserIds: ["user-1"],
    allowDirectInjection: false,
    requireConfirmationFor: ["push"]
  },
  enabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
