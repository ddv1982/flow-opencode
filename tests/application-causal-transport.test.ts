import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowService } from "../src/application/flow-service.js";
import type { SessionRepository } from "../src/application/ports/session-repository.js";
import type { Session, ValidationEvidence } from "../src/domain/session.js";
import {
	createFileEvidenceArtifactStore,
	evidenceArtifactPath,
} from "../src/infrastructure/fs/evidence-artifact-store.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowRunStart,
	flowStatus,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { systemTransitionEnvironment } from "../src/infrastructure/system/transition-environment.js";

const REVIEW_PACKET = `sha256:${"a".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"c".repeat(64)}`;

async function tempWorkspace(): Promise<string> {
	return mkdtemp(join(tmpdir(), "flow-causal-transport-"));
}

function completionPayload(
	session: Session,
	operationId: string,
	options: { artifactRef?: ValidationEvidence["artifactRef"] } = {},
) {
	const reviewExecution = {
		attemptId: `${operationId}-review`,
		logicalPassId: "first-feature-review",
		featureId: "first-feature",
		reviewKind: "feature" as const,
		reviewSnapshotId: REVIEW_PACKET,
		verdict: "passed" as const,
		findings: [],
		startedAt: "2026-07-18T09:00:00.000Z",
		completedAt: "2026-07-18T09:01:00.000Z",
		terminalDisposition: "submitted" as const,
	};
	const validationCommand =
		"bun test tests/application-causal-transport.test.ts";
	return {
		status: "ok" as const,
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: "first-feature",
		summary: "Completed the first feature.",
		validations: [
			{
				command: validationCommand,
				summary: "Focused test passed.",
				startedAt: "2026-07-18T08:58:00.000Z",
				completedAt: "2026-07-18T08:59:00.000Z",
				exitCode: 0,
				outputDigest: OUTPUT_DIGEST,
				...(options.artifactRef ? { artifactRef: options.artifactRef } : {}),
				environmentKeys: [],
			},
		],
		validationScope: "targeted" as const,
		featureReviewDepth: "standard" as const,
		featureReview: {
			status: "passed" as const,
			summary: "Feature review passed.",
			blockingFindings: [],
		},
		reviewExecutions: [reviewExecution],
	};
}

