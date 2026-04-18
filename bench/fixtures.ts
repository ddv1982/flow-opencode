import type { Plan, Session, WorkerResult } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";

const FIXED_CREATED_AT = "2026-01-01T00:00:00.000Z";

function assertOk<T>(
	result: { ok: true; value: T } | { ok: false; message: string },
): T {
	if (!result.ok) {
		throw new Error(result.message);
	}

	return result.value;
}

type FixtureFeatureOptions = {
	status?: "pending" | "in_progress" | "completed" | "blocked";
	dependsOn?: string[];
	blockedBy?: string[];
};

export function createFeature(id: string, options: FixtureFeatureOptions = {}) {
	return {
		id,
		title: `Feature ${id}`,
		summary: `Implement ${id}.`,
		status: options.status ?? "pending",
		fileTargets: [`src/${id}.ts`],
		verification: [`bun test ${id}`],
		...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
		...(options.blockedBy ? { blockedBy: options.blockedBy } : {}),
	};
}

export function createPlan(featureCount: number): Plan {
	const features = Array.from({ length: featureCount }, (_, index) => {
		const featureNumber = index + 1;
		const id = `feature-${featureNumber}`;
		const previousId =
			featureNumber > 1 ? `feature-${featureNumber - 1}` : undefined;

		return createFeature(id, previousId ? { dependsOn: [previousId] } : {});
	});

	return {
		summary: `Plan with ${featureCount} feature${featureCount === 1 ? "" : "s"}.`,
		overview: "Benchmark fixture plan.",
		requirements: ["Keep benchmark fixtures deterministic."],
		architectureDecisions: [
			"Use canonical runtime transitions to shape sessions.",
		],
		features,
		goalMode: "implementation",
		decompositionPolicy: "atomic_feature",
	};
}

export { createSession };

export function createWorkerResult(
	featureId: string,
	summary = `Completed ${featureId}.`,
): WorkerResult {
	return {
		contractVersion: "1",
		status: "ok",
		summary,
		artifactsChanged: [{ path: `src/${featureId}.ts`, kind: "modified" }],
		validationRun: [
			{
				command: "bun test",
				status: "passed",
				summary: "Targeted tests passed.",
			},
		],
		validationScope: "targeted",
		reviewIterations: 1,
		decisions: [{ summary: "Ship the implementation." }],
		nextStep: "Record reviewer approval.",
		featureResult: {
			featureId,
			verificationStatus: "passed",
			notes: [{ note: `Validated ${featureId}.` }],
			followUps: [{ summary: "No follow-up required." }],
		},
		featureReview: {
			status: "passed",
			summary: "Feature review passed.",
			blockingFindings: [],
		},
	};
}

export function createApprovedSession(featureCount: number): Session {
	const base = {
		...createSession(`Benchmark ${featureCount}-feature session`),
		id: `bench-session-${featureCount}`,
		timestamps: {
			createdAt: FIXED_CREATED_AT,
			updatedAt: FIXED_CREATED_AT,
			approvedAt: null,
			completedAt: null,
		},
	};
	const applied = assertOk(applyPlan(base, createPlan(featureCount)));
	return assertOk(approvePlan(applied));
}

export function completeNextFeature(
	session: Session,
	summary?: string,
): Session {
	const started = assertOk(startRun(session)).session;
	const featureId = started.execution.activeFeatureId;

	if (!featureId) {
		throw new Error("Expected active feature after startRun.");
	}

	const reviewed = assertOk(
		recordReviewerDecision(started, {
			scope: "feature",
			featureId,
			status: "approved",
			summary: `Approved ${featureId}.`,
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		}),
	);

	reviewed.execution.history = reviewed.execution.history.map((entry) =>
		entry.featureId === featureId
			? {
					...entry,
					reviewerDecision: reviewed.execution.lastReviewerDecision,
				}
			: entry,
	);

	return assertOk(
		completeRun(reviewed, createWorkerResult(featureId, summary)),
	);
}

export function createCompletedSession(featureCount: number): Session {
	let session = createApprovedSession(featureCount);

	for (let index = 0; index < featureCount; index += 1) {
		const isFinalFeature = index === featureCount - 1;
		if (isFinalFeature) {
			const started = assertOk(startRun(session)).session;
			const featureId = started.execution.activeFeatureId;
			if (!featureId) {
				throw new Error("Expected active feature for final completion.");
			}

			const reviewed = assertOk(
				recordReviewerDecision(started, {
					scope: "final",
					status: "approved",
					summary: "Approved final review.",
					blockingFindings: [],
					followUps: [],
					suggestedValidation: [],
				}),
			);

			reviewed.execution.history = reviewed.execution.history.map((entry) =>
				entry.featureId === featureId
					? {
							...entry,
							reviewerDecision: reviewed.execution.lastReviewerDecision,
						}
					: entry,
			);

			session = assertOk(
				completeRun(reviewed, {
					...createWorkerResult(featureId),
					validationScope: "broad",
					finalReview: {
						status: "passed",
						summary: "Final review passed.",
						blockingFindings: [],
					},
				}),
			);
			continue;
		}

		session = completeNextFeature(session);
	}

	return session;
}

export function createMidExecutionSession(featureCount: number): Session {
	if (featureCount < 4) {
		throw new Error("Mid-execution fixture needs at least 4 features.");
	}

	let session = createApprovedSession(featureCount);
	session = completeNextFeature(session, "Completed feature-1.");
	session = completeNextFeature(session, "Completed feature-2.");
	session = completeNextFeature(session, "Completed feature-3.");
	return assertOk(startRun(session)).session;
}
