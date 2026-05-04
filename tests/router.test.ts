import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BindingRegistry } from "../src/core/bindings/binding-registry.js";
import { PolicyGuard } from "../src/core/policy/policy-guard.js";
import { ProjectPathGuard } from "../src/core/policy/project-path-guard.js";
import { CommandRouter } from "../src/core/router/router.js";
import type { CodexTmuxRuntime } from "../src/runtime/codex-tmux/codex-tmux-runtime.js";
import { AuditLog } from "../src/storage/audit-log.js";
import { ApprovalStore } from "../src/storage/approval-store.js";
import {
  emptyApprovals,
  emptyBindings,
  type BindingsDocument,
  type PendingApprovalsDocument
} from "../src/storage/documents.js";
import { JsonFileStore } from "../src/storage/json-file-store.js";
import { tempDir, testConfig } from "./helpers.js";

describe("CommandRouter", () => {
  it("blocks natural-message injection when direct injection is disabled", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [dir] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const router = new CommandRouter(
      config,
      registry,
      new ProjectPathGuard([dir]),
      new PolicyGuard(config.policy),
      new ApprovalStore(
        new JsonFileStore<PendingApprovalsDocument>(join(dir, "pending.json"), emptyApprovals)
      ),
      fakeRuntime(),
      new AuditLog(join(dir, "audit.jsonl"))
    );

    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      actor: { id: "user-1" },
      command: "send",
      args: { text: "hello" },
      rawText: "hello",
      messageId: "message-1"
    });

    expect(response).toMatchObject({
      kind: "error",
      text: expect.stringContaining("Direct message injection is disabled")
    });
  });

  it("does not expose project list to unauthorized users", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [dir] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const router = newTestRouter(dir, config, registry);
    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      actor: { id: "user-2" },
      command: "projects",
      args: {}
    });

    expect(response.kind).toBe("error");
    expect(response.text).not.toContain(dir);
  });

  it("includes recent pane output in status when a session exists", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [dir] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const router = newTestRouter(dir, config, registry);
    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      actor: { id: "user-1" },
      command: "status",
      args: {}
    });

    expect(response).toMatchObject({
      kind: "status",
      text: "recent pane output"
    });
  });

  it("does not persist high-risk send text in pending approvals", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [dir] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const router = newTestRouter(dir, config, registry);
    const secretText = "please git push with TOKEN=super-secret";
    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      actor: { id: "user-1" },
      command: "send",
      args: { text: secretText }
    });

    expect(response.kind).toBe("approval");
    const pending = await readFile(join(dir, "pending.json"), "utf8");
    expect(pending).not.toContain(secretText);
    expect(pending).not.toContain("super-secret");
  });

  it("unbinds only for authorized users", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [dir] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });

    const router = newTestRouter(dir, config, registry);
    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      actor: { id: "user-1" },
      command: "unbind",
      args: {}
    });

    expect(response).toMatchObject({ kind: "status", title: "Project unbound" });
    expect(
      await registry.findByConversation({
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      })
    ).toBeUndefined();
  });
});

function newTestRouter(dir: string, config = testConfig(), registry?: BindingRegistry): CommandRouter {
  const bindings =
    registry ??
    new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
  return new CommandRouter(
    config,
    bindings,
    new ProjectPathGuard([dir]),
    new PolicyGuard(config.policy),
    new ApprovalStore(
      new JsonFileStore<PendingApprovalsDocument>(join(dir, "pending.json"), emptyApprovals)
    ),
    fakeRuntime(),
    new AuditLog(join(dir, "audit.jsonl"))
  );
}

function fakeRuntime(): CodexTmuxRuntime {
  return {
    ensureSession: async () => {
      throw new Error("should not be called");
    },
    send: async () => undefined,
    readRecent: async () => "recent pane output",
    discoverExisting: async () => ({
      bindingId: "binding-1",
      machineId: "test-machine",
      projectPath: "/tmp/project",
      tmuxSession: "codex-test",
      lastSeenAt: new Date().toISOString()
    }),
    status: async () => ({ state: "running" }),
    detect: async () => ({
      platform: "posix",
      available: true,
      tmuxAvailable: true,
      codexAvailable: true
    }),
    reconcile: async () => {
      throw new Error("not implemented");
    },
    stop: async () => undefined
  } as unknown as CodexTmuxRuntime;
}
