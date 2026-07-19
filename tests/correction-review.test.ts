import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowService } from "../src/application/flow-service.js";
import {
	EvidenceArtifactTooLargeError,
	MAX_EVIDENCE_ARTIFACT_BYTES,
} from "../src/application/ports/evidence-artifact-store.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "../src/application/ports/session-repository.js";
import { SessionSchema } from "../src/application/schema.js";
import {
	type ReviewAssignment,
	type ReviewFindingTaxonomy,
	type Session,
	toFeatureId,
	toSessionId,
} from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	canonicalEvidenceId,
	canonicalOperationRequestDigest,
	canonicalReviewPacketDigest,
	canonicalValidationCommandDigest,
	createSession,
	startReviewAssignment,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import {
	flowFeatureComplete,
	flowFeatureReset,
	flowPlanApprove,
	flowPlanSave,
	flowReviewStart,
	flowRunStart,
	flowStatus,
} from "../src/infrastructure/fs/workspace-flow-service.js";
import { systemTransitionEnvironment } from "../src/infrastructure/system/transition-environment.js";
import { publishValidationReceiptForWorkspace } from "./support/validation-receipt.js";

const temporaryWorkspaces = new Set<string>();
let digestSequence = 0;

afterEach(async () => {
	const workspaces = [...temporaryWorkspaces];
	temporaryWorkspaces.clear();
	await Promise.all(
		workspaces.map((workspace) =>
			rm(workspace, { force: true, recursive: true }),
		),
	);
});

