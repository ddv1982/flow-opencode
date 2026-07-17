# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a durable, resumable planning-and-execution
loop for larger coding work: plan a goal as discrete features, approve the plan,
then implement one feature at a time with enforced validation and review
evidence. State lives in `.flow/session.json`, so a session survives restarts,
model switches, and context loss.

The design is guidance-first: package-owned Markdown carries planning,
execution, validation, review, and orchestration judgment, while the plugin
runtime stays deliberately small — it keeps the session ledger and enforces the
hard gates prompts should not be trusted to remember.

Full project documentation is available in the
[Flow OpenCode wiki](https://github.com/ddv1982/flow-opencode/wiki).

## Quick start

```bash
opencode plugin opencode-plugin-flow@5.0.0 --global --force
```

Start or restart OpenCode, then give Flow a goal:

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
                    featureReviewDepth: standard
                    featureReview: passed
  flow_run_start    feature: per-route-config
  ...

> /flow-status
  status: ok
  workflowData.session.status: running, 1/3 features completed
  nextAction: complete the feature under workflowData.session.activeFeature
```

Interrupt at any point; `/flow-run` resumes the next approved feature. On the
final feature Flow requires broad project-level validation and a final review
whose depth matches the approved plan before the session can close as
completed.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the full guidance-driven loop. |
| `/flow-plan <goal>` | Create or approve a plan. |
| `/flow-run` | Execute one approved feature. |
| `/flow-review` | Run a read-only review. |
| `/flow-status` | Show the active session and next action. |

Commands are compiled entrypoints: manager commands carry only their applicable
core instructions, while `/flow-review` runs against the reserved reviewer's
role-specific agent contract. Flow does not install files into OpenCode's
global skill registry and does not depend on native skill discovery.

`flow-test`, `flow-deslop`, `flow-ui-quality`, and `flow-commit` are optional
package-owned guides loaded on demand through `flow_guidance`, not public
commands. `flow-commit` is user-triggered only and stays outside the autonomous
loop.

## Tools

The plugin exposes eight tools. `flow_guidance` is read-only and returns embedded
Markdown; the other seven form the stateful runtime surface:

| Tool | Purpose |
| --- | --- |
| `flow_guidance` | Load exact package-owned guidance by stable id. |
| `flow_status` | Read the active session and next action. |
| `flow_plan_save` | Create a session and/or save a draft plan. |
| `flow_plan_approve` | Approve the draft plan. |
| `flow_run_start` | Start the next runnable feature. |
| `flow_feature_complete` | Record completion or blocker evidence for the active feature. |
| `flow_feature_reset` | Reset one feature and its dependents. |
| `flow_session_close` | Archive the active session as completed, deferred, or abandoned. |

Review evidence is part of `flow_feature_complete`: every completed feature
needs a passing `featureReview` at the feature's planned `reviewDepth`, and the
final feature also needs a passing `finalReview`.

## What the runtime enforces

The runtime owns only safety; judgment lives in package-owned guidance:

- `.flow/session.json` is the single source of truth; writes are locked and
  atomic, and closed sessions are archived under `.flow/history/`.
- Plans cannot be changed after approval.
- Only one feature can be active at a time.
- Completion requires passing validation evidence: `targeted` scope for
  ordinary features, `broad` scope plus a passing final review for the last
  one.
- Completion records `featureReviewDepth`; the runtime rejects review evidence
  that is shallower than the approved feature requires.
- Failed reviews are bounded: a failed review pauses by default, and autonomous
  repair is limited to one repair plus one retry before the feature blocks.
- Review exhaustion uses the ordinary blocked-feature state; continuing requires
  an explicit `flow_feature_reset`, not a second checkpoint protocol.
- Once a closure is recorded, the session is archive-only. If publication fails,
  retry `flow_session_close`; no run, reset, approval, or replan can reopen it.
- A session can close as `completed` only after final completion has passed.
- Session locks fail closed: Flow never guesses that an old lock is abandoned,
  and only the unique owner may release it. Unreadable session files are
  quarantined with recovery guidance, never silently deleted.
- Flow writes `.flow/.gitignore` so session state stays out of Git by default.
- `.flow/session.json` is the only active-state representation. Canonical Flow
  commands call `flow_status` before acting; plugin configuration does not read,
  refresh, or project workspace state.

## Hidden workers

For broad work, Flow's manager can fan out isolated hidden workers
(`flow-evidence-worker`, `flow-validation-worker`, `flow-audit-worker`,
`flow-candidate-worker`, `flow-verifier-worker`, and the `flow-reviewer`) with
locked-down permissions. Workers gather evidence; they never approve plans,
complete features, or close sessions. Flow reserves those agent ids and the
public command ids while the plugin is enabled, and warns if they collide with
your own config.

Each hidden worker receives only its applicable handoff schema. The manager
contract treats empty or malformed handoffs as coverage gaps instead of
success. The offline handoff validator detects missing headings, empty sections,
unresolved placeholders, and invalid statuses; current OpenCode worker output
remains plain text, so runtime acceptance still depends on the manager applying
that contract. Inspect rendered surfaces and static contracts with
`bun run prompt:quality`; run opt-in model decisions with
`bun run prompt:model-eval -- --model <provider/model> --timeout-ms 300000`;
see
[docs/prompt-quality.md](docs/prompt-quality.md).

For broad implementation, the manager records whether work stayed serial,
used exact-path candidate workers, used isolated worktrees, ran a tournament, or
skipped eligible candidates. Feature completion can carry bounded
`orchestrationPasses` with candidate eligibility, decision, and structured
factors; `flow_status` reports the aggregate under
`workflowData.session.budget.orchestration`.

## Install details and legacy cleanup

See [docs/troubleshooting.md](docs/troubleshooting.md) for updates,
older-OpenCode install fallback, stuck session recovery, and removal of global
Flow skill folders left by v4.

To update a pinned Flow version, rerun the install command with the new version.
Flow starts with the new package-owned guidance immediately; no second restart
or sync command is required. To preview recoverable migration of pristine v4
global skill folders:

```bash
npx -y opencode-plugin-flow@5.0.0 legacy-cleanup --dry-run
```

## Development

```bash
bun install
bun run check        # typecheck + lint + prompt quality + build + tests
bun run smoke:live   # boots a real OpenCode server against the packed tarball
```

The package exports only the OpenCode plugin entrypoint:

```ts
import flowPlugin from "opencode-plugin-flow";
```

See [docs/development.md](docs/development.md) and
[docs/maintainer-contract.md](docs/maintainer-contract.md) for the
v5 domain/application/infrastructure/platform boundaries, guidance split, and
release process.

## Credits

Flow's parallel orchestration guidance was inspired by Ray Fernando's skill
work on parallel agent workflows. Flow also draws conceptual inspiration from
[RepoPrompt CE](https://github.com/repoprompt/repoprompt-ce), especially its
emphasis on codebase orientation, context engineering, agent orchestration,
and reviewable handoffs.

The Flow version is its own OpenCode-native design: package-owned guidance,
manager-owned state, hidden workers, and no extra runtime ledger.
