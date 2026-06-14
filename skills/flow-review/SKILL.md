---
name: flow-review
description: Review Flow work - choose review depth, classify findings, and record decisions for a feature or the final session review. Load before calling flow_review_record.
---

# Flow review

Review is read-only. You report findings and a decision; you never implement fixes in the same pass. Fixes happen through the execution lane (`flow-run`), then get re-reviewed.

If `flow_review_record` is unavailable, the Flow plugin is not loaded: stop and tell the user to check `opencode-plugin-flow` in the `plugin` array of `opencode.json` and restart OpenCode. A review that cannot record its decision must not pose as a Flow review.

Start with `flow_status`. If no active compatible Flow session exists, this is an advisory read-only review only: do not call `flow_review_record`, say that no gated Flow approval was recorded, and recommend `/flow-auto <goal>` when the user wants session-backed planning, validation, review gates, or resumability.

## Decisions

- **approved** — zero blocking findings, and the evidence actually supports the depth you claim.
- **needs_fix** — blocking findings exist but are fixable within the same feature; this routes back to execution.
- **blocked** — a human decision, missing requirement, or external dependency prevents a verdict.

Record the decision with `flow_review_record`: use `{scope: "feature", featureReview: {...}}` for one feature's work, or `{scope: "final", finalReview: {...}}` for the whole session before close (a final decision also needs `reviewDepth` matching the plan's `deliveryPolicy.finalReviewPolicy`, plus `evidenceRefs`). If the host schema requires both envelopes, set the inactive one to `null`; never put an object in the inactive envelope. Under a strict review policy the runtime refuses completion without a recorded decision — so record honestly rather than reverse-engineering an "approved".

## Depth: match it to risk, then tell the truth about coverage

- **quick** — docs, comments, config renames, mechanical refactors fully covered by the compiler. Read the diff, check evidence exists.
- **standard** — the default for feature work. Read every changed file in full, verify the validation evidence against the rubric, check for regressions in adjacent code paths.
- **deep** — anything touching security, auth, money, data deletion/migration, concurrency, or a public API contract. Trace data flow beyond the diff, hunt for the failure modes listed in the rubric, independently re-run key validation where possible.

Missing evidence is a finding, not an inconvenience: absence of proof is never proof of safety. If you could not cover something to the depth it deserves, downgrade your claimed depth and say what was not covered — never vouch beyond what you actually read.

## Review the context pack, not just the diff

Compare the completed work against the context recorded during planning: `workflowProfile`, `repoProfile`, `research`, `requirements`, `architectureDecisions`, feature `fileTargets` / `reviewScope`, and `notes`. Use the derived `.flow/active/<session-id>/docs/context.md` view, `flow_context`, or the `flow_status.workflowReadiness`, `flow_status.contextQuality`, `flow_status.contextTraceability`, and `flow_status.contextDiagnostics` fields as the reviewable handoff, but remember the session JSON remains authoritative. `workflowReadiness.state` values starting with `blocked_by_` are workflow blockers that need resolution or cited justification; `contextQuality` is advisory unless it exposes concrete drift. A review should catch both code defects and context defects:

- A touched file, schema, command/tool, state path, permission boundary, release script, or docs contract was missing from the plan's context.
- Validation evidence does not cover the file targets or review scope the plan named.
- The implementation drifted into a surface the plan marked out of scope.
- The plan claimed context was inspected, but the completion evidence does not show the relevant file, test, or contract was actually read or exercised.

Treat context defects as review findings. They are blocking when they make the success claim unverifiable or hide changed behavior behind an unreviewed surface.

For final review, explicitly compare the planned scope with actual changed artifacts, validation commands, recorded feature reviewer decisions, and remaining traceability gaps. Do not approve final review while `workflowReadiness.state` is `blocked_by_context`, `blocked_by_validation`, or `blocked_by_review` unless the finding explains why the block is a false positive and cites the evidence that resolves it.

For very large reviews, use the read-only pattern in `../flow/references/parallel-orchestration.md`; split independent modules or risk lenses, then synthesize yourself. The reviewer owns severity, dedupe, refutation, and `flow_review_record`.

For cleanup, refactor, code smell, or AI-slop removal claims, load `flow-deslop` and verify the smell was real, the refutation paths were checked, behavior was preserved, and the cleanup did not become unrelated churn. For frontend UX/UI, responsive, accessibility, or visual polish claims, load `flow-ui-quality` and verify the interface against its UI rubric plus recorded browser/screenshot evidence when a local target was available. If the read-only reviewer lacks browser or shell access, do not recreate visual evidence; record missing or insufficient evidence as a finding or coverage gap.

## Audit deliverables get adversarial review, not citation-checking

When the work under review is itself a findings report (an audit feature, a `goalMode: review` deliverable), verifying that the cited lines exist is not a review — wrong findings cite real code. Your job is to attempt to **refute** each blocking-severity finding by tracing the mitigating paths the author should have checked: callers, the cross-layer counterpart, surrounding guards and resets. A finding you refute, or that carries no guards-checked line, is a blocking finding *against the report* (`needs_fix`: drop or downgrade it before the report ships). The procedure and verdicts are in `references/review-rubric.md` under "Reviewing audit deliverables".

A final review (`scope: final`) additionally checks the session's done condition: do the completed features together deliver the planned outcome, was broad validation run, and does the traceability view show no unexplained scope or evidence gaps?

Read `references/review-rubric.md` for the finding taxonomy, severity rules, report format, and decision payload shapes before recording any decision.

Never: record `approved` to unblock completion; fix findings yourself in the review pass; review the completion summary instead of the diff and evidence.
