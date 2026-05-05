# Delivery Guide

This guide is for handing Codex Channel to another operator or machine owner.

## What To Deliver

Deliver the repository, not local runtime artifacts.

Include:

- source code under `src/`
- tests under `tests/`
- documentation under `README.md` and `docs/`
- `config/bridge.example.json`
- `.env.example`
- `package.json` and `package-lock.json`
- planning records under `.omx/context/` and `.omx/plans/`

Do not include:

- `node_modules/`
- `dist/`
- `data/`
- `logs/`
- `.env`
- `config/bridge.local.json`
- bot tokens or other secrets
- `.omx/logs/`, `.omx/state/`, `.omx/drafts/`

## Recipient Prerequisites

The receiving machine needs:

- Node.js 24 or newer
- npm
- Codex CLI
- tmux
- Discord bot token and application details

Windows hosts:

- Run Codex CLI and tmux inside WSL.
- The Bridge uses the WSL tmux runtime on Windows.

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
- Discord guild ID, needed for `register-commands`
- Discord parent channel or Forum ID owned by this machine
- Authorized Discord user IDs
- Optional `path_allowlist` for conservative mode
- Whether ordinary Discord text can inject into Codex
- Windows WSL settings, when running on Windows
- Discord bot token value, stored in `.env.local` as `DISCORD_BOT_TOKEN`

The token value is never written into `config/bridge.local.json`. That config stores only the environment variable name.

After setup, the CLI can run health, register slash commands, and start the Bridge. Use `--no-start` or `--no-post-setup` if you want to stop earlier.

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
  "authorizedUserIds": ["111"],
  "pathAllowlist": [],
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

In the configured child thread:

1. Run `/codex status`.
2. Run `/codex bind path:<absolute-project-path> alias:<short-name>`.
3. Run `/codex confirm code:<code-from-bot>`.
4. Run `/codex pin`.
5. Run `/codex send text:hello from Discord`.
6. Run `/codex status` again and confirm the binding and session state look correct.
7. Run `/codex unpin` and confirm the session returns to on-demand behavior.

For the first handoff, bind one child thread to one harmless test project before binding business-critical projects.

## Multi-Machine Rule

One Discord bot can serve multiple physical machines, but each machine must run its own Bridge instance.

Do not configure two machines with overlapping parent scopes.

Recommended structure:

```text
#codex-windows
  thread: project-a
  thread: project-b

#codex-linux
  thread: project-c

#codex-macos
  thread: project-d
```

Each machine should own only its own parent scope and the child threads beneath it.

## Hook Setup

Codex native hooks call the local hook ingress:

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json
```

The hook command accepts a JSON payload from stdin or from `--event-file`.

The hook CLI submits events locally. The long-running Bridge owns the Discord connection.

Supported MVP lifecycle events:

- `session-start`
- `needs-input`
- `stop`
- `session-end`
- `failed`

Unsupported or verbose hook events are audited but not forwarded by default.

## Operator Safety Notes

- Keep ordinary Discord text injection disabled unless the operator wants it.
- Use `path_allowlist` only for conservative mode.
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
- [ ] `/codex pin` creates or reuses a tmux session
- [ ] `/codex send` reaches the correct tmux pane
- [ ] `/codex unpin` returns the binding to on-demand behavior
