import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowResponse } from "../src/application/flow-service.js";
import {
	type OrchestrationPassRecord,
	type OrchestrationTelemetry,
	WorkerResultSchema,
} from "../src/application/schema.js";
import type { ReviewExecutionInput, Session } from "../src/domain/session.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowFeatureReset as executeFlowFeatureReset,
	flowPlanApprove as executeFlowPlanApprove,
	flowPlanSave as executeFlowPlanSave,
	flowRunStart as executeFlowRunStart,
	flowSessionClose as executeFlowSessionClose,
	flowStatus as executeFlowStatus,
} from "../src/infrastructure/fs/workspace-flow-service.js";

type TestSession = Session & {
	sourceSummary: string;
	features: NonNullable<Session["plan"]>["features"];
	nextFeature: NonNullable<Session["plan"]>["features"][number] | null;
	pendingFeatures: NonNullable<Session["plan"]>["features"];
	latestHistoryEntry: Session["history"][number] | null;
	historyCount: number;
	progress: { completed: number; total: number; remaining: number };
};

type TestFlowResponse = FlowResponse & {
	workflowData?: NonNullable<FlowResponse["workflowData"]> & {
		session?: TestSession;
	};
};

let operationSequence = 0;
const completionResponseCache = new WeakMap<object, FlowResponse>();
const SOURCE_DIGEST = `sha256:${"c".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;

function completionValidations(payload: Record<string, unknown>) {
	const validations = Array.isArray(payload.validationRun)
		? payload.validationRun
		: [];
	return validations.flatMap((run) => {
		if (
			typeof run !== "object" ||
			run === null ||
			!("command" in run) ||
			typeof run.command !== "string"
		) {
			return [];
		}
		return [
			{
				command: run.command,
				summary:
					"summary" in run && typeof run.summary === "string"
						? run.summary
						: "Validation result.",
				startedAt: "2026-07-18T08:58:00.000Z",
				completedAt: "2026-07-18T08:59:00.000Z",
				exitCode: "status" in run && run.status === "passed" ? 0 : 1,
				outputDigest: OUTPUT_DIGEST,
				environmentKeys: [],
			},
		];
	});
}

function decorateSession(session: Session): TestSession {
	const features = session.plan?.features ?? [];
	const completed = features.filter(
		(feature) => feature.status === "completed",
	).length;
	const nextFeature =
		features.find((feature) => feature.status === "pending") ?? null;
	return {
		...session,
		sourceSummary:
			session.history.at(-1)?.summary ?? session.plan?.summary ?? session.goal,
		features,
		nextFeature,
		pendingFeatures: features.filter(
			(feature) => feature.status !== "completed",
		),
		latestHistoryEntry: session.history.at(-1) ?? null,
		historyCount: session.history.length,
		progress: {
			completed,
			total: features.length,
			remaining: features.length - completed,
		},
	};
}

async function withTestSession(
	workspace: string,
	response: FlowResponse,
): Promise<TestFlowResponse> {
	try {
		const session = await loadSession(workspace);
		if (!session) return response;
		const features = session.plan?.features ?? [];
		const completed = features.filter(
			(feature) => feature.status === "completed",
		).length;
		const active = session.activeFeatureId;
		const next = features.find((feature) => feature.status === "pending")?.id;
		return {
			...response,
			statusSummary:
				response.statusSummary ??
				`Progress ${completed}/${features.length}${active ? `; active: ${active}` : next ? `; next: ${next}` : ""}`,
			workflowData: {
				...response.workflowData,
				session: decorateSession(session),
			},
		};
	} catch {
		return response;
	}
}

async function flowStatus(
	workspace: string,
	input: unknown = {},
): Promise<TestFlowResponse> {
	return withTestSession(workspace, await executeFlowStatus(workspace, input));
}

async function flowPlanSave(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	return withTestSession(
		workspace,
		await executeFlowPlanSave(workspace, input),
	);
}

async function flowPlanApprove(workspace: string): Promise<TestFlowResponse> {
	return withTestSession(workspace, await executeFlowPlanApprove(workspace));
}

async function flowRunStart(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	return withTestSession(
		workspace,
		await executeFlowRunStart(workspace, input),
	);
}

async function flowFeatureComplete(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	if (typeof input === "object" && input !== null) {
		const cached = completionResponseCache.get(input);
		if (cached) return withTestSession(workspace, cached);
	}
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	const operationId = `runtime-operation-${++operationSequence}`;
	const normalizedPayload: Record<string, unknown> = {
		...payload,
		...(Array.isArray(payload.reviewExecutions)
			? {
					reviewExecutions: (
						payload.reviewExecutions as ReviewExecutionInput[]
					).map((execution) => ({
						...execution,
						attemptId: `${execution.attemptId}-${operationId}`,
					})),
				}
			: {}),
	};
	const { validationRun: _validationRun, ...publicNormalizedPayload } =
		normalizedPayload;
	const guarded = session
		? {
				operationId,
				expectedRevision: session.causal.revision,
				expectedSnapshotId: session.causal.snapshotId,
				...(Array.isArray(normalizedPayload.validationRun)
					? { validations: completionValidations(normalizedPayload) }
					: {}),
				...publicNormalizedPayload,
			}
		: input;
	const response = await executeFlowFeatureComplete(workspace, guarded);
	if (typeof input === "object" && input !== null) {
		completionResponseCache.set(input, response);
	}
	return withTestSession(workspace, response);
}

async function flowFeatureReset(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return withTestSession(
		workspace,
		await executeFlowFeatureReset(workspace, {
			operationId: `runtime-operation-${++operationSequence}`,
			expectedRevision: session?.causal.revision ?? 0,
			expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
			...payload,
		}),
	);
}

async function flowSessionClose(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	const session = await loadSession(workspace);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	return withTestSession(
		workspace,
		await executeFlowSessionClose(workspace, {
			operationId: `runtime-operation-${++operationSequence}`,
			expectedRevision: session?.causal.revision ?? 0,
			expectedSnapshotId: session?.causal.snapshotId ?? SOURCE_DIGEST,
			...payload,
		}),
	);
}

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "flow-runtime-"));
}

function twoFeaturePlan() {
	return {
		summary: "Deliver the requested change.",
		overview: "Implement the first feature, then the dependent final feature.",
		requirements: ["Keep scope explicit."],
		decisions: ["Use the Flow v5 layered architecture."],
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
	const featureExecution = reviewExecution(
		featureId,
		"feature",
		"passed",
		"pass",
	);
	const finalExecutions =
		featureId === "final-feature"
			? [reviewExecution(featureId, "final", "passed", "pass")]
			: [];
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
		reviewExecutions: [featureExecution, ...finalExecutions],
	};
}

function reviewExecution(
	featureId: string,
	reviewKind: "feature" | "final",
	verdict: "passed" | "failed",
	attempt: string,
) {
	const isFinal = reviewKind === "final";
	return {
		attemptId: `${featureId}-${reviewKind}-${attempt}`,
		logicalPassId: `${featureId}-${reviewKind}-review`,
		featureId,
		reviewKind,
		reviewSnapshotId: `sha256:${(isFinal ? "b" : "a").repeat(64)}`,
		verdict,
		findings:
			verdict === "failed"
				? [
						{
							taxonomy: "implementation_defect" as const,
							subject: `src/${featureId}.ts`,
							requirementOrRisk: `${reviewKind} review must pass`,
							evidenceLocator: `src/${featureId}.ts:1`,
							summary: "Missing behavior test.",
							severity: "blocking" as const,
						},
					]
				: [],
		startedAt: isFinal
			? "2026-07-18T09:02:00.000Z"
			: "2026-07-18T09:00:00.000Z",
		completedAt: isFinal
			? "2026-07-18T09:03:00.000Z"
			: "2026-07-18T09:01:00.000Z",
		terminalDisposition: "submitted" as const,
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

function workflowSession(response: Awaited<ReturnType<typeof flowStatus>>) {
	const session = response.workflowData?.session;
	if (!session) throw new Error("Expected workflow session data.");
	return session;
}

async function orchestrationTelemetry(
	workspace: string,
): Promise<OrchestrationTelemetry> {
	const status = await flowStatus(workspace);
	return (
		workflowSession(status) as {
			budget: { orchestration: OrchestrationTelemetry };
		}
	).budget.orchestration;
}

describe("Flow runtime gates", () => {
	test("keeps repository-controlled prose inside workflowData", async () => {
		const sentinel = "REPOSITORY_PROSE_MUST_STAY_DATA_ONLY";
		const workspace = await tempWorkspace();
		const assertBoundary = (
			response: Awaited<ReturnType<typeof flowStatus>>,
		) => {
			const { workflowData, ...trustedResponse } = response;
			expect(JSON.stringify(trustedResponse)).not.toContain(sentinel);
			expect(JSON.stringify(workflowData)).toContain(sentinel);
		};

		assertBoundary(
			await flowPlanSave(workspace, {
				goal: sentinel,
				plan: {
					...twoFeaturePlan(),
					summary: sentinel,
					overview: sentinel,
					requirements: [sentinel],
					decisions: [sentinel],
					features: twoFeaturePlan().features.map((feature) => ({
						...feature,
						title: sentinel,
						summary: sentinel,
					})),
				},
			}),
		);
		assertBoundary(await flowPlanApprove(workspace));

		assertBoundary(await flowStatus(workspace));
		assertBoundary(await flowRunStart(workspace, {}));
		assertBoundary(
			await flowFeatureComplete(workspace, {
				status: "needs_input",
				featureId: "first-feature",
				summary: sentinel,
				outcome: { kind: "needs_input", summary: sentinel },
			}),
		);
		assertBoundary(
			await flowFeatureReset(workspace, {
				featureId: "first-feature",
				[sentinel]: sentinel,
			}),
		);
		assertBoundary(
			await flowSessionClose(workspace, {
				kind: "deferred",
				summary: sentinel,
			}),
		);

		const unreadableWorkspace = await tempWorkspace();
		await flowPlanSave(unreadableWorkspace, { goal: "Create active state" });
		await Bun.write(
			join(unreadableWorkspace, ".flow", "session.json"),
			`${JSON.stringify({ version: sentinel })}\n`,
		);
		assertBoundary(await flowStatus(unreadableWorkspace));
	});

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
		expect(String(result.workflowData?.failure?.summary)).toContain("cycle");

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
		expect(String(unknownDependency.workflowData?.failure?.summary)).toContain(
			"unknown feature",
		);

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
		expect(String(selfDependency.workflowData?.failure?.summary)).toContain(
			"itself",
		);
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
		expect(String(secondStart.workflowData?.failure?.summary)).toContain(
			"already in progress",
		);
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
		expect(String(missingValidation.workflowData?.failure?.summary)).toContain(
			"validations",
		);

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
		expect(String(failedValidation.workflowData?.failure?.summary)).toContain(
			"validation to pass",
		);

		const broadNonFinal = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "broad"),
		});
		expect(broadNonFinal.status).toBe("error");
		expect(String(broadNonFinal.workflowData?.failure?.summary)).toContain(
			"targeted validation",
		);

		const failedReview = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			reviewExecutions: [
				reviewExecution("first-feature", "feature", "failed", "failure-1"),
			],
			featureReview: {
				status: "failed",
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
		});
		expect(failedReview.status).toBe("error");
		expect(String(failedReview.workflowData?.failure?.summary)).toContain(
			"featureReview",
		);

		const status = await flowStatus(workspace);
		expect(status.workflowData?.session?.status).toBe("running");
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
		expect(String(shallow.workflowData?.failure?.summary)).toContain(
			"review depth",
		);

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
		const session = workflowSession(status) as {
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

	test("bounds pass idempotency to the retained telemetry window", async () => {
		const workspace = await tempWorkspace();
		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Exercise bounded pass idempotency",
					plan: fourFeaturePlan(),
				})
			).status,
		).toBe("ok");
		expect((await flowPlanApprove(workspace)).status).toBe("ok");
		await flowRunStart(workspace, {});

		const retainedWindow = Array.from({ length: 50 }, (_, index) =>
			orchestrationPass(`feature-one-pass-${index}`),
		);
		const completed = await flowFeatureComplete(workspace, {
			...completePayload("feature-one", "targeted"),
			orchestrationPasses: retainedWindow,
		});
		expect(completed.status).toBe("ok");
		const afterFirst = await orchestrationTelemetry(workspace);
		expect(afterFirst.passCount).toBe(50);
		expect(afterFirst.latestPasses).toHaveLength(50);

		await flowRunStart(workspace, {});
		const evictOldest = await flowFeatureComplete(workspace, {
			...completePayload("feature-two", "targeted"),
			orchestrationPasses: [orchestrationPass("feature-two-fresh-pass")],
		});
		expect(evictOldest.status).toBe("ok");

		// feature-one-pass-0 has now left the bounded window. Reusing that id is
		// intentionally counted again; this telemetry is not a permanent ledger.
		await flowRunStart(workspace, {});
		const reuseEvictedId = await flowFeatureComplete(workspace, {
			...completePayload("feature-three", "targeted"),
			orchestrationPasses: [
				orchestrationPass("feature-one-pass-0"),
				orchestrationPass("feature-three-fresh-pass"),
			],
		});
		expect(reuseEvictedId.status).toBe("ok");
		const afterSecond = await orchestrationTelemetry(workspace);
		expect(afterSecond.passCount).toBe(53);
		expect(afterSecond.workerCount).toBe(53);
		expect(afterSecond.latestPasses).toHaveLength(50);
	});

	test("drops candidate decision usage without execution evidence", async () => {
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
		expect(completed.status).toBe("ok");
		expect(completed.warnings).toHaveLength(1);

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.candidateUsedDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("drops serial implementation decisions that claim candidate usage", async () => {
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
		expect(completed.status).toBe("ok");
		expect(completed.warnings).toHaveLength(1);

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.candidatePassCount).toBe(0);
		expect(telemetry.candidateUsedDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("drops candidate accounting decisions on non-implementation passes", async () => {
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
		expect(completed.status).toBe("ok");
		expect(completed.warnings).toHaveLength(1);

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.candidateEligibleCount).toBe(0);
		expect(telemetry.candidateSerialRequiredDecisionCount).toBe(0);
		expect(telemetry.skippedCandidateDecisionCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("drops orchestration subtype worker counts above total workers", async () => {
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
		expect(completed.status).toBe("ok");
		expect(completed.warnings).toHaveLength(1);

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
			reviewExecutions: [
				reviewExecution("first-feature", "feature", "failed", "failure-1"),
			],
			featureReview: {
				status: "failed" as const,
				summary: "A blocker remains.",
				blockingFindings: [{ summary: "Missing behavior test." }],
			},
			orchestrationPasses: [pass, pass],
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
		expect(status.workflowData?.session?.status).toBe("blocked");
		const session = workflowSession(status) as {
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

	test("drops completion telemetry above the orchestration pass limit", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("first-feature", "targeted"),
			orchestrationPasses: Array.from({ length: 51 }, (_, index) =>
				orchestrationPass(`first-feature-pass-${index}`),
			),
		});
		expect(completed.status).toBe("ok");
		expect(completed.warnings).toHaveLength(1);

		const telemetry = await orchestrationTelemetry(workspace);
		expect(telemetry.passCount).toBe(0);
		expect(telemetry.workerCount).toBe(0);
		expect(telemetry.latestPasses).toEqual([]);
	});

	test("failed review retry budget blocks after one autonomous retry", async () => {
		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);
		await flowRunStart(workspace, {});

		const failedReviewPayload = {
			...completePayload("first-feature", "targeted"),
			reviewExecutions: [
				reviewExecution("first-feature", "feature", "failed", "failure-1"),
			],
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
		expect(String(firstFailure.workflowData?.failure?.recovery)).toContain(
			"at most one repair",
		);
		expect((await flowStatus(workspace)).workflowData?.session?.status).toBe(
			"running",
		);

		const duplicateFailure = await flowFeatureComplete(
			workspace,
			failedReviewPayload,
		);
		expect(duplicateFailure.status).toBe("error");
		expect(String(duplicateFailure.workflowData?.failure?.recovery)).toContain(
			"at most one repair",
		);
		expect(duplicateFailure.workflowData?.session?.status).toBe("running");
		expect(
			duplicateFailure.workflowData?.session?.budget.failedReviewCount,
		).toBe(1);

		const retryFailure = await flowFeatureComplete(workspace, {
			...failedReviewPayload,
			reviewExecutions: [
				reviewExecution("first-feature", "feature", "failed", "failure-2"),
			],
		});
		expect(retryFailure.status).toBe("error");
		expect(String(retryFailure.workflowData?.failure?.summary)).toContain(
			"retry budget",
		);
		const retrySession = workflowSession(retryFailure);
		expect(retrySession.status).toBe("blocked");
		expect(String(retryFailure.nextAction)).toContain(
			"Reset the blocked feature",
		);
		const status = await flowStatus(workspace);
		expect(status.workflowData?.session?.status).toBe("blocked");
		expect(
			(workflowSession(status) as { budget: { failedReviewCount: number } })
				.budget.failedReviewCount,
		).toBe(2);
	});

	test("failed final review uses the ordinary blocked-feature state", async () => {
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
			reviewExecutions: [
				reviewExecution("final-feature", "feature", "passed", "pass"),
				reviewExecution("final-feature", "final", "failed", "failure-1"),
			],
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
		expect(String(firstFailure.workflowData?.failure?.recovery)).toContain(
			"at most one repair",
		);
		expect((await flowStatus(workspace)).workflowData?.session?.status).toBe(
			"running",
		);

		const duplicateFailure = await flowFeatureComplete(
			workspace,
			failedFinalReviewPayload,
		);
		expect(duplicateFailure.status).toBe("error");
		expect(duplicateFailure.workflowData?.session?.status).toBe("running");
		expect(
			duplicateFailure.workflowData?.session?.budget.failedReviewCount,
		).toBe(1);

		const retryFailure = await flowFeatureComplete(workspace, {
			...failedFinalReviewPayload,
			reviewExecutions: [
				reviewExecution("final-feature", "feature", "passed", "retry-pass"),
				reviewExecution("final-feature", "final", "failed", "failure-2"),
			],
		});
		expect(retryFailure.status).toBe("error");
		expect(String(retryFailure.workflowData?.failure?.summary)).toContain(
			"retry budget",
		);
		const retrySession = workflowSession(retryFailure) as {
			budget: {
				failedReviewCount: number;
			};
			features: Array<{ id: string; status: string }>;
		};
		expect(retrySession.budget.failedReviewCount).toBe(2);
		expect(
			retrySession.features.find((feature) => feature.id === "final-feature")
				?.status,
		).toBe("blocked");
		expect((await flowStatus(workspace)).workflowData?.session?.status).toBe(
			"blocked",
		);
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
		expect(status.status).toBe("ok");
		expect(status.workflowData?.session?.status).toBe("ready");
		expect(String(status.statusSummary)).toContain("Progress 3/4");
		expect(String(status.statusSummary)).toContain("feature-four");
		expect(String(status.nextAction)).toContain(
			"workflowData.projection.feature",
		);
		expect(
			(workflowSession(status) as { nextFeature: { id: string } | null })
				.nextFeature?.id,
		).toBe("feature-four");
		expect(
			(
				workflowSession(status) as {
					pendingFeatures: Array<{ id: string }>;
					progress: { remaining: number };
				}
			).pendingFeatures.map((feature) => feature.id),
		).toEqual(["feature-four"]);
		expect(
			(
				workflowSession(status) as {
					pendingFeatures: Array<{ id: string }>;
					progress: { remaining: number };
				}
			).progress.remaining,
		).toBe(1);
		expect(
			(workflowSession(status) as { budget: { reviewCount: number } }).budget
				.reviewCount,
		).toBe(3);

		const nextStart = await flowRunStart(workspace, {});
		expect(nextStart.status).toBe("ok");
		const runningStatus = await flowStatus(workspace);
		expect(String(runningStatus.statusSummary)).toContain(
			"active: feature-four",
		);
		expect(String(runningStatus.nextAction)).toContain(
			"workflowData.projection.feature",
		);
		expect(
			(workflowSession(runningStatus) as { budget: { reviewCount: number } })
				.budget.reviewCount,
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
		expect(String(targetedFinal.workflowData?.failure?.summary)).toContain(
			"broad validation",
		);

		const withoutFinalReview = await flowFeatureComplete(
			workspace,
			completePayload("final-feature", "broad"),
		);
		expect(withoutFinalReview.status).toBe("error");
		expect(String(withoutFinalReview.workflowData?.failure?.summary)).toContain(
			"finalReview",
		);

		const failedFinalReview = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			reviewExecutions: [
				reviewExecution("final-feature", "feature", "passed", "pass"),
				reviewExecution("final-feature", "final", "failed", "failure-1"),
			],
			finalReview: {
				...finalReview(),
				status: "failed" as const,
				summary: "Final review found a blocker.",
				blockingFindings: [{ summary: "Project gate is incomplete." }],
			},
		});
		expect(failedFinalReview.status).toBe("error");
		expect(String(failedFinalReview.workflowData?.failure?.summary)).toContain(
			"passing finalReview",
		);

		const wrongReviewDepth = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			reviewExecutions: [
				reviewExecution("final-feature", "feature", "passed", "retry-pass"),
				reviewExecution("final-feature", "final", "passed", "retry-pass"),
			],
			finalReview: {
				...finalReview(),
				reviewDepth: "broad" as const,
			},
		});
		expect(wrongReviewDepth.status).toBe("error");
		expect(String(wrongReviewDepth.workflowData?.failure?.summary)).toContain(
			"plan policy",
		);

		const completed = await flowFeatureComplete(workspace, {
			...completePayload("final-feature", "broad"),
			finalReview: finalReview(),
		});
		expect(completed.status).toBe("ok");
		expect((await flowStatus(workspace)).workflowData?.session?.status).toBe(
			"completed",
		);
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
		expect(String(planlessClose.workflowData?.failure?.summary)).toContain(
			"approved plan",
		);

		const workspace = await tempWorkspace();
		await approvedTwoFeatureSession(workspace);

		const close = await flowSessionClose(workspace, {
			kind: "completed",
			summary: "Done.",
		});
		expect(close.status).toBe("error");
		expect(String(close.workflowData?.failure?.summary)).toContain(
			"unfinished features",
		);
	});

	test("completion outcomes require an explicit kind matching status", () => {
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

		expect(
			WorkerResultSchema.safeParse({
				status: "needs_input",
				featureId: "first-feature",
				summary: "Need operator input.",
				outcome: {
					summary: "Missing API token for manual verification.",
				},
			}).success,
		).toBe(false);

		const parsed = WorkerResultSchema.parse({
			status: "needs_input",
			operationId: "runtime-schema-needs-input",
			expectedRevision: 0,
			expectedSnapshotId: SOURCE_DIGEST,
			requestDigest: SOURCE_DIGEST,
			featureId: "first-feature",
			summary: "Need operator input.",
			outcome: {
				kind: "needs_input",
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
		expect(status.status).toBe("ok");
		expect(status.workflowData?.session?.status).toBe("blocked");
		expect(status.summary).toBe("Flow session status loaded.");
		expect(status.workflowData?.session?.sourceSummary).toBe(
			"Need operator credentials.",
		);
		expect(
			(
				workflowSession(status) as {
					latestHistoryEntry: { outcome?: { resolutionHint?: string } };
				}
			).latestHistoryEntry.outcome?.resolutionHint,
		).toContain("API_TOKEN");

		const rerun = await flowRunStart(workspace, {});
		expect(rerun.status).toBe("error");
		expect(String(rerun.workflowData?.failure?.summary)).toContain("reset");

		const unrelatedReset = await flowFeatureReset(workspace, {
			featureId: "final-feature",
		});
		expect(unrelatedReset.status).toBe("ok");

		const stillBlocked = await flowStatus(workspace);
		expect(stillBlocked.workflowData?.session?.status).toBe("blocked");
		expect(
			(
				workflowSession(stillBlocked) as {
					features: Array<{ id: string; status: string }>;
				}
			).features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("blocked");

		const requestedBlocked = await flowRunStart(workspace, {
			featureId: "first-feature",
		});
		expect(requestedBlocked.status).toBe("error");
		expect(String(requestedBlocked.workflowData?.failure?.summary)).toContain(
			"reset",
		);

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
			workflowSession(status) as {
				features: Array<{ id: string; status: string }>;
			}
		).features;
		expect(
			features.find((feature) => feature.id === "first-feature")?.status,
		).toBe("pending");
		expect(
			features.find((feature) => feature.id === "final-feature")?.status,
		).toBe("pending");
	});

	test("a completed session is archive-only and cannot be reset", async () => {
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
		expect(completed.workflowData?.session?.status).toBe("completed");
		expect(
			(workflowSession(completed) as { closure: { kind: string } }).closure
				.kind,
		).toBe("completed");

		const reset = await flowFeatureReset(workspace, {
			featureId: "first-feature",
		});
		expect(reset.status).toBe("error");
		expect(String(reset.workflowData?.failure?.summary)).toContain(
			"pending archival",
		);

		const status = await flowStatus(workspace);
		expect(status.workflowData?.session?.status).toBe("completed");
		expect(String(status.nextAction)).toContain("flow_session_close");
		expect(
			(
				workflowSession(status) as {
					progress: { completed: number; total: number; remaining: number };
				}
			).progress,
		).toEqual({ completed: 2, total: 2, remaining: 0 });
		expect(
			(
				workflowSession(status) as {
					timestamps: { completedAt: string | null };
				}
			).timestamps.completedAt,
		).not.toBeNull();
		const features = (
			workflowSession(status) as {
				features: Array<{ id: string; status: string }>;
			}
		).features;
		expect(features.every((feature) => feature.status === "completed")).toBe(
			true,
		);
		expect(
			(workflowSession(status) as { historyCount: number }).historyCount,
		).toBe(2);
		expect(
			(workflowSession(status) as { latestHistoryEntry: { featureId: string } })
				.latestHistoryEntry.featureId,
		).toBe("final-feature");
	});
});
