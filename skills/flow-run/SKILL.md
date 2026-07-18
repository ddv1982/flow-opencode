---
name: flow-run
description: "Use when an approved Flow plan has a feature to implement, validate, or complete in the v5 runtime, and the work is scoped to one active feature. For planning a goal first use flow-plan; for the full goal-to-completion loop or resuming a session use flow."
---

# Flow Run

Use this skill for implementation after a Flow plan is approved. Work one feature at a time.

## Execution runtime availability

If `flow_run_start` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode.

## Start

- Load compact `flow_status` and read only `workflowData.projection`. If
  `projection.closure.kind` exists, retry guarded `flow_session_close` and stop.
- When ready, call `flow_run_start`; its receipt only acknowledges the mutation.
- For fresh or resumed running work, call `flow_status` with
  `view: "execution"`. Its projection is the sole feature scope and supplies
  causal guards through completion.
- Helper rule: obtain named helper guidance with `flow_guidance`; if that tool is
  unavailable, record the gap and keep the corresponding claims conservative
  instead of simulating its checks.
- Request `flow-deslop` for cleanup/refactor features.
- Request `flow-ui-quality` for frontend, UX, responsive, accessibility, or visual work.

## Implement

- Read the feature `targets`, `summary`, `validation`, dependencies, and plan `requirements`/`decisions`.
- Treat the feature's `reviewDepth` as the minimum feature-review depth that
  must be recorded in `flow_feature_complete`.
- Keep edits scoped to the active feature. If new scope appears, stop and replan or defer it to another feature.
- Preserve unrelated user changes in the worktree.
- When a wrong assumption invalidates the feature, use `flow_feature_reset`; do not pile patches onto a bad path.
- Do not stage, commit, push, amend, rebase, publish, or mutate releases as part
  of feature execution. If the user explicitly asks for commit preparation, request
  `flow-commit` through `flow_guidance` only after `flow_feature_complete` has been recorded, unless the
  user explicitly asks for a WIP commit path. Keep Git boundaries separate from
  Flow state recording.

## Candidate implementation

`flow-run` remains the candidate-implementation manager entry route. Invoke the
hidden `flow-candidate-worker` only after feature start and a complete pass
manifest; never route the user's feature request directly to it.

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
`flow_feature_complete.orchestrationPasses`; keep full handoffs and long logs
outside the runtime payload.

## Validate

- For complex validation, regression-sensitive changes, browser QA, route QA,
  failure-prone checks, unclear coverage, exploratory QA, or
  `validationRun` summarization, request `flow-test` through `flow_guidance` (helper rule applies).
- Request `flow-run/references/validation-rubric.md` from `flow_guidance` before completing.
- Run the strongest practical checks for the changed behavior.
- Record concrete command names, status, and observed results. "Tests pass" is not evidence.
- Non-final features complete with `validationScope: "targeted"`.
- The final feature must run a broad project-level gate and use `validationScope: "broad"`.

For broad validation research, risky changes, or unclear coverage, request
`flow/references/parallel-orchestration.md` from `flow_guidance`. If it routes
to fan-out, request and use the manifest, execution, handoff-format, and
synthesis reference ids in the order that routing guide specifies.
They may report command output they actually ran or propose focused checks; the
manager decides what is strong enough to record.

## Review and complete

Before completion, route a bounded `flow-review` packet and record
`featureReviewDepth` plus verdict.

For the final feature, economy mode uses exactly: `targeted validation ->
feature review -> one authorized bounded repair/retry if needed -> broad
validation after the last functional edit -> final review -> one atomic
flow_feature_complete`. An active final feature may remain `in_progress` while
awaiting review; this is not a blocker. Never dispatch final review before the
feature review passes in economy mode. Latency/speculative review mode remains
disabled; enabling it would require one immutable `reviewSnapshotId` shared by
both reviews plus explicit contradiction reconciliation.

Send scope, planned depth, requirements/decisions, changed-file summary,
validation outcomes, risk lenses, and immutable snapshot digest—not the transcript.

Append one `reviewExecutions` item per dispatch, including failed
`observed_unsubmitted` work. Record
`attemptId`, `logicalPassId`, `featureId`, `reviewKind`, `reviewSnapshotId`,
`verdict`, `findings`, `startedAt`, `completedAt`, and `terminalDisposition`.
Each finding uses one taxonomy: `implementation_defect`,
`regression_coverage_gap`, `evidence_gap`, or `advisory`, plus `subject`,
`requirementOrRisk`, `evidenceLocator`, `summary`, and `severity`. Flow computes
the stable finding fingerprint from normalized taxonomy + subject +
requirement/risk + evidence locator; reviewers do not supply it. Orchestration
telemetry never replaces review evidence.

If `featureReview.status` or `finalReview.status` is `"failed"`, do not fix
inside review. Record the failed attempt by calling `flow_feature_complete`
with its `reviewExecutions` item, failed `featureReview`, and attempted depth;
the runtime rejects completion but preserves the attempt and consumes retry
budget. With prior autonomous authorization, make at most one repair and one retry review.
If it fails or exhausts budget, stop with the blocker. Resume only after
explicit user direction via `flow_feature_reset`; never start a blocked feature.

If the reviewer or evidence is unavailable, do not record Flow-gated review;
return advisory output and complete `needs_input` when review is required.

For the final feature, `finalReview.reviewDepth` equals `finalReviewPolicy`.
Submit validation, verdicts, new `reviewExecutions`, artifacts, and optional
bounded `orchestrationPasses` in the single completion call.

Immediately call `flow_status` with `view: "compact"` after completion. Close
from refreshed `projection.closure.kind`; otherwise report the result and next
action without starting another feature. Complete real blockers as
`needs_input`. Never fabricate evidence or route from a receipt.
