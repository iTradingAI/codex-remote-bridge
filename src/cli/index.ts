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
  } else if (command === "start" || command === "up") {
    await operations.runStart(configPath);
  } else if (command === "stop" || command === "down") {
    await operations.runStop(configPath);
  } else if (command === "restart") {
    await operations.runStop(configPath);
    await operations.runStart(configPath);
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
  cxb setup [--output config/bridge.local.json] [--force] [--answers setup-answers.json] [--no-start] [--no-post-setup]
    初始化本机配置。默认会健康检查、注册 Discord 命令，并启动 Bridge。

  cxb up [--config config/bridge.local.json]
    启动本机 Bridge 驻留进程。每台真实电脑只需要一个。

  cxb down [--config config/bridge.local.json]
    停止本机 Bridge，并清理 data/.bridge.lock。

  cxb restart [--config config/bridge.local.json]
    重启本机 Bridge。

  cxb status [--config config/bridge.local.json]
    检查配置、Discord 连接、tmux/Codex 可用性和已绑定项目。

  cxb doctor [--config config/bridge.local.json]
    status 的别名，用于环境诊断。

  cxb register [--config config/bridge.local.json]
    注册或刷新 Discord slash commands。

  cxb hook [--config config/bridge.local.json] [--event-file event.json]
    写入本机 hook 事件队列，由正在运行的 Bridge 转发到 Discord。

兼容别名:
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
