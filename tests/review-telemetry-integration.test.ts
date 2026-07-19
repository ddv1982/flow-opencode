import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionSchema } from "../src/application/schema.js";
import type { ReviewAssignment, Session } from "../src/domain/session.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowReviewStart as executeFlowReviewStart,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";

const FEATURE_ID = "review-feature";
const OUTPUT_DIGEST = `sha256:${"d".repeat(64)}`;
let operationSequence = 0;

function flowReviewStart(workspace: string, request: unknown) {
	return executeFlowReviewStart(workspace, { request });
}

function flowFeatureComplete(workspace: string, request: unknown) {
	return executeFlowFeatureComplete(workspace, { request });
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

async function requireSession(workspace: string): Promise<Session> {
	const session = await loadSession(workspace);
	if (!session) throw new Error("Expected an active Flow session.");
	return session;
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
							summary: "Persist review assignment attempts.",
							reviewDepth: "standard",
						},
						{
							id: "later-feature",
							title: "Later feature",
							summary: "Keep the reviewed feature non-final.",
							dependsOn: [FEATURE_ID],
						},
					],
				},
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
	expect(
		(await flowRunStart(workspace, { featureId: FEATURE_ID })).status,
	).toBe("ok");
	return workspace;
}

async function startFeatureAssignment(
	workspace: string,
): Promise<ReviewAssignment> {
	const session = await requireSession(workspace);
	const activeRun = session.featureRuns.find(
		(run) => run.id === session.activeFeatureRunId,
	);
	if (!activeRun) throw new Error("Expected an active feature run.");
	const operationId = `telemetry-review-${++operationSequence}`;
	const response = await flowReviewStart(workspace, {
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: FEATURE_ID,
		reviewKind: "feature",
		validationScope: "targeted",
		packet: {
			summary: "Review the active feature and its focused validation.",
			riskLenses: ["behavior", "regression"],
		},
		validations: [
			{
				command: "bun test tests/review-telemetry-integration.test.ts",
				summary: "Focused tests passed.",
				startedAt: activeRun.startedAt,
				completedAt: activeRun.startedAt,
				exitCode: 0,
				outputDigest: OUTPUT_DIGEST,
				environmentKeys: [],
			},
		],
	});
	expect(response.status).toBe("ok");
	const persisted = await requireSession(workspace);
	const assignment = persisted.reviewAssignments.find(
		(candidate) => candidate.operationId === operationId,
	);
	if (!assignment) throw new Error("Expected a persisted review assignment.");
	return assignment;
}

function assignmentResult(
	assignment: ReviewAssignment,
	verdict: "passed" | "failed",
	terminalDisposition: "submitted" | "observed_unsubmitted" = "submitted",
) {
	return {
		assignmentId: assignment.id,
		verdict,
		findings: verdict === "failed" ? [finding] : [],
		completedAt: assignment.startedAt,
		terminalDisposition,
	};
}

describe("review assignment and optional telemetry integration", () => {
	test("keeps assignment evidence while malformed telemetry is warning-only", async () => {
		const workspace = await runningWorkspace();
		const failedAssignment = await startFeatureAssignment(workspace);
		const beforeFailure = await requireSession(workspace);
		const failed = await flowFeatureComplete(workspace, {
			operationId: `telemetry-complete-${++operationSequence}`,
			expectedRevision: beforeFailure.causal.revision,
			expectedSnapshotId: beforeFailure.causal.snapshotId,
			featureId: FEATURE_ID,
			result: {
				kind: "blocked",
				summary: "Review found a blocker.",
				review: assignmentResult(failedAssignment, "failed"),
				orchestrationPasses: { malformed: true },
			},
		});
		expect(failed.status).toBe("ok");
		expect(failed.warnings).toHaveLength(1);
		expect(failed.warnings?.[0]).toContain("telemetry was malformed");
		const afterFailure = await requireSession(workspace);
		expect(afterFailure.status).toBe("running");
		expect(afterFailure.budget.reviewExecutions).toHaveLength(1);
		expect(afterFailure.budget.reviewExecutions[0]?.verdict).toBe("failed");
		expect(afterFailure.budget.orchestration.passCount).toBe(0);

		const passedAssignment = await startFeatureAssignment(workspace);
		const beforePass = await requireSession(workspace);
		const passed = await flowFeatureComplete(workspace, {
			operationId: `telemetry-complete-${++operationSequence}`,
			expectedRevision: beforePass.causal.revision,
			expectedSnapshotId: beforePass.causal.snapshotId,
			featureId: FEATURE_ID,
			result: {
				kind: "completed",
				summary: "Review retry passed.",
				artifactsChanged: [],
				validationScope: "targeted",
				featureReview: assignmentResult(passedAssignment, "passed"),
				orchestrationPasses: "still malformed",
			},
		});
		expect(passed.status).toBe("ok");
		expect(passed.warnings).toHaveLength(1);
		const completed = await requireSession(workspace);
		expect(completed.status).toBe("ready");
		expect(
			completed.budget.reviewExecutions.map((execution) => execution.verdict),
		).toEqual(["failed", "passed"]);
		expect(completed.budget.reviewLifecycle.retryConsumedCount).toBe(1);
		expect(completed.budget.orchestration.passCount).toBe(0);
	});

	test("malformed core completion consumes neither assignment nor operation", async () => {
		const workspace = await runningWorkspace();
		const assignment = await startFeatureAssignment(workspace);
		const before = await requireSession(workspace);
		const operationId = `telemetry-complete-${++operationSequence}`;
		const invalid = await flowFeatureComplete(workspace, {
			operationId,
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: FEATURE_ID,
			result: {
				kind: "completed",
				summary: "Missing validation scope.",
				artifactsChanged: [],
				featureReview: assignmentResult(assignment, "passed"),
			},
		});
		expect(invalid.status).toBe("error");
		expect(invalid.workflowData?.failure?.summary).toContain("request.result");
		const unchanged = await requireSession(workspace);
		expect(unchanged).toEqual(before);
		expect(
			unchanged.causal.mutations.some(
				(mutation) => mutation.operationId === operationId,
			),
		).toBe(false);
		expect(
			unchanged.reviewAssignments.find(
				(candidate) => candidate.id === assignment.id,
			)?.status,
		).toBe("pending");
	});

	test("observed but unsubmitted review work fails closed", async () => {
		const workspace = await runningWorkspace();
		const assignment = await startFeatureAssignment(workspace);
		const before = await requireSession(workspace);
		const response = await flowFeatureComplete(workspace, {
			operationId: `telemetry-complete-${++operationSequence}`,
			expectedRevision: before.causal.revision,
			expectedSnapshotId: before.causal.snapshotId,
			featureId: FEATURE_ID,
			result: {
				kind: "blocked",
				summary: "Reviewer work was observed but not submitted.",
				review: assignmentResult(assignment, "failed", "observed_unsubmitted"),
			},
		});
		expect(response.status).toBe("ok");
		const persisted = await requireSession(workspace);
		expect(persisted.budget.reviewExecutions).toHaveLength(1);
		expect(persisted.budget.reviewExecutions[0]?.terminalDisposition).toBe(
			"observed_unsubmitted",
		);
		expect(
			persisted.reviewAssignments.find(
				(candidate) => candidate.id === assignment.id,
			)?.status,
		).toBe("observed_unsubmitted");
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
});
