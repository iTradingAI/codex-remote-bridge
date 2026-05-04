import { randomBytes } from "node:crypto";
import type { PendingApproval } from "../types.js";
import type { PendingApprovalsDocument } from "./documents.js";
import { JsonFileStore } from "./json-file-store.js";

export class ApprovalStore {
  constructor(private readonly store: JsonFileStore<PendingApprovalsDocument>) {}

  async create(input: Omit<PendingApproval, "id" | "code" | "createdAt" | "expiresAt">): Promise<PendingApproval> {
    const now = new Date();
    const approval: PendingApproval = {
      ...input,
      id: randomBytes(8).toString("hex"),
      code: randomBytes(3).toString("hex").toUpperCase(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    };
    await this.store.update((document) => {
      document.approvals.push(approval);
      return document;
    });
    return approval;
  }

  async consume(code: string, actorId: string): Promise<PendingApproval | undefined> {
    const normalized = code.trim().toUpperCase();
    let found: PendingApproval | undefined;
    await this.store.update((document) => {
      const now = Date.now();
      document.approvals = document.approvals.filter((approval) => {
        const matches = approval.code === normalized && approval.actorId === actorId;
        const expired = Date.parse(approval.expiresAt) <= now;
        if (matches && !expired) {
          found = approval;
          return false;
        }
        return !expired;
      });
      return document;
    });
    return found;
  }
}
