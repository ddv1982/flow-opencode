import {
	activeDecisionGate,
	decisionRequiresPause,
	summarizeCompletion,
} from "../domain";
import type { Feature, Session } from "../schema";
import { deriveNextCommand } from "../session-operator-state";
import {
	renderArtifactLine,
	renderExecutionHistoryLine,
	renderOutcomeLines,
	renderValidationLine,
} from "./evidence";
import {
	bulletList,
	formatFollowUpLines,
	joinSections,
	maybeSection,
	maybeTitledList,
	toInlineText,
} from "./markdown";

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

function renderPlanOverviewLines(
	session: Session,
	features: Feature[],
): string[] {
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
		...(session.planning.packageManager
			? [`- package manager: ${session.planning.packageManager}`]
			: []),
		...(session.planning.packageManagerAmbiguous
			? [
					"- package manager evidence: ambiguous (multiple lockfile families detected in the same directory)",
				]
			: []),
		`- progress: ${completedCount}/${features.length} completed`,
		`- active feature: ${activeFeature ? activeFeature.id : "none"}`,
	];

	if (!completion) {
		return planLines;
	}

	return [
		...planLines,
		`- completion target: ${completion.targetCompletedFeatures}/${completion.totalFeatures} features`,
		`- stop rule: ${plan?.deliveryPolicy?.stopRule ?? "ship_when_clean"}`,
		`- priority mode: ${plan?.deliveryPolicy?.priorityMode ?? "balanced"}`,
		`- final review policy: ${plan?.deliveryPolicy?.finalReviewPolicy ?? "detailed"}`,
		`- defer allowed: ${plan?.deliveryPolicy?.deferAllowed ? "yes" : "no"}`,
		`- pending allowed at completion: ${completion.canCompleteWithPendingFeatures ? "yes" : "no"}`,
		`- active feature triggers session completion: ${completion.activeFeatureTriggersSessionCompletion ? "yes" : "no"}`,
	];
}

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

function maybeStackProfileSection(session: Session): string {
	const profile = session.planning.stackProfile;
	if (!profile) {
		return "";
	}

	const sections: Array<{ label: string; entries: Array<{ name: string }> }> = [
		{ label: "languages", entries: profile.languages },
		{ label: "frameworks", entries: profile.frameworks },
		{ label: "runtimes", entries: profile.runtimes },
		{ label: "package managers", entries: profile.packageManagers },
		{ label: "tools", entries: profile.tools },
	];

	const lines = sections
		.map(({ label, entries }) => {
			const names = entries.map((entry) => entry.name);
			return names.length > 0 ? `- ${label}: ${names.join(", ")}` : "";
		})
		.filter(Boolean);

	return lines.length === 0 ? "" : `## Stack Profile\n\n${lines.join("\n")}`;
}

function maybeStandardsProfileSection(session: Session): string {
	const profile = session.planning.standardsProfile;
	if (!profile) {
		return "";
	}

	const lines = [
		...profile.precedence.map((item) => `- precedence: ${toInlineText(item)}`),
		...profile.localGuidelines.map(
			(item) => `- local: ${toInlineText(item.title)} | ${item.reference}`,
		),
		...profile.externalGuidance.map(
			(item) => `- external: ${toInlineText(item.title)} | ${item.reference}`,
		),
		...profile.rules.map((item) => `- rule: ${toInlineText(item.summary)}`),
		...profile.gaps.map(
			(item) =>
				`- gap: ${toInlineText(item.stackItem)} | ${toInlineText(item.reason)} | research: ${item.suggestedResearch.map(toInlineText).join(", ")}`,
		),
	];

	return lines.length === 0
		? ""
		: `## Standards Profile\n\n${lines.join("\n")}`;
}

function renderPlanSection(session: Session, features: Feature[]): string {
	const plan = session.plan;

	return joinSections([
		`## Plan

${renderPlanOverviewLines(session, features).join("\n")}`,
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

function renderFeatureResultDetails(
	featureResult: Session["execution"]["lastFeatureResult"],
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

export function renderIndexDoc(session: Session): string {
	const features = session.plan?.features ?? [];

	return joinSections([
		"# Flow Session",
		renderIndexSummarySection(session),
		renderPlanSection(session, features),
		`## Features\n\n${
			features.length === 0
				? "- none"
				: features
						.map(
							(feature) =>
								`- ${feature.id} | ${feature.status} | ${toInlineText(feature.title)}`,
						)
						.join("\n")
		}`,
		session.execution.lastOutcome
			? `## Outcome\n\n${bulletList(renderOutcomeLines(session.execution.lastOutcome))}`
			: "",
		renderFeatureResultDetails(session.execution.lastFeatureResult),
		maybeSection("Notes", session.notes),
		session.artifacts.length > 0
			? `## Changed Artifacts\n\n${bulletList(session.artifacts.map(renderArtifactLine))}`
			: "",
		session.execution.lastValidationRun.length > 0
			? `## Last Validation Run\n\n${bulletList(session.execution.lastValidationRun.map(renderValidationLine))}`
			: "",
		session.execution.history.length > 0
			? `## Execution History\n\n${bulletList(session.execution.history.map(renderExecutionHistoryLine))}`
			: "",
	]);
}
