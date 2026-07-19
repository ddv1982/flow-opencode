---
name: flow-run
description: "Use when an approved Flow plan has a feature to implement, validate, or record in the v5 runtime, and the work is scoped to one active execution. For planning a goal first use flow-plan; for the full goal-to-closure loop or resuming a session use flow."
---

# Flow Run

Use this skill for implementation after a Flow plan is approved. Work one feature at a time.

## Execution runtime availability

If `flow_run_start` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode.

## Start

- Load `flow_status { request: { view: "compact" } }` and read only
  `workflowData.projection`. If `projection.closure.retryOperationId` exists,
  call `flow_session_close { request: { mode: "retry", operationId } }` with
  that complete value and stop.
- When ready, call `flow_run_start`; its receipt only acknowledges the mutation.
- For fresh or resumed running work, call
  `flow_status { request: { view: "execution" } }`. Its projection is the sole
  active-execution scope and supplies
  causal guards through the feature outcome.
- Helper rule: obtain named helper guidance with `flow_guidance`; if that tool is
  unavailable, record the gap and keep the corresponding claims conservative
  instead of simulating its checks.
- Request `flow-deslop` for cleanup/refactor features.
- Request `flow-ui-quality` for frontend, UX, responsive, accessibility, or visual work.

## Implement

- Read the feature `targets`, `summary`, `validation`, dependencies, and plan `requirements`/`decisions`.
- Treat the feature's `reviewDepth` as the minimum review coverage. The runtime
  copies it into the reviewer assignment; do not restate or override it in the
  outcome request.
- Keep edits scoped to the active execution. If new scope appears, stop and replan or defer it to another feature.
- Preserve unrelated user changes in the worktree.
- When a wrong assumption invalidates the feature, use `flow_feature_reset`; do not pile patches onto a bad path.
- For a findings-report audit, request the audit rubric, make strict
  `AuditLedgerV1` the source of truth, and call `flow_audit_render`; use its
  canonical Markdown and derived summary without hand reconciliation.
- Do not stage, commit, push, amend, rebase, publish, or mutate releases as part
  of feature execution. If the user explicitly asks for commit preparation, request
  `flow-commit` through `flow_guidance` only after `flow_feature_complete` has been recorded, unless the
  user explicitly asks for a WIP commit path. Keep Git boundaries separate from
  Flow state recording.

## Candidate implementation

`flow-run` remains the candidate-implementation manager entry route. Invoke the
hidden `flow-candidate-worker` only after feature start, a complete pass
manifest, and either the active `control` profile or one admitted
`candidate-implementation` proposal under `standard` or `assurance` covering
the exact candidate workers; never route the user's feature request directly to
it.

For broad, risky, or multi-target work, record an implementation pass decision
before editing: `serial`, `candidate-exact-path`, `candidate-worktree`,
`tournament`, or `skipped`. Candidate implementation requires explicit user
authorization and either an isolated worktree or exact non-overlapping path
ownership. It is eligible only when the slice has an independent surface and
practical validation, with no shared state, overlapping files, or unresolved
manager judgment. Shared contracts, migrations, lockfiles, generated outputs,
tightly coupled callers, unclear ownership, and small slices remain serial.

Classify `candidateEligibility` (`eligible`, `not_eligible`, or `unknown`) and
`candidateDecision` (`used`, `skipped`, or `serial_required`) separately.
Request `flow/references/parallel-decision.md` from `flow_guidance` for valid
pairings and factors. After selecting fan-out, request
`flow/references/parallel-manifest.md` and
`flow/references/parallel-execution.md`, then
`flow/references/parallel-synthesis.md` when handoffs return.
Set `decision`, `decisionReason`, `decisionFactors`, and `writeScope`.

Candidate workers return patches for manager inspection. The manager accepts,
modifies, or rejects them, integrates accepted work, validates, reviews, and
records Flow state serially. Record the candidate outcome as `accepted`,
`modified`, or `rejected`. When a candidate pass or serial/skipped decision
materially shaped the feature, include its bounded record in
`flow_feature_complete.request.result.orchestrationPasses`; keep full handoffs and long logs
outside the runtime payload.

## Validate

- For complex validation, regression-sensitive changes, browser QA, route QA,
  failure-prone checks, unclear coverage, exploratory QA, or
  validation-observation summarization, request `flow-test` through `flow_guidance` (helper rule applies).
- Request `flow-run/references/validation-rubric.md` from `flow_guidance` before completing.
- Run the strongest practical checks for the changed behavior.
- Immediately before every exact Bash command that may become review evidence,
  call `flow_validation_start` with current causal guards, `featureId`, the
  byte-for-byte command, `coverageScope`, and environment key names. Run that
  exact Bash command next, inspect its outcome, and collect the immutable ref
  appended as `[flow-validation-receipt]`. A missing ref is not evidence.
- Never author or pass validation timestamps, exit status, output digests, or
  per-command summaries. The runtime derives those fields from the Bash hook.
- Non-final feature outcomes use `validationScope: "targeted"`.
- The final feature must run a broad project-level gate and use `validationScope: "broad"`.
- Follow the staged schedule and source/run applicability rules in the
  validation rubric; a diagnostic baseline stays advisory and broad validation
  is a distinct execution, not relabeled targeted evidence.

Receipt chronology is runtime-attested. For final review, the broad receipt
must start no earlier than the passing feature-assignment result's reported
time.

