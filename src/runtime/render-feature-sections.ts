import { renderFeatureHistoryEntrySections } from "./render-feature-history-sections";
import { renderTaskProgressLine } from "./render-history-formatters";
import {
	bulletList,
	formatFollowUpLines,
	joinSections,
	maybeQuotedSection,
	maybeSection,
	toInlineText,
	toQuotedBlock,
} from "./render-sections-shared";
import type { Feature, Session } from "./schema";
import { projectTaskProgress } from "./summary-projections";

function renderFeatureHistory(session: Session, feature: Feature): string {
	const entries = session.execution.history.filter(
		(entry) => entry.featureId === feature.id,
	);
	if (entries.length === 0) {
		return "## Execution History\n\n- none";
	}

	const renderedEntries = entries.map((entry) => {
		const sections = renderFeatureHistoryEntrySections(
			entry,
			formatFollowUpLines,
		);

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

function renderFeatureTaskProgressSection(
	session: Session,
	feature: Feature,
): string {
	const rows = projectTaskProgress(session).filter(
		(row) =>
			row.featureId === feature.id &&
			(row.phase !== "execution" || row.status !== "pending"),
	);
	if (rows.length === 0) {
		return "";
	}

	return `## Task Progress\n\n${bulletList(rows.map(renderTaskProgressLine))}`;
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
		renderFeatureTaskProgressSection(session, feature),
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
