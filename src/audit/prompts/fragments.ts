const SHARED_REVIEW_RULE_LINES = [
	"- Maintain discoveredSurfaces as the canonical coverage ledger.",
	"- Keep findings taxonomy explicit: confirmed_defect, risk, process_gap.",
	"- Default to a human-readable markdown review with sections for Conclusion, Top findings, Recommended next actions, and Coverage notes.",
] as const;

export const FLOW_REVIEW_SHARED_RULES = SHARED_REVIEW_RULE_LINES.join("\n");

export const FLOW_REVIEW_SHARED_VALIDATION_RULE =
	"- This surface does not run shell validation directly; if no validation evidence is already available, record status: not_run and explain why.";

export const FLOW_REVIEW_SHARED_TAXONOMY_RULES = [
	"- Distinguish product defects from non-confirmed risks and process/reporting mismatches.",
	"- Prefer concrete file/line evidence over generalized advice.",
] as const;

export const FLOW_REVIEW_SHARED_RENDER_RULES = [
	"- Build the structured audit ledger described below, then call flow_review_render to render it.",
	"- Use flow_review_render with view: human by default, view: structured when the user explicitly asks for raw/json output, and view: both when the user asks for both readable and structured details.",
	"- Return the renderer's report field verbatim as your final answer.",
] as const;
