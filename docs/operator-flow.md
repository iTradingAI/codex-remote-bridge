# Operator Flow

This is the recipient-facing operating model for Codex Channel.

## Mental Model

Run one Bridge process per physical machine.

Each machine owns one Discord parent channel or Forum. Child threads under that parent are project bindings, not separate bridge processes.

Recommended topology:

```text
Discord parent channel / Forum
  thread: project-a  -> machine-a Bridge -> tmux session for project-a
  thread: project-b  -> machine-a Bridge -> tmux session for project-b
  thread: project-c  -> machine-b Bridge -> tmux session for project-c
```

Rules:

- One physical machine runs one Bridge process.
- One Discord parent scope belongs to one machine.
- One child thread maps to one bound project path.
- One binding usually maps to one tmux session.
- Do not run two Bridge processes with the same `data_dir`.
- Do not let two machines own the same Discord parent scope or child thread.

## Setup

1. Install dependencies.

```bash
npm install
```

2. Run the setup wizard.

```bash
node dist/src/cli/index.js setup --output config/bridge.local.json
```

Setup writes the local machine config, Discord token env reference, and runtime state paths. It should ask for the machine-owned parent channel or Forum, not a project thread boundary.

3. Check health.

```bash
node dist/src/cli/index.js health --config config/bridge.local.json
```

4. Start the Bridge.

```bash
node dist/src/cli/index.js start --config config/bridge.local.json
```

Leave the Bridge running on that machine.

## Bind A Project

In a child thread under the machine-owned parent scope, an authorized Discord user can bind any existing absolute project path:

```text
/codex bind path:<absolute-project-path> alias:<short-name>
/codex confirm code:<code-from-bot>
/codex status
```

Notes:

- The path must already exist and resolve on the local machine.
- Binding is gated by authorized Discord users and any confirmation flow the config enables.
- Child threads are the project-level conversation surface; the parent scope stays machine-owned.

## Session Lifecycle

Use `/codex pin` when the project should keep a resident tmux session:

```text
/codex pin
```

Use `/codex unpin` to return the binding to on-demand behavior:

```text
/codex unpin
```

Use `/codex unbind` when the binding should be removed and the resident session cleaned up if present.

Operational rule:

- `pin` persists resident intent.
- `unpin` persists on-demand intent and stops the deterministic session when present.
- `unbind` removes the binding and cleans up the session if it exists.

## Hook Ingress

Bridge-owned local hook ingress is the default operator model.

The `hook` CLI submits events locally. It does not own the Discord connection and should not log into Discord.

```bash
node dist/src/cli/index.js hook --config config/bridge.local.json < hook-event.json
```

The long-running Bridge owns the Discord connection, starts local ingress, and processes hook events after they enter the Bridge.

## Runtime Expectations

Windows:

- Run Codex CLI and tmux inside WSL.
- Start the Bridge from the Windows host, but let it use the WSL runtime for tmux-backed execution.

Linux and macOS:

- Use native tmux.
- Keep the Bridge process tied to the machine that owns the Discord parent scope.

## What Not To Do

- Do not create one Bridge process per project.
- Do not configure `path_allowlist` as the default path-binding workflow.
- Do not let the hook CLI become a second Discord client.
- Do not share a parent scope across machines.
