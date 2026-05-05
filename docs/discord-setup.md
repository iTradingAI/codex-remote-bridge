# Discord Setup

Set up one Discord application and bot for the whole deployment. Each physical machine gets its own Bridge process and its own parent channel or Forum ownership boundary.

## Permissions

Minimum permissions:

- View Channels
- Send Messages
- Read Message History
- Add Reactions, optional but recommended for status feedback
- Use Slash Commands
- Send Messages in Threads
- Create Public Threads or Create Private Threads, if the Bridge will create threads later

Gateway intents:

- Guilds
- Guild Messages
- Message Content, only if ordinary text messages should be injected directly

## Local Config

The setup wizard collects:

- Discord bot token
- Application ID
- Guild ID for slash command registration
- Machine-owned parent channel or Forum ID
- Authorized Discord user IDs
- Optional conservative `path_allowlist`
- Windows WSL settings, when applicable

The parent channel or Forum is the machine boundary. Child threads under that parent are where project bindings live.

Example conversation binding:

```json
{
  "workspace_id": "guild:123",
  "conversation_id": "channel:456/thread:789"
}
```

Use `channel:<parent_channel_id>/thread:<thread_id>` for a thread binding. The thread is the project surface; the parent channel or Forum belongs to the machine.

## Path Binding

Authorized Discord users can bind arbitrary existing absolute local paths.

The default workflow does not require a path allowlist. Use `path_allowlist` only when you want conservative mode and a narrower set of permitted roots.

Binding remains subject to:

- authorized user checks
- absolute path validation
- realpath resolution
- dangerous-root rejection

## Windows And POSIX Runtime

Windows hosts:

- Run Codex CLI and tmux inside WSL.
- The Bridge should use the WSL runtime for tmux-backed execution.

Linux and macOS hosts:

- Use native tmux.

The operator flow is the same on all platforms: one Bridge process per machine, one parent scope per machine, child threads for project bindings.

## Setup Command

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

Use the resulting config with `health`, `register-commands`, `start`, `bind`, `pin`, `unpin`, `unbind`, `send`, `status`, and `hook`.
