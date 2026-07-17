import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowSessionClose,
	flowStatus,
} from "../src/runtime/api";
import {
	type OrchestrationPassRecord,
	type OrchestrationTelemetry,
	WorkerResultSchema,
} from "../src/runtime/schema";

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "flow-runtime-"));
}

function twoFeaturePlan() {
	return {
		summary: "Deliver the requested change.",
		overview: "Implement the first feature, then the dependent final feature.",
		requirements: ["Keep scope explicit."],
		decisions: ["Use the minimal Flow v4 runtime."],
		finalReviewPolicy: "detailed" as const,
		features: [
			{
				id: "first-feature",
				title: "First feature",
				summary: "Deliver the first part.",
				targets: ["src/first.ts"],
				validation: ["targeted test"],
				dependsOn: [],
			},
			{
				id: "final-feature",
				title: "Final feature",
				summary: "Finish the delivery.",
				targets: ["src/final.ts"],
				validation: ["broad check"],
				dependsOn: ["first-feature"],
			},
		],
	};
}

function completePayload(featureId: string, scope: "targeted" | "broad") {
	return {
		status: "ok" as const,
		featureId,
		summary: `Completed ${featureId}.`,
		artifactsChanged: [{ path: `src/${featureId}.ts` }],
		validationRun: [
			{
				command: `bun test ${featureId}`,
				status: "passed" as const,
				summary: "Focused check passed.",
			},
		],
		validationScope: scope,
		featureReviewDepth: "standard" as const,
		featureReview: {
			status: "passed" as const,
			summary: "Reviewed changed files and validation.",
			blockingFindings: [],
		},
	};
}

function orchestrationPass(
	id: string,
	overrides: Partial<OrchestrationPassRecord> = {},
): OrchestrationPassRecord {
	return {
		id,
		kind: "validation",
		modes: [],
		candidateEligibility: "unknown",
		decisionFactors: [],
		workerCount: 1,
		candidateWorkerCount: 0,
		verifierWorkerCount: 0,
		sliceIds: [],
		dependsOn: [],
		writeScope: "none",
		handoffRefs: [],
		verificationStatus: "passed",
		outcome: "accepted",
		...overrides,
	};
}

function fourFeaturePlan() {
	return {
		...twoFeaturePlan(),
		features: [
			{
				id: "feature-one",
				title: "Feature one",
				summary: "Deliver part one.",
				targets: ["src/one.ts"],
				validation: ["targeted test one"],
				dependsOn: [],
			},
			{
				id: "feature-two",
				title: "Feature two",
				summary: "Deliver part two.",
				targets: ["src/two.ts"],
				validation: ["targeted test two"],
				dependsOn: ["feature-one"],
			},
			{
				id: "feature-three",
				title: "Feature three",
				summary: "Deliver part three.",
				targets: ["src/three.ts"],
				validation: ["targeted test three"],
				dependsOn: ["feature-two"],
			},
			{
				id: "feature-four",
				title: "Feature four",
				summary: "Deliver part four.",
				targets: ["src/four.ts"],
				validation: ["broad check"],
				dependsOn: ["feature-three"],
			},
		],
	};
}

function finalReview() {
	return {
		status: "passed" as const,
		summary: "Reviewed full session scope and broad validation.",
		blockingFindings: [],
		reviewDepth: "detailed" as const,
	};
}

async function approvedTwoFeatureSession(workspace: string): Promise<void> {
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Deliver a two-feature change",
				plan: twoFeaturePlan(),
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
}

async function orchestrationTelemetry(
	workspace: string,
): Promise<OrchestrationTelemetry> {
	const status = await flowStatus(workspace);
	return (
		status.session as { budget: { orchestration: OrchestrationTelemetry } }
	).budget.orchestration;
}

