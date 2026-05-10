import {
	type FeatureDocDrilldownSource,
	type FeatureDocDrilldownTarget,
	resolveFeatureDocDrilldownTarget,
} from "../feature-doc-drilldown";
import type { Session } from "../schema";
import type {
	closeSession,
	listSessionHistory,
	loadStoredSession,
} from "../session";
import { deriveSessionOperatorState } from "../session-operator-state";
import {
	deriveSessionViewModel,
	explainSessionState,
	type SummarizedSessionDetails,
} from "../summary";
import { renderSessionStatusSummary } from "./operator-presenters";
import { guidanceFields } from "./session-presenter-shared";
import {
	toCompactJson,
	toJson,
	type WorkspaceContextSummary,
} from "./workspace-runtime";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type SessionHistoryEntry = NonNullable<SessionHistory["active"]>;
type LatestFailedAttempt = SessionHistoryEntry["latestFailedAttempt"];
type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type CompletedSessionRecord = Awaited<ReturnType<typeof closeSession>>;
type StatusView = "detailed" | "compact";
type AutoPrepareMode = "resume" | "missing_goal" | "start_new_goal";
export type AutoPrepareAttachmentGuidance = {
	status: "unavailable" | "none" | "available" | "mixed" | "unsupported_only";
	source: "current_message" | "latest_batch" | "none";
	supportedFormats: string;
	unsupportedFormats: readonly ["SVG"];
	materializationRequired: boolean;
	materialize: null | {
		tool: "flow_attachments_materialize";
		args: { destinationDirectory: string };
		requiredBefore: readonly ["planning", "repo_inspection", "task_handoff"];
		useImplicitCurrentBatch: true;
	};
	attachments: readonly {
		id: string;
		filename?: string;
		mime: string;
	}[];
	skipped: readonly {
		attachmentId?: string;
		filename?: string;
		reason: string;
	}[];
	reason: string;
};
type SessionFeatureDrilldownSource = FeatureDocDrilldownSource | null;

const DEFAULT_AUTO_PREPARE_ATTACHMENT_GUIDANCE: AutoPrepareAttachmentGuidance =
	{
		status: "unavailable",
		source: "none",
		supportedFormats: "PNG, JPEG, WebP, GIF, and AVIF",
		unsupportedFormats: ["SVG"],
		materializationRequired: false,
		materialize: null,
		attachments: [],
		skipped: [],
		reason: "Attachment availability was not evaluated for this invocation.",
	};

function activeFeatureDrilldownSource(
	session: Session | null,
	workspace?: WorkspaceContextSummary,
): SessionFeatureDrilldownSource {
	if (!session || !workspace?.root) {
		return null;
	}
	return {
		location: "active",
		worktree: workspace.root,
		sessionId: session.id,
	};
}

function storedFeatureDrilldownSource(
	found: NonNullable<StoredSessionRecord>,
	workspace?: WorkspaceContextSummary,
): SessionFeatureDrilldownSource {
	if (!workspace?.root) {
		return null;
	}
	return {
		location: found.source,
		worktree: workspace.root,
		sessionDir: found.completedPath ?? found.path,
		sessionId: found.session.id,
	};
}

function collectFeatureDrilldownIds(
	session: SummarizedSessionDetails,
): string[] {
	return Array.from(
		new Set(
			[
				session.activeFeature?.id,
				...session.taskProgress.map((row) => row.featureId),
			].filter((id): id is string => Boolean(id)),
		),
	);
}

async function resolveFeatureDrilldownMap(
	session: SummarizedSessionDetails,
	source: SessionFeatureDrilldownSource,
): Promise<Map<string, FeatureDocDrilldownTarget>> {
	if (!source) {
		return new Map();
	}
	const entries = await Promise.all(
		collectFeatureDrilldownIds(session).map(async (featureId) => {
			try {
				return [
					featureId,
					await resolveFeatureDocDrilldownTarget({ featureId, source }),
				] as const;
			} catch {
				return null;
			}
		}),
	);
	return new Map(
		entries.filter(
			(entry): entry is readonly [string, FeatureDocDrilldownTarget] =>
				entry !== null,
		),
	);
}