For broad validation research, risky changes, or unclear coverage, request
`flow/references/parallel-orchestration.md` from `flow_guidance`. If it routes
to fan-out, request and use the manifest, execution, handoff-format, and
synthesis reference ids in the order that routing guide specifies.
Validation workers may return appended receipt refs for exact commands they ran
or propose focused checks; the manager decides which passing refs apply.

## Review and record outcome

After validation, call `flow_review_start` before dispatching review. Use a new
operation id inside `request` with the current execution guards, `featureId`,
review kind, required validation scope, a bounded packet summary and risk
lenses, and `validationRefs` copied exactly from successful capture output. Do
not submit inline validation observations. The runtime resolves and verifies
the receipts, records current source
identity and derives the feature run, assignment id, attempt id, logical pass,
packet digest, start time, applicable evidence, and required review depth.

Use the assignment projection returned by `flow_review_start` as the dispatch
contract. A reviewer recovering after interruption calls only
`flow_status { "request": { "view": "reviewer", "assignmentId": "..." } }`.
Neither manager
nor reviewer invents attempt, pass, snapshot, source, evidence, start-time, or
depth fields.

For the final feature, economy mode uses exactly: `targeted validation ->
feature assignment/review -> one authorized bounded repair/retry if needed ->
broad validation after the last functional edit -> final assignment created
with the exact passing feature-assignment result -> final review -> one atomic
flow_feature_complete carrying only the final-assignment result`. Flow obtains
the feature result from the final assignment's durable bound prerequisite. The
final feature's active execution may remain `in_progress` while awaiting
review; this is not a blocker. Never start final
review before the feature review has passed in economy order. Do not substitute
a semantically changed feature result in the feature outcome.

For a same-source final-review retry, load
`flow_status { request: { view: "detail" } }` and copy
`workflowData.projection.finalReviewRetry.prerequisite.result` unchanged into
the new final `flow_review_start.request.featureReview`. That is the first
durable binding for the active run and source; compact and reviewer status
intentionally omit it. A mismatch records nothing and leaves the operation id
reusable. If a repair changed source, start a new targeted feature
assignment/review before broad validation and a new final sequence.

The reviewer returns only `assignmentId`, `verdict`, typed `findings`,
`completedAt`, and `terminalDisposition`. Each finding uses one taxonomy:
`implementation_defect`, `regression_coverage_gap`, `evidence_gap`, or
`advisory`, plus `subject`, `requirementOrRisk`, `evidenceLocator`, `summary`,
and `severity`. A failed verdict needs at least one blocking finding; a passing
verdict cannot retain one. Use `observed_unsubmitted` only for failed work the
host observed but the reviewer could not submit normally.

Submit exactly one
`flow_feature_complete { request: { ...guards, result } }`. The nested `result`
uses one branch:

- A targeted `result.kind: "completed"` carries summary, changed artifacts,
  `validationScope: "targeted"`, and the passing feature-assignment result.
- A broad `result.kind: "completed"` carries summary, changed artifacts,
  `validationScope: "broad"`, and the distinct passing final-assignment result
  only.
- `result.kind: "blocked"` carries summary, one failed assignment result, and
  an optional resolution hint.

A genuine blocker is an accepted mutation with operation status `ok`. It
records the attempt and consumes run-scoped retry budget; it is not a transport
error. Before any repair or edit, submit the terminal failed review result on
the blocked outcome branch and confirm the runtime accepted it. Immediately
refresh `flow_status { request: { view: "compact" } }` and follow its projection;
do not assert that retry budget is exhausted from remembered attempts or
reviewer prose. With prior autonomous authorization, make at most one repair
and one retry review when refreshed runtime state permits it: capture fresh
validation receipts, create a new assignment, and dispatch it once.
If the second review fails, stop with the blocker; never start a third review.
Resume only after explicit user direction via
`flow_feature_reset`; the next `flow_run_start` receives a fresh feature-run id.

A correction assignment packet contains the prior blocking findings, the actual
artifacts changed to address them, and focused post-change evidence. Use a
focused delta review only when that packet is complete and the delta is narrow.
Fall back to a full assigned-depth review when the packet or changed-artifact
accounting is incomplete, the repair broadened beyond the blockers, or the delta
touches security, persistence, public contracts, or cross-layer behavior.
When starting a correction review, pass
`correctionOfAssignmentId` as the exact immediately preceding failed assignment
id. If the repair is known to change a public contract or cross a layer boundary,
also pass the respective `correctionScopeHint` value `public-contract` or
`cross-layer`. This correction-only hint can only elevate to full; it cannot
request narrow mode. Flow cannot infer every semantic scope from paths, so
classify known scope honestly. Flow still derives paths and mode, and a more
specific runtime fallback reason wins. Never author delta metadata; omit both
correction fields for non-correction review.

Malformed, stale, source-changed, or inconsistent input records nothing and
does not consume the operation id. Re-anchor with compact/execution status,
capture new validation refs after source changes, and call `flow_review_start`; Flow
invalidates the stale pending assignment and creates its replacement. Optional
bounded orchestration telemetry belongs inside
`flow_feature_complete.request.result.orchestrationPasses` and never replaces
the assignment result.

Immediately call `flow_status { request: { view: "compact" } }` after the
feature outcome. Close with a new guarded
`flow_session_close { request: { mode: "start", kind: "completed", ...guards } }`
when refreshed status is completed and closure is null. If closure exists,
retry only with
`flow_session_close { request: { mode: "retry", operationId: closure.retryOperationId } }`;
otherwise report the result and next action without
starting another feature. Never fabricate evidence or route from a receipt.
