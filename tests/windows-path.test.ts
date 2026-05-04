import { describe, expect, it } from "vitest";
import { safeTmuxSessionName, windowsPathToWslPath } from "../src/runtime/platform/windows-path.js";

describe("windowsPathToWslPath", () => {
  it("converts drive-letter paths to WSL mount paths", () => {
    expect(windowsPathToWslPath("E:\\Projects\\codex-channel")).toBe(
      "/mnt/e/Projects/codex-channel"
    );
  });

  it("passes non-Windows paths through with slash normalization", () => {
    expect(windowsPathToWslPath("/srv/projects/app")).toBe("/srv/projects/app");
  });
});

describe("safeTmuxSessionName", () => {
  it("normalizes session names for tmux", () => {
    expect(safeTmuxSessionName("Codex: Channel / Thread 123")).toBe("codex-channel-thread-123");
  });
});
