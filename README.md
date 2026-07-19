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
opencode plugin opencode-plugin-flow@5.2.1 --global --force
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

`/flow-auto` still respects the scope of the request. If you ask for a plan
only or explicitly say not to implement, it saves and summarizes the plan and
stops before `flow_run_start`.

## What a session looks like

```text
> /flow-auto add rate limiting to the public API

  flow_plan_save    goal: "add rate limiting to the public API"
                    features: rate-limit-middleware, per-route-config, docs-update
  (you approve the plan)
  flow_plan_approve plan locked — features are now immutable
  flow_run_start    mutation acknowledged
  flow_status       request.view: execution, feature: rate-limit-middleware
  ... implementation, tests ...
  flow_review_start request.validations: focused checks passed
                    request.reviewKind: feature
                    request.validationScope: targeted
                    assignmentId: review-assignment:runtime-id
  flow_status       request.view: reviewer
                    request.assignmentId: review-assignment:runtime-id
  ... independent review ...
  flow_feature_complete
                    request.result.kind: completed
                    request.result.validationScope: targeted
                    request.result.featureReview.assignmentId: review-assignment:runtime-id
                    request.result.featureReview.verdict: passed
  flow_run_start    mutation acknowledged
  flow_status       request.view: execution, feature: per-route-config
  ...

> /flow-status
  status: ok
  workflowData.projection.view: compact
  workflowData.projection.status: running
  workflowData.projection.progress: { completed: 1, total: 3, remaining: 2 }

> /flow-run
  flow_status       request.view: execution
                    workflowData.projection: full active-feature scope
```

`flow_status` returns workflow state under `workflowData.projection`: compact is
routing-only, execution is the full active-feature working scope, detail is
diagnostic, and reviewer is narrow assignment context. State-changing tools
return `workflowData.receipt` acknowledgements; a receipt never replaces a
fresh status projection. Rejected mutations explicitly report
`operationAccepted: false` and `operationIdConsumed: false`; accepted results,
including durable review blockers, report the corresponding accepted receipt.

Interrupt at any point; `/flow-run` resumes the next approved feature. On the
final feature Flow requires broad project-level validation and a final review
whose depth matches the approved plan before the session can close as
completed.

## Commands

| Command | Purpose |
| --- | --- |
| `/flow-auto <goal>` | Drive the authorized loop; stop after planning when requested. |
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

The plugin exposes nine tools. `flow_guidance` is read-only and returns embedded
Markdown; the other eight form the runtime surface:

| Tool | Purpose |
| --- | --- |
| `flow_guidance` | Load exact package-owned guidance by stable id. |
| `flow_status` | Read the active session and next action. |
| `flow_plan_save` | Create a session or update its active same-goal draft. |
| `flow_plan_approve` | Approve the draft plan. |
| `flow_run_start` | Start the next runnable feature. |
| `flow_review_start` | Bind validation to current source and create a runtime-owned reviewer assignment; final review also binds the passing feature result. |
| `flow_feature_complete` | Atomically record a completed or blocked assignment result. |
| `flow_feature_reset` | Reset one feature and its dependents. |
| `flow_session_close` | Archive the active session as completed, deferred, or abandoned. |

Only the root manager calls `flow_review_start`. Reviewers recover the exact
assignment with
`flow_status { request: { view: "reviewer", assignmentId } }` and return only
the assignment id, verdict, typed findings, reported time, and terminal
disposition. The runtime derives all attempt, pass, source, packet, run,
start-time, and required-depth identity. Final assignment creation durably binds
the exact passing feature-assignment result. The final feature outcome submits
only the final-assignment result; Flow records both results atomically from the
durable binding.

The first final assignment pins that binding for every same-source final-review
retry. A manager recovering context loads detail status and copies
`workflowData.projection.finalReviewRetry.prerequisite.result` unchanged into
the new final review start's `request.featureReview`. Compact and reviewer views
omit the aggregate. A mismatch records nothing and leaves its operation id
reusable; a source edit requires a new targeted feature-review sequence.

## What the runtime enforces

The runtime owns only safety; judgment lives in package-owned guidance:

- `.flow/session.json` is the single source of truth; writes are locked and
  atomic, and closed sessions are archived under `.flow/history/`.
- Plans cannot be changed after approval.
- A different-goal plan save cannot replace an unclosed session, including an
  unapproved draft. Close it explicitly as `deferred` or `abandoned` and finish
  archive publication before saving the new goal.
- Only one feature run can be active at a time; reset preserves its audit
  history but the next start receives a fresh run id.
- Reviewer assignment requires source-bound passing validation: `targeted` for
  feature review and `broad` for final review. A source edit invalidates stale
  pending review work when its replacement is created.
- Feature outcome uses a nested `completed` or `blocked` result. Invalid or stale
  input records nothing and does not consume its operation id.
- Each OpenCode handler validates the registered nested schema again at entry;
  invalid host invocations fail as tool errors before Flow state I/O.
- The runtime derives review depth from the approved plan and owns assignment,
  attempt, logical-pass, packet, source, and start-time identity.
- Failed reviews are bounded: an accepted blocker returns operation status
  `ok`, and autonomous repair is limited to one repair plus one retry before
  the feature blocks.
- Review exhaustion uses the ordinary blocked-feature state; continuing requires
  an explicit `flow_feature_reset`, not a second checkpoint protocol.
- A passing final feature outcome marks progress completed but leaves closure null;
  `flow_session_close` exclusively records and archives it.
- Once a closure is recorded, the session is archive-only. If publication fails,
  compact status supplies `closure.retryOperationId`; retry only with
  `flow_session_close { request: { mode: "retry", operationId } }`. No new
  close, run, reset, approval, or replan can reopen or adopt it.
- A new close operation id must be absent from the active causal chain and every
  mutation in canonical Session v4 workspace history. Any archived match is a
  collision; malformed or ambiguous canonical history fails closed before
  active state changes.
- Archive publication requires explicit non-null closure. Closureless Session
  v4 state may remain active, but it is rejected as canonical history and makes
  canonical lookup fail closed if found there.
- Every closure is quiescent: no active execution or pending review assignment
  remains. A session can close as `completed` only after the final feature
  outcome has passed.
- Actor-reported validation and review times must follow run, validation, and
  assignment order and cannot postdate the runtime acceptance time.
- Session locks fail closed: Flow never guesses that an old lock is abandoned,
  and only the unique owner may release it. Only a valid Session v4 document can
  become active state; canonical history additionally requires explicit
  non-null closure.
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
`result.orchestrationPasses` with candidate eligibility, decision, and structured
factors. Bounded projections report the relevant aggregate while full worker
handoffs remain outside `.flow/**`.

## Install details and legacy cleanup

See [docs/troubleshooting.md](docs/troubleshooting.md) for updates,
older-OpenCode install fallback, stuck session recovery, and removal of global
Flow skill folders left by v4.

To update a pinned Flow version, rerun the install command with the new version.
Flow starts with the new package-owned guidance immediately; no second restart
or sync command is required. To preview recoverable migration of pristine v4
global skill folders:

```bash
npx -y opencode-plugin-flow@5.2.1 legacy-cleanup --dry-run
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
