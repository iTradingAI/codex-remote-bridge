import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bridgeDaemonSessionName, buildDaemonCommands } from "../src/cli/daemon.js";
import { testConfig } from "./helpers.js";

describe("bridge daemon tmux commands", () => {
  it("builds a detached POSIX tmux session command for the bridge", () => {
    const config = testConfig({
      machineId: "MacBook Pro",
      runtime: {
        kind: "codex-tmux",
        tmuxCommand: "tmux",
        codexCommand: "codex",
        windows: { useWsl: false, wslCommand: "wsl.exe" }
      }
    });
    const cwd = resolve("/repo");
    const cliPath = resolve("/repo/dist/src/cli/index.js");
    const configPath = resolve("/repo/config/bridge.local.json");
    const commands = buildDaemonCommands(config, configPath, {
      cwd,
      cliPath
    });

    expect(commands.sessionName).toBe("crb-bridge-macbook-pro");
    expect(commands.hasSession).toEqual({
      file: "tmux",
      args: ["has-session", "-t", "crb-bridge-macbook-pro"]
    });
    expect(commands.newSession).toEqual({
      file: "tmux",
      args: [
        "new-session",
        "-d",
        "-s",
        "crb-bridge-macbook-pro",
        "-c",
        cwd,
        `'${process.execPath}' '${cliPath}' 'up' '--config' '${configPath}'`
      ]
    });
    expect(commands.attachHint).toBe("tmux attach -t crb-bridge-macbook-pro");
  });

  it("wraps detached daemon commands through WSL on Windows", () => {
    const config = testConfig({
      machineId: "win-main",
      runtime: {
        kind: "codex-tmux",
        tmuxCommand: "tmux",
        codexCommand: "codex",
        windows: { useWsl: true, wslCommand: "wsl.exe", distro: "Ubuntu" }
      }
    });
    const commands = buildDaemonCommands(config, "E:\\Projects\\codex-channel\\config\\bridge.local.json", {
      cwd: "E:\\Projects\\codex-channel",
      cliPath: "E:\\Projects\\codex-channel\\dist\\src\\cli\\index.js"
    });

    expect(commands.newSession).toEqual({
      file: "wsl.exe",
      args: [
        "-d",
        "Ubuntu",
        "--",
        "tmux",
        "new-session",
        "-d",
        "-s",
        "crb-bridge-win-main",
        "-c",
        "/mnt/e/Projects/codex-channel",
        "'node' '/mnt/e/Projects/codex-channel/dist/src/cli/index.js' 'up' '--config' '/mnt/e/Projects/codex-channel/config/bridge.local.json'"
      ]
    });
    expect(commands.killSession).toEqual({
      file: "wsl.exe",
      args: ["-d", "Ubuntu", "--", "tmux", "kill-session", "-t", "crb-bridge-win-main"]
    });
    expect(commands.attachHint).toBe("wsl.exe -d Ubuntu -- tmux attach -t crb-bridge-win-main");
  });

  it("normalizes daemon session names for tmux", () => {
    expect(bridgeDaemonSessionName({ machineId: "Office PC / Win 11" })).toBe(
      "crb-bridge-office-pc-win-11"
    );
  });
});
