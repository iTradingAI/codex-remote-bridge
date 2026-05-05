import { readFile } from "node:fs/promises";
import type { BindingRegistry } from "../core/bindings/binding-registry.js";
import type { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";
import type { AuditLog } from "../storage/audit-log.js";
import type { ExecutionStateStore } from "../storage/execution-state-store.js";
import type { BridgeConfig, ConversationRef, HookEvent, OutboundMessage } from "../types.js";

const supportedEvents = new Set(["session-start", "needs-input", "stop", "session-end", "failed"]);

export function normalizeHookEvent(raw: unknown): HookEvent {
  if (!raw || typeof raw !== "object") {
    return { event: "unsupported", raw };
  }
  const record = raw as Record<string, unknown>;
  const eventName = String(record.event ?? record.hook_event_name ?? "unsupported");
  const event = supportedEvents.has(eventName) ? (eventName as HookEvent["event"]) : "unsupported";
  return {
    event,
    bindingId: typeof record.binding_id === "string" ? record.binding_id : undefined,
    conversation: parseConversation(record),
    text: typeof record.text === "string" ? record.text : undefined,
    raw
  };
}

export async function readHookEventFromStdin(): Promise<HookEvent> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return { event: "unsupported", raw: null };
  return normalizeHookEvent(JSON.parse(text) as unknown);
}

export async function readHookEventFromFile(filePath: string): Promise<HookEvent> {
  return normalizeHookEvent(JSON.parse(await readFile(filePath, "utf8")) as unknown);
}

export async function routeHookEvent(input: {
  config: BridgeConfig;
  event: HookEvent;
  bindings: BindingRegistry;
  provider?: DiscordProviderAdapter;
  executionStates?: ExecutionStateStore;
  audit: AuditLog;
}): Promise<OutboundMessage> {
  const binding = await findHookBinding(input.event, input.bindings);

  const outbound: OutboundMessage = {
    kind: input.event.event === "failed" ? "error" : "status",
    title: `Codex ${input.event.event}`,
    text: input.event.text ?? "Lifecycle event received."
  };

  await input.audit.append({
    at: new Date().toISOString(),
    machineId: input.config.machineId,
    bindingId: binding?.id,
    conversation: binding
      ? {
          provider: binding.provider,
          workspaceId: binding.workspaceId,
          conversationId: binding.conversationId
        }
      : undefined,
    action: `hook:${input.event.event}`,
    allowed: input.event.event !== "unsupported",
    summary: outbound.text
  });

  if (binding && input.event.event !== "unsupported") {
    await input.executionStates?.set(
      binding,
      executionStateForHook(input.event.event),
      outbound.text
    );
  }

  if (input.provider && binding && input.event.event !== "unsupported") {
    try {
      await input.provider.sendMessage(
        {
          provider: binding.provider,
          workspaceId: binding.workspaceId,
          conversationId: binding.conversationId
        },
        outbound
      );
    } catch (error) {
      await input.audit.append({
        at: new Date().toISOString(),
        machineId: input.config.machineId,
        bindingId: binding.id,
        conversation: {
          provider: binding.provider,
          workspaceId: binding.workspaceId,
          conversationId: binding.conversationId
        },
        action: `hook:${input.event.event}:notify_failed`,
        allowed: false,
        summary: (error as Error).message
      });
    }
  }

  return outbound;
}

function executionStateForHook(event: HookEvent["event"]) {
  switch (event) {
    case "session-start":
      return "executing";
    case "needs-input":
      return "waiting_input";
    case "session-end":
    case "stop":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

async function findHookBinding(event: HookEvent, bindings: BindingRegistry) {
  if (event.bindingId) {
    return (await bindings.listForMachine()).find((item) => item.id === event.bindingId);
  }
  if (event.conversation) {
    return bindings.findByConversation(event.conversation);
  }
  return undefined;
}

function parseConversation(record: Record<string, unknown>): ConversationRef | undefined {
  if (record.conversation && typeof record.conversation === "object") {
    const conversation = record.conversation as Record<string, unknown>;
    return conversationFromFields(conversation);
  }
  return conversationFromFields(record);
}

function conversationFromFields(record: Record<string, unknown>): ConversationRef | undefined {
  const provider = record.provider;
  const workspaceId = record.workspace_id ?? record.workspaceId;
  const conversationId = record.conversation_id ?? record.conversationId;
  if (
    (provider === "discord" || provider === "telegram" || provider === "feishu") &&
    typeof workspaceId === "string" &&
    typeof conversationId === "string"
  ) {
    return { provider, workspaceId, conversationId };
  }
  return undefined;
}
