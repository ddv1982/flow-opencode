import { activeDecisionGate } from "./domain";
import {
	renderArtifactLine,
	renderExecutionHistoryLine,
	renderTaskProgressLine,
	renderValidationLine,
} from "./render-history-formatters";
import {
	maybeApproachSection,
	maybeDecisionLogSection,
	maybeReplanLogSection,
	maybeStackProfileSection,
	maybeStandardsProfileSection,
	renderPlanOverviewLines,
} from "./render-index-plan-sections";
import {
	bulletList,
	formatFollowUpLines,
	joinSections,
	maybeSection,
	maybeTitledList,
	renderOutcomeLines,
	toInlineText,
} from "./render-sections-shared";
import type { Feature, Session } from "./schema";
import { deriveNextCommand } from "./session-operator-state";
import {
	projectTaskProgress,
	type TaskProgressRow,
} from "./summary-projections";

function formatFeatureLine(feature: Feature): string {
	return `- ${feature.id} | ${feature.status} | ${toInlineText(feature.title)}`;
}

function renderFeatureResultDetails(
	featureResult:
		| {
				featureId: string;
				verificationStatus?: string | undefined;
				notes?: Array<{ note: string }> | undefined;
				followUps?:
					| Array<{ summary: string; severity?: string | undefined }>
					| undefined;
		  }
		| null
		| undefined,
): string {
	if (!featureResult) {
		return "";
	}

	const sections = [
		maybeTitledList(
			"Notes",
			featureResult.notes?.map((item) => item.note) ?? [],
			"###",
		),
		maybeTitledList(
			"Follow Ups",
			formatFollowUpLines(featureResult.followUps ?? []),
			"###",
		),
	].filter(Boolean);

	return joinSections([
		`## Feature Result\n\n- feature id: ${featureResult.featureId}\n- verification: ${featureResult.verificationStatus ?? "not_recorded"}`,
		...sections,
	]).trimEnd();
}

function renderIndexSummarySection(session: Session): string {
	const reviewerDecision = session.execution.lastReviewerDecision;
	const decisionGate = activeDecisionGate(session);
	const summaryLines = [
		`- session id: ${session.id}`,
		`- goal: ${toInlineText(session.goal)}`,
		`- status: ${session.status}`,
		`- closure: ${session.closure ? `${session.closure.kind} | ${toInlineText(session.closure.summary)}` : "open"}`,
		`- approval: ${session.approval}`,
		`- next command: ${deriveNextCommand(session)}`,
		`- next step: ${session.execution.lastNextStep ? toInlineText(session.execution.lastNextStep) : "none"}`,
		...(decisionGate
			? [
					`- decision gate: ${decisionGate.status} | ${decisionGate.domain} | ${toInlineText(decisionGate.question)}`,
				]
			: []),
		`- reviewer decision: ${reviewerDecision ? `${reviewerDecision.scope} | ${reviewerDecision.reviewPurpose ?? "inferred"} | ${reviewerDecision.status} | ${toInlineText(reviewerDecision.summary)}` : "none"}`,
		`- created: ${session.timestamps.createdAt}`,
	];

	return `## Summary

${summaryLines.join("\n")}`;
}

function selectTaskProgressRows(rows: TaskProgressRow[]): TaskProgressRow[] {
	const selected: TaskProgressRow[] = [];
	const add = (candidates: TaskProgressRow[], limit = candidates.length) => {
		for (const row of candidates.slice(0, limit)) {
			if (selected.length >= 8) {
				return;
			}
			if (!selected.some((item) => item.id === row.id)) {
				selected.push(row);
			}
		}
	};

	add(rows.filter((row) => row.status === "active"));
	add(rows.filter((row) => row.status === "ready"));
	add(
		rows.filter((row) =>
			["blocked", "needs_fix", "needs_input"].includes(row.status),
		),
	);
	add(
		rows.filter((row) =>
			["validation", "review", "final_review"].includes(row.phase),
		),
	);
	add(
		rows.filter((row) => row.status === "pending"),
		2,
	);
	add(
		rows.filter((row) => row.status === "completed"),
		2,
	);
	return selected;
}

function renderTaskProgressSection(session: Session): string {
	const rows = projectTaskProgress(session);
	if (rows.length === 0) {
		return "";
	}

	const selectedRows = selectTaskProgressRows(rows);
	const omittedCount = rows.length - selectedRows.length;
	const lines = [
		...selectedRows.map(renderTaskProgressLine),
		...(omittedCount > 0
			? [`${omittedCount} more task progress rows omitted.`]
			: []),
	];

	return `## Task Progress\n\n${bulletList(lines)}`;
}

function renderPlanSection(session: Session, features: Feature[]): string {
	const plan = session.plan;
	const planLines = renderPlanOverviewLines(session, features);

	return joinSections([
		`## Plan

${planLines.join("\n")}`,
		maybeSection("Requirements", plan?.requirements ?? []),
		maybeSection("Architecture Decisions", plan?.architectureDecisions ?? []),
		maybeSection("Repo Profile", session.planning.repoProfile),
		maybeStackProfileSection(session),
		maybeStandardsProfileSection(session),
		maybeSection("Research", session.planning.research),
		maybeApproachSection(session),
		maybeDecisionLogSection(session),
		maybeReplanLogSection(session),
	]).trimEnd();
}

function renderFeaturesSection(features: Feature[]): string {
	return `## Features\n\n${features.length === 0 ? "- none" : features.map(formatFeatureLine).join("\n")}`;
}

function renderOutcomeSection(session: Session): string {
	if (!session.execution.lastOutcome) {
		return "";
	}

	return `## Outcome\n\n${bulletList(renderOutcomeLines(session.execution.lastOutcome))}`;
}

function renderChangedArtifactsSection(session: Session): string {
	if (session.artifacts.length === 0) {
		return "";
	}

	return `## Changed Artifacts\n\n${bulletList(session.artifacts.map(renderArtifactLine))}`;
}

function renderLastValidationRunSection(session: Session): string {
	if (session.execution.lastValidationRun.length === 0) {
		return "";
	}

	return `## Last Validation Run\n\n${bulletList(session.execution.lastValidationRun.map(renderValidationLine))}`;
}

function renderExecutionHistoryOverviewSection(session: Session): string {
	if (session.execution.history.length === 0) {
		return "";
	}

	return `## Execution History\n\n${bulletList(session.execution.history.map(renderExecutionHistoryLine))}`;
}

export function renderIndexDoc(session: Session): string {
	const features = session.plan?.features ?? [];

	return joinSections([
		"# Flow Session",
		renderIndexSummarySection(session),
		renderTaskProgressSection(session),
		renderPlanSection(session, features),
		renderFeaturesSection(features),
		renderOutcomeSection(session),
		renderFeatureResultDetails(session.execution.lastFeatureResult),
		maybeSection("Notes", session.notes),
		renderChangedArtifactsSection(session),
		renderLastValidationRunSection(session),
		renderExecutionHistoryOverviewSection(session),
	]);
}
