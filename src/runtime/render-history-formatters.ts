import { toInlineText } from "./render-sections-shared";
import type { Session } from "./schema";

type ArtifactRecord = Session["artifacts"][number];
type ValidationRecord = Session["execution"]["lastValidationRun"][number];
type ExecutionHistoryRecord = Session["execution"]["history"][number];

export function renderArtifactLine(artifact: ArtifactRecord): string {
	return artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path;
}

export function renderValidationLine(item: ValidationRecord): string {
	return `${item.status} | ${item.command} | ${item.summary}`;
}

export function renderExecutionHistoryLine(
	item: ExecutionHistoryRecord,
): string {
	return `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`;
}

export function renderReviewFindingClosureLine(
	item: ExecutionHistoryRecord["reviewFindingClosures"][number],
): string {
	return [
		`${item.status} | ${toInlineText(item.findingRef)}`,
		`fix: ${item.fixRefs.map(toInlineText).join(", ") || "none"}`,
		`tests: ${item.testRefs.map(toInlineText).join(", ") || "none"}`,
		`validation: ${item.validationRefs.map(toInlineText).join(", ") || "none"}`,
		`residual risk: ${toInlineText(item.residualRisk)}`,
	].join(" | ");
}