async function workspaceWithRunningFeature(sourcePath = "source.ts") {
	const workspace = await mkdtemp(join(tmpdir(), "flow-correction-review-"));
	temporaryWorkspaces.add(workspace);
	await writeFile(join(workspace, sourcePath), "export const value = 1;\n");
	expect(
		(
			await flowPlanSave(workspace, {
				goal: "Exercise evidence-backed correction review",
				plan: {
					summary: "Correction review",
					overview: "Keep a second feature so the active review is targeted.",
					features: [
						{
							id: "implementation",
							title: "Implementation",
							summary: "Review and correct one source change.",
							targets: [sourcePath],
						},
						{
							id: "later",
							title: "Later work",
							summary: "Keep targeted review semantics active.",
							dependsOn: ["implementation"],
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

function requireSession(session: Session | null): Session {
	if (!session) throw new Error("Expected an active session.");
	return session;
}

function findAssignment(session: Session, assignmentId: string) {
	const assignment = session.reviewAssignments.find(
		(candidate) => candidate.id === assignmentId,
	);
	if (!assignment) throw new Error(`Missing assignment '${assignmentId}'.`);
	return assignment;
}

function publishValidation(
	workspace: string,
	session: Session,
	label: string,
	coverageScope: "focused" | "broad" | "artifact" = "focused",
) {
	digestSequence += 1;
	return publishValidationReceiptForWorkspace(workspace, {
		command: `bun test --filter ${label}`,
		startedAt: session.timestamps.updatedAt,
		completedAt: session.timestamps.updatedAt,
		exitCode: 0,
		outputDigest: `sha256:${digestSequence.toString(16).padStart(64, "0")}`,
		environmentKeys: [],
		coverageScope,
	});
}

async function startFeatureReview(
	workspace: string,
	operationId: string,
	options: {
		correctionOfAssignmentId?: string;
		correctionScopeHint?: "public-contract" | "cross-layer";
		riskLenses?: string[];
		validationLabel?: string;
	} = {},
) {
	const session = requireSession(await loadSession(workspace));
	const validationRef = await publishValidation(
		workspace,
		session,
		options.validationLabel ?? operationId,
	);
	const request = {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: "implementation",
			reviewKind: "feature",
			validationScope: "targeted",
			packet: {
				summary: "Review the current implementation source.",
				riskLenses: options.riskLenses ?? [],
			},
			validationRefs: [validationRef],
			...(options.correctionOfAssignmentId
				? { correctionOfAssignmentId: options.correctionOfAssignmentId }
				: {}),
			...(options.correctionScopeHint
				? { correctionScopeHint: options.correctionScopeHint }
				: {}),
		},
	} as const;
	const response = await flowReviewStart(workspace, request);
	const projection = response.workflowData?.projection as
		| { assignmentId?: string }
		| undefined;
	return {
		response,
		assignmentId: projection?.assignmentId,
		validationRef,
		request,
	};
}

async function recordFailedReview(
	workspace: string,
	assignmentId: string,
	operationId: string,
	taxonomy: ReviewFindingTaxonomy = "implementation_defect",
) {
	const session = requireSession(await loadSession(workspace));
	const assignment = findAssignment(session, assignmentId);
	return flowFeatureComplete(workspace, {
		request: {
			operationId,
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
			featureId: "implementation",
			result: {
				kind: "blocked",
				summary: "Reviewer found a blocking issue.",
				review: {
					assignmentId,
					verdict: "failed",
					findings: [
						{
							taxonomy,
							subject: "source.ts",
							requirementOrRisk: "The reviewed behavior must be correct.",
							evidenceLocator: "source.ts:1",
							summary: "The implementation still violates the requirement.",
							severity: "blocking",
						},
					],
					completedAt: assignment.startedAt,
					terminalDisposition: "submitted",
				},
			},
		},
	});
}

async function firstFailure(
	workspace: string,
	taxonomy: ReviewFindingTaxonomy = "implementation_defect",
) {
	const started = await startFeatureReview(workspace, "review-initial");
	expect(started.response.status, JSON.stringify(started.response)).toBe("ok");
	if (!started.assignmentId) throw new Error("Expected initial assignment.");
	expect(
		(
			await recordFailedReview(
				workspace,
				started.assignmentId,
				"record-initial-failure",
				taxonomy,
			)
		).status,
	).toBe("ok");
	return started.assignmentId;
}

function serviceWithTransaction(
	workspace: string,
	wrap: (transaction: SessionTransaction) => SessionTransaction,
) {
	const base = createFileSessionRepository(workspace);
	const repository: SessionRepository = {
		read: () => base.read(),
		transact: (task) => base.transact((transaction) => task(wrap(transaction))),
	};
	return createFlowService(repository, systemTransitionEnvironment);
}

function artifactPath(
	workspace: string,
	reference: NonNullable<ReviewAssignment["sourceManifestArtifactRef"]>,
) {
	const hex = reference.digest.slice("sha256:".length);
	return join(
		workspace,
		".flow",
		"evidence",
		"v1",
		"sha256",
		hex.slice(0, 2),
		hex.slice(2),
	);
}

describe("evidence-backed correction review", () => {
	test("derives complete correction context after record-before-edit and recovers it by assignment id", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace);
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");

		const started = await startFeatureReview(workspace, "review-correction", {
			correctionOfAssignmentId: predecessorId,
		});
		expect(started.response.status).toBe("ok");
		expect(started.response.workflowData?.projection).toMatchObject({
			reviewMode: "correction",
			predecessorAssignmentId: predecessorId,
			sourceChanged: true,
			changedRelativePaths: ["source.ts"],
			correctionContextCompleteness: "complete",
			correctionFallbackReason: null,
			priorBlockingFindings: [
				{
					evidenceLocator: "source.ts:1",
					fingerprint: expect.stringMatching(/^finding-v1-/),
				},
			],
		});
		if (!started.assignmentId)
			throw new Error("Expected correction assignment.");
		const recovered = await flowStatus(workspace, {
			request: {
				view: "reviewer",
				assignmentId: started.assignmentId,
			},
		});
		expect(recovered.workflowData?.projection).toEqual(
			started.response.workflowData?.projection,
		);
		const persisted = requireSession(await loadSession(workspace));
		expect(
			findAssignment(persisted, started.assignmentId).correction,
		).toMatchObject({
			predecessorAssignmentId: predecessorId,
			reviewMode: "correction",
			changedRelativePaths: ["source.ts"],
		});
		expect(validateSessionInvariants(persisted)).toBeNull();
	});

	test("rejects stale predecessors and same-source implementation retries before creating an assignment", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace);
		const wrong = await startFeatureReview(workspace, "wrong-predecessor", {
			correctionOfAssignmentId: "review-assignment:not-the-predecessor",
		});
		expect(wrong.response.status).toBe("error");
		expect(wrong.response.workflowData?.failure?.summary).toContain(
			"not the latest recorded failure",
		);

		const sameSource = await startFeatureReview(workspace, "same-source", {
			correctionOfAssignmentId: predecessorId,
			validationLabel: "genuinely-new-validation",
		});
		expect(sameSource.response.status).toBe("error");
		expect(sameSource.response.workflowData?.failure?.summary).toContain(
			"requires a changed source state",
		);
		const persisted = requireSession(await loadSession(workspace));
		expect(persisted.reviewAssignments).toHaveLength(1);
	});

	test("accepts same-source correction only for evidence blockers with distinct validation", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace, "evidence_gap");
		const accepted = await startFeatureReview(
			workspace,
			"evidence-correction",
			{
				correctionOfAssignmentId: predecessorId,
				validationLabel: "new-evidence-command",
			},
		);
		expect(accepted.response.status).toBe("ok");
		expect(accepted.response.workflowData?.projection).toMatchObject({
			reviewMode: "correction",
			sourceChanged: false,
			changedRelativePaths: [],
		});

		const duplicateWorkspace = await workspaceWithRunningFeature();
		const duplicatePredecessor = await firstFailure(
			duplicateWorkspace,
			"evidence_gap",
		);
		const duplicateState = requireSession(
			await loadSession(duplicateWorkspace),
		);
		const priorValidation = duplicateState.causal.evidence.find(
			(evidence) => evidence.kind === "validation",
		);
		if (priorValidation?.kind !== "validation") {
			throw new Error("Expected prior validation evidence.");
		}
		const duplicateValidationRef = await publishValidationReceiptForWorkspace(
			duplicateWorkspace,
			{
				command: "bun test --filter review-initial",
				startedAt: priorValidation.startedAt,
				completedAt: priorValidation.completedAt,
				outputDigest: priorValidation.outputDigest as `sha256:${string}`,
				environmentKeys: [...priorValidation.environmentKeys],
				coverageScope: "focused",
			},
		);
		const duplicate = await flowReviewStart(duplicateWorkspace, {
			request: {
				operationId: "duplicate-evidence-correction",
				expectedRevision: duplicateState.causal.revision,
				expectedSnapshotId: duplicateState.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				correctionOfAssignmentId: duplicatePredecessor,
				packet: { summary: "Reject reused evidence.", riskLenses: [] },
				validationRefs: [duplicateValidationRef],
			},
		});
		expect(duplicate.status).toBe("error");
		expect(duplicate.workflowData?.failure?.summary).toContain(
			"genuinely distinct validation evidence",
		);
	});

	test("falls back to full review when a predecessor manifest is unavailable", async () => {
		const workspace = await workspaceWithRunningFeature();
		let publication = 0;
		const service = serviceWithTransaction(workspace, (transaction) => ({
			...transaction,
			publishEvidenceArtifact: async (bytes) => {
				publication += 1;
				if (publication === 1) {
					throw new EvidenceArtifactTooLargeError(
						"Synthetic oversized initial manifest.",
					);
				}
				return transaction.publishEvidenceArtifact(bytes);
			},
		}));
		const session = requireSession(await loadSession(workspace));
		const initialValidationRef = await publishValidation(
			workspace,
			session,
			"initial-without-manifest",
		);
		const initial = await service.reviewStart({
			request: {
				operationId: "initial-without-manifest",
				expectedRevision: session.causal.revision,
				expectedSnapshotId: session.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				packet: { summary: "Initial full review.", riskLenses: [] },
				validationRefs: [initialValidationRef],
			},
		});
		expect(initial.status).toBe("ok");
		const initialId = (
			initial.workflowData?.projection as { assignmentId?: string } | undefined
		)?.assignmentId;
		if (!initialId) throw new Error("Expected initial assignment id.");
		expect(
			findAssignment(requireSession(await loadSession(workspace)), initialId)
				.sourceManifestArtifactRef,
		).toBeUndefined();
		const failed = requireSession(await loadSession(workspace));
		const firstAssignment = findAssignment(failed, initialId);
		expect(
			(
				await service.featureComplete({
					request: {
						operationId: "record-without-manifest",
						expectedRevision: failed.causal.revision,
						expectedSnapshotId: failed.causal.snapshotId,
						featureId: "implementation",
						result: {
							kind: "blocked",
							summary: "Record failure before correction.",
							review: {
								assignmentId: initialId,
								verdict: "failed",
								findings: [
									{
										taxonomy: "implementation_defect",
										subject: "source.ts",
										requirementOrRisk: "Correctness",
										evidenceLocator: "source.ts:1",
										summary: "Incorrect source.",
										severity: "blocking",
									},
								],
								completedAt: firstAssignment.startedAt,
								terminalDisposition: "submitted",
							},
						},
					},
				})
			).status,
		).toBe("ok");
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const correctionState = requireSession(await loadSession(workspace));
		const correctionValidationRef = await publishValidation(
			workspace,
			correctionState,
			"fallback-correction",
		);
		const correction = await service.reviewStart({
			request: {
				operationId: "fallback-correction",
				expectedRevision: correctionState.causal.revision,
				expectedSnapshotId: correctionState.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				correctionOfAssignmentId: initialId,
				packet: { summary: "Conservative full fallback.", riskLenses: [] },
				validationRefs: [correctionValidationRef],
			},
		});
		expect(correction.status).toBe("ok");
		expect(correction.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			predecessorAssignmentId: initialId,
			correctionContextCompleteness: "fallback",
			correctionFallbackReason: "predecessor_manifest_missing",
		});
	});

	test("falls back for a missing manifest artifact but fails closed for tampered or partial bytes", async () => {
		const missingWorkspace = await workspaceWithRunningFeature();
		const missingPredecessor = await firstFailure(missingWorkspace);
		const missingSession = requireSession(await loadSession(missingWorkspace));
		const missingRef = findAssignment(
			missingSession,
			missingPredecessor,
		).sourceManifestArtifactRef;
		if (!missingRef)
			throw new Error("Expected predecessor manifest reference.");
		await rm(artifactPath(missingWorkspace, missingRef));
		await writeFile(
			join(missingWorkspace, "source.ts"),
			"export const value = 2;\n",
		);
		const missing = await startFeatureReview(
			missingWorkspace,
			"missing-manifest-correction",
			{ correctionOfAssignmentId: missingPredecessor },
		);
		expect(missing.response.status).toBe("ok");
		expect(missing.response.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			correctionContextCompleteness: "fallback",
			correctionFallbackReason: "predecessor_manifest_unavailable",
		});

		const tamperedWorkspace = await workspaceWithRunningFeature();
		const tamperedPredecessor = await firstFailure(tamperedWorkspace);
		const tamperedSession = requireSession(
			await loadSession(tamperedWorkspace),
		);
		const tamperedRef = findAssignment(
			tamperedSession,
			tamperedPredecessor,
		).sourceManifestArtifactRef;
		if (!tamperedRef)
			throw new Error("Expected predecessor manifest reference.");
		await writeFile(
			artifactPath(tamperedWorkspace, tamperedRef),
			"tampered manifest",
		);
		await writeFile(
			join(tamperedWorkspace, "source.ts"),
			"export const value = 2;\n",
		);
		const tampered = await startFeatureReview(
			tamperedWorkspace,
			"tampered-manifest-correction",
			{ correctionOfAssignmentId: tamperedPredecessor },
		);
		expect(tampered.response.status).toBe("error");
		expect(tampered.response.workflowData?.failure?.summary).toContain(
			"integrity",
		);
		expect(
			requireSession(await loadSession(tamperedWorkspace)).reviewAssignments,
		).toHaveLength(1);

		const partialWorkspace = await workspaceWithRunningFeature();
		const partialPredecessor = await firstFailure(partialWorkspace);
		await writeFile(
			join(partialWorkspace, "source.ts"),
			"export const value = 2;\n",
		);
		const partialState = requireSession(await loadSession(partialWorkspace));
		const partialValidationRef = await publishValidation(
			partialWorkspace,
			partialState,
			"partial-manifest",
		);
		const partialService = serviceWithTransaction(
			partialWorkspace,
			(transaction) => ({
				...transaction,
				readEvidenceArtifact: async (reference) =>
					reference.digest === partialValidationRef.digest
						? transaction.readEvidenceArtifact(reference)
						: new TextEncoder().encode('{"version":1,"entries":[]}'),
			}),
		);
		const partial = await partialService.reviewStart({
			request: {
				operationId: "partial-manifest-correction",
				expectedRevision: partialState.causal.revision,
				expectedSnapshotId: partialState.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				correctionOfAssignmentId: partialPredecessor,
				packet: { summary: "Reject partial manifest.", riskLenses: [] },
				validationRefs: [partialValidationRef],
			},
		});
		expect(partial.status).toBe("error");
		expect(partial.workflowData?.failure?.summary).toContain("integrity");
	});

	test("uses full fallback for an oversized current manifest or source delta", async () => {
		const oversizedWorkspace = await workspaceWithRunningFeature();
		const oversizedPredecessor = await firstFailure(oversizedWorkspace);
		await writeFile(
			join(oversizedWorkspace, "source.ts"),
			"export const value = 2;\n",
		);
		const oversizedService = serviceWithTransaction(
			oversizedWorkspace,
			(transaction) => ({
				...transaction,
				computeSourceManifest: async () => {
					if (!transaction.computeSourceManifest) {
						throw new Error("Missing manifest provider.");
					}
					const snapshot = await transaction.computeSourceManifest();
					return {
						...snapshot,
						bytes: new Uint8Array(MAX_EVIDENCE_ARTIFACT_BYTES + 1),
					};
				},
			}),
		);
		const oversizedState = requireSession(
			await loadSession(oversizedWorkspace),
		);
		const oversizedValidationRef = await publishValidation(
			oversizedWorkspace,
			oversizedState,
			"oversized-current",
		);
		const oversized = await oversizedService.reviewStart({
			request: {
				operationId: "oversized-current-manifest",
				expectedRevision: oversizedState.causal.revision,
				expectedSnapshotId: oversizedState.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				correctionOfAssignmentId: oversizedPredecessor,
				packet: { summary: "Use full review.", riskLenses: [] },
				validationRefs: [oversizedValidationRef],
			},
		});
		expect(oversized.status).toBe("ok");
		expect(oversized.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			correctionContextCompleteness: "fallback",
			correctionFallbackReason: "current_manifest_oversized",
		});

		const deltaWorkspace = await workspaceWithRunningFeature();
		const deltaPredecessor = await firstFailure(deltaWorkspace);
		await Promise.all(
			Array.from({ length: 257 }, (_, index) =>
				writeFile(
					join(
						deltaWorkspace,
						`changed-${index.toString().padStart(3, "0")}.ts`,
					),
					`export const value${index} = ${index};\n`,
				),
			),
		);
		const delta = await startFeatureReview(
			deltaWorkspace,
			"oversized-delta-correction",
			{ correctionOfAssignmentId: deltaPredecessor },
		);
		expect(delta.response.status).toBe("ok");
		expect(delta.response.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			changedRelativePaths: [],
			correctionContextCompleteness: "fallback",
			correctionFallbackReason: "source_delta_too_large",
		});
	});

	test("uses conservative full review for security and persistence deltas", async () => {
		for (const [path, reason] of [
			["auth.ts", "security_sensitive_delta_requires_full"],
			["schema.ts", "persistence_sensitive_delta_requires_full"],
		] as const) {
			const workspace = await workspaceWithRunningFeature(path);
			const predecessorId = await firstFailure(workspace);
			await writeFile(join(workspace, path), "export const value = 2;\n");
			const correction = await startFeatureReview(
				workspace,
				`correction-${path}`,
				{ correctionOfAssignmentId: predecessorId },
			);
			expect(correction.response.status).toBe("ok");
			expect(correction.response.workflowData?.projection).toMatchObject({
				reviewMode: "full",
				changedRelativePaths: [path],
				correctionContextCompleteness: "complete",
				correctionFallbackReason: reason,
			});
		}
	});

	test("allows correction callers to elevate public-contract and cross-layer scope only to full review", async () => {
		for (const [hint, reason] of [
			["public-contract", "public_contract_scope_requires_full"],
			["cross-layer", "cross_layer_scope_requires_full"],
		] as const) {
			const workspace = await workspaceWithRunningFeature();
			const predecessorId = await firstFailure(workspace);
			await writeFile(
				join(workspace, "source.ts"),
				`export const value = ${hint === "public-contract" ? 2 : 3};\n`,
			);
			const correction = await startFeatureReview(workspace, `scope-${hint}`, {
				correctionOfAssignmentId: predecessorId,
				correctionScopeHint: hint,
			});
			expect(correction.response.status).toBe("ok");
			expect(correction.response.workflowData?.projection).toMatchObject({
				reviewMode: "full",
				changedRelativePaths: ["source.ts"],
				correctionContextCompleteness: "complete",
				correctionFallbackReason: reason,
			});
			const persisted = requireSession(await loadSession(workspace));
			expect(
				findAssignment(persisted, correction.assignmentId ?? "").correction,
			).toMatchObject({ reviewMode: "full", fallbackReason: reason });
			expect(validateSessionInvariants(persisted)).toBeNull();
		}
	});

	test("keeps runtime-specific correction classifiers ahead of caller elevation hints", async () => {
		const workspace = await workspaceWithRunningFeature("auth.ts");
		const predecessorId = await firstFailure(workspace);
		await writeFile(join(workspace, "auth.ts"), "export const value = 2;\n");
		const correction = await startFeatureReview(
			workspace,
			"runtime-classifier-precedence",
			{
				correctionOfAssignmentId: predecessorId,
				correctionScopeHint: "cross-layer",
			},
		);
		expect(correction.response.status).toBe("ok");
		expect(correction.response.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			correctionFallbackReason: "security_sensitive_delta_requires_full",
		});
	});

	test("binds the correction scope hint into exact operation replay identity", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace);
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const started = await startFeatureReview(workspace, "scope-hint-replay", {
			correctionOfAssignmentId: predecessorId,
			correctionScopeHint: "public-contract",
		});
		expect(started.response.status).toBe("ok");
		expect((await flowReviewStart(workspace, started.request)).status).toBe(
			"ok",
		);
		const rebound = await flowReviewStart(workspace, {
			request: {
				...started.request.request,
				correctionScopeHint: "cross-layer",
			},
		});
		expect(rebound.status).toBe("error");
		expect(rebound.workflowData?.failure?.summary).toContain(
			"already used for a different request",
		);
		const persisted = requireSession(await loadSession(workspace));
		expect(persisted.reviewAssignments).toHaveLength(2);
	});

	test("keeps correction review full for broad final-review scope", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-broad-correction-"));
		temporaryWorkspaces.add(workspace);
		await writeFile(join(workspace, "source.ts"), "export const value = 1;\n");
		expect(
			(
				await flowPlanSave(workspace, {
					goal: "Exercise broad correction review",
					plan: {
						summary: "Broad review",
						overview: "Use one final feature.",
						features: [
							{
								id: "implementation",
								title: "Final implementation",
								summary: "Exercise feature and final review.",
								targets: ["source.ts"],
							},
						],
					},
				})
			).status,
		).toBe("ok");
		expect((await flowPlanApprove(workspace)).status).toBe("ok");
		expect((await flowRunStart(workspace, {})).status).toBe("ok");

		const featureStarted = await startFeatureReview(
			workspace,
			"broad-feature-initial",
		);
		if (!featureStarted.assignmentId) {
			throw new Error("Expected feature assignment.");
		}
		let state = requireSession(await loadSession(workspace));
		const featureAssignment = findAssignment(
			state,
			featureStarted.assignmentId,
		);
		const finalValidationRef = await publishValidation(
			workspace,
			state,
			"broad-final-initial",
			"broad",
		);
		const finalStarted = await flowReviewStart(workspace, {
			request: {
				operationId: "broad-final-initial",
				expectedRevision: state.causal.revision,
				expectedSnapshotId: state.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "final",
				validationScope: "broad",
				packet: { summary: "Initial broad review.", riskLenses: [] },
				validationRefs: [finalValidationRef],
				featureReview: {
					assignmentId: featureAssignment.id,
					verdict: "passed",
					findings: [],
					completedAt: featureAssignment.startedAt,
					terminalDisposition: "submitted",
				},
			},
		});
		expect(finalStarted.status).toBe("ok");
		const finalId = (
			finalStarted.workflowData?.projection as
				| { assignmentId?: string }
				| undefined
		)?.assignmentId;
		if (!finalId) throw new Error("Expected final assignment id.");
		state = requireSession(await loadSession(workspace));
		const finalAssignment = findAssignment(state, finalId);
		expect(
			(
				await flowFeatureComplete(workspace, {
					request: {
						operationId: "record-broad-final-failure",
						expectedRevision: state.causal.revision,
						expectedSnapshotId: state.causal.snapshotId,
						featureId: "implementation",
						result: {
							kind: "blocked",
							summary: "Broad final review found a blocker.",
							review: {
								assignmentId: finalId,
								verdict: "failed",
								findings: [
									{
										taxonomy: "implementation_defect",
										subject: "source.ts",
										requirementOrRisk: "Final behavior must be correct.",
										evidenceLocator: "source.ts:1",
										summary: "Final review blocker.",
										severity: "blocking",
									},
								],
								completedAt: finalAssignment.startedAt,
								terminalDisposition: "submitted",
							},
						},
					},
				})
			).status,
		).toBe("ok");
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const replacementFeature = await startFeatureReview(
			workspace,
			"broad-feature-replacement",
		);
		if (!replacementFeature.assignmentId) {
			throw new Error("Expected replacement feature assignment.");
		}
		state = requireSession(await loadSession(workspace));
		const replacement = findAssignment(state, replacementFeature.assignmentId);
		const correctionValidationRef = await publishValidation(
			workspace,
			state,
			"broad-final-correction",
			"broad",
		);
		const correction = await flowReviewStart(workspace, {
			request: {
				operationId: "broad-final-correction",
				expectedRevision: state.causal.revision,
				expectedSnapshotId: state.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "final",
				validationScope: "broad",
				correctionOfAssignmentId: finalId,
				packet: { summary: "Broad correction stays full.", riskLenses: [] },
				validationRefs: [correctionValidationRef],
				featureReview: {
					assignmentId: replacement.id,
					verdict: "passed",
					findings: [],
					completedAt: replacement.startedAt,
					terminalDisposition: "submitted",
				},
			},
		});
		expect(correction.status).toBe("ok");
		expect(correction.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			predecessorAssignmentId: finalId,
			correctionContextCompleteness: "complete",
			correctionFallbackReason: "broad_scope_requires_full",
		});
	});

	test("binds correction context into packet identity and stops after the second failure", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace);
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const correction = await startFeatureReview(workspace, "second-review", {
			correctionOfAssignmentId: predecessorId,
		});
		if (!correction.assignmentId)
			throw new Error("Expected correction assignment.");
		const pending = requireSession(await loadSession(workspace));
		const corrupted = structuredClone(pending);
		const corruptedAssignment = findAssignment(
			corrupted,
			correction.assignmentId,
		);
		if (!corruptedAssignment.correction) {
			throw new Error("Expected correction binding.");
		}
		corruptedAssignment.correction.changedRelativePaths = ["other.ts"];
		expect(validateSessionInvariants(corrupted)).toContain(
			"invalid canonical review identity",
		);
		expect(SessionSchema.safeParse(corrupted).success).toBe(false);

		expect(
			(
				await recordFailedReview(
					workspace,
					correction.assignmentId,
					"record-second-failure",
				)
			).status,
		).toBe("ok");
		const exhausted = requireSession(await loadSession(workspace));
		expect(exhausted.status).toBe("blocked");
		expect(exhausted.budget.failedReviewAttemptsByFeatureRun).toEqual({
			[findAssignment(exhausted, correction.assignmentId).featureRunId]: 2,
		});
		const third = await flowReviewStart(workspace, {
			request: {
				operationId: "third-review",
				expectedRevision: exhausted.causal.revision,
				expectedSnapshotId: exhausted.causal.snapshotId,
				featureId: "implementation",
				reviewKind: "feature",
				validationScope: "targeted",
				correctionOfAssignmentId: correction.assignmentId,
				packet: {
					summary: "Reject review after the retry budget is exhausted.",
					riskLenses: [],
				},
				validationRefs: [correction.validationRef],
			},
		});
		expect(third.status).toBe("error");
		expect(exhausted.reviewAssignments).toHaveLength(2);
	});

	test("falls back instead of truncating oversized blocker context", async () => {
		const workspace = await workspaceWithRunningFeature();
		const started = await startFeatureReview(
			workspace,
			"large-context-initial",
		);
		if (!started.assignmentId) throw new Error("Expected initial assignment.");
		const state = requireSession(await loadSession(workspace));
		const initial = findAssignment(state, started.assignmentId);
		const recorded = await flowFeatureComplete(workspace, {
			request: {
				operationId: "record-large-context",
				expectedRevision: state.causal.revision,
				expectedSnapshotId: state.causal.snapshotId,
				featureId: "implementation",
				result: {
					kind: "blocked",
					summary: "Record complete oversized blocker context.",
					review: {
						assignmentId: initial.id,
						verdict: "failed",
						findings: Array.from({ length: 3 }, (_, index) => ({
							taxonomy: "implementation_defect" as const,
							subject: `source-${index}.ts`,
							requirementOrRisk: `Requirement ${index}`,
							evidenceLocator: `${"x".repeat(1_900)}:${index}`,
							summary: `Blocking issue ${index}`,
							severity: "blocking" as const,
						})),
						completedAt: initial.startedAt,
						terminalDisposition: "submitted",
					},
				},
			},
		});
		expect(recorded.status).toBe("ok");
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const correction = await startFeatureReview(
			workspace,
			"large-context-correction",
			{ correctionOfAssignmentId: initial.id },
		);
		expect(correction.response.status).toBe("ok");
		expect(correction.response.workflowData?.projection).toMatchObject({
			reviewMode: "full",
			priorBlockingFindings: [],
			changedRelativePaths: [],
			correctionContextCompleteness: "fallback",
			correctionFallbackReason: "projection_context_too_large",
		});
	});

	test("does not carry correction predecessors across a feature reset", async () => {
		const workspace = await workspaceWithRunningFeature();
		const predecessorId = await firstFailure(workspace);
		const beforeReset = requireSession(await loadSession(workspace));
		expect(
			(
				await flowFeatureReset(workspace, {
					operationId: "reset-after-failure",
					expectedRevision: beforeReset.causal.revision,
					expectedSnapshotId: beforeReset.causal.snapshotId,
					featureId: "implementation",
				})
			).status,
		).toBe("ok");
		expect(
			(await flowRunStart(workspace, { featureId: "implementation" })).status,
		).toBe("ok");
		await writeFile(join(workspace, "source.ts"), "export const value = 2;\n");
		const rejected = await startFeatureReview(
			workspace,
			"cross-reset-correction",
			{ correctionOfAssignmentId: predecessorId },
		);
		expect(rejected.response.status).toBe("error");
		expect(rejected.response.workflowData?.failure?.summary).toContain(
			"not the latest recorded failure",
		);
	});

	test("keeps legacy packet digests unchanged when correction fields are absent", () => {
		let tick = 0;
		let runtimeId = 0;
		const environment: TransitionEnvironment = {
			now: () =>
				new Date(
					Date.parse("2026-07-19T12:00:00.000Z") + tick++ * 1_000,
				).toISOString(),
			newSessionId: () => toSessionId("legacy-correction-session"),
			newRuntimeId: (kind) => `${kind}:legacy-${++runtimeId}`,
		};
		const featureId = toFeatureId("implementation");
		const planned = applyPlan(
			createSession("Keep Session v4 compatible", environment),
			{
				summary: "Legacy assignment",
				overview: "Create a pre-extension assignment.",
				features: [
					{
						id: featureId,
						title: "Legacy",
						summary: "No correction fields.",
					},
				],
			},
			environment,
		);
		expect(planned.ok).toBe(true);
		if (!planned.ok) throw new Error(planned.message);
		const approved = approvePlan(planned.value, environment);
		expect(approved.ok).toBe(true);
		if (!approved.ok) throw new Error(approved.message);
		const running = startRun(approved.value, environment, featureId);
		expect(running.ok).toBe(true);
		if (!running.ok || !running.value.session.activeFeatureRunId) {
			throw new Error("Expected legacy active run.");
		}
		const legacySession = running.value.session;
		const legacyFeatureRunId = legacySession.activeFeatureRunId;
		if (!legacyFeatureRunId) throw new Error("Expected legacy feature run id.");
		const run = legacySession.featureRuns.at(-1);
		if (!run) throw new Error("Expected legacy run.");
		const sourceDigest: `sha256:${string}` = `sha256:${"b".repeat(64)}`;
		const provisional = {
			kind: "validation" as const,
			evidenceId: "",
			featureRunId: legacyFeatureRunId,
			capturedAtRevision: legacySession.causal.revision,
			capturedAtSnapshotId: legacySession.causal.snapshotId,
			snapshotId: legacySession.causal.snapshotId,
			sourceDigest,
			commandDigest: canonicalValidationCommandDigest("bun test"),
			commandClass: "test" as const,
			startedAt: run.startedAt,
			completedAt: run.startedAt,
			exitCode: 0,
			outputDigest: `sha256:${"c".repeat(64)}`,
			environmentKeys: [],
		};
		const evidence = {
			...provisional,
			evidenceId: canonicalEvidenceId(provisional),
		};
		const publicRequest = {
			operationId: "legacy-review-start",
			expectedRevision: legacySession.causal.revision,
			expectedSnapshotId: legacySession.causal.snapshotId,
			featureId,
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			packet: { summary: "Legacy packet.", riskLenses: [] },
			validationRefs: [],
		};
		const legacy = startReviewAssignment(
			legacySession,
			{
				operationId: publicRequest.operationId,
				expectedRevision: publicRequest.expectedRevision,
				expectedSnapshotId: publicRequest.expectedSnapshotId,
				requestDigest: canonicalOperationRequestDigest(
					"review_start",
					publicRequest,
				),
				featureId,
				reviewKind: "feature",
				validationScope: "targeted",
				packetSummary: "Legacy packet.",
				riskLenses: [],
				sourceDigest,
				validationEvidence: [evidence],
			},
			environment,
		);
		expect(legacy.ok).toBe(true);
		if (!legacy.ok) throw new Error(legacy.message);
		expect(legacy.value.assignment).not.toHaveProperty(
			"sourceManifestArtifactRef",
		);
		expect(legacy.value.assignment).not.toHaveProperty("correction");
		expect(SessionSchema.safeParse(legacy.value.session).success).toBe(true);
		expect(legacy.value.assignment.packetDigest).toBe(
			canonicalReviewPacketDigest(legacy.value.assignment),
		);

		const identity = {
			featureRunId: "feature-run:legacy",
			featureId,
			reviewKind: "feature" as const,
			validationScope: "targeted" as const,
			validationEvidenceRefs: [`sha256:${"a".repeat(64)}`],
			sourceDigest: `sha256:${"b".repeat(64)}`,
			packetSummary: "Legacy review packet.",
			riskLenses: [],
			prerequisite: null,
		};
		expect(canonicalReviewPacketDigest(identity)).toBe(
			"sha256:0eda72d11693842421efa62f2ec60a3cd909fc6c33633864f3726fdaa24104d1",
		);
	});
});
