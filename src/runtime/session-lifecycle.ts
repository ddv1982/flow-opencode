import { randomUUID } from "node:crypto";
import { getSessionPath } from "./paths";
import {
	type BlockedSessionClosure,
	type ClosedSessionResult,
	closeActiveSession,
} from "./recovery";
import { type PlanningContext, type Session, SessionSchema } from "./schema";
import { activateStoredSessionBoundary } from "./session-live-storage";
import { readSessionFromPath } from "./session-workspace-io";
import { withSessionSaveLock } from "./session-workspace-locks";
import { nowIso } from "./util";
import { assertMutableWorkspaceRoot } from "./workspace-root";

function readActiveSession(
	worktree: string,
	sessionId: string,
): Promise<Session | null> {
	return readSessionFromPath(getSessionPath(worktree, sessionId, "active"));
}

export async function closeSession(
	worktree: string,
	kind: NonNullable<Session["closure"]>["kind"],
	summary?: string,
): Promise<ClosedSessionResult | BlockedSessionClosure | null> {
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
		const activation = await activateStoredSessionBoundary(
			mutableWorktree,
			sessionId,
		);
		if (activation === "missing") {
			return null;
		}

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
			workflowProfile: planning?.workflowProfile ?? "default",
			repoProfile: planning?.repoProfile ?? [],
			packageManager: planning?.packageManager,
			packageManagerAmbiguous: planning?.packageManagerAmbiguous ?? false,
			stackProfile: planning?.stackProfile,
			standardsProfile: planning?.standardsProfile,
			research: planning?.research ?? [],
			implementationApproach: planning?.implementationApproach,
			decisionLog: planning?.decisionLog ?? [],
			replanLog: planning?.replanLog ?? [],
			reviewFindings: planning?.reviewFindings ?? [],
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
