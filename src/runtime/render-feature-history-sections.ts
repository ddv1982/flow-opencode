import {
	renderArtifactLine,
	renderReviewFindingClosureLine,
	renderValidationLine,
} from "./render-history-formatters";
import { renderReviewerDecisionLines } from "./render-reviewer-decision-lines";
import {
	maybeTitledList,
	renderOutcomeLines,
	renderReviewBlock,
} from "./render-sections-shared";
import type { Session } from "./schema";

type ExecutionHistoryEntry = Session["execution"]["history"][number];

export function renderFeatureHistoryEntrySections(
	entry: ExecutionHistoryEntry,
	formatFollowUpLines: (
		followUps: Array<{ summary: string; severity?: string | undefined }>,
	) => string[],
): string[] {
	return [
		maybeTitledList(
			"Changed Artifacts",
			entry.artifactsChanged.map(renderArtifactLine),
			"####",
		),
		maybeTitledList(
			"Validation",
			entry.validationRun.map(renderValidationLine),
			"####",
		),
		maybeTitledList(
			"Decisions",
			entry.decisions.map((item) => item.summary),
			"####",
		),
		maybeTitledList(
			"Review Finding Closures",
			entry.reviewFindingClosures.map(renderReviewFindingClosureLine),
			"####",
		),
		entry.reviewerDecision
			? maybeTitledList(
					"Reviewer Decision",
					renderReviewerDecisionLines(entry.reviewerDecision),
					"####",
				)
			: "",
		entry.outcome
			? maybeTitledList("Outcome", renderOutcomeLines(entry.outcome), "####")
			: "",
		maybeTitledList(
			"Notes",
			entry.featureResult?.notes?.map((item) => item.note) ?? [],
			"####",
		),
		maybeTitledList(
			"Follow Ups",
			formatFollowUpLines(entry.featureResult?.followUps ?? []),
			"####",
		),
		renderReviewBlock("Feature Review", entry.featureReview),
		renderReviewBlock("Final Review", entry.finalReview),
	].filter(Boolean);
}
