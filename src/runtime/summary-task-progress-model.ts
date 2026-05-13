import type { FeatureDocDrilldownTarget } from "./feature-doc-drilldown";

export type TaskProgressRow = {
	id: string;
	phase:
		| "planning"
		| "execution"
		| "validation"
		| "review"
		| "final_review"
		| "recovery"
		| "session";
	ownerRole:
		| "flow-auto"
		| "flow-planner"
		| "flow-planning-researcher"
		| "flow-worker"
		| "flow-reviewer"
		| "flow-runtime";
	subject: string;
	status:
		| "pending"
		| "active"
		| "blocked"
		| "needs_fix"
		| "needs_input"
		| "completed"
		| "ready";
	featureId?: string;
	featureDrilldown?: FeatureDocDrilldownTarget;
	evidence: string[];
	blocker: string | null;
	next: string;
	source:
		| "planning"
		| "plan"
		| "execution"
		| "validation"
		| "reviewer_decision"
		| "operator";
};

export type OperatorLike = {
	phase: string;
	nextStep: string;
	blocker: string | null;
};

function inlineText(value: string): string {
	return value.replace(/\r?\n+/g, " / ").trim();
}

export function compactEvidence(
	items: Array<string | null | undefined>,
): string[] {
	return items.filter((item): item is string => Boolean(item)).map(inlineText);
}