async function runningWorkspace(): Promise<{
	workspace: string;
	session: Session;
}> {
	const workspace = await tempWorkspace();
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
							summary: "Keep the session open after the first feature.",
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

function projection(response: Awaited<ReturnType<typeof flowStatus>>): unknown {
	return response.workflowData?.projection;
}

describe("application causal transport", () => {
	test("defaults to compact status and supports detail, reviewer, and delta views", async () => {
		const { workspace, session } = await runningWorkspace();
		const compact = await flowStatus(workspace);
		expect(compact.status).toBe("ok");
		expect(projection(compact)).toMatchObject({
			view: "compact",
			revision: session.causal.revision,
			snapshotId: session.causal.snapshotId,
			feature: { id: "first-feature" },
		});
		expect(JSON.stringify(compact)).not.toContain("bun test");

		const detail = await flowStatus(workspace, { view: "detail" });
		expect(projection(detail)).toMatchObject({ view: "detail" });

		const reviewer = await flowStatus(workspace, {
			view: "reviewer",
			featureId: "first-feature",
			reviewKind: "feature",
			packetHash: REVIEW_PACKET,
			evidenceRefs: [],
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
		});
		expect(projection(reviewer)).toEqual({
			view: "reviewer",
			featureId: "first-feature",
			assignedScope: ["src/application"],
			packetHash: REVIEW_PACKET,
			evidenceRefs: [],
			reviewKind: "feature",
			requiredDepth: "standard",
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
		});

		const unchanged = await flowStatus(workspace, {
			sinceRevision: session.causal.revision,
		});
		expect(projection(unchanged)).toEqual({
			view: "unchanged",
			revision: session.causal.revision,
			snapshotId: session.causal.snapshotId,
		});
		const delta = await flowStatus(workspace, { sinceRevision: 0 });
		expect(projection(delta)).toMatchObject({
			view: "delta",
			changed: true,
			fromRevision: 0,
			currentRevision: session.causal.revision,
		});
		expect(
			(
				await flowStatus(workspace, {
					sinceRevision: session.causal.revision + 1,
				})
			).status,
		).toBe("error");
	});

	test("loads exact execution context for new and resumed active work only", async () => {
		const { workspace, session } = await runningWorkspace();
		const execution = await flowStatus(workspace, { view: "execution" });
		expect(execution.status).toBe("ok");
		const initialProjection = projection(execution);
		expect(initialProjection).toEqual({
			view: "execution",
			goal: "Exercise causal transport",
			plan: {
				summary: "Exercise causal transport.",
				overview: "Keep model-visible state compact and guarded.",
				requirements: [],
				decisions: [],
				finalReviewPolicy: "detailed",
			},
			feature: {
				id: "first-feature",
				title: "First feature",
				summary: "Complete the first feature.",
				targets: ["src/application"],
				validation: [],
				dependsOn: [],
				reviewDepth: "standard",
			},
			isFinalFeature: false,
			requiredValidationScope: "targeted",
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
		});

		expect(
			(
				await flowFeatureReset(workspace, {
					operationId: "pause-before-resume",
					expectedRevision: session.causal.revision,
					expectedSnapshotId: session.causal.snapshotId,
					featureId: "first-feature",
				})
			).status,
		).toBe("ok");
		const inactive = await flowStatus(workspace, { view: "execution" });
		expect(inactive.status).toBe("error");
		expect(inactive.workflowData?.failure?.summary).toContain(
			"active in-progress",
		);

		expect(
			(await flowRunStart(workspace, { featureId: "first-feature" })).status,
		).toBe("ok");
		const resumed = await flowStatus(workspace, { view: "execution" });
		const resumedSession = await loadSession(workspace);
		if (
			!initialProjection ||
			typeof initialProjection !== "object" ||
			!resumedSession
		) {
			throw new Error("Expected complete initial and resumed execution state.");
		}
		expect(resumed.status).toBe("ok");
		expect(projection(resumed)).toEqual({
			...initialProjection,
			expectedRevision: resumedSession.causal.revision,
			expectedSnapshotId: resumedSession.causal.snapshotId,
		});
	});

	test("returns receipt-only mutations and commits completion evidence exactly once", async () => {
		const { workspace, session } = await runningWorkspace();
		const result = await flowFeatureComplete(
			workspace,
			completionPayload(session, "atomic-completion"),
		);
		expect(result.status).toBe("ok");
		expect(result.workflowData).not.toHaveProperty("session");
		expect(result.workflowData?.receipt).toMatchObject({
			view: "mutation_receipt",
			operationId: "atomic-completion",
			revision: session.causal.revision + 1,
			changedEntity: { kind: "feature", id: "first-feature" },
		});
		expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
			2_000,
		);

		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected persisted completion.");
		expect(persisted.causal.revision).toBe(session.causal.revision + 1);
		expect(persisted.causal.evidence).toHaveLength(2);
		expect(persisted.budget.reviewExecutions).toHaveLength(1);
	});

	test("replays exact completion operations with their original receipt", async () => {
		const { workspace, session } = await runningWorkspace();
		const payload = completionPayload(session, "replayed-completion");
		const first = await flowFeatureComplete(workspace, payload);
		expect(first.status).toBe("ok");
		const afterFirst = await loadSession(workspace);
		if (!afterFirst) throw new Error("Expected completed feature session.");
		expect((await flowRunStart(workspace, {})).status).toBe("ok");
		const afterLaterMutation = await loadSession(workspace);
		if (!afterLaterMutation) throw new Error("Expected later mutation.");
		expect(afterLaterMutation.causal.revision).toBe(
			afterFirst.causal.revision + 1,
		);

		const replay = await flowFeatureComplete(workspace, payload);
		expect(replay.status).toBe("ok");
		expect(replay.workflowData?.receipt).toMatchObject({
			operationId: "replayed-completion",
			revision: session.causal.revision + 1,
		});
		expect(await loadSession(workspace)).toEqual(afterLaterMutation);

		const conflict = await flowFeatureComplete(workspace, {
			...payload,
			summary: "A different request under the same operation id.",
		});
		expect(conflict.status).toBe("error");
		expect(conflict.workflowData?.failure?.summary).toContain(
			"different request",
		);
		expect(conflict.workflowData).not.toHaveProperty("receipt");
		expect(await loadSession(workspace)).toEqual(afterLaterMutation);
	});

	test("measures source and artifacts once for fresh completion and never for replay or conflict", async () => {
		const { workspace, session } = await runningWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const artifactRef = await store.publishEvidenceArtifact(
			new TextEncoder().encode("instrumented validation output"),
		);
		const base = createFileSessionRepository(workspace);
		let sourceIdentityCalls = 0;
		let artifactReadCalls = 0;
		const repository: SessionRepository = {
			read: () => base.read(),
			transact: (task) =>
				base.transact((transaction) =>
					task({
						...transaction,
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
		const payload = completionPayload(session, "instrumented-completion", {
			artifactRef,
		});

		expect((await service.featureComplete(payload)).status).toBe("ok");
		expect(sourceIdentityCalls).toBe(1);
		expect(artifactReadCalls).toBe(1);

		expect((await service.featureComplete(payload)).status).toBe("ok");
		expect(sourceIdentityCalls).toBe(1);
		expect(artifactReadCalls).toBe(1);

		expect(
			(
				await service.featureComplete({
					...payload,
					summary: "Conflicting completion intent.",
				})
			).status,
		).toBe("error");
		expect(sourceIdentityCalls).toBe(1);
		expect(artifactReadCalls).toBe(1);
	});

	test("persists guarded preliminary review observations once on core parse failure", async () => {
		const { workspace, session } = await runningWorkspace();
		const payload = completionPayload(session, "preliminary-review");
		const { validationScope: _omitted, ...invalidCore } = payload;
		const result = await flowFeatureComplete(workspace, invalidCore);
		expect(result.status).toBe("error");
		expect(result.workflowData).not.toHaveProperty("session");
		expect(result.workflowData?.receipt).toMatchObject({
			operationId: "preliminary-review",
			revision: session.causal.revision + 1,
		});
		const persisted = await loadSession(workspace);
		if (!persisted) throw new Error("Expected preliminary observation.");
		expect(persisted.causal.revision).toBe(session.causal.revision + 1);
		expect(persisted.budget.reviewExecutions).toHaveLength(1);
		expect(persisted.causal.evidence).toEqual([]);

		const replay = await flowFeatureComplete(workspace, invalidCore);
		expect(replay.workflowData?.receipt).toMatchObject({
			operationId: "preliminary-review",
			revision: session.causal.revision + 1,
		});
		expect(await loadSession(workspace)).toEqual(persisted);
	});

	test("rejects stale completion guards without persisting observations", async () => {
		const { workspace, session: staleSession } = await runningWorkspace();
		const resetPayload = {
			operationId: "reset-before-stale-completion",
			expectedRevision: staleSession.causal.revision,
			expectedSnapshotId: staleSession.causal.snapshotId,
			featureId: "first-feature",
		};
		const reset = await flowFeatureReset(workspace, resetPayload);
		expect(reset.status).toBe("ok");
		const beforeStale = await loadSession(workspace);
		if (!beforeStale) throw new Error("Expected reset session.");
		const resetReplay = await flowFeatureReset(workspace, resetPayload);
		expect(resetReplay.workflowData?.receipt).toMatchObject({
			operationId: "reset-before-stale-completion",
			revision: staleSession.causal.revision + 1,
		});
		expect(await loadSession(workspace)).toEqual(beforeStale);

		const stale = await flowFeatureComplete(
			workspace,
			completionPayload(staleSession, "stale-completion"),
		);
		expect(stale.status).toBe("error");
		expect(stale.summary).toContain("stale");
		expect(await loadSession(workspace)).toEqual(beforeStale);
	});

	test("verifies claimed artifact references before any state mutation", async () => {
		const { workspace, session } = await runningWorkspace();
		const result = await flowFeatureComplete(
			workspace,
			completionPayload(session, "missing-artifact-completion", {
				artifactRef: {
					kind: "restricted_evidence_v1",
					digest: `sha256:${"f".repeat(64)}`,
					byteLength: 99,
				},
			}),
		);
		expect(result.status).toBe("error");
		expect(result.summary).toContain("unavailable evidence artifacts");
		expect(JSON.stringify(result)).not.toContain("f".repeat(64));
		expect(result.workflowData).not.toHaveProperty("session");
		expect(await loadSession(workspace)).toEqual(session);
	});

	test("accepts a verified restricted artifact reference without exposing bytes", async () => {
		const { workspace, session } = await runningWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const secretBytes = new TextEncoder().encode("private validation output");
		const artifactRef = await store.publishEvidenceArtifact(secretBytes);
		const result = await flowFeatureComplete(
			workspace,
			completionPayload(session, "verified-artifact-completion", {
				artifactRef,
			}),
		);
		expect(result.status).toBe("ok");
		expect(JSON.stringify(result)).not.toContain("private validation output");
		expect(result.workflowData?.receipt?.evidenceRefs).toHaveLength(2);
	});

	test("curates unsafe artifact layout errors without exposing filesystem paths", async () => {
		if (process.platform === "win32") return;
		const { workspace, session } = await runningWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const artifactRef = await store.publishEvidenceArtifact(
			new TextEncoder().encode("restricted validation output"),
		);
		await chmod(evidenceArtifactPath(workspace, artifactRef), 0o644);

		const result = await flowFeatureComplete(
			workspace,
			completionPayload(session, "unsafe-layout-completion", { artifactRef }),
		);
		const serialized = JSON.stringify(result);
		expect(result.status).toBe("error");
		expect(result.summary).toContain("unavailable evidence artifacts");
		expect(serialized).not.toContain(workspace);
		expect(serialized).not.toContain("restricted validation output");
		expect(await loadSession(workspace)).toEqual(session);
	});
});
