# Codex Channel

Discord-first bridge for controlling local Codex CLI sessions over tmux.

The MVP runtime is `codex-tmux`:

- Linux and macOS run native `tmux`.
- Windows runs `tmux` and `codex` inside WSL through `wsl.exe`.
- OMX is not part of the MVP runtime.

One Discord Bot can serve multiple physical machines. Each machine runs its own Bridge instance and only accepts events from its configured `allowed_scopes`.

## Quick Start

1. Copy `config/bridge.example.json` to a local config file outside source control or named `config/bridge.local.json`.
2. Set `DISCORD_BOT_TOKEN` in the local environment.
3. Fill in `machine_id`, Discord IDs, `allowed_scopes`, `path_allowlist`, and authorized Discord user IDs.
4. Run:

```bash
npm install
npm run build
node dist/src/cli/index.js health --config config/bridge.local.json
node dist/src/cli/index.js register-commands --config config/bridge.local.json
node dist/src/cli/index.js start --config config/bridge.local.json
```

Codex native hooks can call the local hook ingress:

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json < hook-event.json
```

## Discord Model

Use one channel or one thread per machine/project during the MVP. Category sections are useful for organization, but binding happens at the channel/thread conversation level.

For multiple physical machines:

```text
#codex-control
  thread: win-main
  thread: linux-cloud
  thread: macbook
```

Each Bridge config should include only the thread or channel it owns.
