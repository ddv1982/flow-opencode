import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlowResponse } from "../src/application/flow-service.js";
import { SessionSchema } from "../src/application/schema.js";
import type { Session } from "../src/domain/session.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowStatus as executeFlowStatus,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";

const FEATURE_ID = "review-feature";
const SNAPSHOT_A = `sha256:${"a".repeat(64)}`;
const SNAPSHOT_B = `sha256:${"b".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;
let operationSequence = 0;

type TestFlowResponse = FlowResponse & {
	workflowData?: NonNullable<FlowResponse["workflowData"]> & {
		session?: Session;
	};
};

function completionValidations(payload: Record<string, unknown>) {
	const validationRun = Array.isArray(payload.validationRun)
		? payload.validationRun
		: [];
	return validationRun.flatMap((run) => {
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

async function withSession(
	workspace: string,
	response: FlowResponse,
): Promise<TestFlowResponse> {
	const session = await loadSession(workspace);
	return session
		? {
				...response,
				workflowData: { ...response.workflowData, session },
			}
		: response;
}

async function flowFeatureComplete(
	workspace: string,
	input: unknown,
): Promise<TestFlowResponse> {
	const session = await loadSession(workspace);
	if (!session) return executeFlowFeatureComplete(workspace, input);
	const payload =
		typeof input === "object" && input !== null
			? (input as Record<string, unknown>)
			: {};
	const { validationRun: _validationRun, ...publicPayload } = payload;
	return withSession(
		workspace,
		await executeFlowFeatureComplete(workspace, {
			operationId: `telemetry-operation-${++operationSequence}`,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			...(Array.isArray(payload.validationRun)
				? { validations: completionValidations(payload) }
				: {}),
			...publicPayload,
		}),
	);
}

async function flowStatus(workspace: string): Promise<TestFlowResponse> {
	return withSession(workspace, await executeFlowStatus(workspace));
}

const finding = {
	taxonomy: "implementation_defect" as const,
	subject: "src/application/flow-service.ts",
	requirementOrRisk: "Review evidence must survive malformed telemetry.",
	evidenceLocator: "src/application/flow-service.ts:flowFeatureComplete",
	summary: "Optional telemetry masked a failed review.",
	severity: "blocking" as const,
};

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "flow-review-telemetry-"));
}

async function runningWorkspace(): Promise<string> {
	const workspace = await tempWorkspace();
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Exercise review telemetry",
				plan: {
					summary: "Review telemetry",
					overview: "Keep core review evidence independent from telemetry.",
					finalReviewPolicy: "detailed",
					features: [
						{
							id: FEATURE_ID,
							title: "Review telemetry",
							summary: "Persist review execution attempts.",
							reviewDepth: "standard",
						},
					],
				},
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
	expect((await flowRunStart(workspace, {})).status).toBe("ok");
	return workspace;
}

function reviewExecution(
	attemptId: string,
	verdict: "passed" | "failed",
	reviewSnapshotId = SNAPSHOT_A,
	logicalPassId = "feature-review",
	reviewKind: "feature" | "final" = "feature",
) {
	const isFinal = reviewKind === "final";
	return {
		attemptId,
		logicalPassId,
		featureId: FEATURE_ID,
		reviewKind,
		reviewSnapshotId,
		verdict,
		findings: verdict === "failed" ? [finding] : [],
		startedAt: isFinal
			? "2026-07-18T09:03:00.000Z"
			: "2026-07-18T09:00:00.000Z",
		completedAt: isFinal
			? "2026-07-18T09:04:00.000Z"
			: attemptId === "attempt-1"
				? "2026-07-18T09:01:00.000Z"
				: "2026-07-18T09:02:00.000Z",
		terminalDisposition: "submitted" as const,
	};
}

function completionPayload(
	reviewExecutions: ReturnType<typeof reviewExecution>[],
	featureReviewStatus: "passed" | "failed",
) {
	const executions =
		featureReviewStatus === "passed" &&
		!reviewExecutions.some((execution) => execution.reviewKind === "final")
			? [
					...reviewExecutions,
					reviewExecution(
						"final-attempt-1",
						"passed",
						SNAPSHOT_B,
						"final-review",
						"final",
					),
				]
			: reviewExecutions;
	return {
		status: "ok" as const,
		featureId: FEATURE_ID,
		summary: "Review lifecycle evaluated.",
		validationRun: [
			{
				command: "bun test tests/review-telemetry-integration.test.ts",
				status: "passed" as const,
				summary: "Focused tests passed.",
			},
		],
		validationScope: "broad" as const,
		featureReviewDepth: "standard" as const,
		featureReview: {
			status: featureReviewStatus,
			summary: `Feature review ${featureReviewStatus}.`,
			blockingFindings:
				featureReviewStatus === "failed"
					? [{ summary: finding.summary, severity: "blocking" as const }]
					: [],
		},
		...(featureReviewStatus === "passed"
			? {
					finalReview: {
						status: "passed" as const,
						summary: "Final review passed.",
						blockingFindings: [],
						reviewDepth: "detailed" as const,
					},
				}
			: {}),
		reviewExecutions: executions,
	};
}

function sessionFrom(response: Awaited<ReturnType<typeof flowStatus>>) {
	const session = response.workflowData?.session;
	if (!session) throw new Error("Expected a Flow session.");
	return session;
}

describe("review execution and optional telemetry integration", () => {
	test("exhausts two distinct failed attempts while dropping malformed telemetry with a warning", async () => {
		const workspace = await runningWorkspace();
		const first = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-1", "failed")], "failed"),
			orchestrationPasses: { malformed: true },
		});
		expect(first.status).toBe("error");
		expect(first.warnings).toHaveLength(1);
		expect(first.warnings?.[0]).toContain("telemetry was malformed");
		expect(first.workflowData?.session?.budget.reviewExecutions).toHaveLength(
			1,
		);
		expect(first.workflowData?.session?.budget.orchestration.passCount).toBe(0);

		const second = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-2", "failed")], "failed"),
			orchestrationPasses: Array.from({ length: 51 }, () => null),
		});
		expect(second.status).toBe("error");
		expect(second.warnings).toHaveLength(1);
		expect(second.workflowData?.failure?.summary).toContain("budget exhausted");
		const session = second.workflowData?.session;
		expect(session?.status).toBe("blocked");
		expect(session?.budget.reviewExecutions).toHaveLength(2);
		expect(session?.budget.reviewLifecycle.retryConsumedCount).toBe(2);
		expect(session?.budget.orchestration.passCount).toBe(0);
		const fingerprints = session?.budget.reviewExecutions.map(
			(execution) => execution.findings[0]?.fingerprint,
		);
		expect(fingerprints?.[0]).toMatch(/^finding-v1-[a-f0-9]{32}$/);
		expect(fingerprints?.[1]).toBe(fingerprints?.[0]);
	});

	test("persists valid review evidence before an ordinary completion rejection", async () => {
		const workspace = await runningWorkspace();
		const result = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-1", "passed")], "passed"),
			validationRun: [],
			orchestrationPasses: "not-an-array",
		});

		expect(result.status).toBe("error");
		expect(result.warnings).toHaveLength(1);
		expect(result.workflowData?.failure?.summary).toContain("validations");
		expect(result.workflowData?.session?.budget.reviewExecutions).toHaveLength(
			2,
		);
		expect(
			result.workflowData?.session?.budget.reviewLifecycle.passedVerdictCount,
		).toBe(2);
		expect(result.workflowData?.session?.status).toBe("running");
	});

	test("preserves failed and passed logical attempts while latest truth completes", async () => {
		const workspace = await runningWorkspace();
		const failed = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-1", "failed")], "failed"),
			orchestrationPasses: false,
		});
		expect(failed.status).toBe("error");

		const passed = await flowFeatureComplete(workspace, {
			...completionPayload(
				[reviewExecution("attempt-2", "passed", SNAPSHOT_B)],
				"passed",
			),
			orchestrationPasses: { still: "malformed" },
		});
		expect(passed.status).toBe("ok");
		expect(passed.warnings).toHaveLength(1);
		const executions = passed.workflowData?.session?.budget.reviewExecutions;
		expect(executions?.map((execution) => execution.verdict)).toEqual([
			"failed",
			"passed",
			"passed",
		]);
		expect(executions?.map((execution) => execution.logicalPassId)).toEqual([
			"feature-review",
			"feature-review",
			"final-review",
		]);
		expect(passed.workflowData?.session?.status).toBe("completed");
	});

	test("rejects same-snapshot contradictory logical passes after preserving both", async () => {
		const workspace = await runningWorkspace();
		const result = await flowFeatureComplete(workspace, {
			...completionPayload(
				[
					reviewExecution("attempt-1", "failed"),
					reviewExecution(
						"attempt-2",
						"passed",
						SNAPSHOT_A,
						"final-review",
						"final",
					),
				],
				"passed",
			),
		});

		expect(result.status).toBe("error");
		expect(result.workflowData?.failure?.summary).toContain(
			"contradictory terminal verdicts",
		);
		expect(result.workflowData?.session?.budget.reviewExecutions).toHaveLength(
			2,
		);
		expect(result.workflowData?.session?.status).toBe("running");
	});

	test("persists review attempts even when a required core field is malformed", async () => {
		const workspace = await runningWorkspace();
		const payload = completionPayload(
			[reviewExecution("attempt-1", "passed")],
			"passed",
		);
		const { validationScope: _omitted, ...withoutValidationScope } = payload;
		const result = await flowFeatureComplete(workspace, withoutValidationScope);

		expect(result.status).toBe("error");
		expect(result.workflowData?.failure?.summary).toContain("validationScope");
		const persisted = sessionFrom(await flowStatus(workspace));
		expect(persisted.budget.reviewExecutions).toHaveLength(2);
		expect(persisted.budget.reviewLifecycle.passedVerdictCount).toBe(2);
		expect(persisted.status).toBe("running");
	});

	test("rejects passing summaries when persisted feature execution truth failed", async () => {
		const workspace = await runningWorkspace();
		const result = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-1", "failed")], "passed"),
			orchestrationPasses: "malformed-but-optional",
		});

		expect(result.status).toBe("error");
		expect(result.warnings).toHaveLength(1);
		expect(result.workflowData?.failure?.summary).toContain("remains failed");
		expect(result.workflowData?.session?.budget.reviewExecutions).toHaveLength(
			2,
		);
		expect(result.workflowData?.session?.status).toBe("running");
	});

	test("rejects a passed execution that the host observed but never submitted", async () => {
		const workspace = await runningWorkspace();
		const invalidExecution = {
			...reviewExecution("attempt-1", "passed"),
			terminalDisposition: "observed_unsubmitted" as const,
		};
		const result = await flowFeatureComplete(workspace, {
			...completionPayload([reviewExecution("attempt-1", "passed")], "passed"),
			reviewExecutions: [invalidExecution],
		});

		expect(result.status).toBe("error");
		expect(result.workflowData?.failure?.summary).toContain(
			"observed_unsubmitted",
		);
		expect(
			sessionFrom(await flowStatus(workspace)).budget.reviewExecutions,
		).toEqual([]);
	});

	test("rejects dishonest observed-worker ledger state combinations", async () => {
		const workspace = await runningWorkspace();
		const sessionPath = join(workspace, ".flow", "session.json");
		const raw = JSON.parse(await readFile(sessionPath, "utf8")) as {
			budget: Record<string, unknown>;
		};
		for (const invalidLedger of [
			{
				source: "unavailable",
				reconciliationStatus: "reconciled",
				observedExecutionCount: 0,
			},
			{
				source: "host_observed",
				reconciliationStatus: "reconciled",
				observedExecutionCount: null,
			},
			{
				source: "unavailable",
				reconciliationStatus: "unreconciled",
				observedExecutionCount: 0,
			},
		]) {
			expect(
				SessionSchema.safeParse({
					...raw,
					budget: {
						...raw.budget,
						observedReviewWorkers: invalidLedger,
					},
				}).success,
			).toBe(false);
		}
	});

	test("applies additive defaults when sparse version 3 review fields are omitted", async () => {
		const workspace = await runningWorkspace();
		const sessionPath = join(workspace, ".flow", "session.json");
		const raw = JSON.parse(await readFile(sessionPath, "utf8")) as {
			budget: Record<string, unknown>;
			causal?: unknown;
		};
		delete raw.budget.reviewExecutions;
		delete raw.budget.reviewLifecycle;
		delete raw.budget.observedReviewWorkers;
		delete raw.causal;
		await writeFile(sessionPath, `${JSON.stringify(raw)}\n`, "utf8");

		const session = sessionFrom(await flowStatus(workspace));
		expect(session.budget.reviewExecutions).toEqual([]);
		expect(session.budget.reviewLifecycle).toEqual({
			featureAttemptCount: 0,
			finalAttemptCount: 0,
			passedVerdictCount: 0,
			failedVerdictCount: 0,
			retryConsumedCount: 0,
		});
		expect(session.budget.observedReviewWorkers).toEqual({
			source: "unavailable",
			reconciliationStatus: "unreconciled",
			observedExecutionCount: null,
		});
	});
});
