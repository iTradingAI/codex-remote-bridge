# Delivery Guide

This guide is for handing Codex Channel to another operator or machine owner.

## What To Deliver

Deliver the git repository, not local runtime artifacts.

Include:

- Source code under `src/`
- Tests under `tests/`
- Documentation under `README.md` and `docs/`
- `config/bridge.example.json`
- `.env.example`
- `package.json` and `package-lock.json`
- Planning records under `.omx/context/` and `.omx/plans/`

Do not include:

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.env`
- `config/bridge.local.json`
- Bot tokens or other secrets
- `.omx/logs/`, `.omx/state/`, `.omx/drafts/`

The `.gitignore` already excludes the local-only paths above.

## Recipient Prerequisites

The receiving machine needs:

- Node.js 24 or newer
- npm
- Codex CLI
- tmux
- Discord Bot token and application details

For Windows hosts, Codex CLI and tmux must be available inside WSL. The Bridge runs tmux through `wsl.exe`.

Verify runtime prerequisites:

```bash
node --version
npm --version
codex --version
tmux -V
```

On Windows, verify inside WSL:

```bash
wsl.exe -- codex --version
wsl.exe -- tmux -V
```

## Setup Steps

1. Clone or copy the repository.

2. Install dependencies:

```bash
npm install
```

3. Build and test:

```bash
npm run typecheck
npm test
npm run build
```

4. Run the setup wizard:

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

The wizard creates the local config and asks for:

- `machine_id`: unique physical machine name, for example `win-main`, `linux-cloud`, or `macbook`
- Discord application ID
- Discord guild/server ID, needed for `register-commands`
- Discord channel ID and optional thread ID owned by this machine
- Authorized Discord user IDs
- Project path allowlist
- Whether ordinary Discord text can inject into Codex; keep this disabled for normal handoff
- Windows WSL settings, when running on Windows
- Discord Bot token value, stored in `.env.local` as `DISCORD_BOT_TOKEN`

The token value is never written into `config/bridge.local.json`. That config stores only the environment variable name.

After setup, the CLI automatically runs health, registers slash commands, and starts the bridge. Use `--no-start` to stop after setup and command registration, or `--no-post-setup` to write files only.

Use `--force` to overwrite an existing local config.

For scripted installs, provide an answers file instead of using the prompts:

```bash
node dist/src/cli/index.js setup --answers setup-answers.json --output config/bridge.local.json --no-start
```

Example answer shape:

```json
{
  "machineId": "win-main",
  "dataDir": "./data",
  "logDir": "./logs",
  "tokenEnv": "DISCORD_BOT_TOKEN",
  "botToken": "replace-with-real-token",
  "applicationId": "123",
  "guildId": "456",
  "channelId": "789",
  "threadId": "101112",
  "authorizedUserIds": ["111"],
  "pathAllowlist": ["E:\\Projects"],
  "allowDirectInjection": false,
  "useWsl": true,
  "wslCommand": "wsl.exe",
  "tmuxCommand": "tmux",
  "codexCommand": "codex"
}
```

5. Check local health:

```bash
node dist/src/cli/index.js health --config config/bridge.local.json
```

6. Register Discord slash commands:

```bash
node dist/src/cli/index.js register-commands --config config/bridge.local.json
```

7. Start the Bridge:

```bash
node dist/src/cli/index.js start --config config/bridge.local.json
```

## First Discord Smoke Test

In the configured channel or thread:

1. Run `/codex status`.
2. Run `/codex bind path:<absolute-project-path> alias:<short-name>`.
3. Run `/codex confirm code:<code-from-bot>`.
4. Run `/codex start`.
5. Run `/codex send text:hello from Discord`.
6. Run `/codex status` again and confirm recent pane output appears.

For the first handoff, bind one channel/thread to one harmless test project before binding business-critical projects.

## Multi-Machine Rule

One Discord Bot can serve multiple physical machines, but each machine must run its own Bridge instance.

Do not configure two machines with overlapping `discord.allowed_scopes`.

Recommended structure:

```text
#codex-control
  thread: win-main
  thread: linux-cloud
  thread: macbook
```

Each machine should own only its own thread.

## Hook Setup

Codex native hooks can call:

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json
```

The hook command accepts a JSON payload from stdin or from `--event-file`.

Supported MVP lifecycle events:

- `session-start`
- `needs-input`
- `stop`
- `session-end`
- `failed`

Unsupported or verbose hook events are audited but not forwarded by default.

## Operator Safety Notes

- Keep `policy.allow_direct_injection` disabled unless the operator explicitly wants ordinary Discord text to enter Codex.
- High-risk sends are confirmation-gated and the full pending prompt text is kept only in memory, not written into `pending-approvals.json`.
- Only one Bridge process should use a given `data_dir`; the process lock prevents accidental same-directory reuse.
- Secrets live in `.env.local` or process environment variables, never in git or bridge config.

## Handoff Checklist

- [ ] Receiver can run `npm install`
- [ ] Receiver can run `npm run typecheck`
- [ ] Receiver can run `npm test`
- [ ] Receiver can run `npm run build`
- [ ] `codex --version` works in the target runtime environment
- [ ] `tmux -V` works in the target runtime environment
- [ ] `health` reports runtime available
- [ ] Slash commands are registered
- [ ] `/codex bind` + `/codex confirm` works
- [ ] `/codex start` creates or reuses a tmux session
- [ ] `/codex send` reaches the correct tmux pane
