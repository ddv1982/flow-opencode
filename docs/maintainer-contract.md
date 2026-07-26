# Maintainer Contract

This document defines the small set of invariants Flow v6 must preserve.

## Product boundary

Flow is a serial durable workflow plugin, not a general orchestration framework.
It owns planning state, one active run, observed validation, one independent
review, reset, and closure. Implementation inside that run may use one bounded,
ephemeral host-native worker wave. Flow exposes ten tools, five commands,
four guides, and two hidden subagents. Active work uses only the root manager
and the reserved `flow-worker` and `flow-reviewer` roles; generic agents are not
part of the Flow execution model.

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
approval and each passing feature outcome. Under `/flow-auto`, compact `ready`
and `completed` projections are mechanical loop states, not user handoffs: the
manager starts the next runnable feature or closes the session in the same
authorized auto drive. An internal host-triggered continuation may cross model
turns from idle only after a same-host accepted non-replayed `flow_plan_save`
establishes the created Flow session. For an active provisional baseline,
temporal progress in that same session lets a dispatched pending reviewer submit
its owned result without pretending reviewer submission is manager provenance.
An unchanged already-ready baseline or replacement session fails closed.
Planning awaiting `flow_plan_approve` and any
`await-user-direction`, whether blocked or ready, remain conversational
checkpoints. A clarification ending at the same recognized checkpoint revision
re-arms waiting without auto-routing; a reply resumes only after it advances the
same session to a mechanical state through an accepted non-replayed manager
mutation observed in that OpenCode host session. The mutation is credited only
when the tool assistant ID resolves through the cached `message.updated`
`parentID` to the authoritative user reply; a missing mapping or mismatch fails
closed. Another host cannot establish that reply authority, though a reviewer
child may contribute only the one state-constrained successor revision after an
authenticated `flow_review_start`; every other mechanical projection must equal
the credited mutation revision. Compaction transfers authority only
after the same host authenticates the trigger assistant → automatic compaction
marker → summary assistant → successor user lineage while the captured
authority remains unchanged. Missing, stale, or unrelated lineage fails closed.
This provenance remains process-local and adds no Session v5 field. Flow never
returns “ready for the next feature” while that proven lease can safely start
it.

`/flow-auto stop` and `/flow-auto cancel` revoke only the process-local lease in
that OpenCode session. They do not mutate or close the durable Flow session.

Initial auto/run prompts, compaction context, and synthetic continuations share
one concise manager kernel: root ownership of manager mutations and
reviewer-owned result submission, reserved Flow roles, the exact
`failedReviewCount === 1` retry gate, and current-source plus relevant base-diff
evidence. This
repetition adds no runtime role registry or durable policy state.

A feature whose latest relevant reviewed outcome remains failed is never
selected implicitly. `/flow-auto` may continue an untouched,
dependency-independent feature; when only retry-required candidates remain,
compact status is `ready` with `await-user-direction`. An automatic fresh full
retry is allowed only as the Session v5 convergence bound below permits. At a
blocked checkpoint, optional `nextFeatureId` on `flow_feature_reset` names the
exact authorized retry or independent feature, and reset plus run start occur in
one transaction. If that reset selects independent work, then all untouched work
finishes, the failed run is already superseded; ready `await-user-direction`
resumes an authorized retry through
`flow_run_start(featureId)`, not another reset. The session remains authoritative
while waiting. Flow otherwise pauses only for a material product or scope
choice, missing authority for an external Git or release action, a hard
operational failure, or the user's explicit choice of deferred or abandoned
closure. Only the user may select either non-completed disposition.

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
- Stable finding, issue, and requirement IDs supplied by the source request
  remain verbatim in saved feature summary or validation prose so each ID is
  traceable to an immutable outcome and its evidence.
- If implementation would require material scope outside an approved plan, stop
  editing. Finish the approved plan or explicitly close it before creating a
  different plan; never replan the active approved session in place.
- A feature run is the canonical attempt aggregate. It contains validation,
  review, result, and artifacts; status and progress are derived.
- Runs remain in strictly increasing durable start-revision order, so derived
  latest-attempt delivery cannot disagree with canonical progress.
- At most one run is active. Dependencies must be complete before a run starts.
- A failed review blocks the run. Reset supersedes the selected feature and its
  dependent runs; an optional exact `nextFeatureId` starts the chosen runnable
  feature in the same transaction, and its new run starts empty. A failed
  feature is excluded from implicit selection while its latest relevant reviewed
  outcome remains failed; untouched dependency-independent features remain
  eligible. Automatic convergence is bounded by recorded failed review results:
  only `failedReviewCount === 1` without a `scopeBlocker` finding may retry
  automatically; every scope blocker or count of two or greater projects
  `await-user-direction` before another user-authorized attempt. When all
  runnable candidates require an explicit retry, status is `ready` and also
  projects `await-user-direction`. Detail identifies the failed feature from
  durable runs; explicit `flow_run_start(featureId)` begins that retry without
  reset. Pre-review resets and rejected stale-source submissions do not
  increment the derived count.
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

