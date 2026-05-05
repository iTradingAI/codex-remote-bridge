# Deep Interview Transcript: Discord Bridge Architecture

## Metadata

- Profile: standard
- Context type: brownfield
- Final ambiguity: 0.15
- Threshold: 0.20
- Rounds: 5
- Context snapshot: `.omx/context/discord-bridge-architecture-20260504T175812Z.md`
- Spec: `.omx/specs/deep-interview-discord-bridge-architecture.md`

## Initial Task

Redesign the Codex Channel bridge architecture so a recipient connects once to Discord, binds directories from channel/thread structure, and gets smooth low-resource routing and monitoring without running one bridge process per project.

## Rounds

### Round 1

Question: What range should a Bridge own by default?

Answer: A. Setup configures one parent channel/Forum; Bridge auto-recognizes all child threads and allows `/codex bind path:...` in any of them.

Resolution: A physical machine bridge owns one configured Discord parent scope. Threads under that parent can bind projects without per-thread static setup.

### Round 2

Question: Should project binding be constrained by `path_allowlist` or by authorized Discord users?

Answer: Authorized Discord users may bind arbitrary local paths.

Resolution: Path allowlisting is not the primary security boundary. Binding authority comes from authorized Discord users and the local OS permissions of the bridge process.

### Round 3

Question: How should Codex sessions be managed after a thread is bound to a project directory?

Answer: C. Hybrid mode, with an explicit way to unpin.

Resolution: Sessions start on demand by default. Important projects can be pinned for long-lived residency with `/codex pin`, and released with `/codex unpin`.

### Round 4

Question: What level of monitoring should the first architecture target?

Answer: B. Monitor Codex execution state.

Resolution: First-class monitoring covers bridge/session health and Codex execution states: queued, thinking, executing, waiting for user, completed, and failed. Git diff, test status, and log summaries stay out of the first core architecture.

### Round 5

Question: How should routing be split when multiple real machines connect to the same Discord bot?

Answer: A. Each machine configures a different parent channel/Forum.

Resolution: Multi-machine routing is separated by Discord parent scope. Each machine bridge owns a distinct parent channel or Forum, preventing cross-machine handler conflicts.

## Pressure Pass

The multi-machine question revisited the earlier "one parent scope" decision under pressure: if multiple machines share one Discord bot, a shared parent scope would require machine selection or path probing. The user selected separate parent scopes per machine, which keeps routing simple and avoids ambiguous ownership.

## Readiness Gates

- Non-goals: explicit
- Decision boundaries: explicit
- Pressure pass: complete

## Handoff

Use `.omx/specs/deep-interview-discord-bridge-architecture.md` as the source of truth for planning. Recommended next step: `$ralplan --direct .omx/specs/deep-interview-discord-bridge-architecture.md`.
