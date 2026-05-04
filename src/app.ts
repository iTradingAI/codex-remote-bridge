import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadBridgeConfig } from "./config.js";
import { BindingRegistry } from "./core/bindings/binding-registry.js";
import { PolicyGuard } from "./core/policy/policy-guard.js";
import { ProjectPathGuard } from "./core/policy/project-path-guard.js";
import { CommandRouter } from "./core/router/router.js";
import { CodexTmuxRuntime } from "./runtime/codex-tmux/codex-tmux-runtime.js";
import { AuditLog } from "./storage/audit-log.js";
import { ApprovalStore } from "./storage/approval-store.js";
import {
  emptyApprovals,
  emptyBindings,
  emptySessions,
  type BindingsDocument,
  type PendingApprovalsDocument,
  type SessionsDocument
} from "./storage/documents.js";
import { JsonFileStore } from "./storage/json-file-store.js";
import { storagePaths } from "./storage/paths.js";
import { ProcessLock } from "./storage/process-lock.js";

export interface CreateBridgeOptions {
  acquireLock?: boolean;
}

export async function createBridge(configPath: string, options: CreateBridgeOptions = {}) {
  const config = await loadBridgeConfig(configPath);
  await mkdir(config.dataDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  const lock = options.acquireLock === false
    ? undefined
    : await ProcessLock.acquire(join(config.dataDir, ".bridge.lock"));
  const paths = storagePaths(config);

  const bindingStore = new JsonFileStore<BindingsDocument>(paths.bindings, emptyBindings);
  const sessionStore = new JsonFileStore<SessionsDocument>(paths.sessions, emptySessions);
  const approvalStore = new JsonFileStore<PendingApprovalsDocument>(paths.approvals, emptyApprovals);
  const audit = new AuditLog(paths.audit);
  const bindings = new BindingRegistry(config, bindingStore);
  const runtime = new CodexTmuxRuntime(config, sessionStore);

  const router = new CommandRouter(
    config,
    bindings,
    new ProjectPathGuard(config.pathAllowlist),
    new PolicyGuard(config.policy),
    new ApprovalStore(approvalStore),
    runtime,
    audit
  );

  return {
    config,
    bindings,
    runtime,
    router,
    audit,
    auditPath: paths.audit,
    logsPath: join(config.logDir, "bridge.jsonl"),
    release: () => lock?.release() ?? Promise.resolve()
  };
}
