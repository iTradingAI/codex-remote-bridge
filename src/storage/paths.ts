import { join } from "node:path";
import type { BridgeConfig } from "../types.js";

export interface StoragePaths {
  bindings: string;
  sessions: string;
  approvals: string;
  audit: string;
}

export function storagePaths(config: BridgeConfig): StoragePaths {
  return {
    bindings: join(config.dataDir, "bindings.json"),
    sessions: join(config.dataDir, "sessions.json"),
    approvals: join(config.dataDir, "pending-approvals.json"),
    audit: join(config.dataDir, "audit.jsonl")
  };
}
