import type { Feature, Session } from "../schema";
import {
	type ExecutionHistoryEntry,
	renderArtifactLine,
	renderOutcomeLines,
	renderReviewBlock,
	renderReviewerDecisionLines,
	renderValidationLine,
} from "./evidence";
import {
	bulletList,
	formatFollowUpLines,
	joinSections,
	maybeQuotedSection,
	maybeSection,
	maybeTitledList,
	toInlineText,
	toQuotedBlock,
} from "./markdown";

function renderFeatureHistoryEntrySections(
	entry: ExecutionHistoryEntry,
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

function renderFeatureHistory(session: Session, feature: Feature): string {
	const entries = session.execution.history.filter(
		(entry) => entry.featureId === feature.id,
	);
	if (entries.length === 0) {
		return "## Execution History\n\n- none";
	}

	const renderedEntries = entries.map((entry) =>
		joinSections([
			`### ${entry.recordedAt}\n\n- status: ${entry.status}\n- outcome: ${entry.outcomeKind ?? "none"}\n- summary: ${toInlineText(entry.summary)}\n- next step: ${entry.nextStep ? toInlineText(entry.nextStep) : "none"}`,
			...renderFeatureHistoryEntrySections(entry),
		]).trimEnd(),
	);

	return `## Execution History\n\n${renderedEntries.join("\n\n")}`;
}

export function renderFeatureDoc(session: Session, feature: Feature): string {
	const isActive = session.execution.activeFeatureId === feature.id;

	return joinSections([
		`# Feature ${feature.id}`,
		`## Summary

- title: ${toInlineText(feature.title)}
- status: ${feature.status}
- active: ${isActive ? "yes" : "no"}
- goal: ${toInlineText(session.goal)}`,
		`## Description\n\n${toQuotedBlock(feature.summary)}`,
		maybeQuotedSection(
			"Latest Runtime Summary",
			session.execution.lastFeatureId === feature.id
				? session.execution.lastSummary
				: null,
		),
		`## File Targets\n\n${bulletList(feature.fileTargets)}`,
		`## Verification\n\n${bulletList(feature.verification)}`,
		maybeSection("Depends On", feature.dependsOn ?? []),
		maybeSection("Blocked By", feature.blockedBy ?? []),
		renderFeatureHistory(session, feature),
	]);
}
