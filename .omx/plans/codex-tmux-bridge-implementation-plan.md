# Codex Tmux Bridge Implementation Plan Draft

## Requirements Summary

Build a Discord-first local Bridge that lets a Discord channel or thread control Codex CLI sessions on real machines. The first runtime is Codex CLI inside tmux. Linux and macOS use native tmux; Windows uses WSL + tmux. OMX is out of scope for MVP. Each physical machine runs its own Bridge instance and only handles the Discord conversations configured for that machine.

## RALPLAN-DR Summary

### Principles

- Keep the runtime boring: Codex CLI plus tmux first, with no extra orchestration layer in the MVP.
- Gate before route: conversation scope and machine ownership must be accepted at provider ingress before any command reaches core routing.
- Separate provider, policy, storage, and runtime boundaries so Discord does not leak into core logic.
- Prefer explicit slash-command control first; make natural-message injection an opt-in policy.
- Verify with real tmux sessions on both POSIX and Windows/WSL paths before claiming interactivity works.

### Decision Drivers

- Multi-machine safety: Windows, Linux, and macOS Bridge instances must not double-handle the same Discord conversation.
- Interactive continuity: `/codex send` must reach the same tmux pane that owns the project session.
- MVP speed: the first build should avoid database, queue, ConPTY, and multi-provider complexity.

### Viable Options

#### Option A: CodexTmuxRuntime as the only MVP runtime

Pros:
- Matches the user's current direction.
- Works across Linux/macOS and Windows via WSL.
- Keeps long-running interactive sessions recoverable through tmux.

Cons:
- Requires tmux and Codex CLI to be installed inside each target environment.
- Windows path conversion and WSL distro selection must be handled carefully.

#### Option B: CodexExecRuntime first, tmux second

Pros:
- Easier first smoke test because no persistent terminal session is needed.
- Useful for one-shot status and task commands later.

Cons:
- Does not solve the core interactive bridge requirement.
- Risks designing around stateless execution and reworking later.

Decision: choose Option A for MVP, with `codex exec` only as a later fallback for one-shot commands.

## Architecture Plan

### Module Boundaries

- `src/providers/discord/`: Discord client, slash command registration, message normalization, replies.
- `src/providers/discord/ownership.ts`: per-machine ingress ownership gate for allowed guild/channel/thread scopes.
- `src/core/router/`: command parsing, conversation lookup, dispatch to binding/status/start/send handlers after ingress acceptance.
- `src/core/bindings/`: binding records, machine ownership, alias lookup, import/export.
- `src/core/policy/`: authorized user checks, path allowlist, direct-injection toggle, high-risk command confirmation.
- `src/runtime/codex-tmux/`: tmux detection, session start, send, readRecent, status, stop.
- `src/runtime/platform/`: host detection, Windows path to WSL path conversion, command builders.
- `src/storage/`: JSON file store with atomic writes for bindings, sessions, approvals, audit logs.
- `src/hooks/`: local Codex native hook ingress contract and event normalization.
- `src/cli/`: Bridge startup, config loading, health/status commands.

### Runtime Contract

```ts
interface CodexSessionRuntime {
  detect(): Promise<RuntimeCapability>;
  ensureSession(binding: ProjectBinding): Promise<RuntimeSession>;
  discoverExisting(binding: ProjectBinding): Promise<RuntimeSession | null>;
  reconcile(binding: ProjectBinding): Promise<RuntimeSession>;
  send(session: RuntimeSession, text: string): Promise<void>;
  readRecent(session: RuntimeSession, lines?: number): Promise<string>;
  status(session: RuntimeSession): Promise<SessionStatus>;
  stop(session: RuntimeSession): Promise<void>;
}
```

`ensureSession()` is idempotent: it reuses an existing tmux session when present and starts one only when absent. `discoverExisting()` and `reconcile()` make Bridge restart recovery explicit instead of hiding it inside `/codex start`.

## Implementation Phases

### Phase 0: Project Scaffold and Config Shape

Create the TypeScript project, lint/test tooling, config examples, and runtime data directories. Define shared types for providers, bindings, ingress ownership scopes, policies, runtime sessions, audit events, and outbound messages.

Acceptance criteria:
- `npm test` runs a placeholder suite.
- `npm run typecheck` validates shared types.
- `config/bridge.example.json` includes `machine_id`, Discord public config, allowed ingress scopes, path allowlist, WSL settings, and data directory.
- Secrets are documented as environment variables or local secrets files outside the repo.

