import { z } from "zod";
import {
	ArtifactSchema,
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	FeatureReviewDepthSchema,
	FinalReviewSchema,
	NeedsInputOutcomeSchema,
	PlanInputSchema,
	ReviewSchema,
	ValidationRunSchema,
	ValidationScopeSchema,
	WorkerOutcomeSchema,
} from "./schema";
import {
	applyPlan,
	approvePlan,
	closeSession,
	completeFeature,
	createSession,
	resetFeature,
	startRun,
	summarizeSession,
} from "./transitions";
import {
	archiveAndClearSession,
	assertMutableWorkspaceRoot,
	loadSession,
	quarantineUnreadableSession,
	saveSession,
	UnreadableFlowSessionError,
	withSessionLock,
} from "./workspace";

export type RuntimeResponse = Record<string, unknown>;

export const FlowPlanSaveSchema = z
	.object({
		goal: z.string().trim().min(1).optional(),
		plan: PlanInputSchema.optional(),
	})
	.strict();

export const FlowRunStartSchema = z
	.object({
		featureId: z.string().min(1).optional(),
		phaseBoundaryAck: z.boolean().optional(),
	})
	.strict();

export const FlowFeatureResetSchema = z
	.object({
		featureId: z.string().min(1),
	})
	.strict();

export const FlowSessionCloseSchema = z
	.object({
		kind: z.enum(["completed", "deferred", "abandoned"]),
		summary: z.string().trim().min(1).optional(),
	})
	.strict();

export const FlowFeatureCompleteToolSchema = z
	.object({
		status: z.enum(["ok", "needs_input"]),
		featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
		summary: z.string().min(1),
		artifactsChanged: z.array(ArtifactSchema).optional(),
		validationRun: z.array(ValidationRunSchema).optional(),
		validationScope: ValidationScopeSchema.optional(),
		featureReviewDepth: FeatureReviewDepthSchema.optional(),
		featureReview: ReviewSchema.optional(),
		finalReview: FinalReviewSchema.optional(),
		outcome: z.union([WorkerOutcomeSchema, NeedsInputOutcomeSchema]).optional(),
	})
	.strict();

function missingSessionResponse(): RuntimeResponse {
	return {
		status: "missing_session",
		summary: "No active Flow session exists.",
		nextAction: "/flow-plan <goal>",
	};
}

function responseFromFailure(result: {
	message: string;
	recovery?: string;
}): RuntimeResponse {
	return {
		status: "error",
		summary: result.message,
		...(result.recovery ? { recovery: result.recovery } : {}),
	};
}

async function quarantineAndReport(
	root: string,
	error: UnreadableFlowSessionError,
): Promise<RuntimeResponse> {
	const quarantinedTo = await quarantineUnreadableSession(root);
	return {
		status: "error",
		summary: `Flow could not read the active session file: ${error.reason}. ${
			quarantinedTo
				? `The unreadable file was preserved at ${quarantinedTo} and the active session was cleared.`
				: "The unreadable file was already gone."
		}`,
		recovery:
			"Start a new session with /flow-plan <goal>. Inspect the quarantined file if you need to recover details from the prior session.",
		...(quarantinedTo ? { quarantinedSessionPath: quarantinedTo } : {}),
	};
}

async function mutate(
	worktree: string,
	task: (
		session: Awaited<ReturnType<typeof loadSession>>,
	) => Promise<RuntimeResponse>,
): Promise<RuntimeResponse> {
	const root = assertMutableWorkspaceRoot(worktree);
	return withSessionLock(root, async () => {
		try {
			return await task(await loadSession(root));
		} catch (error) {
			if (error instanceof UnreadableFlowSessionError) {
				return quarantineAndReport(root, error);
			}
			throw error;
		}
	});
}

export async function flowStatus(worktree: string): Promise<RuntimeResponse> {
	try {
		return summarizeSession(await loadSession(worktree));
	} catch (error) {
		if (!(error instanceof UnreadableFlowSessionError)) throw error;
		const root = assertMutableWorkspaceRoot(worktree);
		return withSessionLock(root, async () => {
			// Re-load under the lock before quarantining: the first read happened
			// without the lock, so a concurrent writer may have already replaced
			// the unreadable file with a valid session. Only quarantine if it is
			// still unreadable now that we hold the lock.
			try {
				return summarizeSession(await loadSession(root));
			} catch (lockedError) {
				if (lockedError instanceof UnreadableFlowSessionError) {
					return quarantineAndReport(root, lockedError);
				}
				throw lockedError;
			}
		});
	}
}

