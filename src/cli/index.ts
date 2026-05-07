#!/usr/bin/env node
import { createBridge } from "../app.js";
import { loadLocalEnvFiles } from "./env.js";
import { configureProxyFromEnv } from "./proxy.js";
import { formatCliError } from "./errors.js";
import { readHookEventFromFile, readHookEventFromStdin } from "../hooks/hook-ingress.js";
import { LocalHookEventQueue } from "../hooks/local-event-queue.js";
import { storagePaths } from "../storage/paths.js";

try {
  await loadLocalEnvFiles();
  configureProxyFromEnv();

  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const configPath = readFlag(args, "--config") ?? "config/bridge.local.json";
  const operations = await import("./operations.js");

  if (command === "health" || command === "status" || command === "doctor") {
    await operations.runHealth(configPath);
  } else if (command === "logs") {
    const { runLogs } = await import("./logs.js");
    await runLogs(configPath, {
      lines: readNumberFlag(args, "--tail") ?? readNumberFlag(args, "--lines") ?? 100,
      errorsOnly: hasFlag(args, "--errors"),
      audit: hasFlag(args, "--audit")
    });
  } else if (command === "update") {
    const { runUpdate } = await import("./update.js");
    await runUpdate({
      configPath,
      force: hasFlag(args, "--force"),
      skipRegister: hasFlag(args, "--skip-register"),
      skipRestart: hasFlag(args, "--skip-restart")
    });
  } else if (command === "daemon" || (command === "up" && hasFlag(args, "--daemon"))) {
    const { runDaemonStart } = await import("./daemon.js");
    await runDaemonStart(configPath);
  } else if (command === "daemon-status") {
    const { runDaemonStatus } = await import("./daemon.js");
    await runDaemonStatus(configPath);
  } else if (command === "daemon-stop") {
    const { runDaemonStop } = await import("./daemon.js");
    await runDaemonStop(configPath);
  } else if (command === "start" || command === "up") {
    await operations.runStart(configPath);
  } else if (command === "stop" || command === "down") {
    await operations.runStop(configPath);
  } else if (command === "restart") {
    await operations.runStop(configPath);
    if (hasFlag(args, "--foreground")) {
      await operations.runStart(configPath);
    } else {
      const { runDaemonStart } = await import("./daemon.js");
      await runDaemonStart(configPath);
    }
  } else if (command === "register-commands" || command === "register") {
    await operations.runRegisterCommands(configPath);
  } else if (command === "hook") {
    const bridge = await createBridge(configPath, { acquireLock: false });
    try {
      const eventPath = readFlag(args, "--event-file");
      const event = eventPath ? await readHookEventFromFile(eventPath) : await readHookEventFromStdin();
      const queued = await new LocalHookEventQueue(storagePaths(bridge.config).eventQueueDir).enqueue(event);
      console.log(JSON.stringify({ queued: true, path: queued, event: event.event }, null, 2));
    } finally {
      await bridge.release();
    }
  } else if (command === "setup") {
    const { runSetupWizard } = await import("./setup.js");
    await runSetupWizard({
      outputPath: readFlag(args, "--output") ?? "config/bridge.local.json",
      force: hasFlag(args, "--force"),
      answersPath: readFlag(args, "--answers"),
      postSetup: !hasFlag(args, "--no-post-setup"),
      startAfterSetup: !hasFlag(args, "--no-start")
    });
  } else {
    console.log(`用法:
  crb setup [--output config/bridge.local.json] [--force] [--answers setup-answers.json] [--no-start] [--no-post-setup]
    初始化本机配置。默认会健康检查、注册 Discord 命令，并启动 Bridge。
  crb up [--config config/bridge.local.json]
    前台启动本机 Bridge，适合临时调试。
  crb daemon [--config config/bridge.local.json]
    自动在 tmux 后台会话中启动 Bridge，终端关闭后仍继续运行。
  crb daemon-status [--config config/bridge.local.json]
    查看后台 tmux Bridge 会话是否还在运行。
  crb daemon-stop [--config config/bridge.local.json]
    停止后台 tmux Bridge 会话。
  crb update [--config config/bridge.local.json] [--force] [--skip-register] [--skip-restart]
    一键拉取、安装依赖、构建、link、注册 Discord 命令并重启后台 Bridge。
  crb logs [--config config/bridge.local.json] [--tail 100] [--errors] [--audit]
    查看 Bridge 运行日志或审计日志。
  crb down [--config config/bridge.local.json]
    停止本机 Bridge，并清理 data/.bridge.lock。
  crb restart [--config config/bridge.local.json]
    重启后台 tmux Bridge。加 --foreground 可改为前台启动。
  crb status [--config config/bridge.local.json]
    检查配置、Discord 连接、tmux/Codex 可用性和已绑定项目。
  crb doctor [--config config/bridge.local.json]
    status 的诊断别名，用于环境诊断。
  crb register [--config config/bridge.local.json]
    注册或刷新 Discord slash commands。
  crb hook [--config config/bridge.local.json] [--event-file event.json]
    写入本机 hook 事件队列，由正在运行的 Bridge 转发到 Discord。
兼容子命令:
  start=up, stop=down, health=status, register-commands=register`);
  }
} catch (error) {
  console.error(formatCliError(error));
  process.exitCode = 1;
}

function readFlag(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  return values[index + 1];
}

function hasFlag(values: string[], name: string): boolean {
  return values.includes(name);
}

function readNumberFlag(values: string[], name: string): number | undefined {
  const raw = readFlag(values, name);
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
