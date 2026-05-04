import { toInlineText } from "./render-sections-shared";
import type { Session } from "./schema";

type ExecutionHistoryEntry = Session["execution"]["history"][number];
type ReviewerDecision = NonNullable<ExecutionHistoryEntry["reviewerDecision"]>;

export function renderReviewerDecisionLines(
	decision: ReviewerDecision,
): string[] {
	const finalScopeLines =
		decision.scope === "final"
			? [
					`review depth: ${decision.reviewDepth}`,
					...(decision.reviewedSurfaces.length > 0
						? [
								`reviewed surfaces: ${decision.reviewedSurfaces.map(toInlineText).join(", ")}`,
							]
						: []),
					...(decision.evidenceSummary
						? [`evidence: ${toInlineText(decision.evidenceSummary)}`]
						: []),
					...(decision.validationAssessment
						? [
								`validation assessment: ${toInlineText(decision.validationAssessment)}`,
							]
						: []),
					...(decision.evidenceRefs.changedArtifacts.length > 0
						? [
								`evidence changed artifacts: ${decision.evidenceRefs.changedArtifacts.map(toInlineText).join(", ")}`,
							]
						: []),
					...(decision.evidenceRefs.validationCommands.length > 0
						? [
								`evidence validation commands: ${decision.evidenceRefs.validationCommands.map(toInlineText).join(", ")}`,
							]
						: []),
					...(decision.integrationChecks.length > 0
						? [
								`integration checks: ${decision.integrationChecks.map(toInlineText).join(", ")}`,
							]
						: []),
					...(decision.regressionChecks.length > 0
						? [
								`regression checks: ${decision.regressionChecks.map(toInlineText).join(", ")}`,
							]
						: []),
					...(decision.remainingGaps.length > 0
						? [
								`remaining gaps: ${decision.remainingGaps.map(toInlineText).join(", ")}`,
							]
						: []),
				]
			: [];

	return [
		`scope: ${decision.scope}`,
		...(decision.scope === "feature"
			? [`feature id: ${decision.featureId}`]
			: []),
		...finalScopeLines,
		`status: ${decision.status}`,
		`summary: ${decision.summary}`,
	];
}