export async function flowPlanSave(
	worktree: string,
	input: unknown,
): Promise<RuntimeResponse> {
	const args = FlowPlanSaveSchema.parse(input ?? {});
	return mutate(worktree, async (existing) => {
		const goal = args.goal ?? existing?.goal;
		if (!goal) {
			return {
				status: "missing_goal",
				summary: "Provide a goal before saving a Flow plan.",
				nextAction: "/flow-plan <goal>",
			};
		}
		const reuseExisting =
			existing !== null &&
			existing.status !== "completed" &&
			existing.goal === goal;
		if (
			existing &&
			existing.status !== "completed" &&
			existing.goal !== goal &&
			existing.approval === "approved"
		) {
			return {
				status: "error",
				summary:
					"An approved Flow session already exists for a different goal. Close it before starting a new one.",
			};
		}
		const session = reuseExisting ? existing : createSession(goal);
		const result = args.plan
			? applyPlan(session, args.plan)
			: { ok: true as const, value: session };
		if (!result.ok) return responseFromFailure(result);
		if (existing && !reuseExisting) {
			await archiveAndClearSession(worktree, existing);
		}
		const saved = await saveSession(worktree, result.value);
		return {
			...summarizeSession(saved),
			status: "ok",
			summary: args.plan ? "Flow plan saved." : "Flow session ready.",
		};
	});
}

export async function flowPlanApprove(
	worktree: string,
): Promise<RuntimeResponse> {
	return mutate(worktree, async (session) => {
		if (!session) {
			return missingSessionResponse();
		}
		const result = approvePlan(session);
		if (!result.ok) return responseFromFailure(result);
		const saved = await saveSession(worktree, result.value);
		return {
			...summarizeSession(saved),
			status: "ok",
			summary: "Flow plan approved.",
		};
	});
}

export async function flowRunStart(
	worktree: string,
	input: unknown,
): Promise<RuntimeResponse> {
	const args = FlowRunStartSchema.parse(input ?? {});
	return mutate(worktree, async (session) => {
		if (!session) {
			return missingSessionResponse();
		}
		const result = startRun(
			session,
			args.featureId,
			args.phaseBoundaryAck === undefined
				? undefined
				: { phaseBoundaryAck: args.phaseBoundaryAck },
		);
		if (!result.ok) return responseFromFailure(result);
		const saved = await saveSession(worktree, result.value.session);
		return {
			...summarizeSession(saved),
			status: "ok",
			summary: `Started feature '${result.value.feature.id}'.`,
			feature: result.value.feature,
		};
	});
}

export async function flowFeatureComplete(
	worktree: string,
	input: unknown,
): Promise<RuntimeResponse> {
	const worker = input ?? {};
	return mutate(worktree, async (session) => {
		if (!session) {
			return missingSessionResponse();
		}
		const result = completeFeature(session, worker);
		if (!result.ok) {
			if (result.session) {
				const saved = await saveSession(worktree, result.session);
				return {
					...summarizeSession(saved),
					status: "error",
					summary: result.message,
					...(result.recovery ? { recovery: result.recovery } : {}),
				};
			}
			return responseFromFailure(result);
		}
		const saved = await saveSession(worktree, result.value);
		return {
			...summarizeSession(saved),
			status: "ok",
			summary: "Feature result recorded.",
		};
	});
}

export async function flowFeatureReset(
	worktree: string,
	input: unknown,
): Promise<RuntimeResponse> {
	const args = FlowFeatureResetSchema.parse(input ?? {});
	return mutate(worktree, async (session) => {
		if (!session) {
			return missingSessionResponse();
		}
		const result = resetFeature(session, args.featureId);
		if (!result.ok) return responseFromFailure(result);
		const saved = await saveSession(worktree, result.value);
		return {
			...summarizeSession(saved),
			status: "ok",
			summary: `Feature '${args.featureId}' reset.`,
		};
	});
}

export async function flowSessionClose(
	worktree: string,
	input: unknown,
): Promise<RuntimeResponse> {
	const args = FlowSessionCloseSchema.parse(input ?? {});
	return mutate(worktree, async (session) => {
		if (!session) {
			return missingSessionResponse();
		}
		const result = closeSession(session, args.kind, args.summary);
		if (!result.ok) return responseFromFailure(result);
		await archiveAndClearSession(worktree, result.value);
		return {
			status: "ok",
			summary: `Flow session closed as ${args.kind}.`,
			archivedSessionId: result.value.id,
			closure: result.value.closure,
		};
	});
}
