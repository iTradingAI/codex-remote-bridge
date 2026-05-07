import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BindingRegistry } from "../src/core/bindings/binding-registry.js";
import { PolicyGuard } from "../src/core/policy/policy-guard.js";
import { ProjectPathGuard } from "../src/core/policy/project-path-guard.js";
import { CommandRouter } from "../src/core/router/router.js";
import type { CodexRuntime } from "../src/runtime/codex-tmux/codex-tmux-runtime.js";
import { AuditLog } from "../src/storage/audit-log.js";
import { ApprovalStore } from "../src/storage/approval-store.js";
import {
  emptyApprovals,
  emptyBindings,
  emptyExecutionStates,
  type BindingsDocument,
  type ExecutionStatesDocument,
  type PendingApprovalsDocument
} from "../src/storage/documents.js";
import { ExecutionStateStore } from "../src/storage/execution-state-store.js";
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
      new ExecutionStateStore(
        new JsonFileStore<ExecutionStatesDocument>(
          join(dir, "execution-states.json"),
          emptyExecutionStates
        )
      ),
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
    expect(response.fields).toEqual(
      expect.arrayContaining([
        { label: "session mode", value: "on_demand" },
        { label: "tmux state", value: "running" }
      ])
    );
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
    const secretText = "please git push with TOKEN=fake-sensitive-value";
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
    expect(response.text).toContain("点击下方");
    expect(response.actions).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^confirm:/),
        label: "确认",
        style: "success"
      })
    ]);
    const pending = await readFile(join(dir, "pending.json"), "utf8");
    expect(pending).not.toContain(secretText);
    expect(pending).not.toContain("fake-sensitive-value");
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

  it("binds arbitrary existing paths without a default allowlist", async () => {
    const dir = await tempDir();
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]));

    const pending = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2/thread:project"
      },
      actor: { id: "user-1" },
      command: "bind",
      args: { path: dir }
    });
    expect(pending.kind).toBe("approval");
    expect(pending.actions?.[0]).toMatchObject({
      id: expect.stringMatching(/^confirm:/),
      label: "确认"
    });
  });

  it("routes slash sends to the bound project session", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime();
    const config = testConfig({
      dataDir: dir,
      policy: { authorizedUserIds: ["user-1"], allowDirectInjection: false, requireConfirmationFor: [] }
    });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2/thread:project"
      },
      projectPath: dir
    });
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);

    const response = await router.handle({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2/thread:project"
      },
      actor: { id: "user-1" },
      command: "send",
      args: { text: "hello" }
    });

    expect(response).toMatchObject({ kind: "summary", text: "codex replied" });
  });

  it("natural direct messages force resume-last when direct injection is enabled", async () => {
    const dir = await tempDir();
    let resumeOption: unknown;
    const runtime = fakeRuntime({
      ensureSession: async (_binding, options) => {
        resumeOption = options?.resume;
        return {
          bindingId: "binding-1",
          machineId: "test-machine",
          projectPath: dir,
          tmuxSession: "codex-test",
          lastSeenAt: new Date().toISOString()
        };
      }
    });
    const config = testConfig({
      dataDir: dir,
      policy: { authorizedUserIds: ["user-1"], allowDirectInjection: true, requireConfirmationFor: [] }
    });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2/thread:project"
    };
    await registry.bind({ conversation, projectPath: dir });
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);

    await router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "continue previous work" },
      rawText: "continue previous work"
    });

    expect(resumeOption).toBe("last");
  });

  it("/codex new forces a non-resumed session", async () => {
    const dir = await tempDir();
    let resumeOption: unknown;
    const runtime = fakeRuntime({
      ensureSession: async (_binding, options) => {
        resumeOption = options?.resume;
        return {
          bindingId: "binding-1",
          machineId: "test-machine",
          projectPath: dir,
          tmuxSession: "codex-test",
          lastSeenAt: new Date().toISOString()
        };
      }
    });
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2"
    };
    await registry.bind({ conversation, projectPath: dir });
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);

    await router.handle({ conversation, actor: { id: "user-1" }, command: "new", args: {} });

    expect(resumeOption).toBe("never");
  });

  it("serializes sends for the same bound project", async () => {
    const dir = await tempDir();
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;
    const runtime = fakeRuntime({
      sendAndWaitForOutput: async (_session, text) => {
        if (text === "first") {
          firstStarted = true;
          await firstCanFinish;
          return "first reply";
        }
        secondStarted = true;
        return "second reply";
      }
    });
    const config = testConfig({
      dataDir: dir,
      policy: { authorizedUserIds: ["user-1"], allowDirectInjection: true, requireConfirmationFor: [] }
    });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2/thread:project"
    };
    await registry.bind({ conversation, projectPath: dir });
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);

    const first = router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "first" }
    });
    await waitUntil(() => firstStarted);
    const second = router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "second" }
    });
    await sleep(10);

    expect(secondStarted).toBe(false);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ text: "first reply" });
    await expect(second).resolves.toMatchObject({ text: "second reply" });
    expect(secondStarted).toBe(true);
  });

  it("allows different bound projects to run concurrently", async () => {
    const dir = await tempDir();
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted = false;
    const runtime = fakeRuntime({
      sendAndWaitForOutput: async (_session, text) => {
        if (text === "first") {
          await firstCanFinish;
          return "first reply";
        }
        secondStarted = true;
        return "second reply";
      }
    });
    const config = testConfig({
      dataDir: dir,
      policy: { authorizedUserIds: ["user-1"], allowDirectInjection: true, requireConfirmationFor: [] }
    });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const firstConversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2/thread:first"
    };
    const secondConversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2/thread:second"
    };
    await registry.bind({ conversation: firstConversation, projectPath: dir });
    await registry.bind({ conversation: secondConversation, projectPath: dir });
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);

    const first = router.handle({
      conversation: firstConversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "first" }
    });
    const second = router.handle({
      conversation: secondConversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "second" }
    });
    await waitUntil(() => secondStarted);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ text: "first reply" });
    await expect(second).resolves.toMatchObject({ text: "second reply" });
  });

  it("pins and unpins session residency", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime();
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
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
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2"
    };

    await expect(
      router.handle({ conversation, actor: { id: "user-1" }, command: "pin", args: {} })
    ).resolves.toMatchObject({ title: "Codex session pinned" });
    await expect(registry.findByConversation(conversation)).resolves.toMatchObject({
      sessionMode: "pinned"
    });
    await expect(
      router.handle({ conversation, actor: { id: "user-1" }, command: "unpin", args: {} })
    ).resolves.toMatchObject({ title: "Codex session unpinned" });
    await expect(registry.findByConversation(conversation)).resolves.toMatchObject({
      sessionMode: "on_demand"
    });
  });

  it("degrades stale active execution state when tmux is missing", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime({ discoverExisting: async () => null });
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
    const registry = new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
    const binding = await registry.bind({
      conversation: {
        provider: "discord",
        workspaceId: "guild:1",
        conversationId: "channel:2"
      },
      projectPath: dir
    });
    const executionStates = new ExecutionStateStore(
      new JsonFileStore<ExecutionStatesDocument>(
        join(dir, "execution-states.json"),
        emptyExecutionStates
      )
    );
    await executionStates.set(binding, "executing", "stale work");
    const router = newTestRouter(
      dir,
      config,
      registry,
      new ProjectPathGuard([]),
      runtime,
      executionStates
    );

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

    expect(response.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "execution state", value: expect.stringContaining("idle") })
      ])
    );
  });

  it("keeps high-risk confirmation waiting even when no tmux session exists", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime({ discoverExisting: async () => null });
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
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
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2"
    };

    await expect(
      router.handle({
        conversation,
        actor: { id: "user-1" },
        command: "send",
        args: { text: "please delete the remote branch" }
      })
    ).resolves.toMatchObject({ kind: "approval" });

    const status = await router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "status",
      args: {}
    });

    expect(status.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "execution state",
          value: expect.stringContaining("waiting_input")
        })
      ])
    );
  });

  it("marks session-start failures as failed instead of leaving execution active", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime({
      ensureSession: async () => {
        throw new Error("tmux unavailable");
      },
      discoverExisting: async () => null
    });
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
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
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2"
    };

    await expect(
      router.handle({ conversation, actor: { id: "user-1" }, command: "start", args: {} })
    ).resolves.toMatchObject({ kind: "error", text: "tmux unavailable" });

    const status = await router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "status",
      args: {}
    });
    expect(status.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "execution state", value: expect.stringContaining("failed") })
      ])
    );
  });

  it("marks confirmed send runtime failures as failed", async () => {
    const dir = await tempDir();
    const runtime = fakeRuntime({
      ensureSession: async () => {
        throw new Error("codex session failed");
      },
      discoverExisting: async () => null
    });
    const config = testConfig({ dataDir: dir, pathAllowlist: [] });
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
    const router = newTestRouter(dir, config, registry, new ProjectPathGuard([]), runtime);
    const conversation = {
      provider: "discord" as const,
      workspaceId: "guild:1",
      conversationId: "channel:2"
    };

    const approval = await router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "send",
      args: { text: "delete the production branch" }
    });
    const code = approval.text.match(/code:([A-F0-9]+)/)?.[1];
    expect(code).toBeDefined();

    await expect(
      router.handle({
        conversation,
        actor: { id: "user-1" },
        command: "confirm",
        args: { code }
      })
    ).resolves.toMatchObject({ kind: "error", text: "codex session failed" });

    const status = await router.handle({
      conversation,
      actor: { id: "user-1" },
      command: "status",
      args: {}
    });
    expect(status.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "execution state", value: expect.stringContaining("failed") })
      ])
    );
  });
});

