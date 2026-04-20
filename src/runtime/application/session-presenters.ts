import type { Session } from "../schema";
import type {
	closeSession,
	listSessionHistory,
	loadStoredSession,
} from "../session";
import { deriveSessionOperatorState } from "../session-operator-state";
import { deriveSessionViewModel, explainSessionState } from "../summary";
import { renderSessionStatusSummary } from "./operator-presenters";
import {
	toCompactJson,
	toJson,
	type WorkspaceContextSummary,
} from "./tool-runtime";

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

export function missingStoredSessionResponse(
	sessionId: string,
	nextCommand: string,
) {
	const operator = deriveSessionOperatorState(null);
	return toJson({
		status: "missing_session",
		summary: `No stored Flow session exists for id '${sessionId}'.`,
		operator,
		phase: operator.phase,
		lane: operator.lane,
		blocker: operator.blocker,
		reason: operator.reason,
		nextCommand,
	});
}

export function historyResponse(history: SessionHistory, nextCommand: string) {
	const activeCount = history.active ? 1 : 0;
	const totalCount =
		activeCount + history.stored.length + history.completed.length;
	const metadata = {
		totalCount,
		activeCount,
		storedCount: history.stored.length,
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
				phase: guidance.phase,
				lane: guidance.lane,
				blocker: guidance.blocker,
				reason: guidance.reason,
				history,
				nextCommand,
			}),
			metadata,
		};
	}
	return {
		payload: toJson({
			status: "ok",
			summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.stored.length} stored, ${history.completed.length} completed).`,
			history,
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
	const guidance = storedSessionGuidance(found, nextCommand);
	const operator = deriveSessionOperatorState(found.session);
	const historySession = found.active
		? summarizedSession
		: { ...summarizedSession, nextCommand };
	return toJson({
		status: "ok",
		summary: `Showing ${found.source} Flow session '${sessionId}'.`,
		source: found.source,
		active: found.active,
		path: found.path,
		completedPath: found.completedPath ?? null,
		completedAt: found.completedAt ?? null,
		closure: found.session.closure ?? null,
		operator,
		phase: guidance.phase,
		lane: guidance.lane,
		blocker: guidance.blocker,
		reason: guidance.reason,
		session: historySession,
		guidance,
		operatorSummary: renderSessionStatusSummary(found.session, {
			nextCommand: guidance.nextCommand,
			nextStep: guidance.nextStep,
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
			phase: guidance.phase,
			lane: guidance.lane,
			blocker: guidance.blocker,
			reason: guidance.reason,
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
		...(viewModel.session ? { session: viewModel.session } : {}),
		phase: guidance.phase,
		lane: guidance.lane,
		blocker: guidance.blocker,
		reason: guidance.reason,
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
					phase: guidance.phase,
					lane: guidance.lane,
					blocker: guidance.blocker,
					reason: guidance.reason,
					nextCommand,
				}
			: mode === "resume" && goal
				? {
						status: "ok" as const,
						mode: "resume" as const,
						goal,
						summary: `Resuming active Flow goal: ${goal}`,
						phase: guidance.phase,
						lane: guidance.lane,
						blocker: guidance.blocker,
						reason: guidance.reason,
						nextCommand,
					}
				: {
						status: "ok" as const,
						mode: "start_new_goal" as const,
						goal,
						summary: `Starting a new autonomous Flow goal: ${goal}`,
						phase: guidance.phase,
						lane: guidance.lane,
						blocker: guidance.blocker,
						reason: guidance.reason,
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
		blocker: operator.blocker,
		reason: operator.reason,
		completedSessionId: completed?.sessionId ?? null,
		completedTo: completed?.completedTo ?? null,
		closureKind: completed?.closureKind ?? null,
		nextCommand,
	});
}
