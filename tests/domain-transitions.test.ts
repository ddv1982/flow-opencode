import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import {
	type FeatureId,
	type PlanInput,
	toFeatureId,
	toSessionId,
} from "../src/domain/session.js";
import {
	applyPlan,
	approvePlan,
	closeSession,
	createSession,
	resetFeature,
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
