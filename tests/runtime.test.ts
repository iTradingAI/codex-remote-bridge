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
    expect(output).not.toContain("Ran git status");
    expect(output).not.toContain("Worked for 5s");
  });

  it("cleans Codex TUI traces from captured Discord output", () => {
    const latest = [
      "> commit changes",
      "",
      "• Ran GIT_AUTHOR_NAME='Max.King' git commit -m \"Support custom content pages\"",
      "  │ commit -m \"Support custom content pages\"",
      "  └ [main 2ca8b70] Support custom content pages",
      "     10 files changed, 2839 insertions(+), 425 deletions(-)",
      "     create mode 100644 wpcn/views/contact.twig.html",
      "",
      "────────────────────────────────────────────────────────────────────────────────",
      "",
      "• commit 已创建。我再检查一次状态和最新提交，确认暂存区已清空。",
      "",
      "• Ran git status --short --branch",
      "  └ ## main",
      "",
      "────────────────────────────────────────────────────────────────────────────────",
      "",
      "• 已完成 git commit。",
      "",
      "  提交信息：",
      "",
      "  2ca8b70 Support custom content pages for Minghui site",
      "",
      "  当前状态干净：",
      "",
      "  ## main",
      "",
      "─ Worked for 1m 05s ────────────────────────────────────────────────────────────",
      "",
      "",
      "› Improve documentation in @filename",
      "",
      "  gpt-5.5 medium · /mnt/e/KEHU/202603明辉 · main · Context 9% used"
    ].join("\n");

    const output = outputAfterSend("", latest, "commit changes");

    expect(output).toContain("已完成 git commit。");
    expect(output).toContain("2ca8b70 Support custom content pages for Minghui site");
    expect(output).not.toContain("• Ran");
    expect(output).not.toContain("GIT_AUTHOR_NAME");
    expect(output).not.toContain("Worked for");
    expect(output).not.toContain("Improve documentation");
    expect(output).not.toContain("gpt-5.5 medium");
  });

  it("does not treat a fresh Codex startup banner as a completed reply", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    const startupOnly = [
      "> contact page changes",
      "",
      "╭────────────────────────────────────────────────╮",
      "│ >_ OpenAI Codex (v0.128.0)                     │",
      "│                                                │",
      "│ model: gpt-5.5 medium                          │",
      "│ directory: /mnt/e/KEHU/202603明辉               │",
      "╰────────────────────────────────────────────────╯"
    ].join("\n");
    runner.paneOutputs = [
      "before\n",
      startupOnly,
      startupOnly,
      [
        startupOnly,
        "",
        "已按反馈完成 contact 页面调整，改动还未提交。",
        "",
        "验证：",
        "- 已运行 git diff --check，无空白/格式错误",
        "─ Worked for 2m 01s ─"
      ].join("\n")
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
      "contact page changes",
      { timeoutMs: 3000, pollMs: 1, stableMs: 1 }
    );

    expect(output).toContain("已按反馈完成 contact 页面调整");
    expect(output).not.toContain("OpenAI Codex");
    expect(output).not.toContain("model: gpt-5.5");
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

  it("anchors output to the current prompt instead of old completed scrollback", () => {
    const latest = [
      "old answer",
      "Worked for 1m",
      "",
      "> current question",
      "",
      "current answer"
    ].join("\n");

    expect(outputAfterSend("unrelated old tail", latest, "current question")).toBe("current answer");
  });

  it("persists the last delivered pane cursor for the session", async () => {
    const dir = await tempDir();
    const runner = new FakeRunner();
    runner.paneOutputs = [
      "old output\n",
      "> hello\n",
      "> hello\nfresh answer\nWorked for 1s\n"
    ];
    const store = new JsonFileStore<SessionsDocument>(join(dir, "sessions.json"), emptySessions);
    const runtime = new CodexTmuxRuntime(testConfig({ dataDir: dir }), store, runner);
    const session = {
      bindingId: "binding-1",
      machineId: "test-machine",
      projectPath: dir,
      tmuxSession: "codex-test",
      lastSeenAt: new Date().toISOString()
    };

    await runtime.ensureSession(binding(dir));
    const output = await runtime.sendAndWaitForOutput(session, "hello", {
      timeoutMs: 3000,
      pollMs: 1,
      messageId: "discord-message-1"
    });
    const document = await store.read();

    expect(output).toContain("fresh answer");
    expect(document.sessions[0]?.outputCursor?.tail).toContain("fresh answer");
    expect(document.sessions[0]?.outputCursor?.messageId).toBe("discord-message-1");
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
