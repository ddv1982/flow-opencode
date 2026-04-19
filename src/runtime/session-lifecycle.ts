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
} from "./session-workspace";
import { completedTimestampNow, nowIso } from "./util";

async function moveActiveSessionToCompleted(
	worktree: string,
	sessionId: string,
): Promise<{ sessionId: string; completedTo: string } | null> {
	const location = await moveSessionDirToCompleted(
		worktree,
		sessionId,
		getActiveSessionDir(worktree, sessionId),
		completedTimestampNow(),
	);
	return location
		? { sessionId: location.sessionId, completedTo: location.completedTo }
		: null;
}

export async function deleteSessionState(worktree: string): Promise<void> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return;
	}

	await rm(getSessionPath(worktree, sessionId), { force: true });
}

export async function deleteSessionArtifacts(worktree: string): Promise<void> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return;
	}

	await deleteSessionDocs(worktree, sessionId, "active");
	await rm(getReviewsDir(worktree, sessionId, "active"), {
		recursive: true,
		force: true,
	});
}

export async function deleteSession(worktree: string): Promise<void> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return;
	}

	await rm(getActiveSessionDir(worktree, sessionId), {
		recursive: true,
		force: true,
	});
}

export async function completeSession(
	worktree: string,
): Promise<{ sessionId: string; completedTo: string } | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	return moveActiveSessionToCompleted(worktree, sessionId);
}

export async function activateSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	const activeSessionId = await resolveActiveSessionId(worktree);
	if (activeSessionId === sessionId) {
		return readSessionFromPath(getSessionPath(worktree, sessionId, "active"));
	}

	const storedDir = getStoredSessionDir(worktree, sessionId);
	if (!(await pathExists(storedDir))) {
		return null;
	}

	if (activeSessionId) {
		await rename(
			getActiveSessionDir(worktree, activeSessionId),
			getStoredSessionDir(worktree, activeSessionId),
		);
	}

	await rename(storedDir, getActiveSessionDir(worktree, sessionId));
	return readSessionFromPath(getSessionPath(worktree, sessionId, "active"));
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
