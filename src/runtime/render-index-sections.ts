import {
	activeDecisionGate,
	decisionRequiresPause,
	summarizeCompletion,
} from "./domain";
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
import { deriveNextCommand } from "./summary";

function maybeApproachSection(session: Session): string {
	const approach = session.planning.implementationApproach;
	if (!approach) {
		return "";
	}

	return joinSections([
		"## Implementation Approach\n\n" +
			`- chosen direction: ${toInlineText(approach.chosenDirection)}`,
		maybeTitledList("Key Constraints", approach.keyConstraints, "###"),
		maybeTitledList("Validation Signals", approach.validationSignals, "###"),
		maybeTitledList("Sources", approach.sources, "###"),
	]).trimEnd();
}

function maybeDecisionLogSection(session: Session): string {
	const decisions = session.planning.decisionLog;
	if (decisions.length === 0) {
		return "";
	}

	return `## Decision Log\n\n${bulletList(
		decisions.map(
			(decision) =>
				`${decision.decisionDomain} | ${decision.decisionMode} | pause: ${decisionRequiresPause(decision.decisionMode) ? "yes" : "no"} | ${toInlineText(decision.question)} | recommended: ${toInlineText(decision.recommendation)} | options: ${decision.options.map((option) => toInlineText(option.label)).join(", ")}`,
		),
	)}`;
}

function maybeReplanLogSection(session: Session): string {
	const replans = session.planning.replanLog;
	if (replans.length === 0) {
		return "";
	}

	return `## Replan Log\n\n${bulletList(
		replans.map(
			(replan) =>
				`${replan.recordedAt} | ${replan.reason} | ${toInlineText(replan.summary)} | failed assumption: ${toInlineText(replan.failedAssumption)} | adjust: ${toInlineText(replan.recommendedAdjustment)}`,
		),
	)}`;
}

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

function renderPlanSection(session: Session, features: Feature[]): string {
	const plan = session.plan;
	const activeFeature =
		features.find(
			(feature) => feature.id === session.execution.activeFeatureId,
		) ?? null;
	const completion = summarizeCompletion(session);
	const completedCount =
		completion?.completedFeatures ??
		features.filter((feature) => feature.status === "completed").length;
	const planLines = [
		`- summary: ${toInlineText(plan?.summary ?? "No plan yet.")}`,
		`- overview: ${toInlineText(plan?.overview ?? "No plan yet.")}`,
		`- progress: ${completedCount}/${features.length} completed`,
		`- active feature: ${activeFeature ? activeFeature.id : "none"}`,
	];

	if (completion) {
		planLines.push(
			`- completion target: ${completion.targetCompletedFeatures}/${completion.totalFeatures} features`,
		);
		planLines.push(
			`- stop rule: ${plan?.deliveryPolicy?.stopRule ?? "ship_when_clean"}`,
		);
		planLines.push(
			`- priority mode: ${plan?.deliveryPolicy?.priorityMode ?? "balanced"}`,
		);
		planLines.push(
			`- defer allowed: ${plan?.deliveryPolicy?.deferAllowed ? "yes" : "no"}`,
		);
		planLines.push(
			`- pending allowed at completion: ${completion.canCompleteWithPendingFeatures ? "yes" : "no"}`,
		);
		planLines.push(
			`- active feature triggers session completion: ${completion.activeFeatureTriggersSessionCompletion ? "yes" : "no"}`,
		);
	}

	return joinSections([
		`## Plan

${planLines.join("\n")}`,
		maybeSection("Requirements", plan?.requirements ?? []),
		maybeSection("Architecture Decisions", plan?.architectureDecisions ?? []),
		maybeSection("Repo Profile", session.planning.repoProfile),
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

	return `## Changed Artifacts\n\n${bulletList(session.artifacts.map((artifact) => (artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path)))}`;
}

function renderLastValidationRunSection(session: Session): string {
	if (session.execution.lastValidationRun.length === 0) {
		return "";
	}

	return `## Last Validation Run\n\n${bulletList(session.execution.lastValidationRun.map((item) => `${item.status} | ${item.command} | ${item.summary}`))}`;
}

function renderExecutionHistoryOverviewSection(session: Session): string {
	if (session.execution.history.length === 0) {
		return "";
	}

	return `## Execution History\n\n${bulletList(session.execution.history.map((item) => `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`))}`;
}

export function renderIndexDoc(session: Session): string {
	const features = session.plan?.features ?? [];

	return joinSections([
		"# Flow Session",
		renderIndexSummarySection(session),
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
