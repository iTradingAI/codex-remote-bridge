import type { BindingExecutionState, ExecutionStateName, ProjectBinding } from "../types.js";
import type { ExecutionStatesDocument } from "./documents.js";
import { JsonFileStore } from "./json-file-store.js";

export class ExecutionStateStore {
  constructor(private readonly store: JsonFileStore<ExecutionStatesDocument>) {}

  async get(binding: ProjectBinding, options: { liveSessionMissing?: boolean } = {}): Promise<BindingExecutionState> {
    const document = await this.store.read();
    const existing = document.states.find(
      (state) => state.bindingId === binding.id && state.machineId === binding.machineId
    );
    const state =
      existing ?? {
        bindingId: binding.id,
        machineId: binding.machineId,
        state: "idle",
        updatedAt: binding.updatedAt
      };
    if (options.liveSessionMissing && isActiveState(state.state)) {
      return this.set(binding, "idle", `Stale ${state.state} state cleared because tmux is missing.`);
    }
    return state;
  }

  async set(
    binding: ProjectBinding,
    state: ExecutionStateName,
    detail?: string
  ): Promise<BindingExecutionState> {
    const next: BindingExecutionState = {
      bindingId: binding.id,
      machineId: binding.machineId,
      state,
      detail,
      updatedAt: new Date().toISOString()
    };
    await this.store.update((document) => {
      const index = document.states.findIndex(
        (item) => item.bindingId === binding.id && item.machineId === binding.machineId
      );
      if (index >= 0) {
        document.states[index] = next;
      } else {
        document.states.push(next);
      }
      return document;
    });
    return next;
  }
}

function isActiveState(state: ExecutionStateName): boolean {
  return state === "queued" || state === "thinking" || state === "executing";
}
