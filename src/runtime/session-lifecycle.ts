import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import {
	getActiveSessionDir,
	getReviewsDir,
	getSessionPath,
	getStoredSessionDir,
} from "./paths";
import {
	type ClosedSessionResult,
	closeActiveSession,
	pathExists,
} from "./recovery";
import { deleteSessionDocs } from "./rendering";
import { type PlanningContext, type Session, SessionSchema } from "./schema";
import {
	readSessionFromPath,
	resolveActiveSessionId,
	withSessionSaveLock,
} from "./session-workspace";
import { nowIso } from "./util";
import { assertMutableWorkspaceRoot } from "./workspace-root";

async function withActiveSessionId(
	worktree: string,
	action: (sessionId: string) => Promise<void>,
): Promise<void> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return;
	}
	await action(sessionId);
}

function readActiveSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	return readSessionFromPath(getSessionPath(worktree, sessionId, "active"));
}

export async function deleteSessionState(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	await withSessionSaveLock(mutableWorktree, async () => {
		await withActiveSessionId(mutableWorktree, async (sessionId) => {
			await rm(getSessionPath(mutableWorktree, sessionId), { force: true });
		});
	});
}

export async function deleteSessionArtifacts(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	await withSessionSaveLock(mutableWorktree, async () => {
		await withActiveSessionId(mutableWorktree, async (sessionId) => {
			await deleteSessionDocs(mutableWorktree, sessionId, "active");
			await rm(getReviewsDir(mutableWorktree, sessionId, "active"), {
				recursive: true,
				force: true,
			});
		});
	});
}

export async function deleteSession(worktree: string): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	await withSessionSaveLock(mutableWorktree, async () => {
		await withActiveSessionId(mutableWorktree, async (sessionId) => {
			await rm(getActiveSessionDir(mutableWorktree, sessionId), {
				recursive: true,
				force: true,
			});
		});
	});
}

export async function closeSession(
	worktree: string,
	kind: NonNullable<Session["closure"]>["kind"],
	summary?: string,
): Promise<ClosedSessionResult | null> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	return withSessionSaveLock(mutableWorktree, async () =>
		closeActiveSession(mutableWorktree, kind, summary),
	);
}

export async function activateSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	return withSessionSaveLock(mutableWorktree, async () => {
		const activeSessionId = await resolveActiveSessionId(mutableWorktree);
		if (activeSessionId === sessionId) {
			return readActiveSession(mutableWorktree, sessionId);
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
		return readActiveSession(mutableWorktree, sessionId);
	});
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
			packageManager: planning?.packageManager,
			packageManagerAmbiguous: planning?.packageManagerAmbiguous ?? false,
			stackProfile: planning?.stackProfile,
			standardsProfile: planning?.standardsProfile,
			research: planning?.research ?? [],
			implementationApproach: planning?.implementationApproach,
			decisionLog: planning?.decisionLog ?? [],
			replanLog: planning?.replanLog ?? [],
			evidencePackets: planning?.evidencePackets,
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
