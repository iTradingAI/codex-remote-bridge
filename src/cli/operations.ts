import { createBridge } from "../app.js";
import type { BridgeConfig } from "../types.js";
import { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";
import { looksLikeDiscordToken } from "./env.js";

export function getDiscordToken(config: BridgeConfig): string {
  if (looksLikeDiscordToken(config.discord.tokenEnv)) {
    throw new Error(
      "discord.token_env appears to contain a Discord bot token. It must be an environment variable name such as DISCORD_BOT_TOKEN. Rotate that token, rerun setup, and keep the token in .env.local or the process environment."
    );
  }
  const token = process.env[config.discord.tokenEnv];
  if (!token) {
    throw new Error(
      `Missing Discord token env ${config.discord.tokenEnv}. Set it in .env.local or the process environment.`
    );
  }
  return token;
}

export async function runHealth(configPath: string): Promise<void> {
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
    const tokenEnvLooksInvalid = looksLikeDiscordToken(bridge.config.discord.tokenEnv);
    const token = tokenEnvLooksInvalid ? undefined : process.env[bridge.config.discord.tokenEnv];
    const discordConnection = token
      ? await new DiscordProviderAdapter(bridge.config).probeConnection(token)
      : {
          connected: false,
          error: tokenEnvLooksInvalid
            ? "discord.token_env appears to contain a token instead of an env var name"
            : `Missing token env ${bridge.config.discord.tokenEnv}`
        };
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
}

export async function runRegisterCommands(configPath: string): Promise<void> {
  const bridge = await createBridge(configPath);
  try {
    const provider = new DiscordProviderAdapter(bridge.config);
    await provider.registerSlashCommands(getDiscordToken(bridge.config));
    console.log("Discord slash commands registered.");
    await bridge.audit.append({
      at: new Date().toISOString(),
      machineId: bridge.config.machineId,
      action: "discord.register_commands",
      allowed: true,
      summary: `Registered guild slash commands for ${bridge.config.discord.guildId ?? "unknown guild"}`
    });
  } finally {
    await bridge.release();
  }
}

export async function runStart(configPath: string): Promise<void> {
  const bridge = await createBridge(configPath);
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
  const session = await provider.start(getDiscordToken(bridge.config));
  console.log(
    `Discord bridge logged in as ${session.username ?? "unknown"} (${session.userId ?? "unknown id"}).`
  );
  await bridge.audit.append({
    at: new Date().toISOString(),
    machineId: bridge.config.machineId,
    action: "discord.start",
    allowed: true,
    summary: `Logged in as ${session.username ?? "unknown"} (${session.userId ?? "unknown id"})`
  });
}
