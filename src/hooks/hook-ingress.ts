import { readFile } from "node:fs/promises";
import type { BindingRegistry } from "../core/bindings/binding-registry.js";
import type { DiscordProviderAdapter } from "../providers/discord/discord-provider.js";
import type { AuditLog } from "../storage/audit-log.js";
import type { BridgeConfig, HookEvent, OutboundMessage } from "../types.js";

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
  audit: AuditLog;
}): Promise<OutboundMessage> {
  const binding = input.event.bindingId
    ? (await input.bindings.listForMachine()).find((item) => item.id === input.event.bindingId)
    : undefined;

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

  if (input.provider && binding && input.event.event !== "unsupported") {
    await input.provider.sendMessage(
      {
        provider: binding.provider,
        workspaceId: binding.workspaceId,
        conversationId: binding.conversationId
      },
      outbound
    );
  }

  return outbound;
}