`flow_status` may add timing for the latest `/flow-auto` invocation in the
current plugin process to top-level workflow data. `activeMs` is process-local
wall time while the coordinator classifies the lease as active, not CPU time or
pure coding time. `waitingForUserMs` counts only recognized projected
`flow_plan_approve` and `await-user-direction` checkpoints. Paused, inactive,
errored, and unprojected waits are excluded. Timing resets on plugin reload,
never enters Session v5 or a projection, and never authorizes or blocks a
transition.

## Validation and review

Before implementation, the manager inventories every exact and
behavior-oriented evidence requirement, its required environment, and its
authorized execution path. It also prepares an adversarial acceptance and risk
checklist covering failure ordering, adjacent state transitions, repeated and
interrupted operations, overlapping feature invariants, and relevant
platform/file-mode risks. That checklist is supplied to every worker before
editing and later to review. Concurrency and state-machine work expresses the
bounded checklist as a matrix of state/interleaving, event, expected outcome,
cleanup/invariant, and evidence. Race-heavy lifecycle invariants are planned
separately from independently acceptable UI, persistence, or accessibility
outcomes.

The manager reuses one conversational baseline inventory across a run and
refreshes changed facts. A feature review receives only baseline facts it
changes or depends on; final review receives the full inventory. Its bounded
packet maps IDs to current-source evidence, carries the feature risk checklist
represented as a transition matrix when applicable, and preserves prior finding
dispositions. Empty optional sections are omitted rather than repeated as a text
manifest.

When resuming attempt 2 or later without prior findings in conversation, the
manager reads detail once and recovers their IDs from superseded runs before
preflight.

When required behavior or environment evidence is knowingly skipped,
unavailable, or inapplicable, manager workflow policy forbids calling
`flow_review_start` even when a substitute broad command passes. If such a gap
reaches review, the reviewer records proof required to approve the outcome as a
precise blocker. The runtime persists no skipped-evidence field and does not
derive this policy as an admission gate. Missing external evidence checkpoints
for user direction. The existing reset or explicit closure path handles the
user's decision; Flow adds no parallel blocker ledger.

`flow_validation_start` prepares the active run, exact next Bash command, scope,
and current workspace-content digest. The OpenCode after-hook accepts only a
structured exit code, records output completeness and digests the output. The
observation is persisted directly on the run.

Validation commands are durable and must not contain inline secrets. Raw output
is neither persisted nor projected; the command, exit code, completeness,
output digest, and source binding are the evidence. `broad` means the
repository's canonical applicable gate or a justified equivalent, and claiming it
binds the claimant.

A failed, incomplete, or source-drifted observation creates a freshness boundary
for its command across attempts. Prospectively, review remains unavailable until
the active run holds a complete exit-zero observation of that same command which
matches the review's current source and is newer than the latest relevant
failure or drift. Returning to an older source digest does not revive a pass
from before that boundary, and no other passing command discharges it — neither
a substitute broad gate nor a narrower command relabelled `broad`. Two command
sets are vetoed this way: any command whose stored bytes equal an entry in the
active feature's validation list, since Flow does not parse validation prose
into commands, and any command an observation recorded at `broad` scope.
Accepted same-schema Session v5 pending or completed reviews are grandfathered;
Flow neither reopens them nor adds a retroactive veto during completion or close.
[ADR 0009](adr/0009-scope-keyed-validation-veto.md) records why the label binds.

An armed capture waits at most 15 minutes for its exact Bash command to begin.
An unrelated Bash command cancels it. Once the exact command begins, the
after-hook remains eligible even if the command finishes after that original
waiting deadline. Session, run, source, exit-code, and output-completeness gates
still apply.

Final review additionally requires broad scope. If the workspace digest
recomputed at persistence differs
from the digest recorded when validation was armed, the observation is recorded
as source-drifted and permanently ineligible. This endpoint comparison does not
detect a transient edit that returns to the armed bytes before persistence.
Review completion likewise fails when its recomputed current digest differs
from the assignment digest.

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

Reviewer guidance explicitly covers before/during/after state transitions,
failure and cleanup ordering, repeated/retried/interrupted/concurrent
operations, invariants shared with overlapping features, changed artifacts, and
the manager-supplied base-diff inventory including deletions, renames, file
types, and executable modes. The reviewer treats that inventory as evidence,
not a verdict, and does not fail merely because its isolated role has no shell.
When the packet omits a relevant fact, conflicts with inspectable artifacts, or
cannot prove a material claim, the reviewer fails with a precise
missing-evidence finding naming the manager-owned reproduction, environment,
and expected observable result. It does not pass conditionally.

