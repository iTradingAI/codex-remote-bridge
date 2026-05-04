# Codex Channel Bridge RALPLAN

Last updated: 2026-05-04

## Evidence Base

- Context snapshot: `.omx/context/codex-tmux-bridge-20260504T070620Z.md:5-52`
- Primary design doc: `docs/interactive-bot-bridge-plan.md:7-520`
- Workspace fact: repo currently has docs and `.omx` metadata only; no source scaffold and no `.git` directory.

## Requirements Summary

- Build a fresh TypeScript/Node project for an interactive Discord-first Codex CLI bridge.
- MVP runtime is `codex` plus `tmux`; no OMX runtime dependency.
- Linux and macOS use native `tmux`; Windows uses `wsl.exe` plus `tmux`.
- One Discord bot must eventually serve multiple physical machines, but one conversation must be owned by exactly one machine-local bridge at a time.
- Provider layer stays portable for later Telegram/Feishu adapters.
- Secrets stay out of repo.
- Stop at planning; do not implement.

## RALPLAN-DR Summary

### Principles

1. Keep MVP centered on the real hard part: safe interactive control of `codex` through `tmux`, not speculative provider expansion.
2. Encode ownership explicitly so one conversation cannot be processed by multiple bridge instances.
3. Default to slash-command-first interaction and require explicit opt-in for free-text injection.
4. Keep the storage model simple first, but define durability and recovery rules up front.
5. Preserve portability by isolating provider logic from routing, policy, ownership, and runtime control.

### Top Decision Drivers

1. Cross-machine correctness: one bot may span machines, so split-brain conversation handling must be prevented.
2. MVP delivery speed: the plan must be executable in a docs-only greenfield repo without introducing unnecessary infrastructure.
3. Runtime portability: Linux/macOS POSIX `tmux` and Windows WSL `tmux` must share one runtime contract.

### Viable Options

| Option | Summary | Pros | Cons |
| --- | --- | --- | --- |
| A. Thin Discord ingress + machine-local bridges | One process owns Discord interactions and routes to the correct machine-local bridge | Clean one-bot-many-machines story; single interaction edge; clearer ownership boundary | Two deployable processes from day one; more coordination work |
| B. Per-machine full Discord edge with static binding ownership | Every machine runs a full Discord adapter and only handles preconfigured conversations | Simpler local autonomy; fastest path to local end-to-end scaffolding | High duplicate-handling risk; Discord interaction topology is less clean; ownership guarantees are harder |
| C. Single-machine-only MVP, defer multi-machine | Build only one local bridge first and add fan-out later | Fastest proof of `codex` + `tmux` loop | Defers a stated product constraint and risks rework |

### Recommended Option

Choose **Option A** for the target architecture, but stage delivery so **machine-local bridge core lands first** and **Discord ingress lands as the next dependent slice**. This preserves the one-bot-many-machines requirement without forcing the executor to redesign ownership later.

## ADR

### Decision

Adopt a **two-entrypoint TypeScript/Node architecture**:

- `discord-ingress`: receives Discord interactions and routes them by persisted conversation ownership.
- `bridge-daemon`: runs on each machine, owns local project bindings, `codex`/`tmux` runtime control, hooks, approvals, and audit/logging.

The MVP interaction surface is **slash-command-first** with `/codex send` enabled. Ambient natural-language injection is deferred behind config until ownership, approval, and observability are proven. The persistence layer starts with JSON/JSONL, but includes explicit **atomic write, lease, and recovery semantics**.

### Drivers

- A single bot must serve multiple machines without double-processing one conversation.
- The runtime must work on Linux/macOS POSIX hosts and Windows WSL without building native PTY support.
- The repo is greenfield, so the plan must keep initial scaffolding simple and testable.

### Alternatives Considered

- Per-machine full Discord edge: rejected for MVP because ownership and interaction delivery become ambiguous.
- Single-machine-only MVP: rejected as the primary architecture because it undercuts the stated bot-to-many-machines requirement, though it remains a useful local milestone inside Phase 2.

### Why Chosen

This preserves the product constraint that one bot can front multiple machines while keeping the hard local runtime work isolated in the bridge daemon. It also prevents later rework around claim/lease semantics, approval ownership, and duplicate event handling.

### Consequences

- The project needs two executable entrypoints instead of one.
- Ownership and lease state must exist from the first coding pass.
- Discord free-text injection is explicitly out of the initial MVP path.
- Local runtime and policy code stay reusable for later providers.

