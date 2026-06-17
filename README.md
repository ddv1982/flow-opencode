# Flow Plugin for OpenCode

`opencode-plugin-flow` is a skills-first workflow helper for OpenCode. The skills carry planning, execution, validation, cleanup, UI quality, review, safe commit preparation, and orchestration judgment. The plugin code stays deliberately small: it keeps a durable `.flow/session.json` ledger and enforces the hard gates prompts should not be trusted to remember.

Flow v4 is a breaking simplification. It does not preserve v3 session layouts or retired tool aliases.

## What Flow adds

- A resumable one-feature-at-a-time loop for larger coding work.
- Skill-guided planning, running, validation, review, cleanup, and UI quality.
- First-class validation guidance through `flow-test`, plus user-triggered safe
  commit preparation through `flow-commit`.
- Hidden evidence, review, validation, audit, verifier, and candidate workers for broad work.
- Structured handoffs with coverage, evidence, confidence, and gaps.
- Runtime gates for approval immutability, validation evidence, review evidence, and safe session closure.

The manager still owns every Flow state change. Workers gather evidence; they do not approve plans, complete features, or close sessions.

## Install or update

Use OpenCode's plugin installer when your OpenCode version supports it:

```bash
opencode plugin opencode-plugin-flow@4.1.9 --global --force
npx -y opencode-plugin-flow@4.1.9 sync
```

The first command adds Flow to your global OpenCode plugin config or replaces an
older pinned Flow entry. The `sync` command pre-installs Flow's managed skills so
the next OpenCode startup can load the refreshed skill registry.

Then start or restart OpenCode. On startup, the plugin syncs its global skills
into:

```text
~/.config/opencode/skills/flow/SKILL.md
~/.config/opencode/skills/flow-plan/SKILL.md
~/.config/opencode/skills/flow-run/SKILL.md
~/.config/opencode/skills/flow-test/SKILL.md
~/.config/opencode/skills/flow-review/SKILL.md
~/.config/opencode/skills/flow-deslop/SKILL.md
~/.config/opencode/skills/flow-ui-quality/SKILL.md
~/.config/opencode/skills/flow-commit/SKILL.md
```

If your OpenCode version does not have `opencode plugin`, add Flow to your
OpenCode config manually instead:

```json
{
  "plugin": ["opencode-plugin-flow@4.1.9"]
}
```

When updating through this fallback, replace the older
`opencode-plugin-flow@...` entry with the new pinned version instead of adding a
duplicate entry.

Then run the same pre-start skill sync and start or restart OpenCode:

```bash
npx -y opencode-plugin-flow@4.1.9 sync
```

Project-local skill overrides still work through OpenCode's normal lookup:

```text
.opencode/skills/flow-plan/SKILL.md
```

If Flow installs or updates skills during the current OpenCode startup, restart
OpenCode once more before using Flow commands. OpenCode may have already scanned
the skill registry for the running process, so a just-synced skill can exist on
disk while still being unavailable to that process. Flow reports this through
`flow_status` as `setup.skills.status: "restart_required"`.

To update a pinned Flow version later, rerun the same install command with the
new version.

`--force` is intentional here: OpenCode keeps an existing same-package plugin
entry unless replacement is requested, so the flag avoids leaving an older pinned
version in your global `opencode.json`.

To inspect the installed skill set:

```bash
npx -y opencode-plugin-flow@4.1.9 doctor
```

If a command reports `Skill "flow-review" not found. Available skills...` or a
similar Flow skill-loading error after upgrading, it is usually an older
OpenCode process or stale resolved command body. Flow command preflight replaces
public Flow command bodies in the running process, and `/flow-review` no longer
asks OpenCode to native-load required public Flow skills. Public Flow command
preflight replaces stale command bodies with bundled command instructions, so
`/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` can continue even
when native skill discovery lags. Run `/flow-status` or the doctor command
above first. Missing, incomplete, or outdated managed skills can still be
repaired with:

```bash
npx -y opencode-plugin-flow@4.1.9 sync
```

Then restart OpenCode so the refreshed registry is loaded. `sync` manages all
bundled Flow skills: `flow`, `flow-plan`, `flow-run`, `flow-test`,
`flow-review`, `flow-deslop`, `flow-ui-quality`, and `flow-commit`. If doctor
reports a foreign or edited managed skill folder, Flow leaves it in place and
asks for a user decision instead of overwriting local work.

## Commands

Commands are bundled entrypoints. OpenCode still syncs the Flow skills for
discoverability and manual use, but public command execution does not depend on
native skill discovery for the required Flow loop:

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the full skill-guided loop. |
| `/flow-plan <goal>` | Create or approve a plan. |
| `/flow-run` | Execute one approved feature. |
| `/flow-review` | Run a read-only review. |
| `/flow-status` | Show the active session and next action. |

`flow-test` and `flow-commit` are managed helper skills, not public commands in
this release. `flow-commit` is user-triggered only and stays outside the
autonomous Flow runtime loop.

## Tools

The runtime exposes seven tools:

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

## Runtime Contract

The runtime owns only safety:

- `.flow/session.json` is the active source of truth.
- `.flow/history/<session-id>.json` stores closed sessions.
- Session writes are locked and atomic.
- Flow writes `.flow/.gitignore` so session state stays out of Git by default.
- Mutable roots cannot be filesystem roots or `$HOME`.
- Plans cannot be changed after approval.
- Only one feature can be active at a time.
- Completion requires passing validation evidence.
- Non-final completion requires `validationScope: "targeted"`.
- Final completion requires `validationScope: "broad"` and a passing final review matching the plan's `finalReviewPolicy`.
- `flow_session_close` accepts `kind: "completed"` only after an approved plan has passed final completion.

Planning quality, decomposition, review depth, validation adequacy, orchestration, and recovery judgment live in the skills.

## State Layout

```text
.flow/session.json
.flow/history/<session-id>.json
.flow/session.lock/
```

Versioning `.flow` state is opt-in. Keep it ignored by default, and archive only
exact Flow session artifacts when a maintainer intentionally asks for them; avoid
broad forced adds of `.flow/**`.

## Development

```bash
bun install
bun run check
```

The package exports only the OpenCode plugin entrypoint:

```ts
import flowPlugin from "opencode-plugin-flow";
```

## Credits

Flow's parallel orchestration guidance was inspired by Ray Fernando's skill work on parallel agent workflows. Flow also draws conceptual inspiration from [RepoPrompt CE](https://github.com/repoprompt/repoprompt-ce), especially its emphasis on codebase orientation, context engineering, agent orchestration, and reviewable handoffs.

The Flow version is its own OpenCode-native design: skills-first, manager-owned state, hidden workers, and no extra runtime ledger.

## Uninstall

First remove `opencode-plugin-flow` from your OpenCode plugin config so future
OpenCode startups stop loading Flow. Then remove Flow-owned synced skills:

```bash
npx -y opencode-plugin-flow@4.1.9 uninstall
```

Restart OpenCode after both steps. This removes Flow-owned synced skills when
they are pristine. User-edited or foreign skill folders are kept.
