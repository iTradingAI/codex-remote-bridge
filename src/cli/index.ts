#!/usr/bin/env node
import { createBridge } from "../app.js";
import { loadLocalEnvFiles } from "./env.js";
import { runHealth, runRegisterCommands, runStart } from "./operations.js";
import { runSetupWizard } from "./setup.js";
import { formatCliError } from "./errors.js";
import { readHookEventFromFile, readHookEventFromStdin } from "../hooks/hook-ingress.js";
import { LocalHookEventQueue } from "../hooks/local-event-queue.js";
import { storagePaths } from "../storage/paths.js";

try {
  await loadLocalEnvFiles();

  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const configPath = readFlag(args, "--config") ?? "config/bridge.example.json";

  if (command === "health") {
    await runHealth(configPath);
  } else if (command === "start") {
    await runStart(configPath);
  } else if (command === "register-commands") {
    await runRegisterCommands(configPath);
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
    await runSetupWizard({
      outputPath: readFlag(args, "--output") ?? "config/bridge.local.json",
      force: hasFlag(args, "--force"),
      answersPath: readFlag(args, "--answers"),
      postSetup: !hasFlag(args, "--no-post-setup"),
      startAfterSetup: !hasFlag(args, "--no-start")
    });
  } else {
    console.log(`用法:
  codex-channel setup [--output config/bridge.local.json] [--force] [--answers setup-answers.json] [--no-start] [--no-post-setup]
    初始化配置。默认会健康检查、注册 Discord 命令，并启动 Bridge。

  codex-channel health --config config/bridge.local.json
    检查本机 Bridge 配置、Discord 连接、tmux/Codex 可用性和已绑定项目。

  codex-channel register-commands --config config/bridge.local.json
    注册或刷新 Discord slash commands。Bridge 已运行时也可以执行。

  codex-channel hook --config config/bridge.local.json [--event-file event.json]
    写入本机 hook 事件队列，由正在运行的 Bridge 转发到 Discord。

  codex-channel start --config config/bridge.local.json
    启动本机 Bridge 驻留进程。每台真实电脑只需要一个。`);
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
