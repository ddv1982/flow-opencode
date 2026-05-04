import { decisionRequiresPause, summarizeCompletion } from "./domain";
import {
	bulletList,
	joinSections,
	maybeTitledList,
	toInlineText,
} from "./render-sections-shared";
import type { Feature, Session } from "./schema";

export function renderPlanOverviewLines(
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

export function maybeApproachSection(session: Session): string {
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

export function maybeDecisionLogSection(session: Session): string {
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

export function maybeReplanLogSection(session: Session): string {
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

export function maybeStackProfileSection(session: Session): string {
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

export function maybeStandardsProfileSection(session: Session): string {
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
