/**
 * Session doc rendering: the markdown views Flow derives from a session
 * snapshot (`docs/index.md` plus one doc per feature) and the change-aware
 * IO that writes them. These docs back the feature drilldown paths surfaced
 * in flow_status output; the structured data itself lives in the session
 * JSON, so sections here stay deliberately compact.
 */
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { buildContextPackProjection } from "./context-pack";
import {
	activeDecisionGate,
	decisionRequiresPause,
	summarizeCompletion,
} from "./domain";
import {
	getContextDocPathFromSessionDir,
	getFeatureDocPathFromSessionDir,
	getFeaturesDocsDirFromSessionDir,
	getIndexDocPathFromSessionDir,
	getSessionDir,
	type LiveSessionLocation,
} from "./paths";
import type { Feature, Session } from "./schema";
import { deriveNextCommand } from "./session-operator-state";
import { assertMutableWorkspaceRoot } from "./workspace-root";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function toInlineText(value: string): string {
	return value.replace(/\r?\n+/g, " / ").trim();
}

function bulletList(items: string[]): string {
	if (items.length === 0) {
		return "- none";
	}

	return items.map((item) => `- ${toInlineText(item)}`).join("\n");
}

function joinSections(sections: string[]): string {
	return `${sections.filter(Boolean).join("\n\n")}\n`;
}

function maybeSection(title: string, items: string[]): string {
	if (items.length === 0) {
		return "";
	}

	return `## ${title}\n\n${bulletList(items)}`;
}

function maybeTitledList(title: string, items: string[], level = "##"): string {
	if (items.length === 0) {
		return "";
	}

	return `${level} ${title}\n\n${bulletList(items)}`;
}

function toQuotedBlock(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		return "> none";
	}

	return normalized
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
}

function maybeQuotedSection(
	title: string,
	value: string | null | undefined,
): string {
	if (!value) {
		return "";
	}

	return `## ${title}\n\n${toQuotedBlock(value)}`;
}

function formatFollowUpLines(
	items: Array<{ summary: string; severity?: string | undefined }>,
): string[] {
	return items.map((item) =>
		item.severity ? `${item.summary} (${item.severity})` : item.summary,
	);
}

function maybeListLine(label: string, items: string[] | undefined): string[] {
	return items && items.length > 0
		? [`${label}: ${items.map(toInlineText).join(", ")}`]
		: [];
}

// ---------------------------------------------------------------------------
// Record line formatters
// ---------------------------------------------------------------------------

type ArtifactRecord = Session["artifacts"][number];
type ValidationRecord = Session["execution"]["lastValidationRun"][number];
type ExecutionHistoryEntry = Session["execution"]["history"][number];
type ReviewerDecision = NonNullable<ExecutionHistoryEntry["reviewerDecision"]>;

function renderArtifactLine(artifact: ArtifactRecord): string {
	return artifact.kind ? `${artifact.path} (${artifact.kind})` : artifact.path;
}

function renderValidationLine(item: ValidationRecord): string {
	return `${item.status} | ${item.command} | ${item.summary}`;
}

function renderExecutionHistoryLine(item: ExecutionHistoryEntry): string {
	return `${item.recordedAt} | ${item.featureId} | ${item.status} | ${item.summary}`;
}

function renderOutcomeLines(
	outcome:
		| {
				kind: string;
				category?: string | undefined;
				summary?: string | undefined;
				resolutionHint?: string | undefined;
				retryable?: boolean | undefined;
				autoResolvable?: boolean | undefined;
				needsHuman?: boolean | undefined;
		  }
		| null
		| undefined,
): string[] {
	if (!outcome) {
		return [];
	}

	return [
		`kind: ${outcome.kind}`,
		...(outcome.category
			? [`category: ${toInlineText(outcome.category)}`]
			: []),
		...(outcome.summary ? [`summary: ${toInlineText(outcome.summary)}`] : []),
		...(outcome.resolutionHint
			? [`resolution hint: ${toInlineText(outcome.resolutionHint)}`]
			: []),
		...(outcome.retryable !== undefined
			? [`retryable: ${outcome.retryable ? "yes" : "no"}`]
			: []),
		...(outcome.autoResolvable !== undefined
			? [`auto resolvable: ${outcome.autoResolvable ? "yes" : "no"}`]
			: []),
		...(outcome.needsHuman !== undefined
			? [`needs human: ${outcome.needsHuman ? "yes" : "no"}`]
			: []),
	];
}

// ---------------------------------------------------------------------------
// Review rendering (shared between reviewer decisions and review payloads)
// ---------------------------------------------------------------------------

