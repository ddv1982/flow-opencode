import type { Session } from "../schema";
import {
	bulletList,
	maybeListLine,
	maybeTitledList,
	toInlineText,
} from "./markdown";

export type ArtifactRecord = Session["artifacts"][number];
export type ValidationRecord =
	Session["execution"]["lastValidationRun"][number];
export type ExecutionHistoryEntry = Session["execution"]["history"][number];
export type ReviewerDecision = NonNullable<
	ExecutionHistoryEntry["reviewerDecision"]
>;

export type ReviewDetails = {
	reviewDepth?: string | undefined;
	reviewedSurfaces?: string[] | undefined;
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	evidenceRefs?:
		| {
				changedArtifacts: string[];
				validationCommands: string[];
		  }
		| undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
	remainingGaps?: string[] | undefined;
};

export function renderArtifactLine(artifact: ArtifactRecord): string {
	return artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path;
}

export function renderValidationLine(item: ValidationRecord): string {
	return `${item.status} | ${item.command} | ${item.summary}`;
}

export function renderExecutionHistoryLine(
	item: ExecutionHistoryEntry,
): string {
	return `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`;
}

export function renderOutcomeLines(
	outcome:
		| {
				kind: string;
				category?: string | undefined;
				summary?: string | undefined;
				resolutionHint?: string | undefined;
				retryable?: boolean | undefined;
				autoResolvable?: boolean | undefined;
				needsHuman?: boolean | undefined;
		  }
		| null
		| undefined,
): string[] {
	if (!outcome) {
		return [];
	}

	return [
		`kind: ${outcome.kind}`,
		...(outcome.category
			? [`category: ${toInlineText(outcome.category)}`]
			: []),
		...(outcome.summary ? [`summary: ${toInlineText(outcome.summary)}`] : []),
		...(outcome.resolutionHint
			? [`resolution hint: ${toInlineText(outcome.resolutionHint)}`]
			: []),
		...(outcome.retryable !== undefined
			? [`retryable: ${outcome.retryable ? "yes" : "no"}`]
			: []),
		...(outcome.autoResolvable !== undefined
			? [`auto resolvable: ${outcome.autoResolvable ? "yes" : "no"}`]
			: []),
		...(outcome.needsHuman !== undefined
			? [`needs human: ${outcome.needsHuman ? "yes" : "no"}`]
			: []),
	];
}

export function reviewDetailLines(review: ReviewDetails): string[] {
	return [
		...(review.reviewDepth ? [`review depth: ${review.reviewDepth}`] : []),
		...maybeListLine("reviewed surfaces", review.reviewedSurfaces),
		...(review.evidenceSummary
			? [`evidence: ${toInlineText(review.evidenceSummary)}`]
			: []),
		...(review.validationAssessment
			? [`validation assessment: ${toInlineText(review.validationAssessment)}`]
			: []),
		...maybeListLine(
			"evidence changed artifacts",
			review.evidenceRefs?.changedArtifacts,
		),
		...maybeListLine(
			"evidence validation commands",
			review.evidenceRefs?.validationCommands,
		),
		...maybeListLine("integration checks", review.integrationChecks),
		...maybeListLine("regression checks", review.regressionChecks),
		...maybeListLine("remaining gaps", review.remainingGaps),
	];
}

export function renderReviewerDecisionLines(
	decision: ReviewerDecision,
): string[] {
	return [
		`scope: ${decision.scope}`,
		...(decision.scope === "feature"
			? [`feature id: ${decision.featureId}`]
			: reviewDetailLines(decision)),
		`status: ${decision.status}`,
		`summary: ${decision.summary}`,
	];
}

export function renderReviewBlock(
	title: string,
	review:
		| (ReviewDetails & {
				status: string;
				summary: string;
				blockingFindings: Array<{ summary: string }>;
		  })
		| undefined,
): string {
	if (!review) {
		return "";
	}

	const lines = [
		`- status: ${review.status}`,
		...reviewDetailLines(review).map((line) => `- ${line}`),
		`- summary: ${toInlineText(review.summary)}`,
		...(review.blockingFindings.length > 0
			? [bulletList(review.blockingFindings.map((item) => item.summary))]
			: []),
	];

	return `#### ${title}\n\n${lines.join("\n")}`;
}

export function renderTitledOutcome(
	title: string,
	outcome: Parameters<typeof renderOutcomeLines>[0],
	level = "####",
): string {
	return outcome
		? maybeTitledList(title, renderOutcomeLines(outcome), level)
		: "";
}
