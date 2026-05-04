import {
  ChannelType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message
} from "discord.js";
import type { BridgeConfig, ConversationRef, InboundCommand, OutboundMessage } from "../../types.js";
import { DiscordIngressOwnership } from "./ownership.js";

export type CommandHandler = (command: InboundCommand) => Promise<OutboundMessage>;
export type OwnershipRejectHandler = (event: {
  conversation: ConversationRef;
  actor: { id: string; name?: string };
  reason: string;
  action: string;
}) => Promise<void>;

export class DiscordProviderAdapter {
  private readonly client: Client;
  private readonly ownership: DiscordIngressOwnership;
  private commandHandler?: CommandHandler;
  private ownershipRejectHandler?: OwnershipRejectHandler;

  constructor(private readonly config: BridgeConfig) {
    this.ownership = new DiscordIngressOwnership(config.discord.allowedScopes);
    const intents = [GatewayIntentBits.Guilds];
    if (config.policy.allowDirectInjection) {
      intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    }
    this.client = new Client({
      intents
    });
  }

  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  onOwnershipReject(handler: OwnershipRejectHandler): void {
    this.ownershipRejectHandler = handler;
  }

  async registerSlashCommands(token: string): Promise<void> {
    if (!this.config.discord.guildId) {
      throw new Error("discord.guild_id is required for development slash command registration");
    }

    const commands = [
      new SlashCommandBuilder()
        .setName("codex")
        .setDescription("Control local Codex bridge sessions")
        .addSubcommand((subcommand) =>
          subcommand
            .setName("bind")
            .setDescription("Bind this conversation to a local project")
            .addStringOption((option) =>
              option.setName("path").setDescription("Absolute project path").setRequired(true)
            )
            .addStringOption((option) =>
              option.setName("alias").setDescription("Short project alias").setRequired(false)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("confirm")
            .setDescription("Confirm a pending bridge action")
            .addStringOption((option) =>
              option.setName("code").setDescription("Confirmation code").setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("unbind").setDescription("Unbind this conversation")
        )
        .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show status"))
        .addSubcommand((subcommand) => subcommand.setName("start").setDescription("Start Codex"))
        .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("Resume Codex"))
        .addSubcommand((subcommand) =>
          subcommand
            .setName("send")
            .setDescription("Send text to Codex")
            .addStringOption((option) =>
              option.setName("text").setDescription("Text to send").setRequired(true)
            )
        )
        .addSubcommand((subcommand) =>
          subcommand.setName("projects").setDescription("List bound projects")
        )
        .toJSON()
    ];

    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(
      Routes.applicationGuildCommands(this.config.discord.applicationId, this.config.discord.guildId),
      { body: commands }
    );
  }

  async start(token: string): Promise<{ userId?: string; username?: string }> {
    this.client.on("interactionCreate", (interaction) => {
      void this.handleInteraction(interaction);
    });
    if (this.config.policy.allowDirectInjection) {
      this.client.on("messageCreate", (message) => {
        void this.handleMessage(message);
      });
    }
    await this.client.login(token);
    this.client.user?.setPresence({
      status: "online",
      activities: [{ name: "Codex Channel" }]
    });
    return {
      userId: this.client.user?.id,
      username: this.client.user?.username
    };
  }

  async probeConnection(token: string): Promise<{ connected: boolean; userId?: string; error?: string }> {
    try {
      await this.client.login(token);
      return { connected: true, userId: this.client.user?.id };
    } catch (error) {
      return { connected: false, error: (error as Error).message };
    } finally {
      await this.destroy();
    }
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }

  async sendMessage(target: ConversationRef, message: OutboundMessage): Promise<void> {
    const channelId = discordTargetChannelId(target);
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !("send" in channel) || typeof channel.send !== "function") {
      throw new Error(`Discord target is not sendable: ${target.conversationId}`);
    }
    await channel.send(formatOutbound(message));
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "codex") return;

