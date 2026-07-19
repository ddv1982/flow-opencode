import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowService } from "../src/application/flow-service.js";
import type { SessionRepository } from "../src/application/ports/session-repository.js";
import type { Session } from "../src/domain/session.js";
import type { ValidationReceiptRef } from "../src/domain/validation-receipt.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete as executeFlowFeatureComplete,
	flowReviewStart as executeFlowReviewStart,
	flowStatus as executeFlowStatus,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { systemTransitionEnvironment } from "../src/infrastructure/system/transition-environment.js";
import {
	publishValidationReceiptForRepository,
	publishValidationReceiptForWorkspace,
} from "./support/validation-receipt.js";

const temporaryWorkspaces = new Set<string>();

async function tempWorkspace(prefix: string): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), prefix));
	temporaryWorkspaces.add(workspace);
	return workspace;
}

afterEach(async () => {
	const workspaces = [...temporaryWorkspaces];
	temporaryWorkspaces.clear();
	await Promise.all(
		workspaces.map((workspace) =>
			rm(workspace, { force: true, recursive: true }),
		),
	);
});

function flowStatus(workspace: string, request: unknown) {
	return executeFlowStatus(workspace, { request });
}

function flowReviewStart(workspace: string, request: unknown) {
	return executeFlowReviewStart(workspace, { request });
}

function flowFeatureComplete(workspace: string, request: unknown) {
	return executeFlowFeatureComplete(workspace, { request });
}

async function runningWorkspace(): Promise<{
	workspace: string;
	session: Session;
}> {
	const workspace = await tempWorkspace("flow-causal-transport-");
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Exercise causal transport",
				plan: {
					summary: "Exercise causal transport.",
					overview: "Keep model-visible state compact and guarded.",
					features: [
						{
							id: "first-feature",
							title: "First feature",
							summary: "Complete the first feature.",
							targets: ["src/application"],
						},
						{
							id: "final-feature",
							title: "Final feature",
							summary: "Keep the session open.",
							dependsOn: ["first-feature"],
						},
					],
				},
			})
		).status,
	).toBe("ok");
	expect((await flowPlanApprove(workspace)).status).toBe("ok");
	expect((await flowRunStart(workspace, {})).status).toBe("ok");
	const session = await loadSession(workspace);
	if (!session) throw new Error("Expected a running Flow session.");
	return { workspace, session };
}

function reviewStartPayload(
	session: Session,
	operationId: string,
	validationRef: ValidationReceiptRef,
) {
	return {
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: "first-feature",
		reviewKind: "feature" as const,
		validationScope: "targeted" as const,
		packet: {
			summary: "Review the first feature.",
			riskLenses: ["causal transport"],
		},
		validationRefs: [validationRef],
	};
}

function activeRunStartedAt(session: Session): string {
	const activeRun = session.featureRuns.find(
		(run) => run.id === session.activeFeatureRunId,
	);
	if (!activeRun) throw new Error("Expected an active feature run.");
	return activeRun.startedAt;
}

function assignmentId(response: Awaited<ReturnType<typeof flowReviewStart>>) {
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	if (!projection?.assignmentId) throw new Error("Expected assignment id.");
	return projection.assignmentId;
}

function completionPayload(session: Session, id: string, operationId: string) {
	const assignment = session.reviewAssignments.find(
		(candidate) => candidate.id === id,
	);
	if (!assignment) throw new Error("Expected a persisted review assignment.");
	return {
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: "first-feature",
		result: {
			kind: "completed" as const,
			summary: "Completed the first feature.",
			artifactsChanged: [],
			validationScope: "targeted" as const,
			featureReview: {
				assignmentId: id,
				verdict: "passed" as const,
				findings: [],
				completedAt: assignment.startedAt,
				terminalDisposition: "submitted" as const,
			},
		},
	};
}

