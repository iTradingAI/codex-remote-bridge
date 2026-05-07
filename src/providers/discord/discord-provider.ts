import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Interaction,
  type Message
} from "discord.js";
import type {
  BridgeConfig,
  ConversationRef,
  InboundCommand,
  OutboundAction,
  OutboundMessage,
  OutboundSink
} from "../../types.js";
import { DiscordIngressOwnership } from "./ownership.js";

export type CommandHandler = (
  command: InboundCommand,
  sink?: OutboundSink
) => Promise<OutboundMessage>;
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

type InteractionReplyMode = "interaction" | "channel";
type DiscordPayload = {
  content: string;
  components?: ActionRowBuilder<ButtonBuilder>[];
};

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
      activities: [{ name: "Codex Remote Bridge" }]
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
    for (const payload of formatOutboundParts(message)) {
      await channel.send(toDiscordPayload(payload, message.actions));
    }
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isButton() && interaction.customId.startsWith("codex:")) {
      await this.handleButtonInteraction(interaction);
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "codex") return;

    let replyMode: InteractionReplyMode = "interaction";
    try {
      if (!this.commandHandler) throw new Error("No command handler registered");
      console.info(`Discord interaction received: ${interaction.id}`);
      replyMode = await deferInteractionSafely(interaction);
      if (replyMode === "interaction") {
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
        await this.sendInteractionResponse(interaction, replyMode, {
          kind: "error",
          title: "Conversation Not Owned",
          text: `This bridge is not configured for this Discord channel/thread. ${reason}`
        });
        return;
      }

      const sink =
        replyMode === "interaction"
          ? interactionProgressSink(interaction)
          : interactionChannelProgressSink(interaction);
      const outbound = await this.commandHandler(command, sink);
      await sink.finalize(outbound);
    } catch (error) {
      await this.sendInteractionResponse(interaction, replyMode, {
        kind: "error",
        title: "Command Failed",
        text: (error as Error).message
      });
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    try {
      if (!this.commandHandler) throw new Error("No command handler registered");
      const command = this.commandFromButton(interaction);
      console.info(`Discord button routed: ${interaction.id} ${command.command}`);
      const ownership = this.ownership.accepts(command.conversation);
      if (!ownership.accepted) {
        await interaction.reply({
          content: formatOutbound({
            kind: "error",
            title: "Conversation Not Owned",
            text: `This bridge is not configured for this Discord channel/thread. ${ownership.reason ?? ""}`
          }),
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();
      const outbound = await this.commandHandler(command, componentProgressSink(interaction));
      await editButtonReplySafely(interaction, outbound);
    } catch (error) {
      await replyOrEditButtonError(interaction, {
        kind: "error",
        title: "Command Failed",
        text: (error as Error).message
      });
    }
  }

  private async sendInteractionResponse(
    interaction: ChatInputCommandInteraction,
    mode: InteractionReplyMode,
    message: OutboundMessage
  ): Promise<void> {
    if (mode === "channel") {
      await sendToInteractionChannelSafely(interaction, message);
      return;
    }
    await this.replyToInteractionSafely(interaction, message);
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
    const [first, ...rest] = formatOutboundParts(message);
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(toDiscordPayload(first, message.actions));
      for (const payload of rest) {
        await interaction.followUp(payload);
      }
      return;
    }
    if (interaction.replied) {
      await interaction.followUp(toDiscordPayload(first, message.actions));
      for (const payload of rest) {
        await interaction.followUp(payload);
      }
      return;
    }
    await interaction.reply(toDiscordPayload(first, message.actions));
    for (const payload of rest) {
      await interaction.followUp(payload);
    }
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
      const sink = messageProgressSink(message);
      const outbound = await this.commandHandler({
        conversation,
        actor: { id: message.author.id, name: message.author.username },
        command: "send",
        args: { text: message.content },
        rawText: message.content,
        messageId: message.id
      }, sink);
      await sink.finalize(outbound);
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

  private commandFromButton(interaction: ButtonInteraction): InboundCommand {
    const [namespace, action, code] = interaction.customId.split(":");
    if (namespace !== "codex" || action !== "confirm" || !code) {
      throw new Error("Unsupported button action.");
    }
    return {
      conversation: conversationFromInteraction(interaction),
      actor: { id: interaction.user.id, name: interaction.user.username },
      command: "confirm",
      args: { code },
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

async function deferInteractionSafely(
  interaction: ChatInputCommandInteraction
): Promise<InteractionReplyMode> {
  if (interaction.deferred || interaction.replied) return "interaction";
  try {
    await interaction.deferReply();
    return "interaction";
  } catch (error) {
    console.error(`Failed to defer Discord interaction: ${(error as Error).message}`);
    return "channel";
  }
}

async function reactToMessage(message: Message, emoji: string): Promise<void> {
  await message.react(emoji).catch(() => undefined);
}

async function replyToMessageSafely(message: Message, outbound: OutboundMessage): Promise<void> {
  const [first, ...rest] = formatOutboundParts(outbound);
  try {
    await message.reply(toDiscordPayload(first, outbound.actions));
    await sendAdditionalParts(message, rest);
    return;
  } catch (error) {
    console.error(`Failed to reply to Discord message: ${(error as Error).message}`);
  }

  try {
    await sendAdditionalParts(message, [first, ...rest]);
  } catch (error) {
    console.error(`Failed to send fallback Discord message: ${(error as Error).message}`);
  }
}

function messageProgressSink(message: Message): OutboundSink & { finalize(message: OutboundMessage): Promise<void> } {
  let primary: Message | undefined;
  return {
    update: async (outbound) => {
      const first = formatOutboundParts(outbound)[0] ?? "";
      if (!primary) {
        primary = await message.reply(toDiscordPayload(first, outbound.actions));
        return;
      }
      await primary.edit(toDiscordEditPayload(first, outbound.actions)).catch(async () => {
        primary = await message.reply(toDiscordPayload(first, outbound.actions));
      });
    },
    finalize: async (outbound) => {
      const [first, ...rest] = formatOutboundParts(outbound);
      if (!primary) {
        await replyToMessageSafely(message, outbound);
        return;
      }
      await primary.edit(toDiscordEditPayload(first, outbound.actions)).catch(async () => {
        primary = await message.reply(toDiscordPayload(first, outbound.actions));
      });
      await sendAdditionalParts(message, rest);
    }
  };
}

function interactionProgressSink(
  interaction: ChatInputCommandInteraction
): OutboundSink & { finalize(message: OutboundMessage): Promise<void> } {
  return {
    update: async (outbound) => {
      const first = formatOutboundParts(outbound)[0] ?? "";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(toDiscordEditPayload(first, outbound.actions)).catch(() => undefined);
        return;
      }
      await interaction.reply(toDiscordPayload(first, outbound.actions)).catch(() => undefined);
    },
    finalize: async (outbound) => {
      await sendToInteractionPartsSafely(interaction, outbound).catch(async (error) => {
        console.error(`Failed to finalize Discord interaction: ${(error as Error).message}`);
        await sendToInteractionChannelSafely(interaction, outbound);
      });
    }
  };
}

function interactionChannelProgressSink(
  interaction: ChatInputCommandInteraction
): OutboundSink & { finalize(message: OutboundMessage): Promise<void> } {
  let primary: Message | undefined;
  return {
    update: async (outbound) => {
      const first = formatOutboundParts(outbound)[0] ?? "";
      primary = await sendOrEditInteractionChannelMessage(interaction, primary, first, outbound.actions);
    },
    finalize: async (outbound) => {
      const [first, ...rest] = formatOutboundParts(outbound);
      primary = await sendOrEditInteractionChannelMessage(interaction, primary, first, outbound.actions);
      await sendInteractionChannelParts(interaction, rest);
    }
  };
}

function componentProgressSink(
  interaction: ButtonInteraction
): OutboundSink & { finalize(message: OutboundMessage): Promise<void> } {
  return {
    update: async (outbound) => {
      await interaction.editReply(toDiscordEditPayload(formatOutboundParts(outbound)[0] ?? "", outbound.actions));
    },
    finalize: async (outbound) => {
      await editButtonReplySafely(interaction, outbound);
    }
  };
}

async function editButtonReplySafely(
  interaction: ButtonInteraction,
  outbound: OutboundMessage
): Promise<void> {
  try {
    const [first, ...rest] = formatOutboundParts(outbound);
    await interaction.editReply(toDiscordEditPayload(first, outbound.actions));
    for (const payload of rest) {
      await interaction.followUp(payload);
    }
  } catch (error) {
    console.error(`Failed to edit Discord button response: ${(error as Error).message}`);
    await sendToButtonChannelSafely(interaction, outbound);
  }
}

async function replyOrEditButtonError(
  interaction: ButtonInteraction,
  outbound: OutboundMessage
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await editButtonReplySafely(interaction, outbound);
    return;
  }
  await interaction.reply(toDiscordPayload(formatOutboundParts(outbound)[0] ?? "", outbound.actions)).catch(
    async () => {
      await sendToButtonChannelSafely(interaction, outbound);
    }
  );
}

async function sendToButtonChannelSafely(
  interaction: ButtonInteraction,
  outbound: OutboundMessage
): Promise<void> {
  try {
    const [first, ...rest] = formatOutboundParts(outbound);
    await sendInteractionChannelPayloads(interaction, [
      toDiscordPayload(first, outbound.actions),
      ...rest
    ]);
  } catch (error) {
    console.error(`Failed to send fallback Discord button message: ${(error as Error).message}`);
  }
}

async function sendAdditionalParts(message: Message, payloads: string[]): Promise<void> {
  if (!("send" in message.channel) || typeof message.channel.send !== "function") return;
  for (const payload of payloads) {
    await message.channel.send(payload);
  }
}

async function sendToInteractionPartsSafely(
  interaction: ChatInputCommandInteraction,
  outbound: OutboundMessage
): Promise<void> {
  const [first, ...rest] = formatOutboundParts(outbound);
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply(toDiscordEditPayload(first, outbound.actions));
  } else if (interaction.replied) {
    await interaction.followUp(toDiscordPayload(first, outbound.actions));
  } else {
    await interaction.reply(toDiscordPayload(first, outbound.actions));
  }
  for (const payload of rest) {
    await interaction.followUp(payload);
  }
}


async function sendToInteractionChannelSafely(
  interaction: ChatInputCommandInteraction,
  outbound: OutboundMessage
): Promise<void> {
  try {
    const [first, ...rest] = formatOutboundParts(outbound);
    await sendInteractionChannelPayloads(interaction, [
      toDiscordPayload(first, outbound.actions),
      ...rest
    ]);
    console.info(`Discord interaction fallback channel message sent: ${interaction.id}`);
  } catch (error) {
    console.error(`Failed to send fallback Discord interaction message: ${(error as Error).message}`);
  }
}

async function sendOrEditInteractionChannelMessage(
  interaction: ChatInputCommandInteraction,
  previous: Message | undefined,
  payload: string,
  actions = [] as OutboundMessage["actions"]
): Promise<Message | undefined> {
  const discordPayload = toDiscordPayload(payload, actions);
  if (previous) {
    try {
      await previous.edit(toDiscordEditPayload(payload, actions));
      return previous;
    } catch (error) {
      console.error(`Failed to edit fallback Discord interaction message: ${(error as Error).message}`);
    }
  }
  const [message] = await sendInteractionChannelPayloads(interaction, [discordPayload]);
  return message;
}

async function sendInteractionChannelParts(
  interaction: ChatInputCommandInteraction,
  payloads: string[]
): Promise<Message[]> {
  return sendInteractionChannelPayloads(interaction, payloads);
}

async function sendInteractionChannelPayloads(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  payloads: Array<string | DiscordPayload>
): Promise<Message[]> {
  const channel = interaction.channel;
  if (!channel || !("send" in channel) || typeof channel.send !== "function") return [];
  const sent: Message[] = [];
  for (const payload of payloads) {
    sent.push(await channel.send(payload));
  }
  return sent;
}

export function discordTargetChannelId(target: ConversationRef): string {
  const threadMatch = /\/thread:([^/]+)$/.exec(target.conversationId);
  if (threadMatch?.[1]) return threadMatch[1];
  const channelMatch = /^channel:([^/]+)$/.exec(target.conversationId);
  if (channelMatch?.[1]) return channelMatch[1];
  throw new Error(`Unsupported Discord conversation id: ${target.conversationId}`);
}

export function conversationFromInteraction(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): ConversationRef {
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
  return formatOutboundParts(message)[0] ?? "";
}

export function formatOutboundParts(message: OutboundMessage): string[] {
  const title = message.title ? `**${message.title}**\n` : "";
  const fields =
    message.fields && message.fields.length > 0
      ? `\n${message.fields.map((field) => `**${field.label}:** ${field.value}`).join("\n")}`
      : "";
  return splitDiscordMessage(`${title}${message.text}${fields}`);
}

export function toDiscordPayload(
  content: string,
  actions: OutboundAction[] = []
): string | DiscordPayload {
  if (actions.length === 0) return content;
  return toDiscordEditPayload(content, actions);
}

export function toDiscordEditPayload(
  content: string,
  actions: OutboundAction[] = []
): DiscordPayload {
  return {
    content,
    components:
      actions.length === 0
        ? []
        : [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              actions.slice(0, 5).map((action) =>
                new ButtonBuilder()
                  .setCustomId(`codex:${action.id}`)
                  .setLabel(action.label)
                  .setStyle(buttonStyle(action.style))
              )
            )
          ]
  };
}

function buttonStyle(style: OutboundAction["style"]): ButtonStyle {
  switch (style) {
    case "primary":
      return ButtonStyle.Primary;
    case "danger":
      return ButtonStyle.Danger;
    case "secondary":
      return ButtonStyle.Secondary;
    case "success":
    default:
      return ButtonStyle.Success;
  }
}

function splitDiscordMessage(text: string): string[] {
  const limit = 1900;
  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const splitAt = bestSplitIndex(remaining, limit);
    parts.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0 || parts.length === 0) {
    parts.push(remaining);
  }
  return parts;
}

function bestSplitIndex(text: string, limit: number): number {
  const newline = text.lastIndexOf("\n", limit);
  if (newline > limit * 0.6) return newline + 1;
  const space = text.lastIndexOf(" ", limit);
  if (space > limit * 0.6) return space + 1;
  return limit;
}