    try {
      if (!this.commandHandler) throw new Error("No command handler registered");

      const command = this.commandFromInteraction(interaction);
      const ownership = this.ownership.accepts(command.conversation);
      if (!ownership.accepted) {
        const reason = ownership.reason ?? "ownership rejected";
        await this.ownershipRejectHandler?.({
          conversation: command.conversation,
          actor: command.actor,
          reason,
          action: command.command
        });
        await this.replyToInteraction(interaction, {
          kind: "error",
          title: "Conversation Not Owned",
          text: `This bridge is not configured for this Discord channel/thread. ${reason}`
        });
        return;
      }

      const outbound = await this.commandHandler(command);
      await this.replyToInteraction(interaction, outbound);
    } catch (error) {
      await this.replyToInteraction(interaction, {
        kind: "error",
        title: "Command Failed",
        text: (error as Error).message
      });
    }
  }

  private async replyToInteraction(
    interaction: ChatInputCommandInteraction,
    message: OutboundMessage
  ): Promise<void> {
    const payload = formatOutbound(message);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.commandHandler || message.author.bot) return;
    const conversation = conversationFromMessage(message);
    const ownership = this.ownership.accepts(conversation);
    if (!ownership.accepted) {
      await this.ownershipRejectHandler?.({
        conversation,
        actor: { id: message.author.id, name: message.author.username },
        reason: ownership.reason ?? "ownership rejected",
        action: "message"
      });
      return;
    }

    const outbound = await this.commandHandler({
      conversation,
      actor: { id: message.author.id, name: message.author.username },
      command: "send",
      args: { text: message.content },
      rawText: message.content,
      messageId: message.id
    });
    await message.reply(formatOutbound(outbound));
  }

  private commandFromInteraction(interaction: ChatInputCommandInteraction): InboundCommand {
    const subcommand = interaction.options.getSubcommand(true) as InboundCommand["command"];
    const args: InboundCommand["args"] = {};
    for (const option of ["path", "alias", "code", "text"]) {
      const value = interaction.options.getString(option, false);
      if (value != null) args[option] = value;
    }
    return {
      conversation: conversationFromInteraction(interaction),
      actor: { id: interaction.user.id, name: interaction.user.username },
      command: subcommand,
      args,
      messageId: interaction.id
    };
  }
}

export function discordTargetChannelId(target: ConversationRef): string {
  const threadMatch = /\/thread:([^/]+)$/.exec(target.conversationId);
  if (threadMatch?.[1]) return threadMatch[1];
  const channelMatch = /^channel:([^/]+)$/.exec(target.conversationId);
  if (channelMatch?.[1]) return channelMatch[1];
  throw new Error(`Unsupported Discord conversation id: ${target.conversationId}`);
}

export function conversationFromInteraction(interaction: ChatInputCommandInteraction): ConversationRef {
  const guildId = interaction.guildId;
  if (!guildId) throw new Error("Discord guild interaction is required");
  const parentId = interaction.channel?.isThread() ? interaction.channel.parentId : undefined;
  const conversationId = parentId
    ? `channel:${parentId}/thread:${interaction.channelId}`
    : `channel:${interaction.channelId}`;
  return {
    provider: "discord",
    workspaceId: `guild:${guildId}`,
    conversationId
  };
}

export function conversationFromMessage(message: Message): ConversationRef {
  if (!message.guildId) throw new Error("Discord guild message is required");
  const parentId =
    message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread
      ? message.channel.parentId
      : undefined;
  const conversationId = parentId
    ? `channel:${parentId}/thread:${message.channelId}`
    : `channel:${message.channelId}`;
  return {
    provider: "discord",
    workspaceId: `guild:${message.guildId}`,
    conversationId
  };
}

export function formatOutbound(message: OutboundMessage): string {
  const title = message.title ? `**${message.title}**\n` : "";
  const fields =
    message.fields && message.fields.length > 0
      ? `\n${message.fields.map((field) => `**${field.label}:** ${field.value}`).join("\n")}`
      : "";
  return `${title}${message.text}${fields}`.slice(0, 1900);
}
