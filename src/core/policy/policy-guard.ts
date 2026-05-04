import type { InboundActor, PolicyConfig, ProjectBinding } from "../../types.js";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}

export class PolicyGuard {
  constructor(private readonly globalPolicy: PolicyConfig) {}

  canStatus(actor: InboundActor, binding?: ProjectBinding): PolicyDecision {
    return this.isAuthorized(actor, binding?.policy ?? this.globalPolicy);
  }

  canStart(actor: InboundActor, binding: ProjectBinding): PolicyDecision {
    return this.isAuthorized(actor, binding.policy);
  }

  canSend(actor: InboundActor, binding: ProjectBinding, text: string): PolicyDecision {
    const auth = this.isAuthorized(actor, binding.policy);
    if (!auth.allowed) return auth;

    const normalizedText = normalizeRiskText(text);
    const matchedKeyword = binding.policy.requireConfirmationFor.find((keyword) =>
      normalizedText.includes(normalizeRiskText(keyword))
    );
    if (matchedKeyword) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Command mentions high-risk keyword: ${matchedKeyword}`
      };
    }

    return { allowed: true };
  }

  canDirectInject(binding: ProjectBinding): boolean {
    return binding.policy.allowDirectInjection;
  }

  private isAuthorized(actor: InboundActor, policy: PolicyConfig): PolicyDecision {
    if (policy.authorizedUserIds.includes(actor.id)) {
      return { allowed: true };
    }
    return { allowed: false, reason: "User is not authorized for this binding" };
  }
}

export function normalizeRiskText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\p{L}\p{N}_./\\-]+/gu, " ")
    .toLowerCase()
    .trim();
}
