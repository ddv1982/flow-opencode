import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import { MAX_SESSION_ID_LENGTH } from "../src/domain/limits.js";
import {
	type FeatureId,
	type PlanInput,
	type ReviewAssignment,
	toFeatureId,
	toSessionId,
} from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	closeSession,
	createSession,
	executionSessionProjection,
	goalProjectionBudgetFailure,
	MAX_EXECUTION_PROJECTION_BYTES,
	MAX_PLAN_FEATURES,
	MAX_REVIEWER_PROJECTION_BYTES,
	resetFeature,
	reviewerSessionProjection,
	serializedUtf8JsonBytes,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";

const fixedEnvironment: TransitionEnvironment = {
	now: () => "2026-07-17T12:00:00.000Z",
	newSessionId: () => toSessionId("session-v5"),
};

const featureId = toFeatureId("domain-rewrite");

const plan: PlanInput = {
	summary: "Rewrite the Flow domain.",
	overview: "Use pure, deterministic transitions.",
	requirements: ["Do not import host or filesystem APIs."],
	decisions: ["Inject time and identity."],
	finalReviewPolicy: "detailed",
	features: [
		{
			id: featureId,
			title: "Domain rewrite",
			summary: "Build the v5 state machine.",
			reviewDepth: "detailed",
			targets: ["src/domain"],
			validation: ["bun test tests/domain-transitions.test.ts"],
			dependsOn: [],
		},
	],
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

describe("v5 domain transitions", () => {
	test("createSession is deterministic when its environment is deterministic", () => {
		const first = createSession("Ship Flow v5", fixedEnvironment);
		const second = createSession("Ship Flow v5", fixedEnvironment);

		expect(first).toEqual(second);
		expect(first.version).toBe(4);
		expect(String(first.id)).toBe("session-v5");
		expect(first.timestamps).toEqual({
			createdAt: "2026-07-17T12:00:00.000Z",
			updatedAt: "2026-07-17T12:00:00.000Z",
			completedAt: null,
		});
	});

	test("revision-zero sessions hydrate only with ISO offset timestamps", () => {
		const offsetEnvironment: TransitionEnvironment = {
			...fixedEnvironment,
			now: () => "2026-07-17T14:00:00.000+02:00",
		};
		const hydrated = JSON.parse(
			JSON.stringify(createSession("Hydrate offset time", offsetEnvironment)),
		);

		expect(SessionSchema.parse(hydrated)).toEqual(hydrated);
		expect(validateSessionInvariants(hydrated)).toBeNull();

		const dateOnly = createSession("Reject date-only time", {
			...fixedEnvironment,
			now: () => "2026-07-17",
		});
		expect(validateSessionInvariants(dateOnly)).toContain("offset timestamps");
		expect(SessionSchema.safeParse(dateOnly).success).toBe(false);
	});

	test("plan, approval, and run leave prior states immutable", () => {
		const created = createSession("Ship Flow v5", fixedEnvironment);
		const planned = unwrap(applyPlan(created, plan, fixedEnvironment));
		const approved = unwrap(approvePlan(planned, fixedEnvironment));
		const running = unwrap(
			startRun(approved, fixedEnvironment, featureId),
		).session;

		expect(created.plan).toBeNull();
		expect(planned.approval).toBe("pending");
		expect(approved.activeFeatureId).toBeNull();
		expect(running.activeFeatureId).toBe(featureId);
		expect(running.activeFeatureRunId).not.toBeNull();
		expect(running.featureRuns).toHaveLength(1);
		expect(approved.featureRuns).toEqual([]);
		for (const state of [created, planned, approved, running]) {
			expect(SessionSchema.safeParse(structuredClone(state)).success).toBe(
				true,
			);
		}
	});

	test("deferred and abandoned close quiesce the active execution", () => {
		for (const kind of ["deferred", "abandoned"] as const) {
			const created = createSession(`Close as ${kind}`, fixedEnvironment);
			const planned = unwrap(applyPlan(created, plan, fixedEnvironment));
			const approved = unwrap(approvePlan(planned, fixedEnvironment));
			const running = unwrap(
				startRun(approved, fixedEnvironment, featureId),
			).session;
			const closed = unwrap(
				closeSession(
					running,
					kind,
					fixedEnvironment,
					`Close this execution as ${kind}.`,
					{
						operationId: `close-${kind}`,
						expectedRevision: running.causal.revision,
						expectedSnapshotId: running.causal.snapshotId,
					},
				),
			);
			const activeRun = running.featureRuns[0];
			if (!activeRun) throw new Error("Expected an active feature run.");

			expect(closed.activeFeatureId).toBeNull();
			expect(closed.activeFeatureRunId).toBeNull();
			expect(closed.featureRuns).toEqual([
				{
					...activeRun,
					status: kind,
					endedAt: fixedEnvironment.now(),
				},
			]);
			expect(closed.closure).toMatchObject({
				kind,
				retryOperationId: `close-${kind}`,
			});
			expect(SessionSchema.safeParse(structuredClone(closed)).success).toBe(
				true,
			);
		}
	});

	test("copies caller-owned plan collections into domain state", () => {
		const mutablePlan: PlanInput = {
			summary: "Copy inputs",
			overview: "Prevent caller mutation.",
			requirements: ["Original requirement"],
			decisions: ["Original decision"],
			features: [
				{
					id: featureId,
					title: "Copy",
					summary: "Clone arrays.",
					targets: ["src/original.ts"],
					validation: ["bun test"],
					dependsOn: [],
				},
			],
		};
		const session = unwrap(
			applyPlan(
				createSession("Copy caller data", fixedEnvironment),
				mutablePlan,
				fixedEnvironment,
			),
		);

		mutablePlan.requirements?.push("Mutated requirement");
		mutablePlan.decisions?.push("Mutated decision");
		mutablePlan.features[0]?.targets?.push("src/mutated.ts");

		expect(session.plan?.requirements).toEqual(["Original requirement"]);
		expect(session.plan?.decisions).toEqual(["Original decision"]);
		expect(session.plan?.features[0]?.targets).toEqual(["src/original.ts"]);
	});

	test("rejects cyclic plans without mutating the session", () => {
		const created = createSession("Reject cycles", fixedEnvironment);
		const first = toFeatureId("first");
		const second = toFeatureId("second");
		const result = applyPlan(
			created,
			{
				summary: "Cyclic",
				overview: "Must fail.",
				features: [
					{
						id: first,
						title: "First",
						summary: "Depends on second.",
						dependsOn: [second],
					},
					{
						id: second,
						title: "Second",
						summary: "Depends on first.",
						dependsOn: [first],
					},
				],
			},
			fixedEnvironment,
		);

		expect(result.ok).toBe(false);
		expect(created.plan).toBeNull();
		expect(created.causal.revision).toBe(0);
	});

	test("validates the maximum supported dependency chain without recursion", () => {
		const featureIds = Array.from({ length: MAX_PLAN_FEATURES }, (_, index) =>
			toFeatureId(`chain-${index}`),
		);
		const result = applyPlan(
			createSession("Validate a bounded dependency chain", fixedEnvironment),
			{
				summary: "Bounded chain",
				overview: "Validate dependencies iteratively.",
				features: featureIds.map((id, index) => ({
					id,
					title: `Feature ${index}`,
					summary: "Validate one dependency edge.",
					dependsOn: index === 0 ? [] : [featureIds[index - 1] as FeatureId],
				})),
			},
			fixedEnvironment,
		);

		expect(result.ok).toBe(true);
	});

	test("rejects plans above the lifecycle feature bound", () => {
		const result = applyPlan(
			createSession("Reject an oversized plan", fixedEnvironment),
			{
				summary: "Too many features",
				overview: "Stay within the bounded lifecycle window.",
				features: Array.from({ length: MAX_PLAN_FEATURES + 1 }, (_, index) => ({
					id: toFeatureId(`oversized-${index}`),
					title: `Feature ${index}`,
					summary: "This feature exceeds the plan cardinality bound.",
				})),
			},
			fixedEnvironment,
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected oversized plan rejection.");
		expect(result.message).toContain(`${MAX_PLAN_FEATURES}`);

		const oversizedTargets = applyPlan(
			createSession("Reject oversized plan collections", fixedEnvironment),
			{
				summary: "Too many targets",
				overview: "Reject before cloning caller-owned arrays.",
				features: [
					{
						id: featureId,
						title: "Bound target cardinality",
						summary: "Keep plan traversal bounded.",
						targets: Array.from(
							{ length: MAX_PLAN_FEATURES + 1 },
							() => "src/target.ts",
						),
					},
				],
			},
			fixedEnvironment,
		);
		expect(oversizedTargets.ok).toBe(false);
		if (oversizedTargets.ok) {
			throw new Error("Expected oversized target collection rejection.");
		}
		expect(oversizedTargets.message).toContain("targets");
	});

	test("admits only plans with a reachable minimal reviewer projection", () => {
		const created = createSession(
			"Keep final review reachable",
			fixedEnvironment,
		);
		const feature = {
			id: featureId,
			title: "Reviewer scope",
			summary: "Keep the immutable plan compatible with final review.",
		};
		const longTargets = Array.from(
			{ length: 32 },
			(_, index) => `src/${index}-${"x".repeat(112)}`,
		);

		const unreachable = applyPlan(
			created,
			{
				summary: "Unreachable final review",
				overview:
					"Every execution view fits, but the final reviewer scope does not.",
				features: [{ ...feature, targets: longTargets }],
			},
			fixedEnvironment,
		);
		expect(unreachable.ok).toBe(false);
		if (unreachable.ok) throw new Error("Expected reviewer budget rejection.");
		expect(unreachable.message).toContain("smallest final reviewer projection");

		const reachable = applyPlan(
			created,
			{
				summary: "Reachable final review",
				overview: "Preserve the 32-target final-review scope.",
				features: [
					{
						...feature,
						targets: Array.from(
							{ length: 32 },
							(_, index) => `src/target-${index}.ts`,
						),
					},
				],
			},
			fixedEnvironment,
		);
		expect(reachable.ok).toBe(true);
		const planned = unwrap(reachable);
		const approved = unwrap(approvePlan(planned, fixedEnvironment));
		const running = unwrap(
			startRun(approved, fixedEnvironment, featureId),
		).session;
		if (!running.activeFeatureRunId) {
			throw new Error("Expected an active feature run.");
		}
		const assignment: ReviewAssignment = {
			id: "review-assignment:scope-boundary",
			operationId: "review-start:scope-boundary",
			featureRunId: running.activeFeatureRunId,
			featureId,
			reviewKind: "final",
			validationScope: "broad",
			validationEvidenceRefs: [`sha256:${"a".repeat(64)}`],
			sourceDigest: `sha256:${"b".repeat(64)}`,
			packetDigest: `sha256:${"c".repeat(64)}`,
			packetSummary: "x",
			riskLenses: [],
			prerequisite: null,
			attemptId: "review-attempt:scope-boundary",
			logicalPassId: "review-pass:scope-boundary",
			startedAt: fixedEnvironment.now(),
			requiredDepth: "detailed",
			status: "pending",
			completedAt: null,
			invalidatedAt: null,
			invalidationReason: null,
		};
		const projection = unwrap(
			reviewerSessionProjection(
				{ ...running, reviewAssignments: [assignment] },
				{ assignmentId: assignment.id },
			),
		);
		expect(projection.assignedScope).toHaveLength(32);
		expect(serializedUtf8JsonBytes(projection)).toBeLessThanOrEqual(
			MAX_REVIEWER_PROJECTION_BYTES,
		);
	});

	test("reserves the maximum persisted feature-run id in execution budgets", () => {
		const maximumRuntimeIdEnvironment: TransitionEnvironment = {
			...fixedEnvironment,
			newRuntimeId: () => "f".repeat(MAX_SESSION_ID_LENGTH),
		};
		const minimalPlan = (summary: string): PlanInput => ({
			summary,
			overview: "x",
			finalReviewPolicy: "broad",
			features: [
				{
					id: toFeatureId("x"),
					title: "x",
					summary: "x",
					reviewDepth: "quick",
				},
			],
		});
		const largestAcceptedLength = (accepts: (length: number) => boolean) => {
			let accepted = 1;
			let rejected = MAX_EXECUTION_PROJECTION_BYTES + 1;
			while (rejected - accepted > 1) {
				const candidate = Math.floor((accepted + rejected) / 2);
				if (accepts(candidate)) accepted = candidate;
				else rejected = candidate;
			}
			return accepted;
		};

		const planCreated = createSession("x", maximumRuntimeIdEnvironment);
		const maximumPlanSummary = largestAcceptedLength(
			(length) =>
				applyPlan(
					planCreated,
					minimalPlan("x".repeat(length)),
					maximumRuntimeIdEnvironment,
				).ok,
		);
		const planned = unwrap(
			applyPlan(
				planCreated,
				minimalPlan("x".repeat(maximumPlanSummary)),
				maximumRuntimeIdEnvironment,
			),
		);
		const oversizedPlan = applyPlan(
			planCreated,
			minimalPlan("x".repeat(maximumPlanSummary + 1)),
			maximumRuntimeIdEnvironment,
		);
		expect(oversizedPlan.ok).toBe(false);
		if (oversizedPlan.ok)
			throw new Error("Expected execution-budget rejection.");
		expect(oversizedPlan.message).toContain("execution projection");

		const running = unwrap(
			startRun(
				unwrap(approvePlan(planned, maximumRuntimeIdEnvironment)),
				maximumRuntimeIdEnvironment,
				toFeatureId("x"),
			),
		).session;
		expect(running.activeFeatureRunId).toHaveLength(MAX_SESSION_ID_LENGTH);
		expect(
			serializedUtf8JsonBytes(unwrap(executionSessionProjection(running))),
		).toBeLessThanOrEqual(MAX_EXECUTION_PROJECTION_BYTES);

		const maximumGoalLength = largestAcceptedLength(
			(length) => goalProjectionBudgetFailure("x".repeat(length)) === null,
		);
		expect(
			goalProjectionBudgetFailure("x".repeat(maximumGoalLength + 1)),
		).not.toBeNull();
		const goalCreated = createSession(
			"x".repeat(maximumGoalLength),
			maximumRuntimeIdEnvironment,
		);
		const goalRunning = unwrap(
			startRun(
				unwrap(
					approvePlan(
						unwrap(
							applyPlan(
								goalCreated,
								minimalPlan("x"),
								maximumRuntimeIdEnvironment,
							),
						),
						maximumRuntimeIdEnvironment,
					),
				),
				maximumRuntimeIdEnvironment,
				toFeatureId("x"),
			),
		).session;
		expect(
			serializedUtf8JsonBytes(unwrap(executionSessionProjection(goalRunning))),
		).toBeLessThanOrEqual(MAX_EXECUTION_PROJECTION_BYTES);
	});

	test("preserves the complete reset dependency closure across schema boundaries", () => {
		for (const dependentCount of [31, 32, 33]) {
			const rootId = toFeatureId(`fanout-root-${dependentCount}`);
			const fanoutPlan: PlanInput = {
				summary: "Reset a broad dependency closure.",
				overview: "Retain every affected feature identity in causal state.",
				features: [
					{
						id: rootId,
						title: "Root",
						summary: "Reset root feature.",
					},
					...Array.from({ length: dependentCount }, (_, index) => ({
						id: toFeatureId(`fanout-${dependentCount}-${index}`),
						title: `Dependent ${index}`,
						summary: "Depends on the reset root.",
						dependsOn: [rootId],
					})),
				],
			};
			const planned = unwrap(
				applyPlan(
					createSession(`Reset ${dependentCount} dependents`, fixedEnvironment),
					fanoutPlan,
					fixedEnvironment,
				),
			);
			const approved = unwrap(approvePlan(planned, fixedEnvironment));
			const running = unwrap(
				startRun(approved, fixedEnvironment, rootId),
			).session;
			const reset = unwrap(
				resetFeature(running, rootId, fixedEnvironment, {
					operationId: `fanout-reset-${dependentCount}`,
					expectedRevision: running.causal.revision,
					expectedSnapshotId: running.causal.snapshotId,
				}),
			);
			const removed = reset.causal.mutations.at(-1)?.blockerDelta.removed;

			expect(removed).toHaveLength(dependentCount + 1);
			expect(SessionSchema.parse(structuredClone(reset))).toEqual(reset);
		}
	});

	test("brands feature ids without changing their runtime value", () => {
		const value: FeatureId = toFeatureId("portable-id");
		expect(String(value)).toBe("portable-id");
	});
});
