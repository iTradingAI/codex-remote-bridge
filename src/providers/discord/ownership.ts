import type { AllowedScope, ConversationRef } from "../../types.js";

export interface OwnershipDecision {
  accepted: boolean;
  reason?: string;
}

export class DiscordIngressOwnership {
  constructor(private readonly allowedScopes: AllowedScope[]) {}

  accepts(conversation: ConversationRef): OwnershipDecision {
    if (conversation.provider !== "discord") {
      return { accepted: false, reason: "Provider is not discord" };
    }

    const matched = this.allowedScopes.some((scope) => {
      if (scope.workspaceId !== conversation.workspaceId) return false;
      if (!scope.conversationId) return true;
      return (
        conversation.conversationId === scope.conversationId ||
        conversation.conversationId.startsWith(`${scope.conversationId}/`)
      );
    });

    if (!matched) {
      return { accepted: false, reason: "Conversation is outside this machine's allowed scopes" };
    }

    return { accepted: true };
  }
}