A finding carries an optional `scopeBlocker` boolean, valid only on a blocking
finding, set when satisfying it would require material work outside the approved
plan. The projection surfaces it as `blockedFeature.scopeBlocker` and `nextAction`
accounts for it, so routing is enforced rather than inferred from prose.

Every finding carries a stable identity in its own `findingId` field, as
`<feature-id>.R<assignment-createdRevision>-<NN>`. The reviewer sets it to a
prior ID for recurrence and omits it for a new issue, which the runtime numbers;
that composition prevents reuse after a qualifying pass drops history. The
reviewer projection supplies the still-live set as `priorFindings` with
`nextFindingIdPrefix`, each carrying its latest severity, summary, and evidence,
so carry-forward never depends on packet prose, and `flow_feature_complete`
rejects a failed result that drops a live prior ID. A passing review clears every
ID it does not repeat. The reviewer checks each claim
against current source and evidence and completes the supplied risk checklist
through its bounded matrix when applicable so independently detectable issues can
arrive in one cohort. An ordinary-review summary preserves only plan/source IDs
mapped to the active feature or explicitly supplied in its packet; a final-review
summary preserves every approved requirement or feature ID. Both report each
still-live prior finding's severity and disposition. Only a passing verdict with
current evidence may state terminal `fixed`. On a failed verdict, if repair F1 is
proven but blocker F2 fails the review, F1 remains `repair proven; terminal fixed
pending pass` with a concise evidence reference. An unproven fixed claim is marked unverified; `recurring` requires
current recurrence and `residual` a confirmed nonblocker. The summary becomes
the latest `outcomeSummary`; terminal findings retain unresolved blockers. Only
IDs fixed by a passing review leave the live carry-forward set.

A fresh close constructs its request from the compact-projected session id and
revision, a fresh operation id, the selected closure kind, and an optional
summary. An `archiveRetry` instead replays only its compact-projected request
byte-for-byte. Both run first without a prerequisite detail read. The accepted
response returns terminal data through the existing concise
`workflowData.delivery`; its latest `outcomeSummary` and terminal findings
supply only the plan-bounded, terminal-only conversational disposition map. If
delivery is absent, the manager reports the exact recovery and claims no map. A
close revision conflict requires a compact refresh. Retry only after confirming
the same session and goal while
status still permits the selected closure kind; it never closes a replacement.
`fixed` requires later passing independent review and current-source evidence;
`residual` means a confirmed nonblocking issue remains; `deferred` requires
explicit user authority for non-completed closure; and `abandoned` remains the
actual closure kind. This adds no historical-finding manifest or second ledger.

`artifactsChanged` is a caller declaration associated with the review
assignment. Flow validates bounded normalized workspace-relative paths, but it
does not prove that each path exists or changed and does not infer an exhaustive
Git delta. The rendered delivery `report` therefore labels them Flow-reported and
separates latest-attempt paths from superseded-only paths.

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
after-hook. An accepted `[flow-validation]` marker returns `passed` and the
observation's `recordedRevision`. That revision is only a concurrency token. A
`passed: true` marker may supply it for `flow_review_start` only while all
runtime review gates still hold; it may also arm another validation. Failed,
incomplete, and ineligible markers report `passed: false` and their revision
may arm only fresh validation, never review. An ineligible marker exposes
`ineligibleReason`: `source-drift`, or `exit-code-unavailable` and
`output-completeness-unknown` when the host reports no structured exit code or
truncation flag. Those two record a durable never-passing observation rather than
failing the capture, so Flow stays usable on any host; `exitCode` is `null` for
the first. No compact refresh is needed solely to recover an
eligible token; missing, malformed, or rejected capture and uncertain routing
still require one. The revision used to arm the completed command is no longer
current.

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
every cohort. Every assignment includes the manager's preflighted adversarial
acceptance and risk checklist. Generic agents may not substitute for a
`flow-worker` or the reserved reviewer. No wave state is persisted; after
interruption, ordinary status and worktree inspection remain authoritative.
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
classification, feature hold, or retry budget is persisted. After the second
failure, blocked status has `nextAction: await-user-direction`; the same action
is projected with ready status when every runnable candidate requires an
explicit retry. For either form the manager reads detail once and reports the
retry-required feature or features. While blocked, an authorized choice is passed
as optional `nextFeatureId` so reset and exact run start are atomic. Once ready,
there is no blocked run to reset: explicit `flow_run_start(featureId)` starts
the authorized retry. A reset-only compatibility request never makes the failed
feature eligible for default selection.

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
| `flow_feature_reset` | Supersede a failed attempt and optionally atomically start the exact authorized retry or dependency-independent feature through `nextFeatureId`. |
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
