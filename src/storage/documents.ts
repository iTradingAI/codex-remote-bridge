import type {
  AuditEvent,
  BindingExecutionState,
  PendingApproval,
  ProjectBinding,
  RuntimeSession
} from "../types.js";

export interface BindingsDocument {
  version: 1;
  bindings: ProjectBinding[];
}

export interface SessionsDocument {
  version: 1;
  sessions: RuntimeSession[];
}

export interface PendingApprovalsDocument {
  version: 1;
  approvals: PendingApproval[];
}

export interface ExecutionStatesDocument {
  version: 1;
  states: BindingExecutionState[];
}

export function emptyBindings(): BindingsDocument {
  return { version: 1, bindings: [] };
}

export function emptySessions(): SessionsDocument {
  return { version: 1, sessions: [] };
}

export function emptyApprovals(): PendingApprovalsDocument {
  return { version: 1, approvals: [] };
}

export function emptyExecutionStates(): ExecutionStatesDocument {
  return { version: 1, states: [] };
}

export type AuditRecord = AuditEvent;
