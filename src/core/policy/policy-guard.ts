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
      mentionsHighRiskOperation(normalizedText, keyword)
    );
    if (matchedKeyword) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Command requests high-risk operation: ${matchedKeyword}`
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

interface RiskOperationPattern {
  canonical: string;
  aliases: string[];
  mentionWords: string[];
  objectWords: string[];
}

const RISK_OPERATIONS: RiskOperationPattern[] = [
  {
    canonical: "commit",
    aliases: ["commit", "提交"],
    mentionWords: ["message", "msg", "format", "history", "log", "diff", "机制", "格式", "信息", "记录", "历史", "说明"],
    objectWords: ["change", "changes", "code", "worktree", "current", "staged", "改动", "代码", "当前", "暂存"]
  },
  {
    canonical: "push",
    aliases: ["push", "推送"],
    mentionWords: ["mechanism", "workflow", "history", "log", "机制", "流程", "说明"],
    objectWords: ["branch", "remote", "origin", "main", "master", "current", "分支", "远程", "当前"]
  },
  {
    canonical: "merge",
    aliases: ["merge", "合并"],
    mentionWords: ["conflict", "strategy", "机制", "策略", "冲突", "说明"],
    objectWords: ["branch", "main", "master", "into", "分支", "主线"]
  },
  {
    canonical: "delete",
    aliases: ["delete", "remove", "rm", "del", "删除", "移除", "删掉"],
    mentionWords: ["meaning", "example", "说明", "含义", "例子"],
    objectWords: ["file", "folder", "directory", "branch", "production", "remote", "文件", "目录", "分支", "生产"]
  },
  {
    canonical: "deploy",
    aliases: ["deploy", "部署", "发布", "上线"],
    mentionWords: ["plan", "process", "流程", "计划", "说明"],
    objectWords: ["production", "prod", "server", "site", "app", "生产", "服务器", "网站", "应用"]
  },
  {
    canonical: "reset",
    aliases: ["reset", "重置", "回滚"],
    mentionWords: ["meaning", "difference", "说明", "区别", "含义"],
    objectWords: ["hard", "soft", "head", "branch", "changes", "当前", "改动", "分支"]
  }
];

const INTENT_WORDS = [
  "please",
  "pls",
  "run",
  "execute",
  "perform",
  "start",
  "do",
  "make",
  "create",
  "go",
  "ahead",
  "now",
  "帮我",
  "请",
  "执行",
  "运行",
  "开始",
  "直接",
  "现在",
  "做",
  "进行"
];

const EXPLANATION_WORDS = [
  "what",
  "why",
  "how",
  "explain",
  "describe",
  "说明",
  "解释",
  "作用",
  "为什么",
  "是什么",
  "怎么",
  "是否",
  "有没有",
  "只是",
  "补充"
];

function mentionsHighRiskOperation(normalizedText: string, configuredKeyword: string): boolean {
  const configured = normalizeRiskText(configuredKeyword);
  if (!configured) return false;

  const operation = riskOperationFor(configured);
  const aliases = operation?.aliases ?? [configured];
  const matchedAlias = aliases.find((alias) => containsRiskAlias(normalizedText, alias));
  if (!matchedAlias) return false;

  if (isLikelyExplanatoryMention(normalizedText, matchedAlias, operation)) {
    return false;
  }

  if (isExactActionAlias(normalizedText, matchedAlias)) return true;
  if (mentionsGitCommand(normalizedText, matchedAlias)) return true;
  if (hasIntentNearAlias(normalizedText, matchedAlias)) return true;
  if (hasOperationObject(normalizedText, matchedAlias, operation)) return true;

  return startsWithActionAlias(normalizedText, matchedAlias);
}

function riskOperationFor(configured: string): RiskOperationPattern | undefined {
  return RISK_OPERATIONS.find(
    (operation) => operation.canonical === configured || operation.aliases.includes(configured)
  );
}

function containsRiskAlias(text: string, alias: string): boolean {
  if (isAsciiWord(alias)) {
    return new RegExp(
      `(?:^|\\s|[^a-z0-9_.\\\\/-])${escapeRegex(alias)}(?:\\s|$|[^a-z0-9_.\\\\/-])`,
      "u"
    ).test(text);
  }
  return text.includes(alias);
}

function mentionsGitCommand(text: string, alias: string): boolean {
  if (!isAsciiWord(alias)) return false;
  return new RegExp(`(?:^|\\s)git\\s+${escapeRegex(alias)}(?:\\s|$)`, "u").test(text);
}

function hasIntentNearAlias(text: string, alias: string): boolean {
  return INTENT_WORDS.some((word) => {
    const compactText = text.replace(/\s+/gu, "");
    if (compactText.includes(`${word}${alias}`) || compactText.includes(`${alias}${word}`)) {
      return true;
    }
    const escapedWord = escapeRegex(word);
    const escapedAlias = escapeRegex(alias);
    return (
      new RegExp(`${escapedWord}(?:\\s+\\S+){0,6}\\s+${escapedAlias}(?:\\s|$)`, "u").test(text) ||
      new RegExp(`(?:^|\\s)${escapedAlias}(?:\\s+\\S+){0,4}\\s+${escapedWord}(?:\\s|$)`, "u").test(text)
    );
  });
}

function hasOperationObject(
  text: string,
  alias: string,
  operation: RiskOperationPattern | undefined
): boolean {
  if (!operation) return false;
  return operation.objectWords.some((word) => {
    const compactText = text.replace(/\s+/gu, "");
    if (compactText.includes(`${alias}${word}`)) return true;
    const escapedAlias = escapeRegex(alias);
    const escapedWord = escapeRegex(word);
    return new RegExp(
      `(?:^|\\s)${escapedAlias}(?:\\s+\\S+){0,5}\\s+${escapedWord}(?:\\s|$)`,
      "u"
    ).test(text);
  });
}

function isExactActionAlias(text: string, alias: string): boolean {
  return text === alias;
}

function startsWithActionAlias(text: string, alias: string): boolean {
  if (!containsRiskAlias(text, alias)) return false;
  const pattern = isAsciiWord(alias)
    ? new RegExp(`^${escapeRegex(alias)}\\s+\\S+`, "u")
    : new RegExp(`^${escapeRegex(alias)}\\S+`, "u");
  return pattern.test(text);
}

function isLikelyExplanatoryMention(
  text: string,
  alias: string,
  operation: RiskOperationPattern | undefined
): boolean {
  const explanationWords = [...EXPLANATION_WORDS, ...(operation?.mentionWords ?? [])];
  return explanationWords.some((word) => {
    const compactText = text.replace(/\s+/gu, "");
    if (compactText.includes(`${word}${alias}`) || compactText.includes(`${alias}${word}`)) {
      return true;
    }
    const escapedWord = escapeRegex(word);
    const escapedAlias = escapeRegex(alias);
    return (
      new RegExp(`${escapedWord}(?:\\s+\\S+){0,8}\\s+${escapedAlias}(?:\\s|$)`, "u").test(text) ||
      new RegExp(`(?:^|\\s)${escapedAlias}(?:\\s+\\S+){0,6}\\s+${escapedWord}(?:\\s|$)`, "u").test(text)
    );
  });
}

function isAsciiWord(text: string): boolean {
  return /^[a-z0-9_.\/\\-]+$/u.test(text);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