function newTestRouter(
  dir: string,
  config = testConfig(),
  registry?: BindingRegistry,
  pathGuard = new ProjectPathGuard([dir]),
  runtime = fakeRuntime(),
  executionStates = new ExecutionStateStore(
    new JsonFileStore<ExecutionStatesDocument>(
      join(dir, "execution-states.json"),
      emptyExecutionStates
    )
  )
): CommandRouter {
  const bindings =
    registry ??
    new BindingRegistry(
      config,
      new JsonFileStore<BindingsDocument>(join(dir, "bindings.json"), emptyBindings)
    );
  return new CommandRouter(
    config,
    bindings,
    pathGuard,
    new PolicyGuard(config.policy),
    new ApprovalStore(
      new JsonFileStore<PendingApprovalsDocument>(join(dir, "pending.json"), emptyApprovals)
    ),
    runtime,
    executionStates,
    new AuditLog(join(dir, "audit.jsonl"))
  );
}

function fakeRuntime(overrides: Partial<CodexRuntime> = {}): CodexRuntime {
  return {
    ensureSession: async () => ({
      bindingId: "binding-1",
      machineId: "test-machine",
      projectPath: "/tmp/project",
      tmuxSession: "codex-test",
      lastSeenAt: new Date().toISOString()
    }),
    send: async () => undefined,
    sendAndWaitForOutput: async () => "codex replied",
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
      throw new Error("Unexpected reconcile call in router test fake");
    },
    stop: async () => undefined,
    ...overrides
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(1);
  }
  throw new Error("Timed out waiting for condition");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