### Follow-ups

- Revisit free-text injection only after the slash-command path, approvals, and ownership lease recovery are verified.
- Revisit same-project multi-conversation bindings only after a session lease-holder model exists.
- Revisit SQLite only if JSON durability or concurrent admin workflows become painful.

## Proposed Project Layout

```text
codex-channel/
  .gitignore
  package.json
  tsconfig.json
  eslint.config.mjs
  vitest.config.ts
  README.md
  config/
    bridge.example.json
    ingress.example.json
  src/
    apps/
      bridge-daemon.ts
      discord-ingress.ts
    core/
      contracts/
        provider.ts
        runtime.ts
        storage.ts
      router/
        command-router.ts
        conversation-router.ts
      bindings/
        binding-registry.ts
        binding-types.ts
      ownership/
        claim-service.ts
        lease-policy.ts
      policy/
        authz-policy.ts
        path-guard.ts
      approvals/
        approval-service.ts
        approval-types.ts
    providers/
      discord/
        discord-adapter.ts
        command-definitions.ts
        interaction-handler.ts
        message-renderer.ts
    runtime/
      codex-tmux/
        tmux-runtime.ts
        session-manager.ts
        output-reader.ts
        hook-ingress.ts
      platform/
        posix-shell.ts
        wsl-shell.ts
        path-mapper.ts
        capability-detect.ts
    storage/
      json-store.ts
      jsonl-audit-log.ts
      file-lock.ts
      startup-repair.ts
    logging/
      logger.ts
      event-types.ts
  tests/
    unit/
    integration/
    smoke/
  docs/
    interactive-bot-bridge-plan.md
    architecture-overview.md
    deployment-windows-wsl.md
    deployment-linux-macos.md
    operations-runbook.md
```

## Scope Boundaries

### In MVP

- Discord slash commands: `/codex bind`, `/codex confirm`, `/codex status`, `/codex start`, `/codex resume`, `/codex pause`, `/codex send`, `/codex projects`
- Thread/forum-post scoped bindings
- POSIX `tmux` runtime for Linux/macOS
- WSL `tmux` runtime for Windows
- Machine ownership and conversation claim/lease model
- Hook-driven approval gating for high-risk actions
- JSON/JSONL persistence with atomic writes and startup repair

### Explicitly Deferred

- Native Windows ConPTY/PTy runtime
- Telegram/Feishu adapters
- Ambient natural-language injection by default
- Same-project multi-conversation fan-in
- SQLite or external database
- Rich web UI

## Phased Implementation Plan

### Phase 0. Repository Bootstrap and Working Conventions

**Targets**

- `.gitignore`
- `package.json`
- `tsconfig.json`
- `eslint.config.mjs`
- `vitest.config.ts`
- `README.md`
- `config/bridge.example.json`
- `config/ingress.example.json`

**Work**

- Initialize git and a standard Node/TypeScript project.
- Define package scripts for `lint`, `typecheck`, `test`, `test:integration`, and `smoke:*`.
- Add example config files only; no real secrets.
- Establish runtime directories: `data/` and `logs/` as ignored local state.

**Acceptance Criteria**

- `npm run lint`, `npm run typecheck`, and `npm test` succeed on an empty scaffold.
- Example config files describe both entrypoints and required local-only secrets.
- `.gitignore` excludes `data/`, `logs/`, `.env*`, and local secret files.

**Verification**

- Fresh clone/bootstrap on one machine completes with documented commands only.
- `git status` remains clean after bootstrap plus generated local state files.

### Phase 1. Shared Domain Contracts, Storage, and Durability

**Targets**

- `src/core/contracts/*`
- `src/core/bindings/*`
- `src/core/ownership/*`
- `src/storage/*`
- `tests/unit/storage/*`
- `tests/unit/ownership/*`

**Work**

- Define binding, session, claim, approval, and audit record types.
- Add persisted ownership primitives:
  - `bridge_instance_id`
  - `conversation_claim.owner_bridge_id`
  - `lease_expires_at`
  - `heartbeat_at`
  - `claim_version`
- Implement JSON store rules:
  - write to temp file
  - flush/fsync
  - atomic rename
  - append-only JSONL for audit
  - single-writer serialization in-process
  - startup repair for orphaned temp files
- Define reclaim rules for expired leases and conflict detection for split-brain claims.

**Acceptance Criteria**

