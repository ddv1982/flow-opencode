import { describe, expect, test } from "bun:test";
import { ArchiveCollisionError } from "../src/application/errors.js";
import { createFlowService } from "../src/application/flow-service.js";
import type { Plan, Session } from "../src/domain/session.js";
import {
	approveSession,
	deterministicEnvironment,
	expectOk,
	FEATURE,
	MemorySessionRepository,
	plan,
	resetFeatureRun,
	revision,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

function planlessSession(id: string, goal: string): Session {
	return {
		version: 5,
		id,
		revision: 0,
		goal,
		approval: "pending",
		plan: null,
		runs: [],
		operations: [],
		closure: null,
	};
}

describe("Flow close recovery and delivery", () => {
	test("confirms visible close replay durability before reporting archive recovery", async () => {
		const repository = new MemorySessionRepository();
		repository.session = planlessSession(
			"ambiguous-close-save",
			"Retire an ambiguous close",
		);
		const flow = createFlowService(repository, deterministicEnvironment());
		const closeRequest = {
			request: {
				operationId: "close-ambiguous-save",
				expectedRevision: 0,
				sessionId: "ambiguous-close-save",
				kind: "abandoned" as const,
				summary: "Close after confirming durability.",
			},
		};
		repository.saveFailureAfterMutation = new Error(
			"injected active directory sync failure",
		);

		const ambiguous = await flow.sessionClose(closeRequest);

		expect(ambiguous.status).toBe("error");
		expect(ambiguous.summary).toBe("injected active directory sync failure");
		expect(repository.session?.closure?.operationId).toBe(
			"close-ambiguous-save",
		);
		expect(repository.saveCount).toBe(1);
		expect(repository.archiveCount).toBe(0);

		repository.saveFailureAfterMutation = null;
		repository.confirmActiveFailure = new Error(
			"injected active durability confirmation failure",
		);
		const unconfirmed = await flow.sessionClose(closeRequest);

		expect(unconfirmed.status).toBe("error");
		expect(unconfirmed.summary).toBe(
			"injected active durability confirmation failure",
		);
		expect(unconfirmed.workflowData).not.toHaveProperty("closeState");
		expect(repository.confirmActiveCount).toBe(1);
		expect(repository.saveCount).toBe(1);
		expect(repository.archiveCount).toBe(0);

		repository.confirmActiveFailure = new ArchiveCollisionError(
			"Active state changed before durability confirmation.",
		);
		const collision = await flow.sessionClose(closeRequest);

		expect(collision.status).toBe("error");
		expect(collision.workflowData).toMatchObject({
			closeState: {
				durableAccepted: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
		});
		expect(collision.workflowData).not.toHaveProperty("delivery");
		expect(repository.archiveCount).toBe(0);

		repository.confirmActiveFailure = null;
		repository.archiveFailure = new Error("injected archive sync failure");
		const confirmed = await flow.sessionClose(closeRequest);

		expect(confirmed.status).toBe("error");
		expect(confirmed.workflowData.closeState).toMatchObject({
			durableAccepted: true,
			archiveConfirmed: false,
			retryExactRequest: true,
		});
		expect(repository.confirmActiveCount).toBe(3);
		expect(repository.saveCount).toBe(1);
		expect(repository.archiveCount).toBe(1);
	});

	test("reconfirms already-absent active cleanup before exact archived replay", async () => {
		const repository = new MemorySessionRepository();
		repository.session = planlessSession(
			"post-unlink-close",
			"Retire a post-unlink close",
		);
		const flow = createFlowService(repository, deterministicEnvironment());
		const closeRequest = {
			request: {
				operationId: "close-post-unlink",
				expectedRevision: 0,
				sessionId: "post-unlink-close",
				kind: "abandoned" as const,
				summary: "Confirm active cleanup.",
			},
		};
		repository.archiveFailureAfterMutation = new Error(
			"injected final Flow directory sync failure",
		);

		const interrupted = await flow.sessionClose(closeRequest);

		expect(interrupted.status).toBe("error");
		expect(repository.session).toBeNull();
		expect(
			repository.archives.get("post-unlink-close")?.closure,
		).not.toBeNull();
		expect(repository.archiveCount).toBe(1);

		repository.archiveFailureAfterMutation = null;
		const replay = await flow.sessionClose(closeRequest);

		expectOk(replay);
		expect(replay.workflowData.operation).toMatchObject({ replayed: true });
		expect(repository.archiveCount).toBe(2);
		expect(repository.confirmActiveCount).toBe(0);
	});

	test("reports archive collisions as manual nonretry recovery", async () => {
		const repository = new MemorySessionRepository();
		repository.session = planlessSession(
			"collision-close",
			"Retire a colliding close",
		);
		repository.archiveFailure = new ArchiveCollisionError(
			"Flow refused to overwrite a different archived session.",
		);
		const flow = createFlowService(repository, deterministicEnvironment());

		const collision = await flow.sessionClose({
			request: {
				operationId: "close-collision",
				expectedRevision: 0,
				sessionId: "collision-close",
				kind: "abandoned",
				summary: "Preserve both states.",
			},
		});

		expect(collision.status).toBe("error");
		expect(collision.summary).toContain("manual recovery");
		expect(collision.workflowData).toMatchObject({
			closeState: {
				durableAccepted: true,
				archiveConfirmed: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
			failure: {
				summary: "Flow refused to overwrite a different archived session.",
				recovery: expect.stringContaining("do not overwrite or delete"),
			},
		});
		expect(repository.session?.closure?.operationId).toBe("close-collision");
		expect(repository.archiveCount).toBe(1);
		const accepted = repository.session;
		if (!accepted) throw new Error("Expected the accepted closed session.");
		repository.archives.set("collision-close", {
			...structuredClone(accepted),
			goal: "Conflicting archived goal",
		});

		const refreshed = await flow.status({ request: { view: "compact" } });

		expect(refreshed.status).toBe("error");
		expect(refreshed.workflowData).toMatchObject({
			closeState: {
				durableAccepted: true,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: {
				nextAction: "await-user-direction",
				archiveRetry: null,
			},
		});

		repository.session = null;
		repository.archiveReadFailure = new ArchiveCollisionError(
			"Archived state is not canonical.",
		);
		const unreadableReplay = await flow.sessionClose({
			request: {
				operationId: "close-collision",
				expectedRevision: 0,
				sessionId: "collision-close",
				kind: "abandoned",
				summary: "Preserve both states.",
			},
		});
		expect(unreadableReplay.workflowData).toMatchObject({
			closeState: {
				durableAccepted: false,
				retryExactRequest: false,
				manualRecoveryRequired: true,
			},
			projection: { nextAction: "await-user-direction", archiveRetry: null },
		});
	});

	test("returns one deterministic delivery across close interruption, retry, and replay", async () => {
		const foundation = "delivery-foundation";
		const runtimeFeature = plan.features[0];
		if (!runtimeFeature) throw new Error("Missing runtime feature.");
		const deliveryPlan: Plan = {
			...plan,
			summary: "Deliver the runtime in two reviewed features.",
			features: [
				{
					id: foundation,
					title: "Delivery foundation",
					summary: "Prepare the delivery foundation.",
					targets: ["src/domain"],
					validation: ["bun test foundation"],
					dependsOn: [],
				},
				{ ...runtimeFeature, dependsOn: [foundation] },
			],
		};
		const repository = new MemorySessionRepository();
		const flow = await approveSession(repository, deterministicEnvironment(), {
			goal: "Ship deterministic delivery",
			plan: deliveryPlan,
			suffix: "delivery",
		});
		await startReviewedRun(flow, repository, {
			featureId: foundation,
			suffix: "delivery-foundation-1",
			command: "bun test foundation",
			artifacts: ["zeta.ts", "shared.ts", "superseded-only.ts"],
		});
		await submitReview(flow, repository, {
			featureId: foundation,
			suffix: "delivery-foundation-1",
			summary: "Foundation attempt remains blocked.",
			verdict: "failed",
			findings: [
				{
					severity: "blocking",
					summary: "The foundation needs a retry.",
					evidence: "superseded-only.ts:1",
				},
			],
		});
		await resetFeatureRun(flow, repository, foundation, "delivery-foundation");
		await startReviewedRun(flow, repository, {
			featureId: foundation,
			suffix: "delivery-foundation-2",
			command: "bun test foundation",
			artifacts: ["shared.ts", "latest-a.ts"],
		});
		await submitReview(flow, repository, {
			featureId: foundation,
			suffix: "delivery-foundation-2",
			summary: "Foundation completed.",
			verdict: "passed",
			findings: [
				{
					severity: "advisory",
					summary: "Keep delivery evidence concise.",
					evidence: "latest-a.ts:1",
				},
			],
		});
		await startReviewedRun(flow, repository, {
			featureId: FEATURE,
			suffix: "delivery-runtime",
			command: "bun test",
			artifacts: ["latest-b.ts", "latest-a.ts"],
		});
		await submitReview(flow, repository, {
			suffix: "delivery-runtime",
			summary: "Runtime completed.",
			verdict: "passed",
		});

		const sessionId = repository.session?.id;
		if (!sessionId) throw new Error("Expected the delivery session id.");
		const closeRequest = {
			request: {
				operationId: "close-delivery",
				expectedRevision: revision(repository),
				sessionId,
				kind: "completed" as const,
				summary: "Deterministic delivery shipped.",
			},
		};
		const expectedDelivery = {
			goal: "Ship deterministic delivery",
			closure: {
				kind: "completed",
				summary: "Deterministic delivery shipped.",
			},
			progress: { completed: 2, total: 2 },
			features: [
				{
					id: foundation,
					title: "Delivery foundation",
					attempts: 2,
					latestState: "completed",
					outcomeSummary: "Foundation completed.",
					terminalFindings: [
						{
							severity: "advisory",
							summary: "Keep delivery evidence concise.",
						},
					],
				},
				{
					id: FEATURE,
					title: "Runtime kernel",
					attempts: 1,
					latestState: "completed",
					outcomeSummary: "Runtime completed.",
					terminalFindings: [],
				},
			],
			reportedArtifacts: {
				latestAttempts: ["latest-a.ts", "latest-b.ts", "shared.ts"],
				supersededAttemptsOnly: ["superseded-only.ts", "zeta.ts"],
			},
		};

		repository.archiveFailure = new Error("injected delivery archive failure");
		const interrupted = await flow.sessionClose(closeRequest);
		expect(interrupted.status).toBe("error");
		expect(interrupted.workflowData.delivery).toEqual(expectedDelivery);
		const retryStatus = await flow.status({ request: { view: "compact" } });
		expectOk(retryStatus);
		const retryRequest = (
			retryStatus.workflowData.projection as {
				archiveRetry: typeof closeRequest;
			}
		).archiveRetry;
		repository.archiveFailure = null;
		repository.saveFailure = new Error("closed state must not be rewritten");
		const savesBeforeRetry = repository.saveCount;
		const retried = await flow.sessionClose(retryRequest);
		expectOk(retried);
		expect(retried.workflowData.delivery).toEqual(expectedDelivery);
		expect(repository.saveCount).toBe(savesBeforeRetry);
		expect(repository.confirmActiveCount).toBe(1);
		expect(repository.archiveCount).toBe(2);

		const exactReplay = await flow.sessionClose(closeRequest);
		expectOk(exactReplay);
		expect(exactReplay.workflowData.delivery).toEqual(expectedDelivery);
		expect(repository.archiveCount).toBe(3);
		repository.saveFailure = null;
		expectOk(
			await flow.planSave({
				request: {
					operationId: "plan-save-after-delivery",
					expectedRevision: 0,
					goal: "Ship a later runtime",
					plan,
				},
			}),
		);
		const laterSession = repository.session;
		if (!laterSession) throw new Error("Expected a later active session.");
		const archivesBeforeDelayedReplay = repository.archiveCount;
		const delayedReplay = await flow.sessionClose(closeRequest);
		expectOk(delayedReplay);
		expect(delayedReplay.workflowData.delivery).toEqual(expectedDelivery);
		expect(repository.session).toBe(laterSession);
		expect(repository.archiveCount).toBe(archivesBeforeDelayedReplay);
	});

	test("delivers a planless abandoned session without inventing work", async () => {
		const repository = new MemorySessionRepository();
		repository.session = {
			version: 5,
			id: "planless-session",
			revision: 0,
			goal: "Retire an unplanned experiment",
			approval: "pending",
			plan: null,
			runs: [],
			operations: [],
			closure: null,
		};
		const flow = createFlowService(repository, deterministicEnvironment());

		const abandoned = await flow.sessionClose({
			request: {
				operationId: "close-planless-session",
				expectedRevision: 0,
				sessionId: "planless-session",
				kind: "abandoned",
				summary: "No plan was approved or executed.",
			},
		});

		expectOk(abandoned);
		expect(abandoned.workflowData.delivery).toEqual({
			goal: "Retire an unplanned experiment",
			closure: {
				kind: "abandoned",
				summary: "No plan was approved or executed.",
			},
			progress: { completed: 0, total: 0 },
			features: [],
			reportedArtifacts: {
				latestAttempts: [],
				supersededAttemptsOnly: [],
			},
		});
	});

	test("delivers active, blocked, and untouched deferred work without inventing outcomes", async () => {
		const runtimeFeature = plan.features[0];
		if (!runtimeFeature)
			throw new Error("Expected the runtime feature fixture.");
		const followup = "runtime-followup";
		const unfinishedPlan: Plan = {
			...plan,
			features: [
				runtimeFeature,
				{
					id: followup,
					title: "Runtime follow-up",
					summary: "Finish the runtime after the kernel.",
					targets: ["src"],
					validation: ["bun test"],
					dependsOn: [FEATURE],
				},
			],
		};
		const scenarios = [
			{
				name: "active",
				latestState: "superseded",
				outcomeSummary: null,
				terminalFindings: [],
			},
			{
				name: "blocked",
				latestState: "blocked",
				outcomeSummary: "Runtime remains blocked.",
				terminalFindings: [
					{ severity: "blocking", summary: "Kernel is incomplete." },
				],
			},
		] as const;

		for (const scenario of scenarios) {
			const repository = new MemorySessionRepository();
			const flow = await approveSession(
				repository,
				deterministicEnvironment(),
				{ plan: unfinishedPlan, suffix: `deferred-${scenario.name}` },
			);
			await startReviewedRun(flow, repository, {
				suffix: `deferred-${scenario.name}`,
				artifacts: ["src/runtime.ts"],
			});
			if (scenario.name === "blocked") {
				await submitReview(flow, repository, {
					suffix: "deferred-blocked",
					summary: scenario.outcomeSummary,
					verdict: "failed",
					findings: [
						{
							severity: "blocking",
							summary: "Kernel is incomplete.",
							evidence: "src/runtime.ts:1",
						},
					],
				});
			}
			const sessionId = repository.session?.id;
			if (!sessionId) throw new Error("Expected the deferred session id.");
			const summary = `Runtime ${scenario.name} work will resume later.`;
			const deferred = await flow.sessionClose({
				request: {
					operationId: `close-deferred-${scenario.name}`,
					expectedRevision: revision(repository),
					sessionId,
					kind: "deferred",
					summary,
				},
			});

			expectOk(deferred);
			expect(deferred.workflowData.delivery).toEqual({
				goal: "Ship the runtime",
				closure: { kind: "deferred", summary },
				progress: { completed: 0, total: 2 },
				features: [
					{
						id: FEATURE,
						title: "Runtime kernel",
						attempts: 1,
						latestState: scenario.latestState,
						outcomeSummary: scenario.outcomeSummary,
						terminalFindings: scenario.terminalFindings,
					},
					{
						id: followup,
						title: "Runtime follow-up",
						attempts: 0,
						latestState: "not-started",
						outcomeSummary: null,
						terminalFindings: [],
					},
				],
				reportedArtifacts: {
					latestAttempts: ["src/runtime.ts"],
					supersededAttemptsOnly: [],
				},
			});
		}
	});
});
