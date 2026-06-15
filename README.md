# Flow Plugin for OpenCode

`opencode-plugin-flow` is a skills-first workflow helper for OpenCode. The skills carry the planning, execution, validation, cleanup, UI, and review guidance. The plugin code is deliberately small: it keeps a durable `.flow/session.json` ledger and enforces the few binary gates that prompts cannot reliably enforce.

Flow v4 is a breaking simplification. It does not preserve v3 session layouts or retired tool aliases.

## Install

Add Flow to your OpenCode config:

```json
{
  "plugin": ["opencode-plugin-flow@4.1.0"]
}
```

Restart OpenCode once. On startup, the plugin syncs its global skills into:

```text
~/.config/opencode/skills/flow/SKILL.md
~/.config/opencode/skills/flow-plan/SKILL.md
~/.config/opencode/skills/flow-run/SKILL.md
~/.config/opencode/skills/flow-review/SKILL.md
~/.config/opencode/skills/flow-deslop/SKILL.md
~/.config/opencode/skills/flow-ui-quality/SKILL.md
```

Project-local skill overrides still work through OpenCode's normal lookup:

```text
.opencode/skills/flow-plan/SKILL.md
```

## Commands

Commands are thin pointers into skills:

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the full skill-guided loop. |
| `/flow-plan <goal>` | Create or approve a plan. |
| `/flow-run` | Execute one approved feature. |
| `/flow-review` | Run a read-only review. |
| `/flow-status` | Show the active session and next action. |

## Tools

The v4 runtime exposes seven tools:

| Tool | Purpose |
| --- | --- |
| `flow_status` | Read the active session and next action. |
| `flow_plan_save` | Create a session and/or save a draft plan. |
| `flow_plan_approve` | Approve the draft plan. |
| `flow_run_start` | Start the next runnable feature. |
| `flow_feature_complete` | Record completion or blocker evidence for the active feature. |
| `flow_feature_reset` | Reset one feature and its dependents. |
| `flow_session_close` | Archive the active session as completed, deferred, or abandoned. |

There is no `flow_context` and no separate review-record tool. Review evidence is part of `flow_feature_complete`: every completed feature needs a passing `featureReview`, and the final feature also needs a passing `finalReview`.

Broad Flow work can fan out through hidden evidence, review, validation, audit, verifier, and candidate workers. Those workers return structured handoffs with coverage, evidence, confidence, and gaps; the manager still owns all Flow state changes and no extra user command is required.

## Runtime Contract

The runtime owns only safety:

- `.flow/session.json` is the active source of truth.
- `.flow/history/<session-id>.json` stores closed sessions.
- Session writes are locked and atomic.
- Mutable roots cannot be filesystem roots or `$HOME`.
- Plans cannot be changed after approval.
- Only one feature can be active at a time.
- Completion requires passing validation evidence.
- Non-final completion requires `validationScope: "targeted"`.
- Final completion requires `validationScope: "broad"` and a passing final review matching the plan's `finalReviewPolicy`.
- `flow_session_close` accepts `kind: "completed"` only after an approved plan has passed final completion.

Planning quality, decomposition, review depth, validation adequacy, and recovery judgment live in the skills.

## State Layout

```text
.flow/session.json
.flow/history/<session-id>.json
.flow/session.lock/
```

## Development

```bash
bun install
bun run check
```

The package exports only the OpenCode plugin entrypoint:

```ts
import flowPlugin from "opencode-plugin-flow";
```

## Uninstall

```bash
bunx opencode-plugin-flow uninstall
```

This removes Flow-owned synced skills when they are pristine. User-edited or foreign skill folders are kept.