type ReviewDetails = {
	reviewDepth?: string | undefined;
	reviewedSurfaces?: string[] | undefined;
	evidenceSummary?: string | undefined;
	validationAssessment?: string | undefined;
	evidenceRefs?:
		| {
				changedArtifacts: string[];
				validationCommands: string[];
		  }
		| undefined;
	integrationChecks?: string[] | undefined;
	regressionChecks?: string[] | undefined;
	remainingGaps?: string[] | undefined;
};

function reviewDetailLines(review: ReviewDetails): string[] {
	return [
		...(review.reviewDepth ? [`review depth: ${review.reviewDepth}`] : []),
		...maybeListLine("reviewed surfaces", review.reviewedSurfaces),
		...(review.evidenceSummary
			? [`evidence: ${toInlineText(review.evidenceSummary)}`]
			: []),
		...(review.validationAssessment
			? [`validation assessment: ${toInlineText(review.validationAssessment)}`]
			: []),
		...maybeListLine(
			"evidence changed artifacts",
			review.evidenceRefs?.changedArtifacts,
		),
		...maybeListLine(
			"evidence validation commands",
			review.evidenceRefs?.validationCommands,
		),
		...maybeListLine("integration checks", review.integrationChecks),
		...maybeListLine("regression checks", review.regressionChecks),
		...maybeListLine("remaining gaps", review.remainingGaps),
	];
}

function renderReviewerDecisionLines(decision: ReviewerDecision): string[] {
	return [
		`scope: ${decision.scope}`,
		...(decision.scope === "feature"
			? [`feature id: ${decision.featureId}`]
			: reviewDetailLines(decision)),
		`status: ${decision.status}`,
		`summary: ${decision.summary}`,
	];
}

