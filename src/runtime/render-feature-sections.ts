import {
	bulletList,
	formatFollowUpLines,
	joinSections,
	maybeQuotedSection,
	maybeSection,
	maybeTitledList,
	renderOutcomeLines,
	renderReviewBlock,
	toInlineText,
	toQuotedBlock,
} from "./render-sections-shared";
import type { Feature, Session } from "./schema";

function renderFeatureHistory(session: Session, feature: Feature): string {
	const entries = session.execution.history.filter(
		(entry) => entry.featureId === feature.id,
	);
	if (entries.length === 0) {
		return "## Execution History\n\n- none";
	}

	const renderedEntries = entries.map((entry) => {
		const sections = [
			maybeTitledList(
				"Changed Artifacts",
				entry.artifactsChanged.map((artifact) =>
					artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path,
				),
				"####",
			),
			maybeTitledList(
				"Validation",
				entry.validationRun.map(
					(item) => `${item.status} | ${item.command} | ${item.summary}`,
				),
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
						[
							`scope: ${entry.reviewerDecision.scope}`,
							...(entry.reviewerDecision.featureId
								? [`feature id: ${entry.reviewerDecision.featureId}`]
								: []),
							`status: ${entry.reviewerDecision.status}`,
							`summary: ${entry.reviewerDecision.summary}`,
						],
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

		return joinSections([
			`### ${entry.recordedAt}\n\n- status: ${entry.status}\n- outcome: ${entry.outcomeKind ?? "none"}\n- summary: ${toInlineText(entry.summary)}\n- next step: ${entry.nextStep ? toInlineText(entry.nextStep) : "none"}`,
			...sections,
		]).trimEnd();
	});

	return `## Execution History\n\n${renderedEntries.join("\n\n")}`;
}

function renderFeatureSummarySection(
	session: Session,
	feature: Feature,
): string {
	const isActive = session.execution.activeFeatureId === feature.id;

	return `## Summary

- title: ${toInlineText(feature.title)}
- status: ${feature.status}
- active: ${isActive ? "yes" : "no"}
- goal: ${toInlineText(session.goal)}`;
}

function renderFeatureDescriptionSection(feature: Feature): string {
	return `## Description\n\n${toQuotedBlock(feature.summary)}`;
}

function renderFeatureTargetsSection(feature: Feature): string {
	return `## File Targets\n\n${bulletList(feature.fileTargets)}`;
}

function renderFeatureVerificationSection(feature: Feature): string {
	return `## Verification\n\n${bulletList(feature.verification)}`;
}

export function renderFeatureDoc(session: Session, feature: Feature): string {
	return joinSections([
		`# Feature ${feature.id}`,
		renderFeatureSummarySection(session, feature),
		renderFeatureDescriptionSection(feature),
		maybeQuotedSection(
			"Latest Runtime Summary",
			session.execution.lastFeatureId === feature.id
				? session.execution.lastSummary
				: null,
		),
		renderFeatureTargetsSection(feature),
		renderFeatureVerificationSection(feature),
		maybeSection("Depends On", feature.dependsOn ?? []),
		maybeSection("Blocked By", feature.blockedBy ?? []),
		renderFeatureHistory(session, feature),
	]);
}
