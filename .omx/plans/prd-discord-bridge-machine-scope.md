# PRD: Machine-owned Discord Bridge

## Requirements Source

- Deep-interview spec: `.omx/specs/deep-interview-discord-bridge-architecture.md`
- Approved ralplan draft: `.omx/drafts/ralplan-discord-bridge-machine-scope-v4.md`
- Architect review: approved v3 after Bridge-owned hook ingress was made explicit.
- Critic review: approved v4 after setup allowlist defaults, hook lifecycle ownership, and direct-injection wording were tightened.

## Goal

Make Codex Channel operate as one lightweight Bridge process per physical machine. Each Bridge connects once to Discord, owns one configured parent channel or Forum, accepts child project threads under that parent, and routes each bound thread to the correct local Codex tmux session.

The user-facing result should be simple: set up a machine once, create or use a child thread, bind any existing local project path as an authorized Discord user, then operate Codex from that thread with visible status.

## Non-goals

- No one-bridge-per-project process model.
- No OMX runtime dependency for the core bridge.
- No shared parent scope across multiple machines in the first architecture.
- No automatic path probing across machines.
- No project intelligence monitoring in this phase, such as git diff summaries, test tracking, log analysis, or long-running project summaries.
- No local web/admin UI.
- No requirement to auto-create Discord threads.

## RALPLAN-DR

### Principles

1. One physical machine owns one Discord parent scope and runs one Bridge process.
2. Child conversations bind projects; bridge processes do not multiply by project.
3. Authorized Discord users plus local OS permissions are the default binding boundary.
4. Residency intent, tmux liveness, and Codex execution state are separate concepts.
5. Discord is connected once by the long-running Bridge; local hook events enter that Bridge through local IPC or a local queue.

### Decision Drivers

1. Reduce recipient setup friction without losing deterministic multi-machine routing.
2. Keep implementation close to the current `ConversationRef` -> `BindingRegistry` -> `CodexTmuxRuntime` architecture.
3. Make restart recovery, execution state, and Discord status output explicit enough to test.

### Options

Option A: Parent-scope ownership with Bridge-owned event ingress.

- Pros: matches the clarified requirement, keeps one Discord connection per machine, avoids path probing, and gives a clean status model.
- Cons: requires schema, command, setup, and local event-ingress changes.

Option B: Reuse `allowed_scopes` internally and change setup/defaults first.

- Pros: smaller migration surface and uses existing parent/child acceptance behavior.
- Cons: the config name remains semantically awkward and legacy multi-scope behavior can confuse users.

Option C: Server-wide ownership with machine/path routing.

- Pros: minimal Discord setup.
- Cons: multiple machines compete for conversations, requiring machine selectors or path probing.

Chosen synthesis: implement Option A behavior while preserving legacy `allowed_scopes` compatibility when it reduces risk. Present the operator model as one owned parent scope per machine.

## State Contract

| Concept | Values | Source of truth | Persisted | Transition owner | Restart behavior | Status output |
| --- | --- | --- | --- | --- | --- | --- |
| Ownership scope | one Discord parent channel/Forum per machine | config | yes | setup/config loader | survives | parent scope id |
| Binding | conversation -> project path | bindings store | yes | bind/confirm/unbind | survives | project, path, aliases |
| Desired residency | `on_demand`, `pinned` | binding/session metadata | yes | bind, pin, unpin, unbind | survives | session mode |
| Tmux liveness | `missing`, `running`, `stale`, `failed` | runtime probe | derived, cached | runtime | re-probed | tmux state |
| Execution state | `idle`, `received`, `queued`, `thinking`, `executing`, `waiting_input`, `completed`, `failed` | execution-state store or session metadata | yes, timestamped | router and Bridge-owned event ingress | stale states degrade safely | execution state + timestamp |

Rules:

- `sessionMode` is intent, not proof that tmux exists.
- On-demand bindings may have no tmux session until `send` or `start`.
- Pinned bindings with missing tmux are repaired on `start`, `send`, `pin`, or explicit reconciliation.
- Execution state is last-known task state; tmux liveness is always probed separately.
- Stale execution states after restart must not pretend work is still running.

## Implementation Phases

### Phase 1: Parent Scope Setup and Ownership

Files:

- `src/types.ts`
- `src/config.ts`
- `src/providers/discord/ownership.ts`
- `src/cli/setup.ts`
- `src/cli/operations.ts`
- `tests/ownership.test.ts`
- `tests/setup.test.ts`

Deliverables:

- Setup collects one parent channel/Forum ID, not a project thread ID.
- Config loading preserves compatibility with legacy `discord.allowed_scopes`.
- Health output shows owned parent scope and warns on non-standard multi-scope configs.
- Ownership accepts child threads under the parent and rejects sibling/outside conversations.

### Phase 2: Arbitrary Path Binding and Setup Defaults

Files:

- `src/core/policy/project-path-guard.ts`
- `src/core/router/router.ts`
- `src/config.ts`
- `src/cli/setup.ts`
- `docs/discord-setup.md`
- `tests/router.test.ts`
- `tests/policy-guard.test.ts`
- `tests/setup.test.ts`

Deliverables:

- Default path validation is absolute, existing, realpath-resolved, and not a dangerous root.
- `path_allowlist` becomes optional conservative mode.
- Fresh setup writes an empty allowlist unless conservative mode is explicitly enabled.
- Authorized-user and confirmation checks remain in the binding path.

### Phase 3: Session Lifecycle

Files:

- `src/types.ts`
- `src/storage/documents.ts`
- `src/core/bindings/binding-registry.ts`
- `src/core/router/router.ts`
- `src/providers/discord/discord-provider.ts`
- `src/runtime/codex-tmux/codex-tmux-runtime.ts`
- `tests/binding-registry.test.ts`
- `tests/router.test.ts`
- `tests/runtime.test.ts`

Deliverables:

- New bindings default to `sessionMode=on_demand`.
- `/codex pin` persists `pinned` and ensures tmux session exists.
- `/codex unpin` persists `on_demand` and stops the deterministic tmux session when present.
- `/codex unbind` disables the binding and cleans up its deterministic resident session when present.

### Phase 4: Bridge-owned Event Ingress and Execution State

Files:

- `src/types.ts`
- `src/storage/documents.ts`
- `src/storage/*`
- `src/app.ts`
- `src/core/router/router.ts`
- `src/hooks/hook-ingress.ts`
- `src/cli/index.ts`
- `src/cli/operations.ts`
- `tests/router.test.ts`
- `tests/hook-ingress.test.ts`
- `tests/hook-route.test.ts`
- new local ingress tests

Deliverables:

- The long-running Bridge process owns local event ingress startup and shutdown alongside Discord provider startup.
- `codex-channel hook` submits hook events locally instead of constructing a Discord provider or logging into Discord.
- Execution state is persisted with timestamps.
- Hook events update durable state only after entering Bridge-owned ingress.
- `/codex status` shows session mode, live tmux state, and last execution state.

### Phase 5: Discord UX and Operator Docs

Files:

- `src/providers/discord/discord-provider.ts`
- `docs/operator-flow.md`
- `docs/discord-setup.md`
- `docs/delivery-guide.md`
- `README.md` if present
- `tests/setup.test.ts`

Deliverables:

- Slash commands include `pin` and `unpin`.
- Reactions remain immediate UX markers for ordinary messages.
- Docs explain Windows/Linux/macOS setup, one process per machine, one parent scope per machine, child-thread binding, and local hook ingress.
- Existing untracked `docs/operator-flow.md` draft is either replaced or finished.

## Acceptance Criteria

1. Setup produces one parent-scope machine config by default.
2. Child threads under the parent are accepted; sibling/outside conversations are rejected.
3. A bound child thread routes `/codex send` to the correct local project session, and ordinary-message injection routes there too when `allow_direct_injection` is enabled.
4. Two configs with different parent scopes do not accept each other's child threads in tests.
5. Authorized users can bind arbitrary existing absolute paths without configuring a default allowlist.
6. Dangerous roots and missing paths are rejected.
7. Optional conservative allowlist mode still restricts resolved paths when configured.
8. Fresh setup output does not require or default-populate `path_allowlist` for ordinary usage.
9. New bindings default to `on_demand`.
10. `/codex pin` persists pinned mode and ensures a tmux session exists.
11. `/codex unpin` persists on-demand mode and stops/releases the deterministic session when present.
12. `/codex unbind` disables the binding and cleans up resident deterministic session when present.
13. `/codex status` shows project, machine, path, parent scope, session mode, live tmux state, and execution state.
14. Bridge restart preserves bindings and session modes, then re-probes tmux liveness.
15. Execution state covers received, queued/thinking, executing, waiting_input, completed, and failed.
16. Codex hook events enter the long-running Bridge through local ingress; the hook CLI does not log into Discord in the target path.
17. Docs explain one Bridge process per physical machine and one Discord parent scope per machine for Windows, Linux, and macOS.
18. `npm run typecheck` and `npm test` pass.

## Risks

- Config migration confusion: preserve legacy load, emit health warnings, and test precedence.
- Expanded path power: require authorized users, confirmation, realpath, dangerous-root rejection, and audit events.
- Setup accidentally preserves old allowlist friction: test generated setup config and docs against empty/default allowlist behavior.
- State drift: keep session mode, tmux liveness, and execution state separate in code and tests.
- Local event ingress reliability: use localhost token or durable JSONL queue and test offline/online behavior.
- Windows/WSL/Chinese path regressions: preserve mojibake and Windows path tests.

## ADR

Decision: Adopt parent-scope ownership with explicit separation of desired session residency, live tmux liveness, and durable execution state. Codex hook events enter the long-running Bridge through local ingress so the Bridge remains the single Discord connection on that machine.

Drivers: smooth recipient flow, deterministic multi-machine routing, low resource use, testable restart/status behavior, and no Discord login per hook event.

Alternatives considered: exact per-thread `allowed_scopes`, pure new config schema immediately, server-wide capture, one bridge per project, and hook CLI direct Discord login.

Why chosen: it satisfies the clarified user model while respecting the current codebase seams and fixing the main architecture gap around execution-state ownership.

Consequences: setup/docs become parent-scope oriented, path allowlist stops being the default user path, status composes three state types, and tests must cover compatibility, persistence, and local hook ingress.

Follow-ups: provider-neutral parent-scope adapters, project intelligence plugins, and retiring any compatibility hook-to-Discord path after local ingress is stable.

## Staffing Guidance

For `$ralph`: one executor implements phases sequentially, with test-engineer support per phase, writer after behavior lands, security-reviewer for path and ingress review, and verifier for final evidence.

For `$team`: split lanes into config/setup/ownership, path guard/router binding, pin/unpin lifecycle, local ingress/execution state/status, cross-phase tests, and docs.

## Launch Hints

```text
$ralph .omx/plans/prd-discord-bridge-machine-scope.md .omx/plans/test-spec-discord-bridge-machine-scope.md
```

```text
$team .omx/plans/prd-discord-bridge-machine-scope.md .omx/plans/test-spec-discord-bridge-machine-scope.md
```
