# Maintainer Contract

This document defines the small set of invariants Flow v6 must preserve.

## Product boundary

Flow is a serial durable workflow plugin, not a general orchestration framework.
It owns planning state, one active run, observed validation, one independent
review, reset, and closure. Implementation inside that run may use one bounded,
ephemeral host-native worker wave. Flow exposes ten tools, five commands, four
guides, and two hidden subagents.

An active Flow session is authoritative for its goal until an explicit close
records completed, deferred, or abandoned disposition. The manager must not
silently continue that goal through an ordinary non-Flow workflow. Runtime
`nextAction` is durable default workflow direction, not a new permission grant.
Environment-sensitive transition guards remain authoritative when a mutation is
attempted.

Before every manager-owned lifecycle mutation, including direct `/flow-plan` or
`/flow-run` use, the manager compares the compact-projected goal with the current
request. Exact projected recovery of an already-accepted close runs first and
grants no authority for new work. The comparison is a semantic judgment made by
the manager, not a runtime intent classifier. A continuation or compatible
narrowing may proceed. A materially new or expanded request causes no mutation
and has not started; the manager offers to continue, defer, or abandon the
active work. A completed but unclosed session is closed as completed before a
new request begins. A same-goal approved plan-only request reports the immutable
plan and current progress, then stops without saving, approving, or starting a
run.

Within existing implementation authority, the manager continues after plan
approval and each passing feature outcome. Only the first in-scope recorded
failed review may be reset and retried automatically as one fresh full run. A
`[scope-blocker]` checkpoints immediately; any other blocking finding is
in-scope by default. A second recorded failed review for the feature projects
`await-user-direction`: the
manager reports the blockers and waits for explicit user direction before one
additional attempt. It does not leave Flow while waiting. It otherwise pauses
only for a material product or scope choice, missing authority for an external
Git or release action, a hard operational failure, or the user's explicit choice
of deferred or abandoned closure. Only the user may select either non-completed
disposition.

Flow does not own plugin installation, automatic activation, cache cleanup,
configuration repair, optional worker admission, audit schemas, benchmark
promotion, replay reporting, narrow correction protocols, durable wave state,
worker recovery, concurrent active features, or cross-version active-state
migration. It also owns no persisted request-intent classifier, retry counter,
or delivery document.

## Session v5

- Session v5 is the only active schema. Older documents never hydrate as active
  state and old archives never authorize work.
- Within Session v5, compatibility runs from older writer to newer reader. An
  older Flow build is not a supported reader after a newer build writes values
  beyond its historical bounds. In particular, a run may retain 64 exact
  planned gates plus one separate broad observation. Users must finish or close
  active work before downgrade; Flow adds no rollback capability layer.
- A plan is a bounded DAG and is immutable after approval.
- If implementation would require material scope outside an approved plan, stop
  editing. Finish the approved plan or explicitly close it before creating a
  different plan; never replan the active approved session in place.
- A feature run is the canonical attempt aggregate. It contains validation,
  review, result, and artifacts; status and progress are derived.
- Runs remain in strictly increasing durable start-revision order, so derived
  latest-attempt delivery cannot disagree with canonical progress.
- At most one run is active. Dependencies must be complete before a run starts.
- A failed review blocks the run. Reset supersedes the selected feature and its
  dependent runs; the next attempt starts empty. Automatic convergence is
  bounded by recorded failed review results: only the first in-scope failure may
  retry automatically, `[scope-blocker]` checkpoints immediately, and the second
  failure projects `await-user-direction` before another user-authorized attempt.
  Pre-review resets and rejected stale-source submissions do not increment that
  derived count.
- Completed close is allowed only after every feature has a passing current run.
  Deferred and abandoned close explicitly supersede active work.

## Causality and idempotency

Every accepted mutation advances one nonnegative revision. Mutation requests
carry the expected revision and a stable operation ID. An exact previously
accepted request resolves to the same durable entity at its current projection
without another mutation. Reusing the ID for another kind or payload fails.
Rejected work does not consume the operation ID.

Revision and durable record order are authoritative. Session correctness must
not depend on UTC time, model-provided time, elapsed duration, or timestamp
repair.

## Validation and review

`flow_validation_start` prepares the active run, exact next Bash command, scope,
and current workspace-content digest. The OpenCode after-hook accepts only a
structured exit code, records output completeness and digests the output. The
observation is persisted directly on the run.

Validation commands are durable and must not contain inline secrets. Raw output
is neither persisted nor projected; the command, exit code, completeness,
output digest, and source binding are the evidence. `broad` means the
repository's canonical applicable gate or a justified equivalent, not merely a
caller label.

A command becomes an exact planned command only when its stored bytes equal one
entry in the active feature's validation list; Flow does not parse validation
prose into commands. Once that exact command has failed or produced incomplete
output on any attempt, reset preserves the known failure. Prospectively, a new
review remains unavailable until the active run has a latest complete exit-zero
observation of that same command for the review's current source; a different
passing broad command cannot discharge it. Accepted same-schema Session v5
pending or completed reviews are grandfathered. Flow neither reopens them nor
adds a retroactive planned-gate veto during completion or close.

