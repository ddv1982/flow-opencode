import { z } from "zod";
import { PlanInputSchema, WorkerResultSchema } from "./schema";
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
	loadSession,
	saveSession,
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

async function mutate(
	worktree: string,
	task: (
		session: Awaited<ReturnType<typeof loadSession>>,
	) => Promise<RuntimeResponse>,
): Promise<RuntimeResponse> {
	return withSessionLock(worktree, async () =>
		task(await loadSession(worktree)),
	);
}

export async function flowStatus(worktree: string): Promise<RuntimeResponse> {
	return summarizeSession(await loadSession(worktree));
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
		if (existing?.status === "completed") {
			await archiveAndClearSession(worktree, existing);
		}
		const base =
			existing?.status === "completed"
				? createSession(goal)
				: (existing ?? createSession(goal));
		if (base.goal !== goal) {
			if (base.approval === "approved") {
				return {
					status: "error",
					summary:
						"An approved Flow session already exists for a different goal. Close it before starting a new one.",
				};
			}
		}
		const session = base.goal === goal ? base : createSession(goal);
		const result = args.plan
			? applyPlan(session, args.plan)
			: { ok: true as const, value: session };
		if (!result.ok) return responseFromFailure(result);
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
			return {
				status: "missing_session",
				summary: "No active Flow session exists.",
				nextAction: "/flow-plan <goal>",
			};
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
			return {
				status: "missing_session",
				summary: "No active Flow session exists.",
				nextAction: "/flow-plan <goal>",
			};
		}
		const result = startRun(session, args.featureId);
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
	const worker = WorkerResultSchema.parse(input ?? {});
	return mutate(worktree, async (session) => {
		if (!session) {
			return {
				status: "missing_session",
				summary: "No active Flow session exists.",
				nextAction: "/flow-plan <goal>",
			};
		}
		const result = completeFeature(session, worker);
		if (!result.ok) {
			if (result.session) await saveSession(worktree, result.session);
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
			return {
				status: "missing_session",
				summary: "No active Flow session exists.",
				nextAction: "/flow-plan <goal>",
			};
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
			return {
				status: "missing_session",
				summary: "No active Flow session exists.",
				nextAction: "/flow-plan <goal>",
			};
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
