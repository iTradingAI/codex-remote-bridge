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
    projectPath: "E:\\Projects\\codex-channel"
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
        "E:\\Projects\\codex-channel",
        "codex",
        "-c",
        'projects."E:\\\\Projects\\\\codex-channel".trust_level="trusted"',
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
        "/mnt/e/Projects/codex-channel",
        "codex",
        "-c",
        'projects."/mnt/e/Projects/codex-channel".trust_level="trusted"',
        "--no-alt-screen"
      ]
    });
  });

  it("quotes project paths for Codex config overrides", () => {
    expect(projectTrustOverride('/tmp/has"quote')).toBe(
      'projects."/tmp/has\\"quote".trust_level="trusted"'
    );
  });

  it("uses caller-provided buffer names for sends", () => {
    const builder = new TmuxCommandBuilder(testConfig(), "posix");
    expect(builder.setBuffer("buffer-a", "hello")).toEqual({
      file: "tmux",
      args: ["set-buffer", "-b", "buffer-a", "hello"]
    });
    expect(builder.pasteBuffer("session-a", "buffer-a")).toEqual({
      file: "tmux",
      args: ["paste-buffer", "-b", "buffer-a", "-t", "session-a"]
    });
  });
});
