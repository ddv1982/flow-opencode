import type { Session } from "../schema";
import type {
	closeSession,
	listSessionHistory,
	loadStoredSession,
} from "../session";
import { deriveSessionOperatorState } from "../session-operator-state";
import { deriveSessionViewModel, explainSessionState } from "../summary";
import { renderSessionStatusSummary } from "./operator-presenters";
import { guidanceFields } from "./session-presenter-shared";
import {
	toCompactJson,
	toJson,
	type WorkspaceContextSummary,
} from "./workspace-runtime";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type CompletedSessionRecord = Awaited<ReturnType<typeof closeSession>>;
type StatusView = "detailed" | "compact";
type AutoPrepareMode = "resume" | "missing_goal" | "start_new_goal";

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

export function historyResponse(history: SessionHistory, nextCommand: string) {
	const activeCount = history.active ? 1 : 0;
	const totalCount =
		activeCount + history.stored.length + history.completed.length;
	const parkedCount = history.stored.filter(
		(session) => session.status !== "completed",
	).length;
	const metadata = {
		totalCount,
		activeCount,
		storedCount: history.stored.length,
		parkedCount,
		completedCount: history.completed.length,
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

export function storedSessionResponse(
	sessionId: string,
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
) {
	const viewModel = deriveSessionViewModel(found.session);
	const summarizedSession = viewModel.session;
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

export function statusResponse(
	session: Session | null | undefined,
	view: StatusView = "detailed",
	workspace?: WorkspaceContextSummary,
) {
	const viewModel = deriveSessionViewModel(session ?? null);
	const normalizedSession = session ?? null;
	const guidance = viewModel.guidance;
	const operatorSummary = renderSessionStatusSummary(normalizedSession);
	const workspaceRoot = workspace?.root ?? null;
	if (view === "compact") {
		return toCompactJson({
			status: viewModel.status,
			summary: viewModel.summary,
			finalReviewPolicy: viewModel.session?.finalReviewPolicy ?? null,
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
		finalReviewPolicy: viewModel.session?.finalReviewPolicy ?? null,
		...(viewModel.session ? { session: viewModel.session } : {}),
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
					...guidanceFields(guidance),
					nextCommand,
				}
			: mode === "resume" && goal
				? {
						status: "ok" as const,
						mode: "resume" as const,
						goal,
						summary: `Resuming active Flow goal: ${goal}`,
						...guidanceFields(guidance),
						nextCommand,
					}
				: {
						status: "ok" as const,
						mode: "start_new_goal" as const,
						goal,
						summary: `Starting a new autonomous Flow goal: ${goal}`,
						...guidanceFields(guidance),
						nextCommand,
					};
	return {
		payload: toJson(payload),
		metadata: {
			mode,
			goal,
			operator: deriveSessionOperatorState(session ?? null),
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
