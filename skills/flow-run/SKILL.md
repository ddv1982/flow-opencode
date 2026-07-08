---
name: flow-run
description: "Use when an approved Flow plan has a feature to implement, validate, or complete in the v4 runtime, and the work is scoped to one active feature. For planning a goal first use flow-plan; for the full goal-to-completion loop or resuming a session use flow."
---

# Flow Run

Use this skill for implementation after a Flow plan is approved. Work one feature at a time.

If `flow_run_start` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode.

## Start

- Call `flow_status`.
- If `flow_status` returns a `session.resumePacket` or
  `session.budget.phaseBoundary`, stop the current autonomous loop and report
  the resume instructions. Only call `flow_run_start` with
  `phaseBoundaryAck: true` at the start of a fresh user invocation that is
  explicitly resuming the Flow session; do not acknowledge a boundary inside
  the same uninterrupted loop that created it.
- Call `flow_run_start` with no `featureId` unless the user or plan requires a specific runnable feature.
- Treat the returned feature as the sole scope until it is completed, blocked, or reset.
- Helper rule: when a named helper skill is unavailable, record the gap and
  keep the corresponding claims conservative instead of simulating its checks.
- Load `flow-deslop` for cleanup/refactor features.
- Load `flow-ui-quality` for frontend, UX, responsive, accessibility, or visual work.

## Implement

- Read the feature `targets`, `summary`, `validation`, dependencies, and plan `requirements`/`decisions`.
- Treat the feature's `reviewDepth` as the minimum feature-review depth that
  must be recorded in `flow_feature_complete`.
- For broad, risky, or multi-target work, record an implementation pass
  decision before editing: `serial`, `candidate-exact-path`,
  `candidate-worktree`, `tournament`, or `skipped`. Use
  `../flow/references/parallel-orchestration.md` for the decision rules,
  manifest fields, and compact `orchestrationPasses` record.
- If candidate workers are skipped, record the reason, such as overlapping
  targets, shared contracts, missing isolation, or no explicit authorization
  for worker edits.
- Keep edits scoped to the active feature. If new scope appears, stop and replan or defer it to another feature.
- Preserve unrelated user changes in the worktree.
- When a wrong assumption invalidates the feature, use `flow_feature_reset`; do not pile patches onto a bad path.
- Do not stage, commit, push, amend, rebase, publish, or mutate releases as part
  of feature execution. If the user explicitly asks for commit preparation, load
  `flow-commit` only after `flow_feature_complete` has been recorded, unless the
  user explicitly asks for a WIP commit path. Keep Git boundaries separate from
  Flow state recording.

## Validate

- For complex validation, regression-sensitive changes, browser QA, route QA,
  failure-prone checks, unclear coverage, exploratory QA, or
  `validationRun` summarization, load `flow-test` (helper rule applies).
- Read `references/validation-rubric.md` before completing.
- Run the strongest practical checks for the changed behavior.
- Record concrete command names, status, and observed results. "Tests pass" is not evidence.
- Non-final features complete with `validationScope: "targeted"`.
- The final feature must run a broad project-level gate and use `validationScope: "broad"`.

For broad validation research, risky changes, or unclear coverage, use
`../flow/references/parallel-orchestration.md` to fan out named Flow workers.
Use the mode-to-agent mapping in that reference instead of generic subagents.
Write its pass manifest before fan-out, paste the matching handoff template
from `../flow/references/handoff-format.md` into every worker prompt, and
apply its verification tiers to the handoffs that come back.
They may report command output they actually ran or propose focused checks; the
manager decides what is strong enough to record.

For independent implementation attempts, use candidate workers only with
explicit user authorization plus isolated worktrees or exact non-overlapping
path ownership. Treat their output as candidate patches. The manager inspects,
merges, validates, and records Flow state serially.
When a candidate pass or serial/skipped implementation decision materially
shaped the feature, include its compact record in
`flow_feature_complete.orchestrationPasses`. Do not paste full worker handoffs
or long logs into the runtime payload.

## Review and complete

Before `flow_feature_complete`, obtain a `featureReview` payload. Load
`flow-review`; for read-only subagent reviews, the manager receives the review
packet and records both `featureReviewDepth` and `featureReview`.

Send reviewers a compact review packet. Do not rely on the accumulated parent
conversation. Include only:

- active feature id, title, summary, `reviewDepth`, targets, validation, and dependencies
- relevant plan requirements, decisions, and final review policy
- changed files and a short diff summary
- validation evidence with exact commands, status, and observed result
- targeted paths or risk lenses the reviewer must inspect

If the review returns `status: "failed"`, do not fix inside the review pass.
Record the failed attempt by calling `flow_feature_complete` with the otherwise
prepared completion payload, the failed `featureReview`, and the attempted
`featureReviewDepth`; the runtime will reject completion and update the retry
budget. Default to stopping and reporting the blocker. When the user already
authorized autonomous implementation, make at most one repair and run one retry
review. If the retry fails or the runtime reports review retry budget
exhausted, stop with the blocker.

If `flow_status` reports `setup.skills` or `flow-review` cannot be loaded, do
not record a Flow-gated `featureReview` or `finalReview`. You may perform an
advisory review using available context or the bundled review fallback provided
by plugin config, then complete with `status: "needs_input"` if review evidence
is required to proceed.

For the final feature, also obtain a `finalReview` payload whose `reviewDepth` equals the approved plan's `finalReviewPolicy`.

Complete with:

```json
{
  "status": "ok",
  "featureId": "active-feature-id",
  "summary": "what changed",
  "artifactsChanged": [{ "path": "src/file.ts" }],
  "validationRun": [
    { "command": "bun test tests/foo.test.ts", "status": "passed", "summary": "3 pass, exercised foo behavior" }
  ],
  "validationScope": "targeted",
  "featureReviewDepth": "standard",
  "featureReview": { "status": "passed", "summary": "review summary", "blockingFindings": [] },
  "orchestrationPasses": [
    {
      "id": "active-feature-id-implementation-decision",
      "kind": "implementation-decision",
      "decision": "serial",
      "decisionReason": "Shared contract edits made worker ownership unsafe.",
      "writeScope": "manager-serial",
      "verificationStatus": "not-needed",
      "outcome": "accepted"
    }
  ]
}
```

If `flow_feature_complete` returns a `session.resumePacket` or
`session.budget.phaseBoundary`, stop after reporting the compact handoff. If
genuinely blocked, call `flow_feature_complete` with `status: "needs_input"` and
an `outcome` that explains the blocker and next step. Never fabricate validation
or review evidence to force progress.
