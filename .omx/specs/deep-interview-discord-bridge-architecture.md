# Deep Interview Spec: Discord Bridge Architecture

## Metadata

- Profile: standard
- Context type: brownfield
- Final ambiguity: 0.15
- Threshold: 0.20
- Rounds: 5
- Context snapshot: `.omx/context/discord-bridge-architecture-20260504T175812Z.md`
- Interview transcript: `.omx/interviews/discord-bridge-architecture-20260505T105013Z.md`

## Clarity Breakdown

| Dimension | Score | Status |
| --- | ---: | --- |
| Intent | 0.80 | Clear: replace fragile/manual project process routing with a machine-level bridge model. |
| Outcome | 0.82 | Clear: connect once per machine, bind projects in Discord, route and monitor reliably. |
| Scope | 0.86 | Clear: one parent scope per machine, child threads bind projects, no per-project bridge. |
| Constraints | 0.83 | Clear: low resource, no OMX runtime dependency, Windows/Linux/macOS support. |
| Success | 0.82 | Clear: setup, binding, routing, session state, and status visibility are testable. |
| Context | 0.85 | Clear: existing TypeScript bridge, Discord provider, JSON stores, codex-tmux runtime. |

## Intent

The bridge should become an operator-grade Discord-to-Codex control surface. The user wants the recipient flow to be simple: run one local bridge per real computer, connect that bridge to one Discord parent scope, then create or use child project threads to bind local directories and operate Codex.

The architecture should reduce manual setup steps, avoid one process per project, and make state visible enough that users can tell whether a message was received, routed, executing, waiting, complete, or failed.

## Desired Outcome

One physical machine runs one Bridge process. That process connects to Discord once, owns one configured parent channel or Forum, auto-recognizes child threads under that parent, and routes each bound thread to the correct local project and Codex session.

Multiple machines may share the same Discord bot, but each machine must own a distinct parent scope. For example:

- Windows host Bridge owns `Windows Projects`
- Linux server Bridge owns `Linux Projects`
- macOS Bridge owns `Mac Projects`

## In Scope

- One Bridge process per physical machine.
- One configured Discord parent channel or Forum per Bridge.
- Automatic recognition of child threads under the configured parent scope.
- `/codex bind path:<local-path> alias:<name>` inside an owned child thread.
- Authorized Discord users may bind arbitrary local paths.
- Conversation-to-project routing: Discord thread -> binding -> Codex runtime session.
- Hybrid session lifecycle:
  - default: start Codex session on demand
  - `/codex pin`: keep a bound project session resident
  - `/codex unpin`: release residency and return to on-demand mode
- First-class monitoring for bridge/session/Codex execution states:
  - received
  - queued
  - thinking
  - executing
  - waiting for user
  - completed
  - failed
- Works across Windows, Linux, and macOS, with tmux used where available and Windows using the existing WSL/tmux strategy.
- Setup should minimize manual commands after initial answers.

## Out of Scope / Non-goals

- No one-bridge-per-project process model.
- No OMX runtime dependency for the core bridge.
- No shared parent scope across multiple machines in the first target architecture.
- No automatic path probing across machines.
- No project intelligence monitoring in the first core architecture:
  - git diff summaries
  - test state tracking
  - log analysis
  - long-running project progress summaries
- No local web/admin UI in the first architecture.
- No requirement that Discord creates project threads automatically in the first architecture.

## Decision Boundaries

The implementation may decide without further confirmation:

- Replace static per-thread `allowed_scopes` with parent-scope ownership.
- Keep `path_allowlist` only as an optional conservative mode, not the default security boundary.
- Add or change slash commands required for binding and lifecycle control, including `/codex pin` and `/codex unpin`.
- Change config schema if a migration or compatibility path is provided.
- Store binding/session metadata locally under the machine bridge data directory.
- Use status reactions and/or status messages to expose execution state.
- Preserve JSON storage for the first architecture unless it becomes a concrete blocker.

Ask before deciding:

- Any destructive migration of existing `data/` files.
- Any change that would require users to create a new Discord bot per machine.
- Any new external service dependency.
- Any move away from `codex-tmux` as the core runtime path.

## Constraints

- Core bridge must not require OMX runtime.
- One machine should keep resource use low by default; pinned sessions are opt-in and reversible.
- Secrets must remain outside git-tracked config files.
- The local OS account running the bridge is the final filesystem permission boundary.
- Discord authorization must remain explicit through authorized user IDs.
- Multiple machine bridges must not compete to handle the same Discord conversation.
- Windows Chinese paths must remain safe; terminal mojibake must not be treated as data corruption without UTF-8 verification.

## Testable Acceptance Criteria

1. Setup can configure one Discord parent scope for a machine bridge.
2. A child thread under that parent can run `/codex bind path:<any-existing-local-path> alias:<name>` as an authorized user.
3. A child thread outside that parent is ignored or rejected by that bridge.
4. Two machine bridges using the same Discord bot but different parent scopes do not handle each other's child threads.
5. A bound thread routes ordinary messages or `/codex send` to the correct local project session.
6. Default session behavior starts on demand and does not keep every project resident forever.
7. `/codex pin` keeps a project's Codex session resident.
8. `/codex unpin` releases that project's resident session.
9. `/codex status` shows bridge health, binding, session lifecycle mode, and current execution state.
10. Discord shows visible state transitions for received, queued/thinking, executing, waiting, done, and failed.
11. Bridge restart recovers bindings and pinned/on-demand lifecycle choices from local storage.
12. The same design is documented for Windows, Linux, and macOS recipient setup.

## Assumptions Exposed and Resolved

- Assumption: One bridge should not manage the whole Discord server. Resolution: each bridge owns one configured parent scope.
- Assumption: Path allowlist is required for safety. Resolution: authorized Discord users may bind arbitrary paths; OS permissions and authorized user IDs are the main boundary.
- Assumption: All project sessions should be resident. Resolution: default on-demand; pin/unpin handles high-frequency projects.
- Assumption: Monitoring means full project observability. Resolution: first version monitors Codex execution state only.
- Assumption: Multi-machine routing can share one parent scope. Resolution: first version uses distinct parent scopes per machine.

## Pressure-pass Findings

The pressure pass challenged the parent-scope model against multi-machine use. If Windows, Linux, and macOS bridges all shared one parent, the system would need machine selection or path probing. The user selected one parent scope per machine, which keeps routing deterministic and resource-light.

## Brownfield Evidence vs Inference Notes

Evidence from the current repository/context snapshot:

- The current app already has a `ConversationRef` routing model.
- The current bridge already persists bindings locally.
- The current runtime is `codex-tmux`.
- Current setup is too manual because it asks for channel/thread IDs and static allowed scopes.
- Current problems include stale locks, start lifecycle, response visibility, session loss, and path encoding.

Inference:

- Parent-scope ownership should replace the current static thread allowlist as the default routing boundary.
- The existing binding registry and router can likely evolve rather than be replaced wholesale.
- Monitoring should be represented as a small execution-state model shared by Discord provider, router, and runtime/hook handling.

## Technical Context Findings

Likely implementation touchpoints:

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

## Recommended Handoff

Use this spec as the source of truth for the next planning step:

```text
$ralplan --direct .omx/specs/deep-interview-discord-bridge-architecture.md
```

The planning phase should produce a PRD and test spec before implementation, especially because this changes routing, config, setup, session lifecycle, and user-facing Discord behavior.
