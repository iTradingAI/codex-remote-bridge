import type { BridgeConfig, ProjectBinding } from "../../types.js";
import { quoteShell, safeTmuxSessionName, windowsPathToWslPath } from "../platform/windows-path.js";

export type RuntimePlatform = "posix" | "windows-wsl";

export interface BuiltCommand {
  file: string;
  args: string[];
  cwd?: string;
}

export class TmuxCommandBuilder {
  constructor(
    private readonly config: BridgeConfig,
    private readonly platform: RuntimePlatform
  ) {}

  detectTmux(): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["-V"]);
  }

  detectCodex(): BuiltCommand {
    return this.wrap(this.config.runtime.codexCommand, ["--version"]);
  }

  hasSession(sessionName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["has-session", "-t", sessionName]);
  }

  newSession(binding: ProjectBinding, options: { resumeLast?: boolean } = {}): BuiltCommand {
    const codexArgs = [
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
      "-c",
      projectTrustOverride(this.projectPath(binding.projectPath)),
      "--no-alt-screen"
    ];
    const command = options.resumeLast
      ? [
          "sh",
          "-lc",
          `${shellCommand([this.config.runtime.codexCommand, "resume", "--last", ...codexArgs])} || exec ${shellCommand([
            this.config.runtime.codexCommand,
            ...codexArgs
          ])}`
        ]
      : [this.config.runtime.codexCommand, ...codexArgs];
    return this.wrap(this.config.runtime.tmuxCommand, [
      "new-session",
      "-d",
      "-s",
      this.sessionName(binding),
      "-c",
      this.projectPath(binding.projectPath),
      ...command
    ]);
  }

  capturePane(sessionName: string, lines: number): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, [
      "capture-pane",
      "-p",
      "-t",
      sessionName,
      "-S",
      `-${lines}`
    ]);
  }

  loadBuffer(bufferName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["load-buffer", "-b", bufferName, "-"]);
  }

  pasteBuffer(sessionName: string, bufferName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, [
      "paste-buffer",
      "-b",
      bufferName,
      "-t",
      sessionName
    ]);
  }

  deleteBuffer(bufferName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["delete-buffer", "-b", bufferName]);
  }

  sendEnter(sessionName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["send-keys", "-t", sessionName, "Enter"]);
  }

  dismissPromptOverlay(sessionName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["send-keys", "-t", sessionName, "Escape"]);
  }

  sendKeys(sessionName: string, keys: string[]): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["send-keys", "-t", sessionName, ...keys]);
  }

  killSession(sessionName: string): BuiltCommand {
    return this.wrap(this.config.runtime.tmuxCommand, ["kill-session", "-t", sessionName]);
  }

  sessionName(binding: Pick<ProjectBinding, "runtime" | "id">): string {
    return safeTmuxSessionName(binding.runtime.tmuxSession || `codex-${binding.id}`);
  }

  private projectPath(path: string): string {
    return this.platform === "windows-wsl" ? windowsPathToWslPath(path) : path;
  }

  private wrap(command: string, args: string[]): BuiltCommand {
    if (this.platform === "posix") {
      return { file: command, args };
    }

    const wslArgs = [];
    const distro = this.config.runtime.windows.distro;
    if (distro) {
      wslArgs.push("-d", distro);
    }
    wslArgs.push("--", command, ...args);
    return { file: this.config.runtime.windows.wslCommand, args: wslArgs };
  }
}

export function projectTrustOverride(projectPath: string): string {
  return `projects.${tomlQuotedKey(projectPath)}.trust_level="trusted"`;
}

function tomlQuotedKey(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shellCommand(parts: string[]): string {
  return parts.map(quoteShell).join(" ");
}
