import { unlink } from "node:fs/promises";
import { platform } from "node:os";
import { join, resolve } from "node:path";
import { loadBridgeConfig } from "../config.js";
import type { BridgeConfig } from "../types.js";
import { ExecFileCommandRunner, type CommandRunner } from "../runtime/process.js";
import { quoteShell, safeTmuxSessionName, windowsPathToWslPath } from "../runtime/platform/windows-path.js";

type DaemonPlatform = "posix" | "windows-wsl";

export interface BuiltDaemonCommand {
  file: string;
  args: string[];
}

export interface DaemonCommandSet {
  sessionName: string;
  hasSession: BuiltDaemonCommand;
  newSession: BuiltDaemonCommand;
  killSession: BuiltDaemonCommand;
  attachHint: string;
}

export interface DaemonOptions {
  cliPath?: string;
  cwd?: string;
  runner?: CommandRunner;
}

export async function runDaemonStart(configPath: string, options: DaemonOptions = {}): Promise<void> {
  const config = await loadBridgeConfig(configPath);
  const runner = options.runner ?? new ExecFileCommandRunner();
  const commands = buildDaemonCommands(config, configPath, options);
  const existing = await runner.run(commands.hasSession.file, commands.hasSession.args);
  if (existing.exitCode === 0) {
    console.log(`Bridge daemon is already running in tmux session ${commands.sessionName}.`);
    console.log(`Attach with: ${commands.attachHint}`);
    return;
  }

  const started = await runner.run(commands.newSession.file, commands.newSession.args);
  if (started.exitCode !== 0) {
    throw new Error(`Failed to start bridge daemon tmux session: ${started.stderr || started.stdout}`);
  }

  await sleep(800);
  const status = await runner.run(commands.hasSession.file, commands.hasSession.args);
  if (status.exitCode !== 0) {
    throw new Error(
      `Bridge daemon tmux session exited immediately. Run crb up --config ${configPath} to see the foreground error.`
    );
  }

  console.log(`Bridge daemon started in tmux session ${commands.sessionName}.`);
  console.log("This terminal can be closed now.");
  console.log(`Attach with: ${commands.attachHint}`);
}

export async function runDaemonStatus(configPath: string, options: DaemonOptions = {}): Promise<void> {
  const config = await loadBridgeConfig(configPath);
  const runner = options.runner ?? new ExecFileCommandRunner();
  const commands = buildDaemonCommands(config, configPath, options);
  const status = await runner.run(commands.hasSession.file, commands.hasSession.args);
  if (status.exitCode === 0) {
    console.log(`Bridge daemon is running in tmux session ${commands.sessionName}.`);
    console.log(`Attach with: ${commands.attachHint}`);
    return;
  }
  console.log(`Bridge daemon is not running in tmux session ${commands.sessionName}.`);
}

export async function stopDaemonSession(
  config: BridgeConfig,
  configPath: string,
  options: DaemonOptions = {}
): Promise<{ stopped: boolean; sessionName: string }> {
  const runner = options.runner ?? new ExecFileCommandRunner();
  const commands = buildDaemonCommands(config, configPath, options);
  const existing = await runner.run(commands.hasSession.file, commands.hasSession.args);
  if (existing.exitCode !== 0) {
    return { stopped: false, sessionName: commands.sessionName };
  }
  const stopped = await runner.run(commands.killSession.file, commands.killSession.args);
  if (stopped.exitCode !== 0) {
    throw new Error(`Failed to stop bridge daemon tmux session: ${stopped.stderr || stopped.stdout}`);
  }
  return { stopped: true, sessionName: commands.sessionName };
}

export async function runDaemonStop(configPath: string, options: DaemonOptions = {}): Promise<void> {
  const config = await loadBridgeConfig(configPath);
  const result = await stopDaemonSession(config, configPath, options);
  if (result.stopped) {
    await unlink(join(config.dataDir, ".bridge.lock")).catch(() => undefined);
    console.log(`Stopped bridge daemon tmux session ${result.sessionName}.`);
    return;
  }
  console.log(`Bridge daemon is not running in tmux session ${result.sessionName}.`);
}

export function buildDaemonCommands(
  config: BridgeConfig,
  configPath: string,
  options: DaemonOptions = {}
): DaemonCommandSet {
  const daemonPlatform = resolveDaemonPlatform(config);
  const sessionName = bridgeDaemonSessionName(config);
  const cwd = resolve(options.cwd ?? process.cwd());
  const cliPath = resolve(options.cliPath ?? process.argv[1]);
  const absoluteConfigPath = resolve(configPath);
  const shellCommand = buildBridgeShellCommand(daemonPlatform, cliPath, absoluteConfigPath);
  const tmuxArgs = ["new-session", "-d", "-s", sessionName, "-c", daemonPath(daemonPlatform, cwd), shellCommand];
  return {
    sessionName,
    hasSession: wrapTmux(config, daemonPlatform, ["has-session", "-t", sessionName]),
    newSession: wrapTmux(config, daemonPlatform, tmuxArgs),
    killSession: wrapTmux(config, daemonPlatform, ["kill-session", "-t", sessionName]),
    attachHint: buildAttachHint(config, daemonPlatform, sessionName)
  };
}

export function bridgeDaemonSessionName(config: Pick<BridgeConfig, "machineId">): string {
  return safeTmuxSessionName(`crb-bridge-${config.machineId}`.slice(0, 80));
}

function resolveDaemonPlatform(config: BridgeConfig): DaemonPlatform {
  return platform() === "win32" && config.runtime.windows.useWsl ? "windows-wsl" : "posix";
}

function buildBridgeShellCommand(
  daemonPlatform: DaemonPlatform,
  cliPath: string,
  configPath: string
): string {
  const nodeCommand = daemonPlatform === "windows-wsl" ? "node" : process.execPath;
  return [
    nodeCommand,
    daemonPath(daemonPlatform, cliPath),
    "up",
    "--config",
    daemonPath(daemonPlatform, configPath)
  ]
    .map(quoteShell)
    .join(" ");
}

function wrapTmux(config: BridgeConfig, daemonPlatform: DaemonPlatform, args: string[]): BuiltDaemonCommand {
  if (daemonPlatform === "posix") {
    return { file: config.runtime.tmuxCommand, args };
  }
  const wslArgs = [];
  if (config.runtime.windows.distro) {
    wslArgs.push("-d", config.runtime.windows.distro);
  }
  wslArgs.push("--", config.runtime.tmuxCommand, ...args);
  return { file: config.runtime.windows.wslCommand, args: wslArgs };
}

function buildAttachHint(config: BridgeConfig, daemonPlatform: DaemonPlatform, sessionName: string): string {
  if (daemonPlatform === "posix") {
    return `${config.runtime.tmuxCommand} attach -t ${sessionName}`;
  }
  const distro = config.runtime.windows.distro ? ` -d ${config.runtime.windows.distro}` : "";
  return `${config.runtime.windows.wslCommand}${distro} -- ${config.runtime.tmuxCommand} attach -t ${sessionName}`;
}

function daemonPath(daemonPlatform: DaemonPlatform, path: string): string {
  return daemonPlatform === "windows-wsl" ? windowsPathToWslPath(path) : path;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