describe("application causal transport", () => {
	test("reports accepted session initialization without inventing an operation", async () => {
		const workspace = await tempWorkspace("flow-session-ready-");
		const response = await flowPlanSave(workspace, {
			goal: "Prepare a planning session",
		});

		expect(response.status).toBe("ok");
		expect(response.workflowData?.receipt).toMatchObject({
			operationAccepted: true,
			operationIdConsumed: false,
			operationId: null,
			revision: 0,
			changedFields: [],
		});
	});

	test("uses explicit compact status and exposes native execution identity", async () => {
		const { workspace, session } = await runningWorkspace();
		const compact = await flowStatus(workspace, { view: "compact" });
		expect(compact.workflowData?.projection).toMatchObject({
			view: "compact",
			revision: session.causal.revision,
			featureRunId: session.activeFeatureRunId,
			feature: { id: "first-feature" },
		});
		const execution = await flowStatus(workspace, { view: "execution" });
		expect(execution.workflowData?.projection).toMatchObject({
			view: "execution",
			featureRunId: session.activeFeatureRunId,
			feature: { id: "first-feature" },
		});
		const unchanged = await flowStatus(workspace, {
			view: "compact",
			sinceRevision: session.causal.revision,
		});
		expect(unchanged.workflowData?.projection).toEqual({
			view: "unchanged",
			revision: session.causal.revision,
			snapshotId: session.causal.snapshotId,
		});
	});

	test("measures source and receipt artifacts at assignment, then source at fresh completion only", async () => {
		const { workspace, session } = await runningWorkspace();
		const base = createFileSessionRepository(workspace);
		const validationRef = await publishValidationReceiptForRepository(base, {
			startedAt: activeRunStartedAt(session),
			command: "bun test tests/application-causal-transport.test.ts",
		});
		let sourceIdentityCalls = 0;
		let artifactReadCalls = 0;
		const repository: SessionRepository = {
			read: () => base.read(),
			transact: (task) =>
				base.transact((transaction) =>
					task({
						...transaction,
						computeSourceManifest: async () => {
							sourceIdentityCalls += 1;
							if (!transaction.computeSourceManifest) {
								throw new Error("Expected source manifest support.");
							}
							return transaction.computeSourceManifest();
						},
						computeSourceIdentity: async () => {
							sourceIdentityCalls += 1;
							return transaction.computeSourceIdentity();
						},
						readEvidenceArtifact: async (reference) => {
							artifactReadCalls += 1;
							return transaction.readEvidenceArtifact(reference);
						},
					}),
				),
		};
		const service = createFlowService(repository, systemTransitionEnvironment);
		const startPayload = reviewStartPayload(
			session,
			"instrumented-assignment",
			validationRef,
		);
		const started = await service.reviewStart({ request: startPayload });
		expect(started.status).toBe("ok");
		expect(sourceIdentityCalls).toBe(1);
		expect(artifactReadCalls).toBe(1);

		expect((await service.reviewStart({ request: startPayload })).status).toBe(
			"ok",
		);
		expect(sourceIdentityCalls).toBe(1);
		expect(artifactReadCalls).toBe(1);

		const current = await loadSession(workspace);
		if (!current) throw new Error("Expected assignment state.");
		const id = assignmentId(started);
		const completePayload = completionPayload(
			current,
			id,
			"instrumented-completion",
		);
		const staleGuard = await service.featureComplete({
			request: {
				...completePayload,
				operationId: "stale-instrumented-completion",
				expectedRevision: completePayload.expectedRevision + 1,
			},
		});
		expect(staleGuard.status).toBe("error");
		expect(staleGuard.workflowData?.failure?.summary).toContain("stale");
		expect(sourceIdentityCalls).toBe(1);

		const missingAssignment = await service.featureComplete({
			request: {
				...completePayload,
				operationId: "missing-assignment-completion",
				result: {
					...completePayload.result,
					featureReview: {
						...completePayload.result.featureReview,
						assignmentId: "review-assignment:missing",
					},
				},
			},
		});
		expect(missingAssignment.status).toBe("error");
		expect(missingAssignment.workflowData?.failure?.summary).toContain(
			"was not found",
		);
		expect(sourceIdentityCalls).toBe(1);

		expect(
			(await service.featureComplete({ request: completePayload })).status,
		).toBe("ok");
		expect(sourceIdentityCalls).toBe(2);
		expect(artifactReadCalls).toBe(1);
		expect(
			(await service.featureComplete({ request: completePayload })).status,
		).toBe("ok");
		expect(sourceIdentityCalls).toBe(2);
	});

	test("malformed completion is atomic and keeps its operation id reusable", async () => {
		const { workspace, session } = await runningWorkspace();
		const validationRef = await publishValidationReceiptForWorkspace(
			workspace,
			{
				startedAt: activeRunStartedAt(session),
				command: "bun test tests/application-causal-transport.test.ts",
			},
		);
		const started = await flowReviewStart(
			workspace,
			reviewStartPayload(session, "atomic-assignment", validationRef),
		);
		const current = await loadSession(workspace);
		if (!current) throw new Error("Expected assignment state.");
		const invalid = await flowFeatureComplete(workspace, {
			operationId: "atomic-completion",
			expectedRevision: current.causal.revision,
			expectedSnapshotId: current.causal.snapshotId,
			featureId: "first-feature",
			result: { kind: "completed", summary: "Missing result fields." },
		});
		expect(invalid.status).toBe("error");
		expect(await loadSession(workspace)).toEqual(current);

		const corrected = await flowFeatureComplete(
			workspace,
			completionPayload(current, assignmentId(started), "atomic-completion"),
		);
		expect(corrected.status).toBe("ok");
	});

	test("rejects unavailable validation receipts before assignment mutation", async () => {
		const { workspace, session } = await runningWorkspace();
		const response = await flowReviewStart(
			workspace,
			reviewStartPayload(session, "missing-artifact", {
				kind: "validation_receipt_ref_v1",
				digest: `sha256:${"f".repeat(64)}`,
				byteLength: 99,
			}),
		);
		expect(response.status).toBe("error");
		expect(response.workflowData?.failure?.summary).toContain(
			"validation receipt",
		);
		expect(await loadSession(workspace)).toEqual(session);
	});
});