- Two simulated bridge instances cannot both acquire the same active conversation claim.
- Expired claims can be reclaimed deterministically.
- Store writes survive interrupted-write simulation without corrupting the last valid file.
- Audit appends remain readable line-by-line after abrupt process termination simulation.

**Verification**

- Unit tests for claim acquisition, renewal, expiration, reclaim, and conflict detection.
- Unit tests for temp-write recovery and JSONL append replay.

### Phase 2. Local Runtime and Platform Adapters

**Targets**

- `src/runtime/codex-tmux/*`
- `src/runtime/platform/*`
- `tests/unit/runtime/*`
- `tests/integration/runtime/*`
- `tests/smoke/runtime/*`

**Work**

- Define shared runtime contract: `detect`, `start`, `status`, `send`, `readRecent`, `stop`.
- Implement POSIX adapter for Linux/macOS native `tmux`.
- Implement Windows adapter using `wsl.exe` plus `tmux`.
- Implement path mapping for Windows host paths to WSL mount paths.
- Implement session discovery and recent-output reading from `tmux`.

**Acceptance Criteria**

- Linux/macOS adapter can detect `tmux` and `codex`, start a named session, and query status.
- Windows WSL adapter can detect `wsl.exe`, `tmux`, and `codex` inside WSL, start a named session, and query status.
- Path mapping produces stable conversions for configured Windows roots.
- Runtime status distinguishes `starting`, `running`, `waiting_input`, `completed`, `failed`, and `stale`.

**Verification**

- Unit tests for path mapping and command generation.
- Integration tests with runtime stubs for session discovery and output parsing.
- Smoke scripts:
  - Linux/macOS: `tmux -V`, `codex --version`, create session, read session state.
  - Windows: `wsl.exe tmux -V`, `wsl.exe codex --version`, create session, read session state.

### Phase 3. Bridge Daemon Core, Policy, and Approval Engine

**Targets**

- `src/apps/bridge-daemon.ts`
- `src/core/router/*`
- `src/core/policy/*`
- `src/core/approvals/*`
- `src/runtime/codex-tmux/hook-ingress.ts`
- `tests/unit/policy/*`
- `tests/integration/daemon/*`

**Work**

- Build command routing for bind/status/start/resume/pause/send/projects.
- Enforce path allowlists and authorized user IDs.
- Add slash-only send policy for MVP.
- Implement approval holds keyed by runtime or hook evidence, not only inbound text.
- Persist pending approvals with expiry and one-time release semantics.
- Add heartbeat updates for bridge ownership claims.

**Acceptance Criteria**

- Unbound conversations cannot issue runtime commands other than bind/help.
- Unauthorized users cannot start, resume, or send to a bound project.
- A high-risk action remains blocked until an approval token is explicitly confirmed.
- An approval token cannot be replayed after release or expiry.
- Bridge restarts restore claims, sessions, and pending approvals consistently.

**Verification**

- Unit tests for policy gates and approval state machine.
- Integration tests that simulate hook events leading to approval-required transitions.
- Restart-recovery tests for pending approvals and claim heartbeats.

### Phase 4. Discord Ingress and Slash Command Surface

**Targets**

- `src/apps/discord-ingress.ts`
- `src/providers/discord/*`
- `tests/integration/discord/*`
- `docs/architecture-overview.md`

**Work**

- Implement Discord adapter for slash commands and thread/forum-post identification.
- Resolve conversation ownership through the persisted claim/binding store before forwarding to a bridge daemon.
- Render status, error, question, summary, and approval responses consistently.
- Keep `Message Content` intent out of the default MVP path.

**Acceptance Criteria**

- Slash commands can bind, confirm, query status, start, resume, pause, send, and list projects.
- The ingress routes one conversation to exactly one owning bridge instance.
- When no valid owner exists, ingress returns a clear error rather than sending duplicate work.
- Thread/forum-post IDs normalize to the same `conversation_id` shape defined in the plan doc.

**Verification**

- Integration tests with fake Discord interactions and fake bridge transport.
- Deterministic tests for routing to the correct owning bridge.
- Contract tests for normalized `InboundCommand` and `OutboundMessage` structures.

### Phase 5. End-to-End Runtime Loop and Hook-Driven Status

**Targets**

- `src/runtime/codex-tmux/output-reader.ts`
- `src/runtime/codex-tmux/hook-ingress.ts`
- `src/providers/discord/message-renderer.ts`
- `tests/integration/e2e/*`
- `tests/smoke/e2e/*`

