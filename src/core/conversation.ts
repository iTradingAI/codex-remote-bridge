import type { ConversationRef } from "../types.js";

export function conversationKey(ref: ConversationRef): string {
  return `${ref.provider}:${ref.workspaceId}:${ref.conversationId}`;
}

export function bindingIdFromConversation(ref: ConversationRef): string {
  return conversationKey(ref)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isSameConversation(a: ConversationRef, b: ConversationRef): boolean {
  return (
    a.provider === b.provider &&
    a.workspaceId === b.workspaceId &&
    a.conversationId === b.conversationId
  );
}
