import { sessionCompletionReached } from "../domain";
import { getActiveSessionDir, getSessionPath } from "../paths";
import { renderSessionDocsAtDir } from "../render";
import { type Session, SessionSchema } from "../schema";
import {
	allocateCompletedSessionLocation,
	completedTimestampForSession,
	findNewestCompletedSession,
} from "../session-completed-storage";
import {
	moveActiveSessionToCompleted,
	resolveActiveSessionId,
} from "../session-live-storage";
import {
	readSessionFromPath,
	writeSessionFileAtDir,
} from "../session-workspace-io";
import { completedTimestampNow, nowIso } from "../util";
import type { MutableWorkspaceRoot } from "../workspace-root";

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
		await moveActiveSessionToCompleted(worktree, session.id, completedAt);
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

export type BlockedSessionClosure = {
	blocked: true;
	sessionId: string;
	summary: string;
	unfinishedFeatureIds: string[];
};

export async function closeActiveSession(
	worktree: MutableWorkspaceRoot,
	kind: NonNullable<Session["closure"]>["kind"],
	summary?: string,
): Promise<ClosedSessionResult | BlockedSessionClosure | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	const activeDir = getActiveSessionDir(worktree, sessionId);
	const session = await readSessionFromPath(
		getSessionPath(worktree, sessionId, "active"),
	);

	// Hard invariant: a session cannot close as completed while planned
	// features remain below the plan's completion target.
	if (kind === "completed" && session?.plan) {
		const plan = session.plan;
		if (!sessionCompletionReached(plan, plan.features)) {
			const unfinishedFeatureIds = plan.features
				.filter((feature) => feature.status !== "completed")
				.map((feature) => feature.id);
			return {
				blocked: true,
				sessionId,
				summary: `Cannot close the session as completed: ${unfinishedFeatureIds.length} planned feature${unfinishedFeatureIds.length === 1 ? " is" : "s are"} unfinished (${unfinishedFeatureIds.join(", ")}). Finish or defer the remaining features, or close the session as 'deferred' or 'abandoned'.`,
				unfinishedFeatureIds,
			};
		}
	}
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
	const moved = await moveActiveSessionToCompleted(
		worktree,
		sessionId,
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