An armed capture waits at most 15 minutes for its exact Bash command to begin.
An unrelated Bash command cancels it. Once the exact command begins, the
after-hook remains eligible even if the command finishes after that original
waiting deadline. Session, run, source, exit-code, and output-completeness gates
still apply.

Only exit-zero, complete validation for the review's current source is
applicable. Final review additionally requires broad scope. A source change
during validation prevents recording; a source change after assignment prevents
completion.

Each run has at most one review assignment. The runtime derives `feature` or
`final`; callers do not choose it. The hidden reviewer receives approved plan
context, its full assignment, declared artifacts, assignment-linked validation,
and completed feature IDs. It is workspace-read-only; its allowed Flow tools are
`flow_status` and `flow_feature_complete`, while its guidance restricts status
use to the assigned reviewer view. The platform accepts a new completion only
from the reserved reviewer identity. While that Session v5 workflow remains
active, every caller with tool access may receive the read-only result of an
exact previously accepted completion request without validation cancellation or
a session write. A failed verdict requires an evidence-backed blocking finding;
a passed verdict cannot contain one.

New reviewer guidance uses only an optional `[scope-blocker]` summary marker
when satisfying a blocking finding would require material work outside the
approved plan. All other routing comes from the existing severity and recorded
failure count. This remains a convention inside the finding shape, not a
structured Session or audit schema.

`artifactsChanged` is a caller declaration associated with the review
assignment. Flow validates bounded normalized workspace-relative paths, but it
does not prove that each path exists or changed and does not infer an exhaustive
Git delta. User-facing delivery therefore calls them Flow-reported artifacts and
separates paths reported by latest attempts from paths reported only by
superseded attempts.

Result submission is the reviewer's sole lifecycle mutation. `flow_status` may
fail-closed quarantine unreadable active state; that is recovery maintenance,
not a lifecycle transition.

The manager creates and dispatches the assignment, then reads compact status;
it never copies or submits the verdict. A pending assignment may be redispatched
after interruption or an unconfirmed reviewer return. A source-binding failure
instead requires reset, fresh validation, and a new review.
Manager status rechecks workspace content only while a review is pending and
projects `flow_feature_reset` when that assignment's source binding is stale.
If fingerprinting is unavailable, status fails closed with repair guidance and
does not recommend redispatch.
Observed-but-unsubmitted work fails closed. [ADR
0007](adr/0007-reviewer-owned-submission.md) records the rationale.

Every host-observed validation advances the revision indirectly through the
after-hook. The manager must refresh compact status after each observation and
before another validation or review mutation; the revision used to arm the
command is no longer current.

## Bounded worker waves

Serial means one durable active feature run and one authoritative combined
validation/review chain. The manager works serially by default, but may delegate
two or three exact, non-overlapping slices to one initial `flow-worker` cohort
when parallel work has clear benefit, and at most one targeted follow-up cohort.
Existing implementation authority covers a qualifying wave; workers need no
separate user approval.

Workers contribute only inside their assigned boundary. The manager owns shared
files, integration, evidence acceptance, the combined diff, authoritative
validation, and review dispatch. Ordinary worker edits are allowed so a cohort
can run without approval interruptions; Bash, `.flow` and `.git` metadata
paths, nested delegation, and Flow-state tools are denied. Exact per-assignment
paths remain a prompt contract because one static reusable agent cannot express
a dynamic file ACL; the manager audits assigned versus changed paths after
every cohort. No wave state is persisted; after interruption, ordinary status
and worktree inspection remain authoritative.
[ADR 0006](adr/0006-bounded-intra-feature-waves.md) records the rationale and
rejected heavier designs; the package's `flow-run` guidance is the executable
manager contract.

## Persistence

- Workspace resolution is canonical and project-scoped.
- `.flow` and managed files are not followed through symbolic links.
- One cross-process project lock protects transactions.
- Session writes validate the complete schema and use atomic replacement with
  durability sync where supported.
- Unreadable active state is quarantined instead of overwritten.
- Close first records the terminal state durably, then publishes a no-overwrite
  archive and clears active state; compact status projects the exact retry
  request needed to converge after interruption.
- Exact active close replay confirms that the canonical active bytes still
  match, synchronizes the file and `.flow` durability boundary, and does not
  rewrite the Session. Exact archived replay re-synchronizes no-overwrite
  publication and active cleanup, including when cleanup is already absent. A
  delayed replay must not clear a different active session.
- An archive or active-state collision preserves both documents and returns
  `manualRecoveryRequired` with no `archiveRetry`; callers stop automatic retry
  rather than overwrite or delete either side. Closed status re-derives an
  archive collision from the existing history document, so interruption cannot
  restore automatic retry. This behavior adds no persisted recovery state.
