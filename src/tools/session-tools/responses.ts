/**
 * Session tool boundary: JSON response envelope assembly only.
 * Do not add next-command routing or activation/resume policy here.
 */
import { toJson } from "../../runtime/application";
import type { Session } from "../../runtime/schema";
import type {
	archiveSession,
	listSessionHistory,
	loadStoredSession,
} from "../../runtime/session";
import { summarizeSession } from "../../runtime/summary";
import type { AutoPrepareMode } from "./next-command-policy";

type SessionHistory = Awaited<ReturnType<typeof listSessionHistory>>;
type StoredSessionRecord = Awaited<ReturnType<typeof loadStoredSession>>;
type ArchivedSessionRecord = Awaited<ReturnType<typeof archiveSession>>;

export function missingGoalResponse(summary: string, nextCommand: string) {
	return toJson({
		status: "missing_goal",
		summary,
		nextCommand,
	});
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
	const activeCount = history.activeSessionId ? 1 : 0;
	const totalCount = history.sessions.length + history.archived.length;

	if (totalCount === 0) {
		return {
			payload: toJson({
				status: "missing",
				summary: "No Flow session history found.",
				history,
				nextCommand,
			}),
			metadata: {
				totalCount,
				activeCount,
				archivedCount: history.archived.length,
			},
		};
	}

	return {
		payload: toJson({
			status: "ok",
			summary: `Found ${totalCount} Flow session ${totalCount === 1 ? "entry" : "entries"} (${activeCount} active, ${history.archived.length} archived).`,
			history,
			nextCommand,
		}),
		metadata: {
			totalCount,
			activeCount,
			archivedCount: history.archived.length,
		},
	};
}

export function storedSessionResponse(
	sessionId: string,
	found: NonNullable<StoredSessionRecord>,
	nextCommand: string,
) {
	const summarizedSession = summarizeSession(found.session).session;

	return toJson({
		status: "ok",
		summary: `Showing ${found.source === "archive" ? "archived" : "stored"} Flow session '${sessionId}'.`,
		source: found.source,
		active: found.active,
		path: found.path,
		archivePath: found.archivePath ?? null,
		archivedAt: found.archivedAt ?? null,
		session: found.active
			? summarizedSession
			: { ...summarizedSession, nextCommand },
		nextCommand,
	});
}

export function statusResponse(session?: Session | null) {
	return toJson(summarizeSession(session ?? null));
}

export function autoPrepareResponse(
	mode: AutoPrepareMode,
	goal: string | null,
	nextCommand: string,
) {
	if (mode === "missing_goal") {
		return {
			payload: toJson({
				status: "missing_goal",
				mode: "missing_goal",
				summary:
					"No active Flow session exists. Provide a goal to start a new autonomous run.",
				nextCommand,
			}),
			metadata: { mode, goal },
		};
	}

	if (mode === "resume" && goal) {
		return {
			payload: toJson({
				status: "ok",
				mode: "resume",
				goal,
				summary: `Resuming active Flow goal: ${goal}`,
				nextCommand,
			}),
			metadata: { mode, goal },
		};
	}

	return {
		payload: toJson({
			status: "ok",
			mode: "start_new_goal",
			goal,
			summary: `Starting a new autonomous Flow goal: ${goal}`,
			nextCommand,
		}),
		metadata: { mode, goal },
	};
}

export function resetSessionResponse(
	archived: ArchivedSessionRecord,
	nextCommand: string,
) {
	return toJson({
		status: "ok",
		summary: archived
			? "Archived and cleared the active Flow session."
			: "No active Flow session existed.",
		archivedSessionId: archived?.sessionId ?? null,
		archivedTo: archived?.archivedTo ?? null,
		nextCommand,
	});
}
