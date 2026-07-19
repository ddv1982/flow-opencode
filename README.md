# Flow Plugin for OpenCode

`opencode-plugin-flow` gives OpenCode a durable, resumable planning-and-execution
loop for larger coding work: plan a goal as discrete features, approve the plan,
then implement one feature at a time with enforced validation and review
evidence. State lives in `.flow/session.json`, so a session survives restarts,
model switches, and context loss.

The design is guidance-first: package-owned Markdown carries planning,
execution, validation, review, and orchestration judgment, while the plugin
runtime stays bounded and policy-focused — it keeps the session ledger and
enforces the hard gates prompts should not be trusted to remember.

The maintained documentation starts at [docs/index.md](docs/index.md). The
tracked `droid-wiki/` tree is an archived generated snapshot and is not a
current product or contributor contract.

## Quick start

```bash
npx -y opencode-plugin-flow@5.3.1 activation-apply \
  --project "$PWD" --scope global
npx -y opencode-plugin-flow@5.3.1 activation-apply \
  --project "$PWD" --scope global --apply
npx -y opencode-plugin-flow@5.3.1 activation-check --project "$PWD"
```

The first command is a read-only plan. Review it before running the second;
the final check must report exactly one active `opencode-plugin-flow@5.3.1`
source and no proven inactive Flow cache artifacts. Use `--scope project` when
the one canonical pin should live with the project instead of in global config.
Flow refuses ambiguous local wrappers, cache entries, unsafe links, and config
it cannot change conservatively rather than guessing which copy is authoritative.

To select npm's current release instead of this release-pinned example, replace
`@5.3.1` with `@latest` on the `npx` invocations; do not pass
`--target latest`. The fetched CLI resolves its own embedded exact version and
converges every mutable Flow activation to that one pin, so latest replaces an
older active version rather than loading beside it.

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
  flow_validation_start
                    command: exact next Bash command
                    coverageScope: focused
  bash              exact armed command
                    [flow-validation-receipt] immutable receipt reference
  flow_review_start request.validationRefs: [receipt reference]
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

The plugin exposes 12 tools. Nine own the durable lifecycle; three add bounded
harness admission, runtime-attested validation, and deterministic audit
rendering:

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
| `flow_orchestration_admit` | Evaluate and arm one bounded optional-worker proposal for the active harness profile. |
| `flow_validation_start` | Arm capture for the exact next Bash command against current causal guards, feature run, and source. |
| `flow_audit_render` | Validate `AuditLedgerV1` and render its reconciled Markdown deterministically. |

Only the root manager calls `flow_review_start`. Reviewers recover the exact
assignment with
`flow_status { request: { view: "reviewer", assignmentId } }` and return only
the assignment id, verdict, typed findings, reported time, and terminal
disposition. The runtime derives all attempt, pass, source, packet, run,
start-time, and required-depth identity. Final assignment creation durably binds
the exact passing feature-assignment result. The final feature outcome submits
only the final-assignment result; Flow records both results atomically from the
durable binding.

Validation input is no longer a caller-authored success claim. Immediately
before a check, call `flow_validation_start` with the exact command and current
guards, execute that exact command as the next Bash call, and copy the emitted
immutable receipt reference into `flow_review_start.request.validationRefs`.
Flow verifies receipt bytes, run, feature, current source, host-observed exit,
output completeness, and scope before materializing Session v4 evidence. A
failed, truncated, missing, stale, altered, or duplicate receipt is rejected
without consuming the review-start operation id.

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
- Validation receipts are host-attested from the exact next Bash execution.
  Callers cannot supply validation timestamps, exit status, command class, or
  output digest to `flow_review_start`.
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
- Host-observed validation times and reviewer-reported result times must follow
  run, validation, and assignment order and cannot postdate runtime acceptance.
- Session locks fail closed: Flow never guesses that an old lock is abandoned,
  and only the unique owner may release it. Only a valid Session v4 document can
  become active state; canonical history additionally requires explicit
  non-null closure.
- Flow writes `.flow/.gitignore` so session state stays out of Git by default.
- `.flow/session.json` is the only active-state representation. Canonical Flow
  commands call `flow_status` before acting; plugin configuration does not read,
  refresh, or project workspace state.
- Exactly one Flow runtime instance may operate in an OpenCode process. If
  duplicate copies load, every copy fails closed; the highest semantic version
  is named only as a diagnostic leader and does not become operational.

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

The trusted command footer selects one harness profile with
`OPENCODE_FLOW_HARNESS_PROFILE=control|standard|assurance` (default
`standard`) and one admission rollout with
`OPENCODE_FLOW_ROLLOUT_MODE=control|observe|enforce` (default `observe`).
`control` preserves discretionary optional-worker behavior without admission
ceremony. `standard` admits a small bounded discovery/challenge path;
`assurance` permits broader bounded evidence and audit coverage when risk
justifies it. In `observe`, a policy violation is reported but does not block;
in `enforce`, the exact admitted optional worker class and count must be
dispatched. Lifecycle-required reviewer and validation workers are not optional
passes and do not use orchestration admission. Validation receipts remain
mandatory in every profile.

Hidden worker routing can be tuned without changing the domain contract. Set
`OPENCODE_FLOW_READONLY_WORKER_MODEL`,
`OPENCODE_FLOW_REVIEW_WORKER_MODEL`, or
`OPENCODE_FLOW_CANDIDATE_WORKER_MODEL`, with
`OPENCODE_FLOW_WORKER_MODEL` as the fallback. Matching `*_WORKER_STEPS`
variables set OpenCode's current `steps` limit; values must be integers from 1
through 1000.

For broad implementation, the manager records whether work stayed serial,
used exact-path candidate workers, used isolated worktrees, ran a tournament, or
skipped eligible candidates. Feature completion can carry bounded
`result.orchestrationPasses` with candidate eligibility, decision, and structured
factors. Bounded projections report the relevant aggregate while full worker
handoffs remain outside `.flow/**`.

## Install details and legacy cleanup

See [docs/troubleshooting.md](docs/troubleshooting.md) for updates,
activation refusal and duplicate-runtime recovery, stuck session recovery, and
removal of global Flow skill folders left by v4.

To update, run the same `activation-apply` dry-run/apply/check sequence with the
new exact package version. The activator inventories OpenCode's global, project,
`.opencode`, custom, inline, and readable managed configuration; singular and
plural plugin directories; and the Flow package cache. It preserves unrelated
plugins, removes recognized Flow config entries outside the selected canonical
scope, and moves only marker-proven wrappers and proven inactive cache artifacts
to recovery locations. Applied changes receive backups and a recovery journal.
Sources that cannot be proved safe—including unknown wrappers, ambiguous cache
artifacts, JSONC that would require a lossy rewrite, inline config, and
administrator-managed config—produce manual remediation instead of mutation.
If an applied multi-source change fails, Flow attempts exact safe rollback and
records either `rolled-back` or `rollback-failed` in the recovery journal;
concurrent or unsafe state is preserved for manual recovery. Remote and
managed-preference sources that cannot be decoded offline remain covered by
fail-closed runtime leadership.

To preview recoverable migration of pristine v4 global skill folders:

```bash
npx -y opencode-plugin-flow@5.3.1 legacy-cleanup --dry-run
```

## Development

```bash
bun install
bun run check        # typecheck + lint + release metadata + prompt quality + build + tests
bun run harness:report # sanitized control/candidate resource and quality status
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