function featureDrilldownField(
	drilldowns: Map<string, FeatureDocDrilldownTarget>,
	featureId: string | undefined,
): { featureDrilldown: FeatureDocDrilldownTarget } | Record<string, never> {
	if (!featureId) {
		return {};
	}
	const featureDrilldown = drilldowns.get(featureId);
	return featureDrilldown ? { featureDrilldown } : {};
}

async function withFeatureDrilldowns(
	session: SummarizedSessionDetails,
	source: SessionFeatureDrilldownSource,
): Promise<SummarizedSessionDetails> {
	const drilldowns = await resolveFeatureDrilldownMap(session, source);
	if (drilldowns.size === 0) {
		return session;
	}
	return {
		...session,
		activeFeature: session.activeFeature
			? {
					...session.activeFeature,
					...featureDrilldownField(drilldowns, session.activeFeature.id),
				}
			: null,
		taskProgress: session.taskProgress.map((row) => ({
			...row,
			...featureDrilldownField(drilldowns, row.featureId),
		})),
	};
}

function storedSessionGuidance(
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
) {
	const guidance = explainSessionState(found.session);
	if (found.active || found.session.status === "completed") {
		return { ...guidance, nextCommand };
	}
	return {
		...guidance,
		nextStep: "Activate this session to continue it in the current worktree.",
		nextCommand,
	};
}

function storedSessionInactiveWarning(
	found: NonNullable<StoredSessionRecord>,
): string | null {
	return found.source === "stored" && found.session.status !== "completed"
		? "Stored session is parked/inactive; activate it before continuing. Direct work outside Flow will not update this session's runtime state, reviewer records, validation records, or completion artifacts."
		: null;
}

function parkedStoredTaskProgressRows(
	found: NonNullable<StoredSessionRecord>,
	rows: NonNullable<
		ReturnType<typeof deriveSessionViewModel>["session"]
	>["taskProgress"],
	nextStep: string,
) {
	if (
		found.source !== "stored" ||
		found.active ||
		found.session.status === "completed"
	) {
		return rows;
	}
	return rows.map((row) =>
		row.status === "completed" ? row : { ...row, next: nextStep },
	);
}

export function missingStoredSessionResponse(
	sessionId: string,
	nextCommand: string,
) {
	const operator = deriveSessionOperatorState(null);
	return toJson({
		status: "missing_session",
		summary: `No stored Flow session exists for id '${sessionId}'.`,
		operator,
		...guidanceFields(operator),
		nextCommand,
	});
}

function collectHistoryEntries(history: SessionHistory): SessionHistoryEntry[] {
	return [
		...(history.active ? [history.active] : []),
		...history.stored,
		...history.completed,
	];
}

function latestHistoryFailedAttempt(
	history: SessionHistory,
): LatestFailedAttempt {
	return (
		collectHistoryEntries(history)
			.filter((entry) => entry.latestFailedAttempt)
			.sort((left, right) =>
				(right.latestFailedAttempt?.occurredAt ?? "").localeCompare(
					left.latestFailedAttempt?.occurredAt ?? "",
				),
			)[0]?.latestFailedAttempt ?? null
	);
}

function historyFailedAttemptGroups(history: SessionHistory) {
	const groups = new Map<
		string,
		{
			tool: NonNullable<LatestFailedAttempt>["tool"];
			failureCategory: string;
			count: number;
			sessionIds: string[];
			latestOccurredAt: string | null;
			recoveryHint?: string;
		}
	>();
	for (const entry of collectHistoryEntries(history)) {
		const failure = entry.latestFailedAttempt;
		if (!failure) continue;
		const key = `${failure.tool}:${failure.failureCategory}`;
		const existing = groups.get(key);
		const attemptCount = failure.sameCategoryFailureCount ?? 1;
		if (existing) {
			existing.count += attemptCount;
			existing.sessionIds.push(entry.id);
			if ((failure.occurredAt ?? "") > (existing.latestOccurredAt ?? "")) {
				existing.latestOccurredAt = failure.occurredAt ?? null;
				if (failure.recoveryHint) {
					existing.recoveryHint = failure.recoveryHint;
				}
			}
			continue;
		}
		groups.set(key, {
			tool: failure.tool,
			failureCategory: failure.failureCategory,
			count: attemptCount,
			sessionIds: [entry.id],
			latestOccurredAt: failure.occurredAt ?? null,
			...(failure.recoveryHint ? { recoveryHint: failure.recoveryHint } : {}),
		});
	}
	return [...groups.values()].sort((left, right) =>
		(right.latestOccurredAt ?? "").localeCompare(left.latestOccurredAt ?? ""),
	);
}

