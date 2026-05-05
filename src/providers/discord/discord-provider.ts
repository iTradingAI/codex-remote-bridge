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

export const MESSAGE_STATUS_REACTIONS = {
  received: "📥",
  thinking: "🤔",
  executing: "⚙️",
  done: "✅",
  failed: "❌",
  rejected: "🚫"
} as const;

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

    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(
      Routes.applicationGuildCommands(this.config.discord.applicationId, this.config.discord.guildId),
      { body: buildCodexSlashCommands() }
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
      console.info(`Discord interaction received: ${interaction.id}`);
      if (await deferInteractionSafely(interaction)) {
        console.info(`Discord interaction deferred: ${interaction.id}`);
      }

      const command = this.commandFromInteraction(interaction);
      console.info(`Discord command routed: ${interaction.id} ${command.command}`);
      const ownership = this.ownership.accepts(command.conversation);
      if (!ownership.accepted) {
        const reason = ownership.reason ?? "ownership rejected";
        await this.ownershipRejectHandler?.({
          conversation: command.conversation,
          actor: command.actor,
          reason,
          action: command.command
        });
        await this.replyToInteractionSafely(interaction, {
          kind: "error",
          title: "Conversation Not Owned",
          text: `This bridge is not configured for this Discord channel/thread. ${reason}`
        });
        return;
      }

      const outbound = await this.commandHandler(command);
      await this.replyToInteractionSafely(interaction, outbound);
    } catch (error) {
      await this.replyToInteractionSafely(interaction, {
        kind: "error",
        title: "Command Failed",
        text: (error as Error).message
      });
    }
  }

  private async replyToInteractionSafely(
    interaction: ChatInputCommandInteraction,
    message: OutboundMessage
  ): Promise<void> {
    try {
      await this.replyToInteraction(interaction, message);
      console.info(`Discord interaction replied: ${interaction.id} ${message.kind}`);
    } catch (error) {
      console.error(`Failed to reply to Discord interaction: ${(error as Error).message}`);
      await sendToInteractionChannelSafely(interaction, message);
    }
  }

  private async replyToInteraction(
    interaction: ChatInputCommandInteraction,
    message: OutboundMessage
  ): Promise<void> {
    const payload = formatOutbound(message);
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(payload);
      return;
    }
    await interaction.reply(payload);
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.commandHandler || shouldIgnoreMessage(message)) return;
    try {
      await reactToMessage(message, MESSAGE_STATUS_REACTIONS.received);
      const conversation = conversationFromMessage(message);
      const ownership = this.ownership.accepts(conversation);
      if (!ownership.accepted) {
        await reactToMessage(message, MESSAGE_STATUS_REACTIONS.rejected);
        await this.ownershipRejectHandler?.({
          conversation,
          actor: { id: message.author.id, name: message.author.username },
          reason: ownership.reason ?? "ownership rejected",
          action: "message"
        });
        return;
      }

      await reactToMessage(message, MESSAGE_STATUS_REACTIONS.thinking);
      await reactToMessage(message, MESSAGE_STATUS_REACTIONS.executing);
      const outbound = await this.commandHandler({
        conversation,
        actor: { id: message.author.id, name: message.author.username },
        command: "send",
        args: { text: message.content },
        rawText: message.content,
        messageId: message.id
      });
      await replyToMessageSafely(message, outbound);
      await reactToMessage(message, MESSAGE_STATUS_REACTIONS.done);
    } catch (error) {
      await reactToMessage(message, MESSAGE_STATUS_REACTIONS.failed);
      await replyToMessageSafely(message, {
        kind: "error",
        title: "Message Failed",
        text: (error as Error).message
      });
    }
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

export function buildCodexSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("codex")
      .setDescription("连接本机 Codex 项目会话")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("bind")
          .setDescription("绑定当前频道到一个本机项目目录")
          .addStringOption((option) =>
            option
              .setName("path")
              .setDescription("本机项目绝对路径，例如 E:\\Projects\\demo 或 /srv/app")
              .setRequired(true)
          )
          .addStringOption((option) =>
            option.setName("alias").setDescription("项目别名，可用于人工识别").setRequired(false)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("confirm")
          .setDescription("确认绑定或高风险操作")
          .addStringOption((option) =>
            option.setName("code").setDescription("Bot 给出的确认码").setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("unbind").setDescription("解除当前频道的项目绑定")
      )
      .addSubcommand((subcommand) => subcommand.setName("status").setDescription("查看当前项目状态"))
      .addSubcommand((subcommand) => subcommand.setName("start").setDescription("启动当前项目的 Codex 会话"))
      .addSubcommand((subcommand) => subcommand.setName("resume").setDescription("恢复或接入当前项目会话"))
      .addSubcommand((subcommand) =>
        subcommand.setName("pin").setDescription("让当前项目会话保持驻留")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("unpin").setDescription("解除驻留，恢复按需启动")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("send")
          .setDescription("向当前项目的 Codex 发送消息")
          .addStringOption((option) =>
            option.setName("text").setDescription("要发送给 Codex 的内容").setRequired(true)
          )
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("projects").setDescription("列出本机已绑定项目")
      )
      .toJSON()
  ];
}

export function shouldIgnoreMessage(message: Pick<Message, "author" | "system">): boolean {
  return message.author.bot || message.system;
}

async function deferInteractionSafely(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply();
    return true;
  } catch (error) {
    console.error(`Failed to defer Discord interaction: ${(error as Error).message}`);
    return false;
  }
}

async function reactToMessage(message: Message, emoji: string): Promise<void> {
  await message.react(emoji).catch(() => undefined);
}

async function replyToMessageSafely(message: Message, outbound: OutboundMessage): Promise<void> {
  const payload = formatOutbound(outbound);
  try {
    await message.reply(payload);
    return;
  } catch (error) {
    console.error(`Failed to reply to Discord message: ${(error as Error).message}`);
  }

  try {
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send(payload);
    }
  } catch (error) {
    console.error(`Failed to send fallback Discord message: ${(error as Error).message}`);
  }
}

async function sendToInteractionChannelSafely(
  interaction: ChatInputCommandInteraction,
  outbound: OutboundMessage
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function") return;
  try {
    await channel.send(formatOutbound(outbound));
    console.info(`Discord interaction fallback channel message sent: ${interaction.id}`);
  } catch (error) {
    console.error(`Failed to send fallback Discord interaction message: ${(error as Error).message}`);
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
