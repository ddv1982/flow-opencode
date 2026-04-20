/**
 * Session tool boundary: JSON response envelope assembly only.
 * Do not add next-command routing or activation/resume policy here.
 */
import {
	toCompactJson,
	toJson,
	type WorkspaceContextSummary,
} from "../../runtime/application";
import type { Session } from "../../runtime/schema";
import type {
	closeSession,
	listSessionHistory,
	loadStoredSession,
} from "../../runtime/session";
import {
	explainSessionState,
	renderSessionStatusSummary,
	summarizeSession,
} from "../../runtime/summary";
import type { FlowStatusArgs } from "../schemas";
import type { AutoPrepareMode } from "./next-command-policy";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type CompletedSessionRecord = Awaited<ReturnType<typeof closeSession>>;

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

export function missingGoalResponse(summary: string, nextCommand: string) {
	return toJson({ status: "missing_goal", summary, nextCommand });
}

export function missingStoredSessionResponse(
	sessionId: string,
	nextCommand: string,
) {
	return toJson({
		status: "missing_session",
		summary: `No stored Flow session exists for id '${sessionId}'.`,
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
		return {
			payload: toJson({
				status: "missing",
				summary: "No Flow session history found.",
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
	const summarizedSession = summarizeSession(found.session).session;
	const guidance = storedSessionGuidance(found, nextCommand);
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
	session?: Session | null,
	args: FlowStatusArgs = {},
	workspace?: WorkspaceContextSummary,
) {
	const normalizedSession = session ?? null;
	const guidance = explainSessionState(normalizedSession);
	const operatorSummary = renderSessionStatusSummary(normalizedSession);
	const view = args.view ?? "detailed";
	const workspaceRoot = workspace?.root ?? null;
	if (view === "compact") {
		const summary = summarizeSession(normalizedSession);
		return toCompactJson({
			status: summary.status,
			summary: summary.summary,
			guidance,
			operatorSummary,
			nextCommand: guidance.nextCommand,
			workspaceRoot,
			workspace: workspace ?? null,
		});
	}
	return toJson({
		...summarizeSession(normalizedSession),
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
) {
	const payload =
		mode === "missing_goal"
			? {
					status: "missing_goal" as const,
					mode: "missing_goal" as const,
					summary:
						"No active Flow session exists. Provide a goal to start a new autonomous run.",
					nextCommand,
				}
			: mode === "resume" && goal
				? {
						status: "ok" as const,
						mode: "resume" as const,
						goal,
						summary: `Resuming active Flow goal: ${goal}`,
						nextCommand,
					}
				: {
						status: "ok" as const,
						mode: "start_new_goal" as const,
						goal,
						summary: `Starting a new autonomous Flow goal: ${goal}`,
						nextCommand,
					};
	return {
		payload: toJson(payload),
		metadata: { mode, goal },
	};
}

export function closeSessionResponse(
	completed: CompletedSessionRecord,
	nextCommand: string,
) {
	return toJson({
		status: "ok",
		summary: completed
			? `Closed the active Flow session as ${completed.closureKind}.`
			: "No active Flow session existed.",
		completedSessionId: completed?.sessionId ?? null,
		completedTo: completed?.completedTo ?? null,
		closureKind: completed?.closureKind ?? null,
		nextCommand,
	});
}
