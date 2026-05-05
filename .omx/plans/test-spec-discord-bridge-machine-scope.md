# Test Spec: Machine-owned Discord Bridge

## Scope

This test spec verifies the approved PRD in `.omx/plans/prd-discord-bridge-machine-scope.md`. It covers parent-scope ownership, arbitrary path binding, pin/unpin lifecycle, Bridge-owned local event ingress, execution state, and recipient docs.

## Test Strategy

Use focused unit tests for config, ownership, path validation, binding registry, router, runtime, and hook ingress. Use integration-style tests for router + stores + fake runtime. Use manual smoke tests only for real Discord/tmux behavior that cannot be reliably asserted in Vitest.

Required command gates:

```text
npm run typecheck
npm test
vitest run tests/ownership.test.ts tests/setup.test.ts tests/router.test.ts tests/runtime.test.ts tests/hook-ingress.test.ts tests/hook-route.test.ts
```

## Phase 1 Tests: Parent Scope Setup and Ownership

Files:

- `tests/ownership.test.ts`
- `tests/setup.test.ts`

Cases:

1. A config with parent `channel:parent` accepts child conversation `channel:parent/thread:child`.
2. A config with parent `channel:parent-a` rejects `channel:parent-b/thread:child`.
3. Two different configs for different parent scopes do not accept each other's child threads.
4. Setup emits exactly one channel-only parent scope by default.
5. Setup no longer asks for or stores a project thread ID as the machine ownership boundary.
6. Legacy `allowed_scopes` configs still load.
7. Non-standard multi-scope legacy config is reported by health or config diagnostics.

Pass condition:

- Ownership routing is deterministic by parent scope before commands reach `CommandRouter`.

## Phase 2 Tests: Arbitrary Path Binding

Files:

- `tests/router.test.ts`
- `tests/policy-guard.test.ts`
- `tests/setup.test.ts`

Cases:

1. Authorized user can bind an arbitrary existing absolute temp project path with no default allowlist.
2. Unauthorized user cannot bind a path.
3. Missing path is rejected.
4. Relative path is rejected.
5. POSIX `/` is rejected.
6. Windows drive roots such as `C:\` are rejected by dangerous-root logic where platform-safe to test.
7. Broad user roots such as `C:\Users` are rejected where platform-safe to test.
8. Symlink/junction input resolves to realpath before validation where supported.
9. Optional conservative allowlist mode rejects paths outside configured roots.
10. Fresh setup output writes an empty `path_allowlist` or omits effective default restrictions for ordinary mode.

Pass condition:

- Default binding is not allowlist-gated, but dangerous roots and invalid paths remain blocked.

## Phase 3 Tests: Session Lifecycle

Files:

- `tests/binding-registry.test.ts`
- `tests/router.test.ts`
- `tests/runtime.test.ts`

Cases:

1. New binding defaults to `sessionMode=on_demand`.
2. `/codex pin` requires authorization.
3. `/codex pin` persists `pinned` and calls runtime `ensureSession`.
4. `/codex unpin` requires authorization.
5. `/codex unpin` persists `on_demand` and calls runtime `stop` when session exists.
6. `/codex unpin` succeeds cleanly when the deterministic tmux session is already missing.
7. `/codex unbind` disables the binding and stops resident deterministic session when present.
8. Reloading binding storage preserves `sessionMode`.
9. Manual tmux deletion is reflected as `missing` while pinned intent remains pinned.

Pass condition:

- Desired residency and live tmux state are not conflated.

## Phase 4 Tests: Bridge-owned Local Event Ingress and Execution State

Files:

- `tests/hook-ingress.test.ts`
- `tests/hook-route.test.ts`
- `tests/router.test.ts`
- new local ingress tests

Cases:

1. `runStart` or bridge startup initializes local event ingress alongside the Discord provider.
2. `codex-channel hook` submits events locally and does not construct or start `DiscordProviderAdapter` in the target path.
3. Local event ingress accepts hook JSON/stdin with a valid local token or queue contract.
4. Offline bridge behavior is either queued or rejected with a clear operator-readable error, according to implementation choice.
5. `session-start` maps to a non-terminal execution state such as `executing` or equivalent chosen state.
6. `needs-input` maps to `waiting_input`.
7. `session-end` maps to `completed`.
8. `failed` maps to `failed`.
9. Hook events route to the correct binding by `binding_id` or conversation.
10. Stale execution state after restart is degraded safely and does not show phantom active execution.
11. Router send/start paths record received/queued/thinking/executing transitions as implemented.
12. `/codex status` combines session mode, live tmux probe, and last execution state with timestamp.

Pass condition:

- Durable execution state is owned by the long-running Bridge and visible in status without a Discord login per hook event.

## Phase 5 Tests: Discord UX and Docs

Files:

- `tests/setup.test.ts`
- documentation review for `docs/operator-flow.md`, `docs/discord-setup.md`, `docs/delivery-guide.md`, and `README.md` if present

Cases:

1. Registered slash command JSON includes `pin` and `unpin`.
2. Existing bind/confirm/unbind/status/start/resume/send/projects commands remain registered.
3. Ordinary-message reaction behavior remains enabled only when direct injection is enabled.
4. Docs state one Bridge process per physical machine.
5. Docs state one Discord parent scope per machine.
6. Docs explain child-thread project binding.
7. Docs explain Windows WSL/tmux and POSIX tmux expectations.
8. Docs explain that `path_allowlist` is optional conservative mode, not the default path-binding workflow.
9. Docs explain local hook ingress and that the Bridge is the Discord connection owner.

Pass condition:

- A new recipient can follow docs without creating a bridge process per project or manually configuring each project thread in setup.

## Integration Scenarios

### Scenario A: Parent-scoped Bind and Send

1. Create config for parent `channel:machine-a`.
2. Create child conversation `channel:machine-a/thread:project-1`.
3. Bind a temp project directory as authorized user.
4. Send via `/codex send`.
5. Assert fake runtime receives the text for the binding's deterministic session.
6. Assert status contains project, machine, path, parent scope, session mode, tmux state, and execution state.

### Scenario B: Multi-machine Isolation

1. Create config A for `channel:win`.
2. Create config B for `channel:linux`.
3. Assert config A rejects `channel:linux/thread:project`.
4. Assert config B rejects `channel:win/thread:project`.

### Scenario C: Pinned Restart Recovery

1. Bind project.
2. Pin project.
3. Reload stores.
4. Discover tmux missing.
5. Assert status reports `sessionMode=pinned` and tmux `missing`.
6. Assert next ensure path can recreate session.

### Scenario D: Hook Event Without Discord Re-login

1. Start fake Bridge local ingress.
2. Submit hook event through hook command path.
3. Assert event is accepted locally.
4. Assert no Discord provider login is invoked.
5. Assert execution state is updated for the correct binding.

## Manual Smoke Tests

### Windows Host

1. Run setup and configure a parent Discord channel/Forum.
2. Register commands.
3. Start bridge and leave terminal open.
4. In a child thread, bind an arbitrary local project path.
5. Run `/codex send`.
6. Run `/codex status`.
7. Run `/codex pin`, confirm session remains resident.
8. Run `/codex unpin`, confirm session returns to on-demand behavior.
9. Run `/codex unbind`, confirm binding and resident session are cleaned up.

### Linux/macOS Host

1. Use POSIX tmux config with a separate parent scope.
2. Bind a child thread to a local project.
3. Send a message and check status.
4. Confirm it does not accept the Windows parent thread.

## Evidence Required Before Completion

- `npm run typecheck` output passes.
- `npm test` output passes.
- Targeted Vitest command output passes.
- `git status --short` reviewed.
- Documentation paths updated and reviewed.
- Manual smoke result recorded, or explicitly marked not run with reason.

## Residual Risks

- Real Discord permission failures may require live testing beyond Vitest.
- Windows WSL/tmux behavior depends on local WSL setup.
- Local ingress transport choice can affect reliability; tests must lock whichever implementation is chosen.
