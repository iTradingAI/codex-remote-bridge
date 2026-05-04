#!/usr/bin/env node
import { createBridge } from "../app.js";
import { readHookEventFromFile, readHookEventFromStdin, routeHookEvent } from "../hooks/hook-ingress.js";
import { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const configPath = readFlag(args, "--config") ?? "config/bridge.example.json";

if (command === "health") {
  const bridge = await createBridge(configPath, { acquireLock: false });
  try {
    const capability = await bridge.runtime.detect();
    const bindings = await bridge.bindings.listForMachine();
    const sessionStates = await Promise.all(
      bindings.map(async (binding) => {
        const session = await bridge.runtime.discoverExisting(binding);
        const status = session
          ? await bridge.runtime.status(session)
          : { state: "missing" as const, detail: "No tmux session is running." };
        return {
          binding_id: binding.id,
          project: binding.projectName,
          tmux_session: binding.runtime.tmuxSession,
          state: status.state
        };
      })
    );
    const token = process.env[bridge.config.discord.tokenEnv];
    const discordConnection = token
      ? await new DiscordProviderAdapter(bridge.config).probeConnection(token)
      : { connected: false, error: `Missing token env ${bridge.config.discord.tokenEnv}` };
    console.log(
      JSON.stringify(
        {
          machine_id: bridge.config.machineId,
          bindings: bindings.length,
          runtime: capability,
          data_dir: bridge.config.dataDir,
          storage: {
            audit: bridge.auditPath,
            logs: bridge.logsPath
          },
          discord: {
            application_id: bridge.config.discord.applicationId,
            guild_id: bridge.config.discord.guildId,
            allowed_scopes: bridge.config.discord.allowedScopes.length,
            token_env_present: Boolean(token),
            connection: discordConnection
          },
          sessions: sessionStates
        },
        null,
        2
      )
    );
  } finally {
    await bridge.release();
  }
} else if (command === "start") {
  const bridge = await createBridge(configPath);
  const token = process.env[bridge.config.discord.tokenEnv];
  if (!token) {
    throw new Error(`Missing Discord token env: ${bridge.config.discord.tokenEnv}`);
  }
  const provider = new DiscordProviderAdapter(bridge.config);
  provider.onCommand((inbound) => bridge.router.handle(inbound));
  provider.onOwnershipReject((event) =>
    bridge.audit.append({
      at: new Date().toISOString(),
      machineId: bridge.config.machineId,
      conversation: event.conversation,
      actor: event.actor,
      action: event.action,
      allowed: false,
      summary: event.reason
    })
  );
  await provider.start(token);
} else if (command === "register-commands") {
  const bridge = await createBridge(configPath);
  try {
    const token = process.env[bridge.config.discord.tokenEnv];
    if (!token) {
      throw new Error(`Missing Discord token env: ${bridge.config.discord.tokenEnv}`);
    }
    const provider = new DiscordProviderAdapter(bridge.config);
    await provider.registerSlashCommands(token);
    console.log("Discord slash commands registered.");
  } finally {
    await bridge.release();
  }
} else if (command === "hook") {
  const bridge = await createBridge(configPath, { acquireLock: false });
  try {
    const eventPath = readFlag(args, "--event-file");
    const event = eventPath ? await readHookEventFromFile(eventPath) : await readHookEventFromStdin();
    let provider: DiscordProviderAdapter | undefined;
    const token = process.env[bridge.config.discord.tokenEnv];
    if (token) {
      provider = new DiscordProviderAdapter(bridge.config);
      await provider.start(token);
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
} else {
  console.log(`Usage:
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
