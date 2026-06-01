const FLOW_TOOL_DOCS_SECTION = "docs/development.md#current-runtime-tools";

export const FLOW_DEFAULT_TOOL_DOCS_ROW = {
	section: FLOW_TOOL_DOCS_SECTION,
	label: "Default OpenCode tool surface",
} as const;

export const FLOW_PROMPT_GUIDANCE_BY_ID = {
	flow_plan_start: `## Use when
- Use first when creating or refreshing a Flow planning session from a user goal.

## Avoid when
- Do not use for plan approval, feature execution, or review persistence.

## Returns
- Returns the active planning session state and the next canonical planning step.`,
	flow_plan_context_record: `## Use when
- Use to persist repo profile, stackProfile, standardsProfile, research findings, implementation approach, or planning decisions that justify the plan.
- Provide the planning-context fields directly as this tool's arguments.

## Avoid when
- Do not embed this context inside the plan payload when the runtime has dedicated planning fields.

## Returns
- Updates the active planning context so downstream Flow summaries expose the same evidence.`,
	flow_plan_apply: `## Use when
- Use after you have a draft plan that already matches the Flow planning contract.
- Provide the full \`{ plan, planning? }\` payload directly as this tool's arguments.

## Avoid when
- Do not use to store free-form notes or partial execution results.

## Returns
- Returns the canonical runtime response for the applied draft, including approval guidance.`,
	flow_run_start: `## Use when
- Use first for execution to start the next runnable feature or a specific approved feature id.

## Avoid when
- Do not call this after implementation is already complete; use completion tools instead.

## Returns
- Returns the canonical runtime response describing the active feature or why nothing is runnable.`,
	flow_run_complete_feature: `## Use when
- Use only to persist the worker result for the active feature after its required validation/review gate is satisfied.
- Treat the returned tool JSON as authoritative; OpenCode row metadata is provisional request-time context until this tool returns ok.
- Normal features require targeted validation and clean featureReview; final completion requires broad validation and the finalReview required by deliveryPolicy.finalReviewPolicy.
- For review/review_and_fix completion paths, include reviewScopeLedger accounting for every declared review scope target/domain.
- If recovery details include reviewScopeLedger.exampleReviewScopeLedger, treat it as scaffold-only; do not replay unchanged.
- If this tool returns status: "error", do not retry the same completion payload unchanged; after repeated same-category reviewScopeLedger failures, inspect flow_status or recovery details and repair evidenceRefs before retrying.
- Provide the full worker result fields directly as this tool's arguments.

## Avoid when
- Do not use for partial progress or speculative status updates.
- Do not use while validation, review, finalReview, or reviewScopeLedger prerequisites are missing.

## Returns
- Persists a worker result and returns the canonical runtime completion response.`,
	flow_review_record_feature: `## Use when
- Use to persist a reviewer decision for the current feature after the review is already complete.
- Treat the returned tool JSON as authoritative; OpenCode row metadata is provisional request-time context until this tool returns ok.
- Provide the full reviewer decision fields directly as this tool's arguments.

## Avoid when
- Do not use to ask for review or to record final cross-feature approval.

## Returns
- Returns the canonical runtime response for the feature-level approval gate.`,
	flow_review_record_final: `## Use when
- Use only to persist the final reviewer decision for the final completion gate.
- Treat the returned tool JSON as authoritative; OpenCode row metadata is provisional request-time context until this tool returns ok.
- The decision must satisfy deliveryPolicy.finalReviewPolicy; review/review_and_fix approvals must include reviewScopeLedger accounting for every declared review scope target/domain.
- If recovery details include reviewScopeLedger.exampleReviewScopeLedger, re-record only corrected evidence-grounded entries with truthful residualRisk.
- If this tool returns status: "error", do not retry the same final-review payload unchanged; after repeated same-category reviewScopeLedger failures, inspect flow_status or recovery details and repair evidenceRefs before retrying.
- Provide the full reviewer decision fields directly as this tool's arguments.

## Avoid when
- Do not use for normal feature reviews.
- Do not use while broad validation, finalReview, or reviewScopeLedger prerequisites are missing.

## Returns
- Returns the canonical runtime response for the final approval gate.`,
	flow_review_render: `## Use when
- Use to render an already-complete structured review ledger.
- Provide the full review ledger fields directly as this tool's arguments.
- Include \`reviewTarget\` unless \`view: structured\` is explicitly selected for raw JSON output without target provenance.
- Use \`view: human\` for the default user-facing report, \`structured\` for raw JSON, or \`both\` to append structured details after the readable report.

## Avoid when
- Do not use to create findings, fill coverage gaps, or mutate Flow state.

## Returns
- Returns a rendered review report string, not a Flow runtime session mutation response.`,
} as const;