### Phase 1: Storage, Binding, and Policy Core

Implement JSON-backed storage, binding registry, path guard, explicit ingress ownership gate, authorization checks, audit logging, and pending approval records.

Acceptance criteria:
- A conversation can bind to exactly one project per machine config.
- A Bridge rejects out-of-scope Discord events before router dispatch.
- A Bridge ignores bindings owned by another `machine_id`.
- Binding rejects nonexistent paths and paths outside allowlist.
- Policy tests cover authorized and unauthorized send/start/status paths.

### Phase 2: CodexTmuxRuntime

Implement POSIX tmux and Windows/WSL tmux runtime operations behind one adapter. Include detect/ensureSession/discoverExisting/reconcile/status/send/readRecent/stop. Treat macOS as POSIX unless detect proves otherwise.

Acceptance criteria:
- POSIX command builder emits `tmux new-session`, `tmux send-keys`, and `tmux capture-pane` commands.
- Windows command builder emits `wsl.exe tmux ...` and converts `E:\Projects\foo` to `/mnt/e/Projects/foo`.
- Runtime refuses to start if Codex CLI or tmux is missing in the target environment.
- `ensureSession()` reuses a pre-existing tmux session instead of duplicating it.
- `reconcile()` restores `sessions.json` state after Bridge restart when tmux still has the session.
- Unit tests cover path conversion, command escaping, and session naming.

### Phase 3: Discord Provider MVP

Implement Discord bot startup, slash commands, channel/thread normalization, ingress ownership enforcement, and outbound replies for `/codex bind`, `/codex confirm`, `/codex status`, `/codex start`, and `/codex send`.

Acceptance criteria:
- Slash commands produce normalized inbound command events.
- Events outside the machine's configured allowed scopes are ignored before routing and audited at debug level only.
- Unbound conversations reject execution with a clear message.
- Bound conversations return project path, machine id, runtime status, and recent output.
- Unauthorized users cannot send/start sessions.

### Phase 4: Router Integration and Interactive Smoke Tests

Wire Discord provider, router, policy, storage, and runtime. Add smoke scripts for fake projects and real tmux sessions.

Acceptance criteria:
- Two Discord threads can bind to two fake projects without cross-routing.
- `/codex start` creates or reuses the correct tmux session.
- `/codex send` injects literal user text into the correct pane.
- `readRecent` returns recent pane output for Discord summary replies.

### Phase 5: Hooks, Health, and Deployment

Add minimal hook ingress for Codex native lifecycle events, Bridge health command, startup docs, and per-host deployment notes for Windows/WSL, Linux, and macOS. MVP hook scope is intentionally small: `session-start`, `needs-input`, `stop`, `session-end`, and `failed`. Verbose tool-level hook forwarding is post-MVP.

Acceptance criteria:
- Hook event payloads can be received locally and routed to the owning conversation.
- Unsupported or verbose hook events are stored/audited but not sent to Discord by default.
- `codex-channel health` reports Discord connection, storage path, bindings count, runtime capability, and tmux session state.
- Deployment docs include Windows Task Scheduler, Linux systemd, and macOS launchd guidance.

## Task Decomposition

1. Scaffold Node/TypeScript project and scripts.
2. Define shared types and config schema.
3. Implement JSON file store with atomic write helper.
4. Implement BindingRegistry and conversation key normalization.
5. Implement Discord ingress ownership gate for allowed guild/channel/thread scopes.
6. Implement ProjectPathGuard for POSIX, Windows, and WSL mapping inputs.
7. Implement PolicyGuard for user authorization, direct injection, and risky command confirmation.
8. Implement audit log writer and pending approval store.
9. Implement RuntimeCapability detection for POSIX tmux/codex.
10. Implement RuntimeCapability detection for Windows WSL tmux/codex.
11. Implement tmux command builders and safe literal send helpers.
12. Implement CodexTmuxRuntime adapter with `ensureSession`, `discoverExisting`, and `reconcile`.
13. Implement DiscordProviderAdapter startup and event normalization.
14. Implement slash command registration and command handlers.
15. Wire Router to provider, storage, policy, and runtime.
16. Add minimal hook ingress for `session-start`, `needs-input`, `stop`, `session-end`, and `failed`.
17. Add smoke tests for two bindings and two tmux session names.
18. Add docs for Discord setup, secrets, and per-host deployment.

