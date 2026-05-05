import { join } from "node:path";
import type { BridgeConfig } from "../types.js";

export interface StoragePaths {
  bindings: string;
  sessions: string;
  executionStates: string;
  eventQueueDir: string;
  approvals: string;
  audit: string;
}

export function storagePaths(config: BridgeConfig): StoragePaths {
  return {
    bindings: join(config.dataDir, "bindings.json"),
    sessions: join(config.dataDir, "sessions.json"),
    executionStates: join(config.dataDir, "execution-states.json"),
    eventQueueDir: join(config.dataDir, "events"),
    approvals: join(config.dataDir, "pending-approvals.json"),
    audit: join(config.dataDir, "audit.jsonl")
  };
}
