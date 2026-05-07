import { describe, expect, it } from "vitest";
import {
  projectTrustOverride,
  TmuxCommandBuilder
} from "../src/runtime/codex-tmux/tmux-command-builder.js";
import type { ProjectBinding } from "../src/types.js";
import { testConfig } from "./helpers.js";

describe("TmuxCommandBuilder", () => {
  const binding = {
    id: "binding-1",
    runtime: { kind: "codex-tmux" as const, tmuxSession: "codex-binding-1" },
    projectPath: "E:\\Projects\\codex-remote-bridge"
  } as ProjectBinding;

  it("builds POSIX tmux commands", () => {
    const builder = new TmuxCommandBuilder(testConfig(), "posix");
    expect(builder.newSession(binding)).toEqual({
      file: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "codex-binding-1",
        "-c",
        "E:\\Projects\\codex-remote-bridge",
        "codex",
        "--sandbox",
        "danger-full-access",
        "--ask-for-approval",
        "never",
        "-c",
        'projects."E:\\\\Projects\\\\codex-remote-bridge".trust_level="trusted"',
        "--no-alt-screen"
      ]
    });
  });

  it("wraps Windows commands through WSL", () => {
    const builder = new TmuxCommandBuilder(testConfig(), "windows-wsl");
    expect(builder.newSession(binding)).toEqual({
      file: "wsl.exe",
      args: [
        "--",
        "tmux",
        "new-session",
        "-d",
        "-s",
        "codex-binding-1",
        "-c",
        "/mnt/e/Projects/codex-remote-bridge",
        "codex",
        "--sandbox",
        "danger-full-access",
        "--ask-for-approval",
        "never",
        "-c",
        'projects."/mnt/e/Projects/codex-remote-bridge".trust_level="trusted"',
        "--no-alt-screen"
      ]
    });
  });

  it("can start Codex by resuming the last project session with fallback", () => {
    const builder = new TmuxCommandBuilder(testConfig(), "posix");
    const command = builder.newSession(binding, { resumeLast: true });

    expect(command.file).toBe("tmux");
    expect(command.args.slice(0, 6)).toEqual([
      "new-session",
      "-d",
      "-s",
      "codex-binding-1",
      "-c",
      "E:\\Projects\\codex-remote-bridge"
    ]);
    expect(command.args[6]).toBe("sh");
    expect(command.args[7]).toBe("-lc");
    expect(command.args[8]).toContain("'codex' 'resume' '--last'");
    expect(command.args[8]).toContain("|| exec 'codex'");
    expect(command.args[8]).toContain("--no-alt-screen");
  });

  it("quotes project paths for Codex config overrides", () => {
    expect(projectTrustOverride('/tmp/has"quote')).toBe(
      'projects."/tmp/has\\"quote".trust_level="trusted"'
    );
  });

  it("loads tmux buffers from stdin for sends", () => {
    const builder = new TmuxCommandBuilder(testConfig(), "posix");
    expect(builder.loadBuffer("buffer-a")).toEqual({
      file: "tmux",
      args: ["load-buffer", "-b", "buffer-a", "-"]
    });
    expect(builder.pasteBuffer("session-a", "buffer-a")).toEqual({
      file: "tmux",
      args: ["paste-buffer", "-b", "buffer-a", "-t", "session-a"]
    });
    expect(builder.dismissPromptOverlay("session-a")).toEqual({
      file: "tmux",
      args: ["send-keys", "-t", "session-a", "Escape"]
    });
    expect(builder.sendKeys("session-a", ["1", "Enter"])).toEqual({
      file: "tmux",
      args: ["send-keys", "-t", "session-a", "1", "Enter"]
    });
  });
});
