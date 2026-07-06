# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a durable, resumable planning-and-execution
loop for larger coding work: plan a goal as discrete features, approve the plan,
then implement one feature at a time with enforced validation and review
evidence. State lives in `.flow/session.json`, so a session survives restarts,
model switches, and context loss.

The design is skills-first: the skills carry planning, execution, validation,
review, and orchestration judgment, while the plugin runtime stays deliberately
small — it keeps the session ledger and enforces the hard gates prompts should
not be trusted to remember.

Full project documentation is available in the
[Flow OpenCode wiki](https://github.com/ddv1982/flow-opencode/wiki).

## Quick start

```bash
opencode plugin opencode-plugin-flow@4.3.2 --global --force
npx -y opencode-plugin-flow@4.3.2 sync
```

Restart OpenCode, then give Flow a goal:

```text
/flow-auto add rate limiting to the public API
```

Flow inspects the repo, saves a plan of features, asks for approval (or
proceeds if you already authorized autonomous work), then runs the loop:
implement one feature → validate it → review it → record evidence → next
feature. `/flow-status` shows where you are at any point, including after a
restart.

## What a session looks like

```text
> /flow-auto add rate limiting to the public API

  flow_plan_save    goal: "add rate limiting to the public API"
                    features: rate-limit-middleware, per-route-config, docs-update
  (you approve the plan)
  flow_plan_approve plan locked — features are now immutable
  flow_run_start    feature: rate-limit-middleware
  ... implementation, tests ...
  flow_feature_complete
                    validationRun: "bun test tests/middleware.test.ts" passed
                    featureReview: passed
  flow_run_start    feature: per-route-config
  ...

> /flow-status
  status: running, 1/3 features completed
  nextAction: complete feature "per-route-config"
```

Interrupt at any point; `/flow-run` resumes the next approved feature. On the
final feature Flow requires broad project-level validation and a final review
whose depth matches the approved plan before the session can close as
completed.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the full skill-guided loop. |
| `/flow-plan <goal>` | Create or approve a plan. |
| `/flow-run` | Execute one approved feature. |
| `/flow-review` | Run a read-only review. |
| `/flow-status` | Show the active session and next action. |

Commands are bundled entrypoints: they carry their own instructions, so they
keep working even when OpenCode's native skill discovery lags behind a fresh
install (see [docs/troubleshooting.md](docs/troubleshooting.md)).

`flow-test`, `flow-deslop`, `flow-ui-quality`, and `flow-commit` are managed
helper skills, not public commands.
`flow-commit` is user-triggered only and stays outside the autonomous loop.

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

Review evidence is part of `flow_feature_complete`: every completed feature
needs a passing `featureReview`, and the final feature also needs a passing
`finalReview`.

## What the runtime enforces

The runtime owns only safety; judgment lives in the skills:

- `.flow/session.json` is the single source of truth; writes are locked and
  atomic, and closed sessions are archived under `.flow/history/`.
- Plans cannot be changed after approval.
- Only one feature can be active at a time.
- Completion requires passing validation evidence: `targeted` scope for
  ordinary features, `broad` scope plus a passing final review for the last
  one.
- A session can close as `completed` only after final completion has passed.
- Crash recovery is built in: stale session locks expire automatically and
  unreadable session files are quarantined with recovery guidance, never
  silently deleted.
- Flow writes `.flow/.gitignore` so session state stays out of Git by default.
- `.flow/opencode-instructions.md` is a generated projection of the active
  session that keeps ambient context accurate; do not edit it.

## Hidden workers

For broad work, Flow's manager can fan out read-only workers
(`flow-evidence-worker`, `flow-validation-worker`, `flow-audit-worker`,
`flow-candidate-worker`, `flow-verifier-worker`, and the `flow-reviewer`) with
locked-down permissions. Workers gather evidence; they never approve plans,
complete features, or close sessions. Flow reserves those agent ids and the
public command ids while the plugin is enabled, and warns if they collide with
your own config.

## Install details, doctor, repair, uninstall

See [docs/troubleshooting.md](docs/troubleshooting.md) for skill sync
mechanics, the `doctor`/`sync` CLI, older-OpenCode install fallback, stuck
session recovery, and uninstall (`uninstall --dry-run` previews removals).

To update a pinned Flow version, rerun the install command with the new
version. To inspect skill health:

```bash
npx -y opencode-plugin-flow@4.3.2 doctor
```

## Experimental: compaction context

Flow's ambient context uses stable OpenCode configuration by default. If you
want the active session summary injected into OpenCode's session compaction as
well, opt in with the environment variable `FLOW_EXPERIMENTAL_COMPACTION=1`.
This uses OpenCode's experimental compaction hook and may change with OpenCode
versions; the default remains hook-free.

## Development

```bash
bun install
bun run check        # typecheck + lint + build + tests
bun run smoke:live   # boots a real OpenCode server against the packed tarball
```

The package exports only the OpenCode plugin entrypoint:

```ts
import flowPlugin from "opencode-plugin-flow";
```

See [docs/development.md](docs/development.md) and
[docs/maintainer-contract.md](docs/maintainer-contract.md) for the
runtime/skills split and release process.

## Credits

Flow's parallel orchestration guidance was inspired by Ray Fernando's skill
work on parallel agent workflows. Flow also draws conceptual inspiration from
[RepoPrompt CE](https://github.com/repoprompt/repoprompt-ce), especially its
emphasis on codebase orientation, context engineering, agent orchestration,
and reviewable handoffs.

The Flow version is its own OpenCode-native design: skills-first,
manager-owned state, hidden workers, and no extra runtime ledger.
