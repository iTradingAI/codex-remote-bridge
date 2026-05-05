# Codex Channel

Discord-first bridge for controlling local Codex CLI sessions over tmux.

Operating model:

- one Bridge process per physical machine
- one Discord parent channel or Forum per machine
- child threads bind to local project paths
- `path_allowlist` is optional conservative mode, not the default workflow
- local hook ingress is Bridge-owned; the hook CLI submits locally and the Bridge owns the Discord connection

Platform runtime:

- Linux and macOS use native tmux
- Windows uses Codex CLI and tmux inside WSL

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

3. Start the Bridge:

```bash
node dist/src/cli/index.js start --config config/bridge.local.json
```

4. In a child thread under the machine-owned parent scope, bind a project path:

```text
/codex bind path:<absolute-project-path> alias:<short-name>
/codex confirm code:<code-from-bot>
/codex pin
```

## Documentation

- [Operator flow](docs/operator-flow.md)
- [Discord setup](docs/discord-setup.md)
- [Delivery guide](docs/delivery-guide.md)
