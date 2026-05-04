#!/usr/bin/env node
import { createBridge } from "../app.js";
import { loadLocalEnvFiles } from "./env.js";
import { getDiscordToken, runHealth, runRegisterCommands, runStart } from "./operations.js";
import { runSetupWizard } from "./setup.js";
import { readHookEventFromFile, readHookEventFromStdin, routeHookEvent } from "../hooks/hook-ingress.js";
import { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";

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
    let provider: DiscordProviderAdapter | undefined;
    try {
      const token = getDiscordToken(bridge.config);
      provider = new DiscordProviderAdapter(bridge.config);
      await provider.start(token);
    } catch {
      provider = undefined;
    }
    try {
      const routed = await routeHookEvent({
        config: bridge.config,
        event,
        bindings: bridge.bindings,
        provider,
        audit: bridge.audit
      });
      console.log(JSON.stringify(routed, null, 2));
    } finally {
      await provider?.destroy();
    }
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
  console.log(`Usage:
  codex-channel setup [--output config/bridge.local.json] [--force] [--answers setup-answers.json] [--no-start] [--no-post-setup]
  codex-channel health --config config/bridge.local.json
  codex-channel register-commands --config config/bridge.local.json
  codex-channel hook --config config/bridge.local.json [--event-file event.json]
  codex-channel start --config config/bridge.local.json`);
}

function readFlag(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  return values[index + 1];
}

function hasFlag(values: string[], name: string): boolean {
  return values.includes(name);
}