## Verification Plan

- Unit: config parsing, conversation keys, binding lookup, path guard, WSL path conversion, tmux command builders, policy decisions.
- Integration: JSON storage persistence, router command flow, fake Discord event handling, fake runtime adapter.
- Runtime smoke: POSIX tmux session start/send/capture, Windows WSL tmux session start/send/capture.
- Recovery smoke: start Bridge with an existing tmux session and empty/stale `sessions.json`; verify `reconcile()` rediscovers it.
- Manual Discord smoke: bind/status/start/send in one text channel or thread.

## Risks and Mitigations

- Risk: two machines process the same Discord message. Mitigation: require `machine_id` ownership and binding-level conversation allowlist; log ignored conversations.
- Risk: a machine handles first-bind commands for a conversation it should not own. Mitigation: enforce configured allowed ingress scopes before bind and before router dispatch.
- Risk: Windows path conversion sends Codex to wrong directory. Mitigation: centralize conversion and test drive letters, spaces, Unicode, and nonexistent paths.
- Risk: `tmux send-keys` mangles special characters. Mitigation: use literal paste-buffer or safe escaping helper and test multiline input.
- Risk: Codex CLI output is hard to summarize. Mitigation: start with `capture-pane` recent lines and add hook summaries later.
- Risk: natural-message injection is too easy to misuse. Mitigation: default to slash commands only; ordinary message injection remains opt-in.

## ADR

Decision: Build the MVP around `CodexTmuxRuntimeAdapter` using Codex CLI inside tmux. Linux/macOS use native tmux; Windows uses WSL tmux.

Drivers: multi-machine safety, interactive continuity, and MVP speed.

Alternatives considered:
- `codex exec` first: rejected because it cannot preserve interactive session continuity.
- Windows native ConPTY first: rejected because it adds PTY complexity before the product loop is proven.
- OMX adapter first: rejected because the user wants Codex CLI and client fundamentals without OMX dependency.

Why chosen: tmux is the smallest shared control plane that supports start, resume, send, capture, and recovery across the user's Linux, macOS, and Windows/WSL machines.

Consequences:
- Every target machine must have Codex CLI and tmux installed in the runtime environment.
- Windows setup depends on WSL health.
- Each Bridge needs explicit allowed Discord scopes; this is slightly more config, but avoids a shared database or lease service in MVP.
- Later providers can reuse core router and runtime without Discord-specific coupling.

Follow-ups:
- Add Telegram and Feishu providers after Discord MVP.
- Add optional `codex exec` fallback for one-shot commands.
- Revisit Windows native ConPTY only after tmux MVP is stable.
- Revisit shared ownership registry only if per-machine ingress scopes become too hard to operate.

## Available-Agent-Types Roster

- `explore`: fast file and symbol mapping once source exists.
- `planner`: task sequencing and plan updates.
- `architect`: runtime/platform boundary review.
- `executor`: implementation of scoped modules.
- `debugger`: tmux/WSL/runtime failure diagnosis.
- `test-engineer`: unit, integration, and smoke test design.
- `security-reviewer`: token, authz, path allowlist, command injection review.
- `code-reviewer`: final quality review.
- `verifier`: completion evidence and claim validation.
- `writer`: deployment and operator documentation.

## Follow-up Staffing Guidance

Ralph path: use one sequential owner for Phase 0 through Phase 2, then verify before Discord wiring. Recommended supporting roles: `architect` for runtime boundary review, `test-engineer` for test shape, `security-reviewer` before enabling send/start.

Team path: split into four lanes after scaffold: core/storage/policy, runtime/codex-tmux, Discord provider/router, tests/docs. Keep runtime and provider write scopes separate. Verification should prove local unit tests plus at least one real tmux smoke before shutdown.

## Launch Hints for Later Execution

Do not launch now. When ready:

```text
$ralph implement .omx/plans/codex-tmux-bridge-implementation-plan.md
$team implement .omx/plans/codex-tmux-bridge-implementation-plan.md
```

## Changelog

- Draft created from `docs/interactive-bot-bridge-plan.md` and current user direction.
- Applied Architect iteration: explicit ingress ownership gate, recoverable runtime contract, and minimal hook MVP boundary.
- Aligned minimal hook MVP with source doc by including `stop`.
- Architect approved after iteration; Critic approved final plan quality, verification shape, ADR, and staffing guidance.
