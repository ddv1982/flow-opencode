---
name: flow-review
description: Review Flow work - choose review depth, classify findings, and record decisions for a feature or the final session review. Load before calling flow_review_record.
---

# Flow review

Review is read-only. You report findings and a decision; you never implement fixes in the same pass. Fixes happen through the execution lane (`flow-run`), then get re-reviewed.

If `flow_review_record` is unavailable, the Flow plugin is not loaded: stop and tell the user to check `opencode-plugin-flow` in the `plugin` array of `opencode.json` and restart OpenCode. A review that cannot record its decision must not pose as a Flow review.

## Decisions

- **approved** — zero blocking findings, and the evidence actually supports the depth you claim.
- **needs_fix** — blocking findings exist but are fixable within the same feature; this routes back to execution.
- **blocked** — a human decision, missing requirement, or external dependency prevents a verdict.

Record the decision with `flow_review_record`: `scope: feature` for one feature's work, `scope: final` for the whole session before close (a final decision also needs `reviewDepth` matching the plan's `deliveryPolicy.finalReviewPolicy`, plus `evidenceRefs`). Under a strict review policy the runtime refuses completion without a recorded decision — so record honestly rather than reverse-engineering an "approved".

## Depth: match it to risk, then tell the truth about coverage

- **quick** — docs, comments, config renames, mechanical refactors fully covered by the compiler. Read the diff, check evidence exists.
- **standard** — the default for feature work. Read every changed file in full, verify the validation evidence against the rubric, check for regressions in adjacent code paths.
- **deep** — anything touching security, auth, money, data deletion/migration, concurrency, or a public API contract. Trace data flow beyond the diff, hunt for the failure modes listed in the rubric, independently re-run key validation where possible.

Missing evidence is a finding, not an inconvenience: absence of proof is never proof of safety. If you could not cover something to the depth it deserves, downgrade your claimed depth and say what was not covered — never vouch beyond what you actually read.

## Review the context pack, not just the diff

Compare the completed work against the context recorded during planning: `repoProfile`, `research`, `requirements`, `architectureDecisions`, feature `fileTargets` / `reviewScope`, and `notes`. Use the derived `.flow/active/<session-id>/docs/context.md` view or the `flow_status.contextDiagnostics` field as the reviewable handoff, but remember the session JSON remains authoritative. A review should catch both code defects and context defects:

- A touched file, schema, command/tool, state path, permission boundary, release script, or docs contract was missing from the plan's context.
- Validation evidence does not cover the file targets or review scope the plan named.
- The implementation drifted into a surface the plan marked out of scope.
- The plan claimed context was inspected, but the completion evidence does not show the relevant file, test, or contract was actually read or exercised.

Treat context defects as review findings. They are blocking when they make the success claim unverifiable or hide changed behavior behind an unreviewed surface.

## Audit deliverables get adversarial review, not citation-checking

When the work under review is itself a findings report (an audit feature, a `goalMode: review` deliverable), verifying that the cited lines exist is not a review — wrong findings cite real code. Your job is to attempt to **refute** each blocking-severity finding by tracing the mitigating paths the author should have checked: callers, the cross-layer counterpart, surrounding guards and resets. A finding you refute, or that carries no guards-checked line, is a blocking finding *against the report* (`needs_fix`: drop or downgrade it before the report ships). The procedure and verdicts are in `references/review-rubric.md` under "Reviewing audit deliverables".

A final review (`scope: final`) additionally checks the session's done condition: do the completed features together deliver the planned outcome, and was broad validation run?

Read `references/review-rubric.md` for the finding taxonomy, severity rules, report format, and decision payload shapes before recording any decision.

Never: record `approved` to unblock completion; fix findings yourself in the review pass; review the completion summary instead of the diff and evidence.
