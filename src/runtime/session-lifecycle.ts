import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import {
	getArchiveDir,
	getReviewsDir,
	getSessionDir,
	getSessionPath,
} from "./paths";
import { deleteSessionDocs } from "./render";
import { type PlanningContext, type Session, SessionSchema } from "./schema";
import {
	migrateLegacySessionIfNeeded,
	readSessionFromPath,
	resolveActiveSessionId,
	writeActiveSessionId,
} from "./session-workspace";
import { archiveTimestampNow, nowIso } from "./time";

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

	await deleteSessionDocs(worktree, sessionId);
	await rm(getReviewsDir(worktree, sessionId), {
		recursive: true,
		force: true,
	});
}

export async function deleteSession(worktree: string): Promise<void> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return;
	}

	await rm(getSessionDir(worktree, sessionId), {
		recursive: true,
		force: true,
	});
	await writeActiveSessionId(worktree, null);
}

export async function archiveSession(
	worktree: string,
): Promise<{ sessionId: string; archivedTo: string } | null> {
	const sessionId = await resolveActiveSessionId(worktree);
	if (!sessionId) {
		return null;
	}

	const sourceDir = getSessionDir(worktree, sessionId);
	let archivedDir: string | null = null;

	for (let attempt = 0; ; attempt += 1) {
		const timestamp = archiveTimestampNow();
		const suffix = attempt === 0 ? "" : `-${attempt}`;
		const candidate = join(
			getArchiveDir(worktree),
			`${sessionId}-${timestamp}${suffix}`,
		);

		try {
			await rename(sourceDir, candidate);
			archivedDir = candidate;
			break;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				await writeActiveSessionId(worktree, null);
				return null;
			}

			if (code === "EEXIST" || code === "ENOTEMPTY") {
				continue;
			}

			throw error;
		}
	}

	await writeActiveSessionId(worktree, null);
	return {
		sessionId,
		archivedTo: relative(worktree, archivedDir),
	};
}

export async function activateSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	await migrateLegacySessionIfNeeded(worktree);

	try {
		const session = await readSessionFromPath(
			getSessionPath(worktree, sessionId),
		);
		await writeActiveSessionId(worktree, sessionId);
		return session;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}

		throw error;
	}
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