describe("Flow runtime gates", () => {
	test("rejects invalid feature dependency graphs", async () => {
		const workspace = await tempWorkspace();
		const cyclic = {
			...twoFeaturePlan(),
			features: [
				{ ...twoFeaturePlan().features[0], dependsOn: ["final-feature"] },
				{ ...twoFeaturePlan().features[1], dependsOn: ["first-feature"] },
			],
		};

		const result = await flowPlanSave(workspace, {
			goal: "Reject invalid graph",
			plan: cyclic,
		});
		expect(result.status).toBe("error");
		expect(String(result.summary)).toContain("cycle");

		const unknownDependency = await flowPlanSave(await tempWorkspace(), {
			goal: "Reject unknown dependency",
			plan: {
				...twoFeaturePlan(),
				features: [
					twoFeaturePlan().features[0],
					{
						...twoFeaturePlan().features[1],
						dependsOn: ["missing-feature"],
					},
				],
			},
		});
		expect(unknownDependency.status).toBe("error");
		expect(String(unknownDependency.summary)).toContain("unknown feature");

		const selfDependency = await flowPlanSave(await tempWorkspace(), {
			goal: "Reject self dependency",
			plan: {
				...twoFeaturePlan(),
				features: [
					{
						...twoFeaturePlan().features[0],
						dependsOn: ["first-feature"],
					},
					twoFeaturePlan().features[1],
				],
			},
		});
		expect(selfDependency.status).toBe("error");
		expect(String(selfDependency.summary)).toContain("itself");
	});

	test("approved plans are immutable and only one feature can run", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);

		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Deliver a two-feature change",
					plan: { ...twoFeaturePlan(), summary: "Changed after approval." },
				})
			).status,
		).toBe("error");

		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const secondStart = await flowRunStart(workspace, {
			featureId: "final-feature",
		});
		expect(secondStart.status).toBe("error");
		expect(String(secondStart.summary)).toContain("already in progress");
	});

	test("completion requires validation and review evidence", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const missingValidation = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			validationRun: [],
		});
		expect(missingValidation.status).toBe("error");
		expect(String(missingValidation.summary)).toContain("validation evidence");

		const failedValidation = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			validationRun: [
				{
					command: "bun test first-feature",
					status: "failed" as const,
					summary: "Focused check failed.",
				},
			],
		});
		expect(failedValidation.status).toBe("error");
		expect(String(failedValidation.summary)).toContain("validation to pass");

		const broadNonFinal = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "broad"),
		});
		expect(broadNonFinal.status).toBe("error");
		expect(String(broadNonFinal.summary)).toContain("targeted validation");

		const failedReview = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			featureReview: {
				status: "failed",
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
		});
		expect(failedReview.status).toBe("error");
		expect(String(failedReview.summary)).toContain("featureReview");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("running");
	});

	test("completion enforces planned feature review depth", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Require detailed review",
			plan: {
				...twoFeaturePlan(),
				features: [
					{ ...twoFeaturePlan().features[0], reviewDepth: "detailed" as const },
					twoFeaturePlan().features[1],
				],
			},
		});
		await flowPlanApprove(workspace);
		await flowRunStart(workspace, {});

		const shallow = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			featureReviewDepth: "standard" as const,
		});
		expect(shallow.status).toBe("error");
		expect(String(shallow.summary)).toContain("review depth");

		const detailed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			featureReviewDepth: "detailed" as const,
		});
		expect(detailed.status).toBe("ok");
	});

	test("records bounded orchestration pass accounting", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				{
					id: "first-feature-implementation-decision",
					kind: "implementation-decision" as const,
					decision: "serial" as const,
					decisionReason:
						"Shared contract edits made manager-serial implementation safer.",
					candidateEligibility: "not_eligible" as const,
					candidateDecision: "serial_required" as const,
					decisionFactors: [
						"shared_state" as const,
						"overlapping_files" as const,
						"needs_manager_judgment" as const,
					],
					writeScope: "manager-serial" as const,
					verificationStatus: "not-needed" as const,
					outcome: "accepted" as const,
				},
				{
					id: "first-feature-candidate-docs",
					kind: "candidate" as const,
					decision: "candidate-exact-path" as const,
					decisionReason:
						"Docs target was disjoint from runtime implementation files.",
					candidateEligibility: "eligible" as const,
					candidateDecision: "used" as const,
					decisionFactors: [
						"independent_surface" as const,
						"validation_available" as const,
					],
					modes: ["candidate-implementation" as const],
					workerCount: 1,
					candidateWorkerCount: 1,
					sliceIds: ["docs-slice"],
					writeScope: "exact-path" as const,
					handoffRefs: ["/tmp/flow/first-feature-candidate.md"],
					verificationStatus: "passed" as const,
					outcome: "accepted" as const,
					synthesisRef: "/tmp/flow/first-feature-synthesis.md",
				},
				{
					id: "first-feature-review-claim-check",
					kind: "verification" as const,
					modes: ["verifier" as const],
					workerCount: 1,
					verifierWorkerCount: 1,
					sliceIds: ["claim-review-coverage"],
					dependsOn: ["first-feature-candidate-docs"],
					verificationStatus: "passed" as const,
					outcome: "accepted" as const,
				},
			],
		});
		expect(completed.status).toBe("ok");

		const status = await flowStatus(workspace);
		const session = status.session as {
			budget: { orchestration: OrchestrationTelemetry };
			latestHistoryEntry: {
				orchestrationPasses: Array<{ id: string; writeScope: string }>;
			};
		};
		expect(session.budget.orchestration).toMatchObject({
			passCount: 3,
			workerCount: 2,
			candidatePassCount: 1,
			verifierPassCount: 1,
			candidateEligibleCount: 0,
			candidateUsedDecisionCount: 0,
			candidateSerialRequiredDecisionCount: 1,
			skippedCandidateDecisionCount: 0,
		});
		expect(
			session.budget.orchestration.latestPasses.map((pass) => pass.id),
		).toEqual([
			"first-feature-implementation-decision",
			"first-feature-candidate-docs",
			"first-feature-review-claim-check",
		]);
		expect(session.budget.orchestration.latestPasses[0]).toMatchObject({
			candidateEligibility: "not_eligible",
			candidateDecision: "serial_required",
			decisionFactors: [
				"shared_state",
				"overlapping_files",
				"needs_manager_judgment",
			],
		});
		expect(session.budget.orchestration.latestPasses[1]).toMatchObject({
			candidateEligibility: "eligible",
			candidateDecision: "used",
			decisionFactors: ["independent_surface", "validation_available"],
		});
		expect(session.budget.orchestration.latestPasses[1]?.handoffRefs).toEqual([
			"/tmp/flow/first-feature-candidate.md",
		]);
		expect(session.budget.orchestration.latestPasses[2]?.dependsOn).toEqual([
			"first-feature-candidate-docs",
		]);
		expect(session.latestHistoryEntry.orchestrationPasses).toHaveLength(3);
		expect(session.latestHistoryEntry.orchestrationPasses[1]?.writeScope).toBe(
			"exact-path",
		);
	});

	test("counts only eligible skipped implementation candidates as skipped", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-too-tight", {
					kind: "implementation-decision",
					decision: "serial",
					decisionReason:
						"A shared lifecycle invariant required one manager-owned edit.",
					candidateEligibility: "not_eligible",
					candidateDecision: "serial_required",
					decisionFactors: ["shared_state", "overlapping_files"],
					workerCount: 0,
					writeScope: "manager-serial",
					verificationStatus: "not-needed",
				}),
				orchestrationPass("first-feature-frontend-skipped", {
					kind: "implementation-decision",
					decision: "skipped",
					decisionReason:
						"Frontend slice was independent with targeted validation, but the manager chose serial.",
					candidateEligibility: "eligible",
					candidateDecision: "skipped",
					decisionFactors: [
						"independent_surface",
						"validation_available",
						"small_slice",
					],
					workerCount: 0,
					writeScope: "manager-serial",
					verificationStatus: "not-needed",
				}),
			],
		});
		expect(completed.status).toBe("ok");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.candidateEligibleCount).toBe(1);
		expect(telemetry.candidateUsedDecisionCount).toBe(0);
		expect(telemetry.candidateSerialRequiredDecisionCount).toBe(1);
		expect(telemetry.skippedCandidateDecisionCount).toBe(1);
		expect(telemetry.latestPasses.map((pass) => pass.id)).toEqual([
			"first-feature-too-tight",
			"first-feature-frontend-skipped",
		]);
	});

	test("dedupes resubmitted pass ids beyond the latestPasses window", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const manyPasses = Array.from({ length: 60 }, (_, index) =>
			orchestrationPass(`first-feature-pass-${index}`),
		);
		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: manyPasses,
		});
		expect(completed.status).toBe("ok");
		const afterFirst = await orchestrationTelemetry(workspace);
		expect(afterFirst.passCount).toBe(60);
		expect(afterFirst.latestPasses).toHaveLength(50);

		// first-feature-pass-0 has slid out of the 50-record window; a
		// resubmitted id must still dedup via recordedPassIds.
		await flowRunStart(workspace, {});
		const resubmitted = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: finalReview(),
			orchestrationPasses: [
				orchestrationPass("first-feature-pass-0"),
				orchestrationPass("final-feature-fresh-pass"),
			],
		});
		expect(resubmitted.status).toBe("ok");
		const afterSecond = await orchestrationTelemetry(workspace);
		expect(afterSecond.passCount).toBe(61);
		expect(afterSecond.workerCount).toBe(61);
	});

	test("rejects candidate decision usage without execution evidence", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-decision-only-candidate", {
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					decisionReason:
						"Decision selected a candidate-capable exact-path shape.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 0,
					candidateWorkerCount: 0,
					writeScope: "exact-path",
				}),
			],
		});
		expect(completed.status).toBe("error");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.candidateUsedDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("rejects serial implementation decisions that claim candidate usage", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-serial-used-candidate", {
					kind: "implementation-decision",
					decision: "serial",
					decisionReason:
						"Serial manager-owned work cannot also claim candidate usage.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 1,
					candidateWorkerCount: 1,
					writeScope: "manager-serial",
				}),
			],
		});
		expect(completed.status).toBe("error");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.candidateUsedDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("rejects candidate accounting decisions on non-implementation passes", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-validation-skipped-candidate", {
					kind: "validation",
					decisionReason:
						"Validation cannot record a manager implementation skip.",
					candidateEligibility: "eligible",
					candidateDecision: "skipped",
					verificationStatus: "passed",
				}),
			],
		});
		expect(completed.status).toBe("error");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.candidateEligibleCount).toBe(0);
		expect(telemetry.candidateSerialRequiredDecisionCount).toBe(0);
		expect(telemetry.skippedCandidateDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("rejects orchestration subtype worker counts above total workers", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-impossible-worker-counts", {
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					decisionReason:
						"Candidate worker count cannot exceed total worker count.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 0,
					candidateWorkerCount: 1,
					writeScope: "exact-path",
				}),
			],
		});
		expect(completed.status).toBe("error");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.workerCount).toBe(0);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("counts valid candidate implementation decisions with worker evidence", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-candidate-worker-decision", {
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					decisionReason:
						"Candidate worker owned a disjoint exact-path implementation.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 1,
					candidateWorkerCount: 1,
					writeScope: "exact-path",
					verificationStatus: "passed",
				}),
			],
		});
		expect(completed.status).toBe("ok");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(1);
		expect(telemetry.workerCount).toBe(1);
		expect(telemetry.candidatePassCount).toBe(1);
		expect(telemetry.candidateEligibleCount).toBe(1);
		expect(telemetry.candidateUsedDecisionCount).toBe(1);
		expect(telemetry.candidateSerialRequiredDecisionCount).toBe(0);
		expect(telemetry.skippedCandidateDecisionCount).toBe(0);
		expect(telemetry.latestPasses.map((pass) => pass.id)).toEqual([
			"first-feature-candidate-worker-decision",
		]);
	});

	test("counts verifier worker count as verifier pass evidence", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [
				orchestrationPass("first-feature-verifier-worker-count", {
					kind: "validation",
					decisionReason:
						"A verifier worker checked claims after manager synthesis.",
					workerCount: 1,
					verifierWorkerCount: 1,
					verificationStatus: "passed",
				}),
			],
		});
		expect(completed.status).toBe("ok");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(1);
		expect(telemetry.workerCount).toBe(1);
		expect(telemetry.verifierPassCount).toBe(1);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.latestPasses.map((pass) => pass.id)).toEqual([
			"first-feature-verifier-worker-count",
		]);
	});

	test("records orchestration telemetry on validation gate failures", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const failed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			validationRun: [
				{
					command: "bun test first-feature",
					status: "failed" as const,
					summary: "Focused check failed.",
				},
			],
			orchestrationPasses: [
				orchestrationPass("first-feature-validation-failure", {
					workerCount: 2,
				}),
			],
		});
		expect(failed.status).toBe("error");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(1);
		expect(telemetry.workerCount).toBe(2);
		expect(telemetry.latestPasses.map((pass) => pass.id)).toEqual([
			"first-feature-validation-failure",
		]);
	});

	test("does not double count orchestration passes across review retries", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const pass = orchestrationPass("first-feature-review-pass", {
			kind: "review",
			modes: ["review"],
		});
		const failedReview = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			featureReview: {
				status: "failed" as const,
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
			orchestrationPasses: [pass],
		});
		expect(failedReview.status).toBe("error");

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: [pass],
		});
		expect(completed.status).toBe("ok");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(1);
		expect(telemetry.latestPasses.map((item) => item.id)).toEqual([
			"first-feature-review-pass",
		]);
	});

	test("records orchestration telemetry when a feature needs input", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const blocked = await flowFeatureComplete(workspace, {
			status: "needs_input" as const,
			featureId: "first-feature",
			summary: "Need a product decision.",
			outcome: {
				kind: "needs_input" as const,
				summary: "Need user input on expected behavior.",
			},
			orchestrationPasses: [
				orchestrationPass("first-feature-question-discovery", {
					kind: "discovery",
					modes: ["evidence"],
				}),
			],
		});
		expect(blocked.status).toBe("ok");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("blocked");
		const session = status.session as {
			budget: {
				orchestration: {
					passCount: number;
					latestPasses: Array<{ id: string }>;
				};
			};
			latestHistoryEntry: {
				orchestrationPasses: Array<{ id: string }>;
			};
		};
		expect(session.budget.orchestration.passCount).toBe(1);
		expect(session.budget.orchestration.latestPasses[0]?.id).toBe(
			"first-feature-question-discovery",
		);
		expect(session.latestHistoryEntry.orchestrationPasses[0]?.id).toBe(
			"first-feature-question-discovery",
		);
	});

	test("caps latest orchestration pass retention without losing totals", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: Array.from({ length: 55 }, (_, index) =>
				orchestrationPass(`first-feature-pass-${index}`),
			),
		});
		expect(completed.status).toBe("ok");

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(55);
		expect(telemetry.workerCount).toBe(55);
		expect(telemetry.latestPasses).toHaveLength(50);
		expect(telemetry.latestPasses[0]?.id).toBe("first-feature-pass-5");
		expect(telemetry.latestPasses.at(-1)?.id).toBe("first-feature-pass-54");
	});

	test("failed review retry budget blocks after one autonomous retry", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const failedReviewPayload = {
			...completePayload("first-feature", "targeted"),
			featureReview: {
				status: "failed" as const,
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
		};
		const firstFailure = await flowFeatureComplete(
			workspace,
			failedReviewPayload,
		);
		expect(firstFailure.status).toBe("error");
		expect(String(firstFailure.recovery)).toContain("at most one repair");
		expect((await flowStatus(workspace)).status).toBe("running");

		const retryFailure = await flowFeatureComplete(
			workspace,
			failedReviewPayload,
		);
		expect(retryFailure.status).toBe("error");
		expect(String(retryFailure.summary)).toContain("retry budget");
		const retrySession = retryFailure.session as {
			budget: { phaseBoundary: { reason: string } };
			resumePacket: unknown;
		};
		expect(retrySession.budget.phaseBoundary.reason).toBe(
			"review_failure_limit",
		);
		expect(retrySession.resumePacket).toBeTruthy();
		const status = await flowStatus(workspace);
		expect(status.status).toBe("blocked");
		expect(
			(status.session as { budget: { failedReviewCount: number } }).budget
				.failedReviewCount,
		).toBe(2);
	});

	test("failed final review uses retry budget and returns boundary handoff", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		expect(
			(
				await flowFeatureComplete(
					workspace,
					completePayload("first-feature", "targeted"),
				)
			).status,
		).toBe("ok");
		await flowRunStart(workspace, {});

		const failedFinalReviewPayload = {
			...completePayload("final-feature", "broad"),
			finalReview: {
				...finalReview(),
				status: "failed" as const,
				summary: "Final review still finds a blocker.",
				blockingFindings: [{ summary: "Release gate is not covered." }],
			},
		};
		const firstFailure = await flowFeatureComplete(
			workspace,
			failedFinalReviewPayload,
		);
		expect(firstFailure.status).toBe("error");
		expect(String(firstFailure.recovery)).toContain("at most one repair");
		expect((await flowStatus(workspace)).status).toBe("running");

		const retryFailure = await flowFeatureComplete(
			workspace,
			failedFinalReviewPayload,
		);
		expect(retryFailure.status).toBe("error");
		expect(String(retryFailure.summary)).toContain("retry budget");
		const retrySession = retryFailure.session as {
			budget: {
				failedReviewCount: number;
				phaseBoundary: { reason: string };
			};
			features: Array<{ id: string; status: string }>;
			resumePacket: unknown;
		};
		expect(retrySession.budget.failedReviewCount).toBe(2);
		expect(retrySession.budget.phaseBoundary.reason).toBe(
			"review_failure_limit",
		);
		expect(retrySession.resumePacket).toBeTruthy();
		expect(
			retrySession.features.find((feature) => feature.id === "final-feature")
				?.status,
		).toBe("blocked");
		expect((await flowStatus(workspace)).status).toBe("blocked");
	});

	test("does not stop a plan after three completed features", async () => {
		const workspace = await tempWorkspace();
		await flowPlanSave(workspace, {
			goal: "Deliver a four-feature change",
			plan: fourFeaturePlan(),
		});
		await flowPlanApprove(workspace);

		for (const featureId of ["feature-one", "feature-two", "feature-three"]) {
			expect((await flowRunStart(workspace, {})).status).toBe("ok");
			expect(
				(
					await flowFeatureComplete(
						workspace,
						completePayload(featureId, "targeted"),
					)
				).status,
			).toBe("ok");
		}

		const status = await flowStatus(workspace);
		expect(status.status).toBe("ready");
		expect(String(status.statusSummary)).toContain("Progress 3/4");
		expect(String(status.statusSummary)).toContain("feature-four");
		expect(String(status.nextAction)).toContain("feature-four");
		expect(
			(status.session as { nextFeature: { id: string } | null }).nextFeature
				?.id,
		).toBe("feature-four");
		expect(
			(
				status.session as {
					pendingFeatures: Array<{ id: string }>;
					progress: { remaining: number };
				}
			).pendingFeatures.map((feature) => feature.id),
		).toEqual(["feature-four"]);
		expect(
			(
				status.session as {
					pendingFeatures: Array<{ id: string }>;
					progress: { remaining: number };
				}
			).progress.remaining,
		).toBe(1);
		expect(
			(status.session as { budget: { phaseBoundary: unknown } }).budget
				.phaseBoundary,
		).toBeNull();

		const nextStart = await flowRunStart(workspace, {});
		expect(nextStart.status).toBe("ok");
		const runningStatus = await flowStatus(workspace);
		expect(String(runningStatus.statusSummary)).toContain(
			"active: feature-four",
		);
		expect(String(runningStatus.nextAction)).toContain("feature-four");
		expect(
			(
				runningStatus.session as {
					budget: { completedFeaturesSinceBoundary: number };
				}
			).budget.completedFeaturesSinceBoundary,
		).toBe(3);
	});

	test("final feature requires broad validation and final review", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		expect(
			(
				await flowFeatureComplete(
					workspace,
					completePayload("first-feature", "targeted"),
				)
			).status,
		).toBe("ok");

		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const targetedFinal = await flowFeatureComplete(
			workspace,
			completePayload("final-feature", "targeted"),
		);
		expect(targetedFinal.status).toBe("error");
		expect(String(targetedFinal.summary)).toContain("broad validation");

		const withoutFinalReview = await flowFeatureComplete(
			workspace,
			completePayload("final-feature", "broad"),
		);
		expect(withoutFinalReview.status).toBe("error");
		expect(String(withoutFinalReview.summary)).toContain("finalReview");

		const failedFinalReview = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: {
				...finalReview(),
				status: "failed" as const,
				summary: "Final review found a blocker.",
				blockingFindings: [{ summary: "Project gate is incomplete." }],
			},
		});
		expect(failedFinalReview.status).toBe("error");
		expect(String(failedFinalReview.summary)).toContain("passing finalReview");

		const wrongReviewDepth = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: {
				...finalReview(),
				reviewDepth: "broad" as const,
			},
		});
		expect(wrongReviewDepth.status).toBe("error");
		expect(String(wrongReviewDepth.summary)).toContain("plan policy");

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: finalReview(),
		});
		expect(completed.status).toBe("ok");
		expect((await flowStatus(workspace)).status).toBe("completed");
	});

	test("completed close refuses unfinished features", async () => {
		const planlessWorkspace = await tempWorkspace();
		await flowPlanSave(planlessWorkspace, {
			goal: "Close without a plan",
		});
		const planlessClose = await flowSessionClose(planlessWorkspace, {
			kind: "completed",
			summary: "Done.",
		});
		expect(planlessClose.status).toBe("error");
		expect(String(planlessClose.summary)).toContain("approved plan");

		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);

		const close = await flowSessionClose(workspace, {
			kind: "completed",
			summary: "Done.",
		});
		expect(close.status).toBe("error");
		expect(String(close.summary)).toContain("unfinished features");
	});

	test("needs_input outcomes cannot default to completed", () => {
		expect(
			WorkerResultSchema.safeParse({
				...completePayload("first-feature", "targeted"),
				outcome: {
					kind: "blocked",
					summary: "Blocked outcomes must not be reported as ok.",
				},
			}).success,
		).toBe(false);

		expect(
			WorkerResultSchema.safeParse({
				status: "needs_input",
				featureId: "first-feature",
				summary: "Need operator input.",
				outcome: {},
			}).success,
		).toBe(false);

		const parsed = WorkerResultSchema.parse({
			status: "needs_input",
			featureId: "first-feature",
			summary: "Need operator input.",
			outcome: {
				summary: "Missing API token for manual verification.",
			},
		});
		if (parsed.status !== "needs_input") {
			throw new Error("Expected a needs_input worker result.");
		}
		expect(parsed.outcome.kind).toBe("needs_input");
	});

	test("blocked sessions expose blocker details and require reset before rerun", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const blocked = await flowFeatureComplete(workspace, {
			status: "needs_input",
			featureId: "first-feature",
			summary: "Need operator credentials.",
			outcome: {
				kind: "needs_input",
				summary: "Missing API token for manual verification.",
				resolutionHint: "Provide API_TOKEN or reset with a mocked check.",
			},
		});
		expect(blocked.status).toBe("ok");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("blocked");
		expect(status.summary).toBe("Need operator credentials.");
		expect(
			(
				status.session as {
					latestHistoryEntry: { outcome?: { resolutionHint?: string } };
				}
			).latestHistoryEntry.outcome?.resolutionHint,
		).toContain("API_TOKEN");

		const rerun = await flowRunStart(workspace, {});
		expect(rerun.status).toBe("error");
		expect(String(rerun.summary)).toContain("reset");

		const unrelatedReset = await flowFeatureReset(workspace, {
			featureId: "final-feature",
		});
		expect(unrelatedReset.status).toBe("ok");

		const stillBlocked = await flowStatus(workspace);
		expect(stillBlocked.status).toBe("blocked");
		expect(
			(
				stillBlocked.session as {
					features: Array<{ id: string; status: string }>;
				}
			).features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("blocked");

		const requestedBlocked = await flowRunStart(workspace, {
			featureId: "first-feature",
		});
		expect(requestedBlocked.status).toBe("error");
		expect(String(requestedBlocked.summary)).toContain("reset");

		const resetBlocked = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(resetBlocked.status).toBe("ok");
		expect(
			(await flowRunStart(workspace, { featureId: "first-feature" })).status,
		).toBe("ok");
	});

	test("reset clears a feature and its dependents", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(
			workspace,
			completePayload("first-feature", "targeted"),
		);

		const reset = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(reset.status).toBe("ok");

		const status = await flowStatus(workspace);
		const features = (
			status.session as { features: Array<{ id: string; status: string }> }
		).features;
		expect(
			features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("pending");
		expect(
			features.find((feature) => feature.id === "final-feature")?.status,
		).toBe("pending");
	});

	test("resetting a completed session reopens the approved plan", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(
			workspace,
			completePayload("first-feature", "targeted"),
		);
		await flowRunStart(workspace, {});
		await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: finalReview(),
		});

		const completed = await flowStatus(workspace);
		expect(completed.status).toBe("completed");
		expect(
			(completed.session as { closure: { kind: string } }).closure.kind,
		).toBe("completed");

		const reset = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(reset.status).toBe("ok");

		const status = await flowStatus(workspace);
		expect(status.status).toBe("ready");
		expect(
			(status.session as { activeFeature: unknown }).activeFeature,
		).toBeNull();
		expect(
			(
				status.session as {
					progress: { completed: number; total: number; remaining: number };
				}
			).progress,
		).toEqual({ completed: 0, total: 2, remaining: 2 });
		expect(
			(status.session as { closure: null; timestamps: { completedAt: null } })
				.closure,
		).toBeNull();
		expect(
			(status.session as { timestamps: { completedAt: string | null } })
				.timestamps.completedAt,
		).toBeNull();
		const features = (
			status.session as { features: Array<{ id: string; status: string }> }
		).features;
		expect(features.every((feature) => feature.status === "pending")).toBe(
			true,
		);
		expect((status.session as { historyCount: number }).historyCount).toBe(2);
		expect(
			(status.session as { latestHistoryEntry: { featureId: string } })
				.latestHistoryEntry.featureId,
		).toBe("final-feature");
	});
});
