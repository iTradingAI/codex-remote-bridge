import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CodexTmuxRuntime,
  outputAfterSend
} from "../src/runtime/codex-tmux/codex-tmux-runtime.js";
import type { CommandResult, CommandRunner } from "../src/runtime/process.js";
import { emptySessions, type SessionsDocument } from "../src/storage/documents.js";
import { JsonFileStore } from "../src/storage/json-file-store.js";
import type { ProjectBinding } from "../src/types.js";
import { tempDir, testConfig } from "./helpers.js";

class FakeRunner implements CommandRunner {
  calls: Array<{ file: string; args: string[] }> = [];
  sessionExists = false;
  paneOutputs = ["recent output\n"];

  async run(file: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ file, args });
    const text = args.join(" ");
    if (text.includes("--version") || text.includes("-V")) {
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }
    if (text.includes("has-session")) {
      return { exitCode: this.sessionExists ? 0 : 1, stdout: "", stderr: "" };
    }
    if (text.includes("new-session")) {
      this.sessionExists = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (text.includes("capture-pane")) {
      return { exitCode: 0, stdout: this.paneOutputs.shift() ?? "recent output\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("CodexTmuxRuntime", () => {
  it("starts a missing session and records it", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    const runtime = new CodexTmuxRuntime(
      testConfig({ dataDir: dir }),
      new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions),
      runner
    );

    const session = await runtime.ensureSession(binding(dir));
    expect(session.tmuxSession).toBe("codex-test");
    expect(runner.calls.some((call) => call.args.includes("new-session"))).toBe(true);
  });

  it("rediscovers an existing session during reconcile", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    runner.sessionExists = true;
    const runtime = new CodexTmuxRuntime(
      testConfig({ dataDir: dir }),
      new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions),
      runner
    );

    const session = await runtime.reconcile(binding(dir));
    expect(session.bindingId).toBe("binding-1");
    expect(runner.calls.some((call) => call.args.includes("new-session"))).toBe(false);
  });

  it("uses a unique tmux buffer for each send and deletes it", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    const runtime = new CodexTmuxRuntime(
      testConfig({ dataDir: dir }),
      new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions),
      runner
    );

    await runtime.send(
      {
        bindingId: "binding-1",
        machineId: "test-machine",
        projectPath: dir,
        tmuxSession: "codex-test",
        lastSeenAt: new Date().toISOString()
      },
      "hello"
    );

    const setBuffer = runner.calls.find((call) => call.args.includes("set-buffer"));
    const pasteBuffer = runner.calls.find((call) => call.args.includes("paste-buffer"));
    const deleteBuffer = runner.calls.find((call) => call.args.includes("delete-buffer"));
    const bufferName = argAfter(setBuffer?.args ?? [], "-b");
    expect(bufferName).toMatch(/^codex-channel-codex-test-/);
    expect(argAfter(pasteBuffer?.args ?? [], "-b")).toBe(bufferName);
    expect(argAfter(deleteBuffer?.args ?? [], "-b")).toBe(bufferName);
  });

  it("waits for pane output after sending text", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    runner.paneOutputs = ["before\n", "hello\n", "hello\nCodex response\n─ Worked for 1s ─\n"];
    const runtime = new CodexTmuxRuntime(
      testConfig({ dataDir: dir }),
      new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions),
      runner
    );

    const output = await runtime.sendAndWaitForOutput(
      {
        bindingId: "binding-1",
        machineId: "test-machine",
        projectPath: dir,
        tmuxSession: "codex-test",
        lastSeenAt: new Date().toISOString()
      },
      "hello",
      { timeoutMs: 3000, pollMs: 1 }
    );

    expect(output).toContain("Codex response");
    expect(output).not.toContain("before");
    expect(output).not.toContain("hello");
  });

  it("waits past intermediate Codex output until the completion marker appears", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    runner.paneOutputs = [
      "before\n",
      "hello\n• Ran git status\n",
      "hello\n• Ran git status\n",
      "hello\n• Ran git status\nFinal answer\n─ Worked for 5s ─\n"
    ];
    const runtime = new CodexTmuxRuntime(
      testConfig({ dataDir: dir }),
      new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions),
      runner
    );

    const output = await runtime.sendAndWaitForOutput(
      {
        bindingId: "binding-1",
        machineId: "test-machine",
        projectPath: dir,
        tmuxSession: "codex-test",
        lastSeenAt: new Date().toISOString()
      },
      "hello",
      { timeoutMs: 3000, pollMs: 1 }
    );

    expect(output).toContain("Final answer");
    expect(output).toContain("Worked for 5s");
  });

  it("extracts only newly added pane output after the prompt echo", () => {
    const before = [
      "old status",
      "old response"
    ].join("\n");
    const latest = [
      "old status",
      "old response",
      "› 检查当前git状态",
      "",
      "当前仓库在 main 分支。"
    ].join("\n");

    expect(outputAfterSend(before, latest, "检查当前git状态")).toBe("当前仓库在 main 分支。");
  });
  it("does not resend old scrollback when the tmux viewport shifts", () => {
    const before = [
      "banner",
      "old status",
      "old response",
      "stable tail"
    ].join("\n");
    const latest = [
      "old response",
      "stable tail",
      "> new task",
      "",
      "fresh answer"
    ].join("\n");

    expect(outputAfterSend(before, latest, "new task")).toBe("fresh answer");
  });
});

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function binding(projectPath: string): ProjectBinding {
  return {
    id: "binding-1",
    provider: "discord",
    workspaceId: "guild:1",
    conversationId: "channel:2",
    projectPath,
    projectName: "project",
    aliases: [],
    machineId: "test-machine",
    runtime: { kind: "codex-tmux", tmuxSession: "codex-test" },
    sessionMode: "on_demand",
    policy: {
      authorizedUserIds: ["user-1"],
      allowDirectInjection: false,
      requireConfirmationFor: []
    },
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
