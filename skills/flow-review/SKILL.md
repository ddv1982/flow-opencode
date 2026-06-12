---
name: flow-review
description: Review Flow work - choose review depth, classify findings, and record decisions for a feature or the final session review. Load before calling flow_review_record.
---

# Flow review

Review is read-only. You report findings and a decision; you never implement fixes in the same pass. Fixes happen through the execution lane (`flow-run`), then get re-reviewed.

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

A final review (`scope: final`) additionally checks the session's done condition: do the completed features together deliver the planned outcome, and was broad validation run?

Read `references/review-rubric.md` for the finding taxonomy, severity rules, report format, and decision payload shapes before recording any decision.

Never: record `approved` to unblock completion; fix findings yourself in the review pass; review the completion summary instead of the diff and evidence.
