# Context Snapshot: discord-bridge-architecture

## Task Statement

Run a deep interview before redesigning Codex Channel architecture so a recipient can connect once to Discord, bind project directories from channel/thread structure, and get smooth low-resource routing/monitoring without per-project bridge processes.

## Desired Outcome

An execution-ready architecture spec that clarifies process topology, Discord routing, project binding, monitoring, setup/handoff flow, and resource constraints before implementation.

## Stated Solution

User believes the target should be:

- One server/machine connection should be enough.
- Users should bind directories from Discord channel/thread sections.
- Routing should automatically handle machine, channel/thread, project, and Codex session relationships.
- Resource use should stay low.
- The whole flow should be smoother than the current manual setup/bind/restart experience.

## Probable Intent Hypothesis

The user wants Codex Channel to become an operator-grade bridge rather than a fragile demo: one lightweight daemon per real computer, automatic Discord-side project discovery/binding, durable monitoring, clear status, fewer manual IDs, and fewer failure modes around stale locks, session crashes, response gaps, and encoding issues.

## Known Facts / Evidence

- Current repo is a TypeScript Node project using `discord.js`.
- Current config has `discord.allowed_scopes`, `path_allowlist`, runtime commands, token env, and policy fields.
- Current Bridge process loads one config, creates a `BindingRegistry`, `CommandRouter`, `CodexTmuxRuntime`, `AuditLog`, and JSON stores.
- Current routing key is a `ConversationRef` with provider/workspace/conversation IDs.
- Current Discord provider listens to slash commands and optional ordinary messages.
- Current runtime is `codex-tmux`; Windows uses WSL plus tmux.
- Current storage is JSON files under `data/`.
- Current process lock prevents two bridge processes sharing one `data_dir`; stale lock recovery was added.
- Current per-project relationship is: Discord thread -> binding -> tmux session.
- Current setup still asks for specific channel/thread IDs and writes static allowed scopes.
- Current hook ingress can forward Codex lifecycle events only when it can map a binding.
- Recent issues encountered:
  - token field confusion
  - Chinese path mojibake
  - start returning after login
  - stale lock blocking restarts
  - message handler crash before binding
  - Discord response only showing "Sent to Codex"
  - tmux session disappearance
  - process/flow documentation not yet smooth
- A draft `docs/operator-flow.md` exists but is uncommitted and contains mojibake in terminal output; it should not be treated as final.

## Constraints

- Use `$deep-interview`; do not implement directly until requirements are crystallized.
- MVP should not depend on OMX.
- Keep one bridge process per physical machine as the likely target unless interview overturns it.
- One Discord Bot may serve multiple physical machines.
- Prevent multiple machines from handling the same conversation.
- Keep resource use low.
- Keep setup safe for Windows, Linux, and macOS.
- Secrets must not enter git-tracked files.

## Unknowns / Open Questions

- Should a machine own one parent channel/category/forum and auto-discover/bind child threads, or should every thread still require explicit allowlisting?
- Should binding be initiated only from Discord, or should setup pre-register machine ownership of a parent scope?
- What exact security boundary is acceptable for auto-binding directories?
- Should project directory discovery come from a local allowlist, a configured workspace root, or user-provided paths at bind time?
- What monitoring means: Codex lifecycle hooks only, tmux pane polling, Discord thread heartbeat, process health, or all of them?
- Should ordinary text injection be default on or only after explicit per-binding enablement?
- Should the bridge run as a managed service immediately in scope?
- What counts as "low resource" in measurable terms?

## Decision Boundary Unknowns

- Whether the implementation may change config schema substantially.
- Whether existing local data can be migrated automatically or reset.
- Whether current Discord slash commands can be changed.
- Whether the bridge should create Discord threads automatically or only use existing ones.
- Whether a local web/admin UI is out of scope.

## Likely Codebase Touchpoints

- `src/types.ts`
- `src/config.ts`
- `src/app.ts`
- `src/cli/setup.ts`
- `src/cli/operations.ts`
- `src/providers/discord/*`
- `src/core/router/router.ts`
- `src/core/bindings/binding-registry.ts`
- `src/runtime/codex-tmux/*`
- `src/hooks/hook-ingress.ts`
- `src/storage/*`
- `docs/*`