function renderReviewBlock(
	title: string,
	review:
		| (ReviewDetails & {
				status: string;
				summary: string;
				blockingFindings: Array<{ summary: string }>;
		  })
		| undefined,
): string {
	if (!review) {
		return "";
	}

	const lines = [
		`- status: ${review.status}`,
		...reviewDetailLines(review).map((line) => `- ${line}`),
		`- summary: ${toInlineText(review.summary)}`,
		...(review.blockingFindings.length > 0
			? [bulletList(review.blockingFindings.map((item) => item.summary))]
			: []),
	];

	return `#### ${title}\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Feature doc
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Index doc
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Context pack doc
// ---------------------------------------------------------------------------

export function renderContextPackDoc(session: Session): string {
	const contextPack = buildContextPackProjection(session);

	return joinSections([
		"# Flow Context Pack",
		`## Summary

- session id: ${contextPack.sessionId}
- goal: ${toInlineText(contextPack.goal)}
- features: ${contextPack.features.length}
- diagnostics: ${contextPack.diagnostics.length}
- readiness: ${contextPack.workflowReadiness.state}
- readiness blocking: ${contextPack.workflowReadiness.blocking.length}
- readiness warnings: ${contextPack.workflowReadiness.warnings.length}
- next action: ${toInlineText(contextPack.workflowReadiness.nextAction)}`,
		contextPack.workflowReadiness.blocking.length > 0
			? `## Workflow Readiness

${bulletList(
	contextPack.workflowReadiness.blocking.map((item) =>
		[
			item.id,
			item.featureId ? `feature: ${item.featureId}` : "",
			toInlineText(item.summary),
			`remediation: ${toInlineText(item.remediation)}`,
		]
			.filter(Boolean)
			.join(" | "),
	),
)}`
			: "",
		maybeSection("Repo Profile", contextPack.repoProfile),
		maybeSection("Research", contextPack.research),
		maybeSection("Requirements", contextPack.requirements),
		maybeSection("Architecture Decisions", contextPack.architectureDecisions),
		maybeSection("Notes", contextPack.notes),
		`## Traceability Summary

- planned targets: ${contextPack.traceability.plannedTargetCount}
- changed artifacts: ${contextPack.traceability.changedArtifactCount}
- validation commands: ${contextPack.traceability.validationCommandCount}
- reviewed features: ${contextPack.traceability.reviewedFeatureCount}
- unplanned changed artifacts: ${contextPack.traceability.unplannedChangedArtifacts.length > 0 ? contextPack.traceability.unplannedChangedArtifacts.map(toInlineText).join(", ") : "none"}`,
		`## Feature Context

${
	contextPack.traceability.features.length === 0
		? "- none"
		: contextPack.traceability.features
				.map((feature) =>
					[
						`### ${feature.id}`,
						`- title: ${toInlineText(feature.title)}`,
						`- status: ${feature.status}`,
						`- file targets: ${feature.fileTargets.length > 0 ? feature.fileTargets.map(toInlineText).join(", ") : "none"}`,
						`- review scope: ${feature.reviewScope.length > 0 ? feature.reviewScope.map(toInlineText).join(", ") : "none"}`,
						`- verification: ${feature.verification.length > 0 ? feature.verification.map(toInlineText).join(", ") : "none"}`,
						`- changed artifacts: ${feature.changedArtifacts.length > 0 ? feature.changedArtifacts.map(toInlineText).join(", ") : "none"}`,
						`- validation commands: ${feature.validationCommands.length > 0 ? feature.validationCommands.map(toInlineText).join(", ") : "none"}`,
						`- reviewer decision: ${feature.reviewerDecisionStatus ?? "none"}`,
						`- feature review: ${feature.featureReviewStatus ?? "none"}`,
						`- final review: ${feature.finalReviewStatus ?? "none"}`,
						`- gaps: ${feature.gaps.length > 0 ? feature.gaps.map((gap) => `${gap.id}: ${toInlineText(gap.summary)}`).join("; ") : "none"}`,
					].join("\n"),
				)
				.join("\n\n")
}`,
		maybeSection("Changed Artifacts", contextPack.changedArtifacts),
		maybeSection("Validation Commands", contextPack.validationCommands),
		contextPack.diagnostics.length > 0
			? `## Context Diagnostics

${bulletList(
	contextPack.diagnostics.map((diagnostic) =>
		[
			diagnostic.severity,
			diagnostic.id,
			diagnostic.featureId ? `feature: ${diagnostic.featureId}` : "",
			toInlineText(diagnostic.summary),
			`remediation: ${toInlineText(diagnostic.remediation)}`,
		]
			.filter(Boolean)
			.join(" | "),
	),
)}`
			: "",
	]);
}

// ---------------------------------------------------------------------------
// Doc IO
// ---------------------------------------------------------------------------

type RenderedDoc = {
	path: string;
	content: string;
};
const preparedFeaturesDocsDirs = new Set<string>();

function createContentHash(input: string): string {
	let hash = 2166136261;

	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

async function writeDocIfChanged(doc: RenderedDoc): Promise<boolean> {
	const nextHash = createContentHash(doc.content);

	try {
		const previousContent = await readFile(doc.path, "utf8");
		if (createContentHash(previousContent) === nextHash) {
			return false;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}

	await writeFile(doc.path, doc.content, "utf8");
	return true;
}

async function ensureSessionDocDirs(sessionDir: string): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(sessionDir);
	if (preparedFeaturesDocsDirs.has(featuresDir)) {
		try {
			await stat(featuresDir);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				preparedFeaturesDocsDirs.delete(featuresDir);
			} else {
				throw error;
			}
		}
	}

	await mkdir(featuresDir, { recursive: true });
	preparedFeaturesDocsDirs.add(featuresDir);
}

async function pruneFeatureDocs(
	sessionDir: string,
	activeFeatureIds: Set<string>,
): Promise<void> {
	const featuresDir = getFeaturesDocsDirFromSessionDir(sessionDir);

	try {
		const entries = await readdir(featuresDir, { withFileTypes: true });
		await Promise.all(
			entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
				.filter((entry) => !activeFeatureIds.has(entry.name.slice(0, -3)))
				.map((entry) =>
					rm(
						getFeatureDocPathFromSessionDir(
							sessionDir,
							entry.name.slice(0, -3),
						),
						{
							force: true,
						},
					),
				),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

export async function renderSessionDocsAtDir(
	sessionDir: string,
	session: Session,
): Promise<void> {
	const features = session.plan?.features ?? [];

	await ensureSessionDocDirs(sessionDir);
	await writeDocIfChanged({
		path: getIndexDocPathFromSessionDir(sessionDir),
		content: renderIndexDoc(session),
	});
	await writeDocIfChanged({
		path: getContextDocPathFromSessionDir(sessionDir),
		content: renderContextPackDoc(session),
	});

	await Promise.all(
		features.map((feature) =>
			writeDocIfChanged({
				path: getFeatureDocPathFromSessionDir(sessionDir, feature.id),
				content: renderFeatureDoc(session, feature),
			}),
		),
	);
	await pruneFeatureDocs(
		sessionDir,
		new Set(features.map((feature) => feature.id)),
	);
}

export async function renderSessionDocs(
	worktree: string,
	session: Session,
	location: LiveSessionLocation = "active",
): Promise<void> {
	await renderSessionDocsAtDir(
		getSessionDir(assertMutableWorkspaceRoot(worktree), session.id, location),
		session,
	);
}
