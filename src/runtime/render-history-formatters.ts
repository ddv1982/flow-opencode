import { toInlineText } from "./render-sections-shared";
import type { Session } from "./schema";
import type { TaskProgressRow } from "./summary-projections";

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

function formatTaskProgressHandoff(row: TaskProgressRow): string {
	return row.handoffMode
		? `${row.handoffMode} (${row.handoffSource})`
		: row.handoffSource;
}

export function renderTaskProgressLine(row: TaskProgressRow): string {
	return [
		`${row.status} | ${row.ownerRole} | ${row.phase} | handoff: ${formatTaskProgressHandoff(row)} | ${toInlineText(row.subject)}`,
		`next: ${toInlineText(row.next)}`,
		...(row.evidence.length > 0
			? [`evidence: ${row.evidence.map(toInlineText).join(", ")}`]
			: ["evidence: none"]),
		...(row.blocker ? [`blocker: ${toInlineText(row.blocker)}`] : []),
	].join(" | ");
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