- Every close path whose terminal state was durably accepted returns the same
  derived `workflowData.delivery`: initial success, archive-pending recovery,
  exact retry, and delayed replay from history. The projection contains the
  goal, closure, completed/total progress, every planned feature's attempt count,
  latest outcome, terminal findings, and Flow-reported artifact groups.
- Delivery is recomputed from the canonical closed Session or archive. It is not
  written into Session v5 or archive JSON and is not a report artifact unless
  the user separately requests one.
- Source identity hashes sorted effective workspace path/type/content tuples;
  `.git` and `.flow` are excluded. It is a content fingerprint, not a Git audit
  chain.
- Source identity requires a readable Git worktree and rejects tracked
  submodules explicitly.
- A timed-out project lock fails closed. Automatic stale-lock stealing is not
  allowed because ownership cannot be reclaimed without a race.

## OpenCode surface

Compact `flow_status` includes the active goal so the manager can align the
current request before mutation. When blocked, it also includes
`blockedFeature.featureId`, the latest attempt number, and a
`failedReviewCount` derived only from recorded failed review results. No intent
classification or retry budget is persisted. After the second failure its
`nextAction` is `await-user-direction`. The manager checkpoints a
`[scope-blocker]` immediately without persisting tag-specific state. On the
first failure, compact `flow_feature_reset` is only the count-derived default;
the manager reads detail once before reset, and a scope-blocker refines that
default to a checkpoint.

### Commands

| Command | Contract |
| --- | --- |
| `flow-auto` | Normal end-to-end driver for the authorized lifecycle. |
| `flow-plan` | Plan-only/advanced creation, revision, and approval; same-goal approved plans are reported without mutation. |
| `flow-run` | Advanced/recovery execution of one approved feature after request alignment. |
| `flow-review` | Internal/recovery dispatch for a runtime-created reviewer assignment. |
| `flow-status` | Advanced/recovery projection of compact durable state and the next action. |

`flow-review` stays in the public inventory because OpenCode dispatches the
reserved reviewer through it and recovery may need it. It is not an ordinary
user starting point.

### Tools

| Tool | Contract |
| --- | --- |
| `flow_guidance` | Load one package-owned guide. |
| `flow_status` | Read compact, execution, detail, or reviewer state; compact state includes the goal and derived blocked convergence summary. |
| `flow_plan_save` | Create or replace the active draft plan. |
| `flow_plan_approve` | Approve and lock the draft plan. |
| `flow_run_start` | Start one runnable approved feature. |
| `flow_validation_start` | Arm observation of the exact next Bash command. |
| `flow_review_start` | Create the run's independent review assignment. |
| `flow_feature_complete` | Reviewer-only new result submission; exact accepted requests remain read-only replays while the Session v5 workflow is active. |
| `flow_feature_reset` | Supersede a failed attempt for a fresh full retry. |
| `flow_session_close` | Close and archive the session, returning the same concise derived delivery on every durably accepted close path. |

The nine lifecycle tools accept a nested `request`, return state under
`workflowData`, and require the current revision plus a stable operation ID for
mutations. `flow_session_close` additionally returns derived delivery under
`workflowData`; `flow_guidance` instead accepts a guide ID and returns Markdown.

### Guides

| Guide | Contract |
| --- | --- |
| `flow` | Manager orientation and authority boundary. |
| `flow-plan` | Planning and conversational approval. |
| `flow-run` | Serial execution and optional bounded waves. |
| `flow-review` | Independent review of one runtime assignment. |

### Hidden agents

| Agent | Boundary |
| --- | --- |
| `flow-worker` | Bounded implementation contribution; ordinary edits are allowed, while Bash, `.flow` and `.git` metadata paths, external-directory access, skills, delegation, and Flow tools are denied. |
| `flow-reviewer` | Independent workspace-read-only inspection; only `flow_status` and its exact `flow_feature_complete` lifecycle submission are allowed among Flow tools. |

User configuration may select the reviewer's model and step budget with
`OPENCODE_FLOW_REVIEWER_MODEL` and `OPENCODE_FLOW_REVIEWER_STEPS`.

Duplicate plugin instances for the same canonical project fail closed through a
small process-global guard. Instances for different projects do not conflict.
The guard does not elect a winning version or modify configuration.

## Distribution and release

The public package is loaded through OpenCode's ordinary npm plugin
configuration and native plugin command. Flow ships no installer CLI and
performs no startup activation, cache cleanup, inventory, version election, or
automatic repair.

The deterministic local gate is `bun run check`. CI keeps a normal Linux check,
targeted platform persistence coverage, dependency and workflow checks, a real
OpenCode live smoke, package smoke, and release publication. Removed lifecycle
soaks, prompt evaluators, harness promotion, replay, and cross-version active
session gates must not return without a new ADR that removes an equal or larger
amount of product machinery. Bounded-wave coverage should test the real agent
permissions, manager guidance, and host-visible configuration without adding a
scheduler or tests-of-tests.

See [Model-driven wave evidence](development.md#model-driven-wave-evidence) for
the manual canary policy.
