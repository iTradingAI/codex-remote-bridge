# Deployment Notes

## Windows Host

The MVP expects Codex CLI and tmux to be available inside WSL.

Verify inside WSL:

```bash
codex --version
tmux -V
```

From Windows, the Bridge runs commands through `wsl.exe tmux ...`. The setup wizard asks whether to use WSL and writes the runtime settings:

```powershell
node dist/src/cli/index.js setup --output config/bridge.local.json
```

The generated runtime block should look like:

```json
{
  "runtime": {
    "kind": "codex-tmux",
    "windows": {
      "use_wsl": true,
      "wsl_command": "wsl.exe",
      "distro": null
    }
  }
}
```

Use Windows Task Scheduler for auto-start after the local config and token are ready.

For Codex lifecycle relays, point a native Codex hook command at:

```powershell
node dist/src/cli/index.js hook --config config/bridge.local.json
```

## Linux Host

Install Codex CLI and tmux on the host:

```bash
codex --version
tmux -V
```

Create the local bridge config:

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

Use `systemd` for auto-start once the bridge config is stable.

For hook ingress:

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json
```

## macOS Host

Install Codex CLI and tmux locally, for example with Homebrew for tmux:

```bash
brew install tmux
codex --version
tmux -V
```

Create the local bridge config:

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

Use `launchd` for auto-start after smoke testing manually.

For hook ingress:

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json
```

## Ownership Rule

Do not configure two Bridge instances with overlapping Discord `allowed_scopes`. The MVP intentionally avoids a shared ownership database; safety comes from explicit per-machine ingress scopes.
