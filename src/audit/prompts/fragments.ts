const SHARED_REVIEW_RULE_LINES = [
	"- Maintain discoveredSurfaces as the canonical coverage ledger.",
	"- Keep findings taxonomy explicit: confirmed_defect, risk, hardening_opportunity, process_gap.",
	"- Default to a human-readable markdown review with sections for Conclusion, Top findings, Recommended next actions, and Coverage notes.",
] as const;

export const FLOW_REVIEW_READONLY_BOUNDARY_RULE =
	"- Stay read-only with respect to repository code and Flow execution/review state; do not mutate Flow planning, execution, review, reset, or session state.";

export const FLOW_REVIEW_SHARED_RULES = SHARED_REVIEW_RULE_LINES.join("\n");

export const FLOW_REVIEW_SHARED_FAILURE_MODE_RULE =
	"- For each directly reviewed behavior surface, choose the applicable adversarial failure-mode classes before writing findings: lifecycle/reentrancy/idempotency, async races/event ordering, persistence failure and recovery, interaction geometry/hit-testing, accessibility semantics/live regions, and test-oracle authenticity. Record the checked classes in coverageNotes, findings, or nextSteps; do not invent findings for classes that are not applicable.";

export const FLOW_REVIEW_SHARED_VALIDATION_RULE =
	"- This surface does not run shell validation; if no validation evidence is already available, record status: not_run and explain why.";
export const FLOW_REVIEW_SHARED_TAXONOMY_RULES = [
	"- Separate confirmed defects, likely risks, hardening opportunities, and process/reporting gaps instead of flattening them into generic advice.",
	"- Use confirmed_defect only for directly evidenced broken behavior or violated contracts.",
	"- Prefer concrete file/line evidence and traced failure paths over generalized advice.",
] as const;

export const FLOW_REVIEW_SHARED_RENDER_RULES = [
	"- Build the structured audit ledger described below, then call flow_review_render to render it.",
	"- Pass the ledger to flow_review_render by spreading the ledger fields directly, plus view when a non-default render view is selected.",
	"- Do not wrap the ledger in a JSON string field; flow_review_render validates the ledger object directly.",
	"- Use flow_review_render with view: human by default, view: structured when the user explicitly asks for raw/json output, and view: both when the user asks for both readable and structured details.",
	"- Return the renderer's report field verbatim as your final answer.",
] as const;
