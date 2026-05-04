# Discord Setup

Create one Discord Application and Bot. The same bot can serve Windows, Linux, and macOS machines.

Minimum permissions:

- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Send Messages in Threads
- Create Public Threads or Create Private Threads, if the Bridge will create threads later

Gateway intents:

- Guilds
- Guild Messages
- Message Content, only if ordinary text messages should be injected directly. The Bridge requests this intent only when `policy.allow_direct_injection` is enabled.

Required values for local config:

- Discord Bot Token, stored in `.env.local` or the process environment as `DISCORD_BOT_TOKEN`
- Application ID
- Guild ID for development slash command registration. It is required only when running `codex-channel register-commands`; normal `start` does not register commands.
- Target channel or thread IDs
- Authorized Discord user IDs

The setup wizard collects these values and writes `config/bridge.local.json`:

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

Paste the Bot Token only when the wizard asks for the token value. Do not paste it into the env var name field; the env var name should normally stay `DISCORD_BOT_TOKEN`.

Binding is scoped to a Discord conversation:

```json
{
  "workspace_id": "guild:123",
  "conversation_id": "channel:456/thread:789"
}
```

Use `channel:<channel_id>` for a text channel and `channel:<parent_channel_id>/thread:<thread_id>` for a thread.