**Work**

- Wire runtime session events back into provider-facing status summaries.
- Implement bounded event aggregation for start, needs-input, stop, end, failed, and approval prompts.
- Keep tool-level spam out of the default provider surface.
- Add operator-facing logs for diagnostics and audit correlation.

**Acceptance Criteria**

- `/codex start` leads to a visible session start acknowledgement plus current runtime status.
- `/codex send` injects into the correct `tmux` session and produces a provider acknowledgement.
- Hook-driven approval prompts reach the same conversation that initiated the action.
- Session end, failure, and waiting-input states are visible without reading raw logs.

**Verification**

- Integration tests with a stub runtime emitting lifecycle events.
- Smoke test with one bound project on POSIX and one on Windows WSL using fake/demo directories.

### Phase 6. Operational Hardening, Packaging, and Deployment Docs

**Targets**

- `docs/deployment-windows-wsl.md`
- `docs/deployment-linux-macos.md`
- `docs/operations-runbook.md`
- `tests/smoke/ops/*`

**Work**

- Document secrets placement outside repo.
- Document process start patterns for Linux/macOS and Windows.
- Add runbook coverage for lost lease recovery, stale sessions, failed `tmux` detection, and approval cleanup.
- Add export/import design notes only for public config and bindings that exclude secrets.

**Acceptance Criteria**

- An operator can bootstrap either entrypoint on Linux/macOS or Windows WSL using only docs plus example config.
- Recovery steps exist for expired claims, duplicate ownership detection, and stale runtime sessions.
- Export/import documentation explicitly excludes tokens and host-specific secret material.

**Verification**

- Dry-run the documented bootstrap sequence on at least one POSIX host shape and one Windows WSL host shape.
- Manual doc review against actual config keys and file paths.

## Task Decomposition

| ID | Task | Depends On | Suggested Lane |
| --- | --- | --- | --- |
| T01 | Initialize repo, TypeScript tooling, scripts, and ignored local-state paths | none | Foundation |
| T02 | Define core domain types for bindings, sessions, approvals, and claims | T01 | Foundation |
| T03 | Implement durable JSON/JSONL storage with recovery semantics | T02 | Foundation |
| T04 | Implement claim/lease ownership service and heartbeat rules | T02, T03 | Ownership |
| T05 | Implement POSIX runtime adapter for Linux/macOS | T01, T02 | Runtime |
| T06 | Implement WSL runtime adapter and Windows path mapper | T01, T02 | Runtime |
| T07 | Implement bridge-daemon router and path/auth policy | T02, T03 | Daemon |
| T08 | Implement approval state machine backed by hook/runtime evidence | T02, T03, T07 | Policy |
| T09 | Implement Discord slash command definitions and adapter | T01, T02 | Provider |
| T10 | Implement ingress-to-bridge routing through claim ownership | T03, T04, T09 | Provider |
| T11 | Wire runtime lifecycle events to provider-facing summaries | T05, T06, T07, T09 | Integration |
| T12 | Add unit tests for storage, ownership, policy, and path mapping | T03, T04, T06, T08 | Quality |
| T13 | Add integration tests for ingress, routing, runtime stubs, and restart recovery | T05-T11 | Quality |
| T14 | Add smoke scripts and deployment/ops documentation | T11, T13 | Docs/Ops |

## Suggested Execution Lanes

### Lane A. Foundation and Persistence

- T01, T02, T03
- Goal: make the repo executable and durable before any provider or runtime work assumes storage exists.

### Lane B. Ownership and Policy

- T04, T07, T08
- Goal: prevent split-brain routing and define how risky actions are actually gated.

### Lane C. Runtime and Platform

- T05, T06
- Goal: prove `codex` plus `tmux` control on POSIX and Windows WSL.

### Lane D. Discord Ingress

- T09, T10
- Goal: make the provider surface usable without leaking ownership logic into provider code.

### Lane E. Integration, Quality, and Ops

- T11, T12, T13, T14
- Goal: prove the cross-layer loop and leave operational instructions that match the shipped behavior.

## Verification Plan

### Unit Coverage

- Binding normalization and conversation ID generation
- Path allowlist and canonical path guard
- WSL path translation
- Claim acquire/renew/expire/reclaim rules
- Approval token creation, expiry, replay rejection, and release
- Atomic JSON store write and startup repair

