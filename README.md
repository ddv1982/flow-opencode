# Flow Plugin for OpenCode

`opencode-plugin-flow` adds a durable planning and execution workflow to OpenCode.

It turns a goal into a tracked session, breaks that goal into features, executes one feature at a time, and requires validation plus reviewer approval before work can advance.

## What Flow Does

Flow provides:

- persisted planning and approval
- feature-by-feature execution
- validation evidence for completed work
- reviewer-gated progression
- broad final validation before full completion
- resumable sessions stored in `.flow/`

For longer sessions, keep the workflow strict and tune efficiency in OpenCode/provider configuration first. The recommended knobs are stable prompts, OpenCode compaction, and provider cache keys.

## Commands

Flow injects these slash commands into OpenCode:

| Command | Purpose |
| --- | --- |
| `/flow-plan <goal>` | Create or refresh a draft plan |
| `/flow-plan select <feature-id...>` | Keep only selected features in the draft |
| `/flow-plan approve [feature-id...]` | Approve the current draft plan |
| `/flow-run [feature-id]` | Execute exactly one approved feature |
| `/flow-auto <goal>` | Plan and execute autonomously from a new goal |
| `/flow-auto resume` | Resume the active autonomous session |
| `/flow-status` | Show the current session summary |
| `/flow-history` | Show stored session history |
| `/flow-session activate <id>` | Switch the active session |
| `/flow-reset feature <id>` | Reset a feature and dependents back to pending |
| `/flow-reset session` | Archive the active session and clear it |

## Quick Start

### Manual flow

1. `/flow-plan Add a workflow plugin for OpenCode`
2. Review the proposed features
3. `/flow-plan approve`
4. `/flow-run`
5. Repeat `/flow-run` until complete
6. `/flow-status`

### Autonomous flow

1. `/flow-auto Add a workflow plugin for OpenCode`
2. Let Flow plan, execute, validate, review, and continue until complete or blocked
3. Use `/flow-status` at any time to inspect progress

### Resume behavior

- `/flow-auto` with no argument is resume-only
- `/flow-auto resume` is the explicit equivalent
- if no active session exists, Flow asks for a goal
- completed sessions are not resumable

## Where Flow Stores Progress

Flow keeps one active session per worktree.

Main session state:

```text
.flow/active
.flow/sessions/<session-id>/session.json
```

Readable docs:

```text
.flow/sessions/<session-id>/docs/index.md
.flow/sessions/<session-id>/docs/features/<feature-id>.md
```

Archived sessions live under:

```text
.flow/archive/
```

## What Flow Will Not Skip

Flow is intentionally strict.

Flow will not mark a feature complete unless it has:

- an approved plan
- exactly one active feature
- recorded validation evidence
- passing validation for that completion path
- a recorded reviewer decision
- an approved reviewer decision for the current scope
- a passing `featureReview`

Flow will not mark the whole session complete unless it also has:

- broad validation for the repo
- a final reviewer decision
- a passing `finalReview`

## Install

### Use locally today

This is the current way to use the plugin from this repo:

```bash
bun install
bun run build
```

OpenCode should load:

```text
dist/index.js
```

Place the built file in an OpenCode plugin directory such as:

```text
.opencode/plugins/
```

or:

```text
~/.config/opencode/plugins/
```

Example:

```bash
cp dist/index.js .opencode/plugins/flow.js
```

### Future package install

This will be the simpler end-user install path after the plugin is published:

```json
{
  "plugin": ["opencode-plugin-flow"]
}
```

## More Documentation

- [Maintainer and contributor notes](docs/maintainers.md)
- [Performance and token-efficiency notes](docs/token-efficiency.md)

## License

This project is licensed under the MIT License. See `LICENSE` for the full text.
