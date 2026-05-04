# Context Snapshot: codex-tmux-bridge

## Task Statement

Create a concrete development plan for the Codex Channel interactive bot bridge, with task decomposition, and stop before implementation.

## Desired Outcome

A RALPLAN consensus-approved implementation plan saved under `.omx/plans/`, grounded in the current `docs/interactive-bot-bridge-plan.md`, ready for later execution.

## Known Facts / Evidence

- `docs/interactive-bot-bridge-plan.md` now defines the product as a Codex CLI interactive bridge, not a Codex/OMX bridge.
- Runtime MVP is `codex-tmux`.
- Linux hosts use native `tmux`.
- Windows hosts use WSL + `tmux`.
- Windows native PTY/ConPTY is explicitly deferred.
- One Discord Bot can serve multiple physical machines, while each physical machine runs its own local Bridge instance and owns only its configured conversations.
- Current workspace contains documentation only: `docs/interactive-bot-bridge-plan.md`; there is not yet an application source tree.
- Current directory is not a git repository.

## Constraints

- Do not implement yet; only plan and task-split.
- No OMX runtime dependency in the MVP.
- Support Windows host, Linux cloud host, and macOS host as deployment targets.
- Keep provider layer portable: Discord first, Telegram/Feishu later via adapter.
- Use tmux as the first interactive session control plane.
- One conversation must not be handled by multiple Bridge instances.
- Secrets must not be stored in repo.

## Unknowns / Open Questions

- Exact Discord IDs and bot token are not available yet.
- Exact WSL distro name and Linux/macOS install paths are not known.
- Whether ordinary text messages should be enabled immediately or only slash commands first remains a policy choice.
- Whether macOS should be implemented in the first coding pass or covered by the same POSIX runtime as Linux needs verification.

## Likely Codebase Touchpoints

- `package.json`, `tsconfig.json`, and TypeScript project scaffold.
- `src/providers/discord/*`
- `src/core/router/*`
- `src/core/bindings/*`
- `src/core/policy/*`
- `src/runtime/codex-tmux/*`
- `src/runtime/platform/*`
- `src/storage/*`
- `config/*.example.json`
- `data/*.json` and `logs/*.jsonl` runtime paths.
- `docs/interactive-bot-bridge-plan.md`
- Deployment docs for Windows/WSL, Linux, and macOS.
