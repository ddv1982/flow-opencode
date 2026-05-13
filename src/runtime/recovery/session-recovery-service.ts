import { getActiveSessionDir, getSessionPath } from "../paths";
import { renderSessionDocsAtDir } from "../rendering";
import { type Session, SessionSchema } from "../schema";
import {
	allocateCompletedSessionLocation,
	completedTimestampForSession,
	findNewestCompletedSession,
	moveSessionDirToCompleted,
} from "../session-completed-storage";
import { resolveActiveSessionId } from "../session-workspace";
import {
	readSessionFromPath,
	writeSessionFileAtDir,
} from "../session-workspace-io";
import { completedTimestampNow, nowIso } from "../util";
import type { MutableWorkspaceRoot } from "../workspace-root";

async function moveActiveSessionToCompleted(
	worktree: MutableWorkspaceRoot,
	sessionId: string,
	activeDir: string,
	completedAt: string,
): Promise<boolean> {
	const moved = await moveSessionDirToCompleted(
		worktree,
		sessionId,
		activeDir,
		completedAt,
	);
	return Boolean(moved);
}

export async function persistCompletedSession(
	worktree: MutableWorkspaceRoot,
	session: Session,
	includeArtifacts: boolean,
): Promise<void> {
	const completedAt = completedTimestampForSession(session);
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId === session.id) {
		const activeDir = getActiveSessionDir(worktree, session.id);
		await writeSessionFileAtDir(activeDir, session);
		if (includeArtifacts) {
			await renderSessionDocsAtDir(activeDir, session);
		}
		await moveActiveSessionToCompleted(
			worktree,
			session.id,
			activeDir,
			completedAt,
		);
		return;
	}

	const location = await allocateCompletedSessionLocation(
		worktree,
		session.id,
		completedAt,
	);
	await writeSessionFileAtDir(location.completedDir, session);
	if (includeArtifacts) {
		await renderSessionDocsAtDir(location.completedDir, session);
	}
}

export async function syncCompletedSessionArtifacts(
	worktree: MutableWorkspaceRoot,
	session: Session,
): Promise<boolean> {
	const completed = await findNewestCompletedSession(worktree, session.id);
	if (!completed) {
		return false;
	}
	await renderSessionDocsAtDir(completed.completedDir, session);
	return true;
}

export type ClosedSessionResult = {
	sessionId: string;
	completedTo: string;
	closureKind: NonNullable<Session["closure"]>["kind"];
};

export async function closeActiveSession(
	worktree: MutableWorkspaceRoot,
	kind: NonNullable<Session["closure"]>["kind"],
	summary?: string,
): Promise<ClosedSessionResult | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	const activeDir = getActiveSessionDir(worktree, sessionId);
	const session = await readSessionFromPath(
		getSessionPath(worktree, sessionId, "active"),
	);
	const recordedAt = nowIso();
	const closedSession: Session = SessionSchema.parse({
		...session,
		status: "completed",
		closure: {
			kind,
			summary:
				summary ??
				(kind === "completed"
					? "Completed the Flow session."
					: kind === "deferred"
						? "Deferred the Flow session for later."
						: "Abandoned the Flow session."),
			recordedAt,
		},
		execution: {
			...session.execution,
			activeFeatureId: null,
			lastSummary:
				summary ??
				(kind === "completed"
					? "Completed the Flow session."
					: kind === "deferred"
						? "Deferred the Flow session."
						: "Abandoned the Flow session."),
			lastOutcomeKind:
				session.execution.lastOutcomeKind ??
				(kind === "completed" ? "completed" : "needs_input"),
		},
		timestamps: {
			...session.timestamps,
			updatedAt: recordedAt,
			completedAt: session.timestamps.completedAt ?? recordedAt,
		},
	});

	await writeSessionFileAtDir(activeDir, closedSession);
	const moved = await moveSessionDirToCompleted(
		worktree,
		sessionId,
		activeDir,
		completedTimestampNow(),
	);
	return moved
		? {
				sessionId: moved.sessionId,
				completedTo: moved.completedTo,
				closureKind: kind,
			}
		: null;
}
