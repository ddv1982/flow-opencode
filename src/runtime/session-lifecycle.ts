import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import {
	getActiveSessionDir,
	getReviewsDir,
	getSessionPath,
	getStoredSessionDir,
} from "./paths";
import { deleteSessionDocs } from "./render";
import { type PlanningContext, type Session, SessionSchema } from "./schema";
import {
	moveSessionDirToCompleted,
	pathExists,
} from "./session-completed-storage";
import {
	readSessionFromPath,
	resolveActiveSessionId,
	writeSessionFileAtDir,
} from "./session-workspace";
import { completedTimestampNow, nowIso } from "./util";
import { assertMutableWorkspaceRoot } from "./workspace-root";

export async function deleteSessionState(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const sessionId = await resolveActiveSessionId(mutableWorktree);
	if (!sessionId) {
		return;
	}

	await rm(getSessionPath(mutableWorktree, sessionId), { force: true });
}

export async function deleteSessionArtifacts(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const sessionId = await resolveActiveSessionId(mutableWorktree);
	if (!sessionId) {
		return;
	}

	await deleteSessionDocs(mutableWorktree, sessionId, "active");
	await rm(getReviewsDir(mutableWorktree, sessionId, "active"), {
		recursive: true,
		force: true,
	});
}

export async function deleteSession(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const sessionId = await resolveActiveSessionId(mutableWorktree);
	if (!sessionId) {
		return;
	}

	await rm(getActiveSessionDir(mutableWorktree, sessionId), {
		recursive: true,
		force: true,
	});
}

type ClosedSessionResult = {
	sessionId: string;
	completedTo: string;
	closureKind: NonNullable<Session["closure"]>["kind"];
};

export async function closeSession(
	worktree: string,
	kind: NonNullable<Session["closure"]>["kind"],
	summary?: string,
): Promise<ClosedSessionResult | null> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const sessionId = await resolveActiveSessionId(mutableWorktree);
	if (!sessionId) {
		return null;
	}

	const session = await readSessionFromPath(
		getSessionPath(mutableWorktree, sessionId, "active"),
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

	const activeDir = getActiveSessionDir(mutableWorktree, sessionId);
	await writeSessionFileAtDir(activeDir, closedSession);
	const moved = await moveSessionDirToCompleted(
		mutableWorktree,
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

export async function activateSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const activeSessionId = await resolveActiveSessionId(mutableWorktree);
	if (activeSessionId === sessionId) {
		return readSessionFromPath(
			getSessionPath(mutableWorktree, sessionId, "active"),
		);
	}

	const storedDir = getStoredSessionDir(mutableWorktree, sessionId);
	if (!(await pathExists(storedDir))) {
		return null;
	}

	if (activeSessionId) {
		await rename(
			getActiveSessionDir(mutableWorktree, activeSessionId),
			getStoredSessionDir(mutableWorktree, activeSessionId),
		);
	}

	await rename(storedDir, getActiveSessionDir(mutableWorktree, sessionId));
	return readSessionFromPath(
		getSessionPath(mutableWorktree, sessionId, "active"),
	);
}

export function createSession(
	goal: string,
	planning?: Partial<PlanningContext>,
): Session {
	const createdAt = nowIso();

	return SessionSchema.parse({
		version: 1,
		id: randomUUID(),
		goal,
		status: "planning",
		approval: "pending",
		planning: {
			repoProfile: planning?.repoProfile ?? [],
			research: planning?.research ?? [],
			implementationApproach: planning?.implementationApproach,
			decisionLog: planning?.decisionLog ?? [],
			replanLog: planning?.replanLog ?? [],
		},
		plan: null,
		execution: {
			activeFeatureId: null,
			lastFeatureId: null,
			lastSummary: null,
			lastOutcomeKind: null,
			lastOutcome: null,
			lastNextStep: null,
			lastFeatureResult: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			history: [],
		},
		closure: null,
		notes: [],
		artifacts: [],
		timestamps: {
			createdAt,
			updatedAt: createdAt,
			approvedAt: null,
			completedAt: null,
		},
	});
}