export function historyResponse(history: SessionHistory, nextCommand: string) {
	const activeCount = history.active ? 1 : 0;
	const totalCount =
		activeCount + history.stored.length + history.completed.length;
	const parkedCount = history.stored.filter(
		(session) => session.status !== "completed",
	).length;
	const latestFailedAttempt = latestHistoryFailedAttempt(history);
	const failedAttemptGroups = historyFailedAttemptGroups(history);
	const metadata = {
		totalCount,
		activeCount,
		storedCount: history.stored.length,
		parkedCount,
		completedCount: history.completed.length,
		failedAttemptGroupCount: failedAttemptGroups.length,
	};
	if (totalCount === 0) {
		const guidance = explainSessionState(null);
		const operator = deriveSessionOperatorState(null);
		return {
			payload: toJson({
				status: "missing",
				summary: "No Flow session history found.",
				operator,
				...guidanceFields(guidance),
				history,
				latestFailedAttempt,
				failedAttemptGroups,
				nextCommand,
			}),
			metadata,
		};
	}
	return {
		payload: toJson({
			status: "ok",
			summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.stored.length} stored/${parkedCount} parked, ${history.completed.length} completed).`,
			history,
			latestFailedAttempt,
			failedAttemptGroups,
			...(parkedCount > 0
				? {
						warning:
							"Stored non-completed sessions are parked/inactive snapshots. Activate a stored session before continuing it; direct work outside Flow will not update its runtime records.",
					}
				: {}),
			nextCommand,
		}),
		metadata,
	};
}

export async function storedSessionResponse(
	sessionId: string,
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
	workspace?: WorkspaceContextSummary,
): Promise<string> {
	const viewModel = deriveSessionViewModel(found.session);
	const summarizedSession = viewModel.session
		? await withFeatureDrilldowns(
				viewModel.session,
				storedFeatureDrilldownSource(found, workspace),
			)
		: null;
	if (!summarizedSession) {
		throw new Error("Stored Flow session summary unexpectedly missing.");
	}
	const guidance = storedSessionGuidance(found, nextCommand);
	const operator = deriveSessionOperatorState(found.session);
	const historySession = found.active
		? summarizedSession
		: { ...summarizedSession, nextCommand };
	const inactiveWarning = storedSessionInactiveWarning(found);
	const parkedAwareSession = {
		...historySession,
		taskProgress: parkedStoredTaskProgressRows(
			found,
			historySession.taskProgress,
			guidance.nextStep,
		),
	};
	return toJson({
		status: "ok",
		summary: inactiveWarning
			? `Showing parked Flow session '${sessionId}'.`
			: `Showing ${found.source} Flow session '${sessionId}'.`,
		source: found.source,
		active: found.active,
		parked:
			found.source === "stored" &&
			!found.active &&
			found.session.status !== "completed",
		path: found.path,
		completedPath: found.completedPath ?? null,
		completedAt: found.completedAt ?? null,
		closure: found.session.closure ?? null,
		operator,
		...guidanceFields(guidance),
		session: parkedAwareSession,
		guidance,
		...(inactiveWarning ? { warning: inactiveWarning } : {}),
		operatorSummary: renderSessionStatusSummary(found.session, {
			nextCommand: guidance.nextCommand,
			nextStep: guidance.nextStep,
			taskProgressOverride: parkedAwareSession.taskProgress,
		}),
		nextCommand,
	});
}

export async function statusResponse(
	session: Session | null | undefined,
	view: StatusView = "detailed",
	workspace?: WorkspaceContextSummary,
): Promise<string> {
	const viewModel = deriveSessionViewModel(session ?? null);
	const normalizedSession = session ?? null;
	const guidance = viewModel.guidance;
	const presentedSession = viewModel.session
		? await withFeatureDrilldowns(
				viewModel.session,
				activeFeatureDrilldownSource(normalizedSession, workspace),
			)
		: null;
	const operatorSummary = renderSessionStatusSummary(
		normalizedSession,
		presentedSession
			? { taskProgressOverride: presentedSession.taskProgress }
			: undefined,
	);
	const workspaceRoot = workspace?.root ?? null;
	const activeFeatureDrilldown =
		presentedSession?.activeFeature?.featureDrilldown ?? null;
	if (view === "compact") {
		return toCompactJson({
			status: viewModel.status,
			summary: viewModel.summary,
			finalReviewPolicy: presentedSession?.finalReviewPolicy ?? null,
			...(presentedSession?.latestFailedAttempt
				? { latestFailedAttempt: presentedSession.latestFailedAttempt }
				: {}),
			...(activeFeatureDrilldown ? { activeFeatureDrilldown } : {}),
			...guidanceFields(guidance),
			guidance,
			operatorSummary,
			nextCommand: guidance.nextCommand,
			workspaceRoot,
			workspace: workspace ?? null,
		});
	}
	return toJson({
		status: viewModel.status,
		summary: viewModel.summary,
		finalReviewPolicy: presentedSession?.finalReviewPolicy ?? null,
		...(presentedSession?.latestFailedAttempt
			? { latestFailedAttempt: presentedSession.latestFailedAttempt }
			: {}),
		...(activeFeatureDrilldown ? { activeFeatureDrilldown } : {}),
		...(presentedSession ? { session: presentedSession } : {}),
		...guidanceFields(guidance),
		guidance,
		operatorSummary,
		workspaceRoot,
		workspace: workspace ?? null,
	});
}

export function autoPrepareResponse(
	mode: AutoPrepareMode,
	goal: string | null,
	nextCommand: string,
	session?: Session | null,
	attachmentGuidance: AutoPrepareAttachmentGuidance = DEFAULT_AUTO_PREPARE_ATTACHMENT_GUIDANCE,
) {
	const guidance =
		mode === "resume" && session
			? explainSessionState(session)
			: mode === "missing_goal"
				? explainSessionState(null)
				: {
						...explainSessionState(null),
						summary: `Flow should start a new autonomous goal: ${goal}`,
						blocker: null,
						reason:
							"A new explicit goal was provided, so Flow should start a fresh session for it.",
						nextStep: "Start the new autonomous goal.",
						nextCommand,
					};
	const payload =
		mode === "missing_goal"
			? {
					status: "missing_goal" as const,
					mode: "missing_goal" as const,
					summary:
						"No active Flow session exists. Provide a goal to start a new autonomous run.",
					attachmentGuidance,
					...guidanceFields(guidance),
					nextCommand,
				}
			: mode === "resume" && goal
				? {
						status: "ok" as const,
						mode: "resume" as const,
						goal,
						summary: `Resuming active Flow goal: ${goal}`,
						attachmentGuidance,
						...guidanceFields(guidance),
						nextCommand,
					}
				: {
						status: "ok" as const,
						mode: "start_new_goal" as const,
						goal,
						summary: `Starting a new autonomous Flow goal: ${goal}`,
						attachmentGuidance,
						...guidanceFields(guidance),
						nextCommand,
					};
	return {
		payload: toJson(payload),
		metadata: {
			mode,
			goal,
			operator: deriveSessionOperatorState(session ?? null),
			attachmentStatus: attachmentGuidance.status,
			attachmentMaterializationRequired:
				attachmentGuidance.materializationRequired,
			attachmentCount: attachmentGuidance.attachments.length,
			attachmentSkippedCount: attachmentGuidance.skipped.length,
		},
	};
}

export function closeSessionResponse(
	completed: CompletedSessionRecord,
	nextCommand: string,
) {
	const operator = deriveSessionOperatorState(null);
	return toJson({
		status: "ok",
		summary: completed
			? `Closed the active Flow session as ${completed.closureKind}.`
			: "No active Flow session existed.",
		operator,
		phase: operator.phase,
		lane: operator.lane,
		laneReason: operator.laneReason,
		blocker: operator.blocker,
		reason: operator.reason,
		completedSessionId: completed?.sessionId ?? null,
		completedTo: completed?.completedTo ?? null,
		closureKind: completed?.closureKind ?? null,
		nextCommand,
	});
}
