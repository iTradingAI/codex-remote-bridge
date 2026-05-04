# Codex Channel

Discord-first bridge for controlling local Codex CLI sessions over tmux.

The MVP runtime is `codex-tmux`:

- Linux and macOS run native `tmux`.
- Windows runs `tmux` and `codex` inside WSL through `wsl.exe`.
- OMX is not part of the MVP runtime.

One Discord Bot can serve multiple physical machines. Each machine runs its own Bridge instance and only accepts events from its configured `allowed_scopes`.

## Quick Start

1. Install dependencies and build:

```bash
npm install
npm run build
```

2. Run the local setup wizard:

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

The wizard asks for the machine ID, Discord application/server/channel or thread IDs, authorized Discord user IDs, project path allowlist, and Windows WSL/tmux settings when applicable. It writes a local config that is ignored by git.

For scripted machine setup, pass an answers file:

```bash
node dist/src/cli/index.js setup --answers setup-answers.json --output config/bridge.local.json
```

3. Set `DISCORD_BOT_TOKEN` in the local environment.

4. Run:

```bash
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

## Documentation

- [Discord setup](docs/discord-setup.md)
- [Deployment notes](docs/deployment.md)
- [Delivery guide](docs/delivery-guide.md)
