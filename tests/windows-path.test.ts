import { describe, expect, it } from "vitest";
import { safeTmuxSessionName, windowsPathToWslPath } from "../src/runtime/platform/windows-path.js";

describe("windowsPathToWslPath", () => {
  it("converts drive-letter paths to WSL mount paths", () => {
    expect(windowsPathToWslPath("E:\\Projects\\codex-remote-bridge")).toBe(
      "/mnt/e/Projects/codex-remote-bridge"
    );
  });

  it("passes non-Windows paths through with slash normalization", () => {
    expect(windowsPathToWslPath("/srv/projects/app")).toBe("/srv/projects/app");
  });
});

describe("safeTmuxSessionName", () => {
  it("normalizes session names for tmux", () => {
    expect(safeTmuxSessionName("Codex: Remote Bridge / Thread 123")).toBe(
      "codex-remote-bridge-thread-123"
    );
  });
});