### Integration Coverage

- Fake Discord slash interaction -> ingress -> claim resolution -> bridge router -> runtime stub
- Restart recovery for claims, approvals, and sessions
- Hook-driven approval request and release flow
- POSIX runtime contract against a stubbed `tmux` shell
- WSL runtime contract against generated command lines and stubbed `wsl.exe`

### Smoke Coverage

- Linux/macOS host: detect tools, create tmux session, status roundtrip, send roundtrip
- Windows WSL host: detect tools, create tmux session, status roundtrip, send roundtrip
- One bound Discord thread/forum-post mapped to one demo project
- Duplicate-owner simulation returns a safe error path

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Split-brain conversation ownership across machines | Duplicate or conflicting Codex actions | Persist `bridge_instance_id` claims with heartbeats, TTL, conflict detection, and deterministic reclaim rules |
| Discord interaction topology complicates one-bot-many-machines delivery | Wrong bridge handles commands | Keep a distinct ingress entrypoint and route through persisted ownership instead of letting each machine act as an unconstrained Discord edge |
| JSON persistence corruption on crash | Lost bindings, approvals, or claims | Temp-file write, fsync, rename, startup repair, append-only audit log |
| Approval gating based only on text heuristics misses real risky actions | Unsafe execution | Make runtime/hook evidence the enforcement source; keep keyword checks as hints only |
| WSL path mapping errors on Windows | Commands start in wrong directory | Add path-mapper unit tests and config allowlist roots that match actual mounted paths |
| macOS parity drifts behind Linux | Incomplete POSIX support | Treat macOS as part of the same Phase 2 POSIX contract and require smoke verification there if available |

## Deferred Decisions

- Whether to add ambient message injection after MVP validation
- Whether to keep JSON storage beyond the first real concurrency needs
- Whether to support same-project multi-conversation fan-in
- Whether ingress and bridge transport should be local IPC, HTTP, or queue-based in the implementation pass

## Available Agent Types Roster

Relevant agent types for later execution:

- `planner`
- `architect`
- `executor`
- `debugger`
- `verifier`
- `test-engineer`
- `security-reviewer`
- `writer`
- `explore`
- `critic`
- `build-fixer`

## Staffing Guidance For Later Execution

### Ralph Path

- Use one `executor` as the main owner for Phases 0-3.
- Pull in `test-engineer` after Phase 2 to shape unit/integration coverage before provider wiring expands the surface.
- Pull in `security-reviewer` before finalizing approval and secret-handling behavior.
- Finish with `verifier` for the end-to-end evidence pass and doc-to-runtime consistency check.

Suggested reasoning:

- `executor`: high
- `test-engineer`: medium
- `security-reviewer`: medium
- `verifier`: high

### Team Path

- Lane A Foundation/Persistence: `executor` or `team-executor`, high
- Lane B Ownership/Policy: `architect` plus `executor`, high
- Lane C Runtime/Platform: `executor`, high; add `debugger` if shell/runtime behavior diverges by OS
- Lane D Discord Ingress: `executor`, medium-high
- Lane E Quality/Ops: `test-engineer`, `writer`, `verifier`, medium/high

Team sizing guidance:

- 4 active implementation lanes is the practical maximum here.
- Keep Lane B and Lane C separate because they are both high-risk and touch different boundaries.
- Do not let Provider work start final routing behavior until Ownership contracts are fixed.

Launch hints for later execution, not for use now:

```text
$team execute .omx/plans/codex-channel-bridge-ralplan-20260504.md
omx team run --plan .omx/plans/codex-channel-bridge-ralplan-20260504.md
```

### Team Verification Path

- Team proves per-lane completion with passing unit/integration targets and file-local acceptance evidence.
- Team leader verifies dependency joins:
  - ownership + ingress
  - daemon + runtime
  - approvals + hook ingress
- Final Ralph or verifier pass confirms:
  - clean git worktree
  - docs match actual config/runtime behavior
  - POSIX and WSL smoke paths both pass
  - no known duplicate-owner path remains unresolved

## Changelog From Review

- Added a machine-ownership ADR and explicit persisted claim fields.
- Tightened MVP interaction policy to slash-command-first plus `/codex send`; ambient injection deferred.
- Deferred same-project multi-conversation fan-in until a lease-holder model exists.
- Added JSON durability and startup repair requirements.
- Expanded verification into unit, integration, and smoke matrices including macOS POSIX coverage.
