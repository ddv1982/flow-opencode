import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
	createFlowService,
	type FlowResponse,
} from "../../src/application/flow-service.js";
import type {
	SessionRepository,
	SessionTransaction,
} from "../../src/application/ports/session-repository.js";
import {
	type ReviewAssignment,
	type Session,
	toSessionId,
} from "../../src/domain/session.js";
import {
	MAX_EXECUTION_PROJECTION_BYTES,
	type TransitionEnvironment,
} from "../../src/domain/transitions.js";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const measurementSourceDigest = `sha256:${"0".repeat(64)}` as const;

const FeatureFixtureSchema = z
	.object({
		id: z.string().trim().min(1),
		title: z.string().trim().min(1),
		summary: z.string().trim().min(1),
		reviewDepth: z.enum(["quick", "standard", "detailed"]),
		targets: z.array(z.string().trim().min(1)),
		validation: z.array(z.string().trim().min(1)),
		dependsOn: z.array(z.string().trim().min(1)),
	})
	.strict();

const MeasurementFixtureSchema = z
	.object({
		fixtureVersion: z.literal(1),
		fixtureId: z.string().trim().min(1),
		measuredAt: z.string().datetime(),
		sessionId: z.string().trim().min(1),
		goal: z.string().trim().min(1),
		plan: z
			.object({
				summary: z.string().trim().min(1),
				overview: z.string().trim().min(1),
				requirements: z.array(z.string().trim().min(1)),
				decisions: z.array(z.string().trim().min(1)),
				finalReviewPolicy: z.enum(["broad", "detailed"]),
				features: z.array(FeatureFixtureSchema).length(6),
			})
			.strict(),
	})
	.strict();

type MeasurementFixture = z.infer<typeof MeasurementFixtureSchema>;

type DecisionSignature = {
	id: string;
	accepted: boolean;
	status: Session["status"];
	revision: number;
	operationId: string;
};

type OutputAggregate = {
	count: number;
	utf8Bytes: number;
	sha256: string;
};

export type CausalTransportMeasurement = {
	reportVersion: 1;
	fixture: {
		id: string;
		version: 1;
		featureCount: 6;
		measuredAt: string;
	};
	phase2Acceptance: {
		status: "passed" | "failed" | "blocked";
		localGatesPass: boolean;
		sameCorpusGatePass: boolean | null;
		blockingReasonCodes: string[];
	};
	localGates: {
		sixFeatureCompactStatus: {
			maximumUtf8Bytes: number;
			limitUtf8Bytes: 3000;
			pass: boolean;
		};
		ordinaryMutationReceipt: {
			maximumUtf8Bytes: number;
			limitUtf8Bytes: 2000;
			changedEntityIncluded: true;
			changedEntityExclusionApplied: false;
			pass: boolean;
		};
		reviewerContext: {
			maximumUtf8Bytes: number;
			limitUtf8Bytes: 3000;
			pass: boolean;
		};
		executionContext: {
			maximumUtf8Bytes: number;
			limitUtf8Bytes: number;
			headroomUtf8Bytes: number;
			pass: boolean;
		};
		unchangedPolling: {
			maximumUtf8Bytes: number;
			projectionKeys: ["revision", "snapshotId", "view"];
			metadataOnly: boolean;
			pass: boolean;
		};
		currentRunStatefulOutput: {
			referenceTransport: "explicit_detail_projection";
			currentTransport: "mutation_receipt_compact_execution_reviewer_and_unchanged";
			reference: OutputAggregate;
			current: OutputAggregate;
			reductionUtf8Bytes: number;
			reductionBasisPoints: number;
			requiredReductionBasisPoints: 6000;
			sameRuntimeTransitionDecisions: boolean;
			decisionCount: number;
			referenceDecisions: DecisionSignature[];
			currentDecisions: DecisionSignature[];
			pass: boolean;
		};
	};
	sameCorpusFlowToolResultCharacters: {
		availability: "unavailable";
		baselineCharacters: 1007950;
		targetMaximumCharacters: 302385;
		requiredReductionBasisPoints: 7000;
		observedCharacters: null;
		reductionBasisPoints: null;
		pass: null;
		reasonCode: "missing_sanitized_call_kind_result_shape_histogram_and_complete_replay_corpus";
		reason: string;
	};
};

function cloneSession(session: Session | null): Session | null {
	return session ? structuredClone(session) : null;
}

class DeterministicMemoryRepository implements SessionRepository {
	#session: Session | null = null;

	async read(): Promise<Session | null> {
		return cloneSession(this.#session);
	}

	async transact<T>(
		task: (transaction: SessionTransaction) => Promise<T>,
	): Promise<T> {
		const transaction: SessionTransaction = {
			computeSourceIdentity: async () => ({
				digest: measurementSourceDigest,
				mode: "non-git",
				entryCount: 0,
			}),
			load: async () => cloneSession(this.#session),
			findArchivedByCloseRetryOperationId: async () => null,
			findArchivedByOperationId: async () => null,
			save: async (session) => {
				this.#session = cloneSession(session);
				return structuredClone(session);
			},
			archiveAndClear: async () => {
				this.#session = null;
			},
			quarantineUnreadable: async () => null,
			publishEvidenceArtifact: async () => {
				throw new Error("The transport fixture does not publish artifacts.");
			},
			readEvidenceArtifact: async () => {
				throw new Error("The transport fixture has no artifact bytes.");
			},
		};
		return task(transaction);
	}

	requireSession(): Session {
		if (!this.#session)
			throw new Error("Expected an active measurement session.");
		return structuredClone(this.#session);
	}
}

function utf8Bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function aggregateOutputs(outputs: readonly FlowResponse[]): OutputAggregate {
	const serialized = JSON.stringify(outputs);
	return {
		count: outputs.length,
		utf8Bytes: outputs.reduce((total, output) => total + utf8Bytes(output), 0),
		sha256: sha256(serialized),
	};
}

function requireProjection(response: FlowResponse): Record<string, unknown> {
	const projection = response.workflowData?.projection;
	if (
		!projection ||
		typeof projection !== "object" ||
		Array.isArray(projection)
	) {
		throw new Error("Expected a Flow projection response.");
	}
	return projection as Record<string, unknown>;
}

function requireDetailCompact(response: FlowResponse): Record<string, unknown> {
	const detail = requireProjection(response);
	const compact = detail.compact;
	if (!compact || typeof compact !== "object" || Array.isArray(compact)) {
		throw new Error("Expected detail output to carry its compact projection.");
	}
	return compact as Record<string, unknown>;
}

function decisionFromDetail(
	id: string,
	response: FlowResponse,
): DecisionSignature {
	const compact = requireDetailCompact(response);
	const detail = requireProjection(response);
	const causal = detail.causal;
	if (!causal || typeof causal !== "object" || Array.isArray(causal)) {
		throw new Error("Expected detail output to carry causal records.");
	}
	const mutations = (causal as Record<string, unknown>).mutations;
	if (!Array.isArray(mutations) || mutations.length === 0) {
		throw new Error("Expected at least one causal mutation.");
	}
	const latest = mutations.at(-1);
	if (!latest || typeof latest !== "object" || Array.isArray(latest)) {
		throw new Error("Expected a latest causal mutation.");
	}
	const operationId = (latest as Record<string, unknown>).operationId;
	if (
		typeof compact.status !== "string" ||
		typeof compact.revision !== "number" ||
		typeof operationId !== "string"
	) {
		throw new Error("Detail output is missing decision identity fields.");
	}
	return {
		id,
		accepted: response.status === "ok",
		status: compact.status as Session["status"],
		revision: compact.revision,
		operationId,
	};
}

function decisionFromReceipt(
	id: string,
	response: FlowResponse,
): DecisionSignature {
	const receipt = response.workflowData?.receipt;
	if (
		!receipt?.operationId ||
		receipt.status === null ||
		receipt.revision === null
	) {
		throw new Error(`Expected mutation receipt for '${id}'.`);
	}
	return {
		id,
		accepted: response.status === "ok",
		status: receipt.status,
		revision: receipt.revision,
		operationId: receipt.operationId,
	};
}

function assertSuccessful(response: FlowResponse, label: string): void {
	if (response.status !== "ok") {
		throw new Error(`${label} failed: ${response.summary}`);
	}
}

function environmentFor(fixture: MeasurementFixture): TransitionEnvironment {
	let tick = 0;
	let runtimeSequence = 0;
	const baseline = Date.parse(fixture.measuredAt);
	return {
		now: () => new Date(baseline + tick++ * 1000).toISOString(),
		newSessionId: () => toSessionId(fixture.sessionId),
		newOperationId: (revision) => `measurement-operation-${revision}`,
		newRuntimeId: (kind) => `${kind}:measurement-${++runtimeSequence}`,
	};
}

function validationObservations(featureId: string, timestamp: string) {
	const outputDigest = sha256(`${featureId}:validation-output`);
	if (!digestPattern.test(outputDigest)) {
		throw new Error("Measurement output digests must be canonical.");
	}
	return [
		{
			command: "bun test tests/causal-transport-measurement.test.ts",
			summary: "Deterministic transport measurement passed.",
			startedAt: timestamp,
			completedAt: timestamp,
			exitCode: 0,
			outputDigest,
			environmentKeys: [],
		},
	];
}

function passingAssignmentResult(assignment: ReviewAssignment) {
	return {
		assignmentId: assignment.id,
		verdict: "passed" as const,
		findings: [],
		completedAt: assignment.startedAt,
		terminalDisposition: "submitted" as const,
	};
}

async function loadFixture(path: string): Promise<MeasurementFixture> {
	return MeasurementFixtureSchema.parse(
		JSON.parse(await readFile(path, "utf8")),
	);
}

export async function measureCausalTransport(
	fixturePath: string,
): Promise<CausalTransportMeasurement> {
	const fixture = await loadFixture(fixturePath);
	const repository = new DeterministicMemoryRepository();
	const service = createFlowService(repository, environmentFor(fixture));
	const referenceOutputs: FlowResponse[] = [];
	const currentOutputs: FlowResponse[] = [];
	const referenceDecisions: DecisionSignature[] = [];
	const currentDecisions: DecisionSignature[] = [];
	const receiptBytes: number[] = [];
	const compactBytes: number[] = [];
	const reviewerBytes: number[] = [];
	const executionBytes: number[] = [];
	const unchangedBytes: number[] = [];
	const unchangedProjectionKeys: string[][] = [];

	const recordMutation = async (
		id: string,
		response: FlowResponse,
		ordinaryReceipt = true,
	): Promise<void> => {
		assertSuccessful(response, id);
		const detail = await service.status({ request: { view: "detail" } });
		const compact = await service.status({ request: { view: "compact" } });
		const compactProjection = requireProjection(compact);
		if (typeof compactProjection.revision !== "number") {
			throw new Error("Compact output is missing its revision.");
		}
		const unchanged = await service.status({
			request: {
				view: "compact",
				sinceRevision: compactProjection.revision,
			},
		});
		assertSuccessful(detail, `${id}:detail`);
		assertSuccessful(compact, `${id}:compact`);
		assertSuccessful(unchanged, `${id}:unchanged`);
		for (const current of [response, compact, unchanged]) {
			referenceOutputs.push(detail);
			currentOutputs.push(current);
		}
		referenceDecisions.push(decisionFromDetail(id, detail));
		currentDecisions.push(decisionFromReceipt(id, response));
		if (ordinaryReceipt) receiptBytes.push(utf8Bytes(response));
		compactBytes.push(utf8Bytes(compact));
		unchangedBytes.push(utf8Bytes(unchanged));
		unchangedProjectionKeys.push(
			Object.keys(requireProjection(unchanged)).sort(),
		);
	};

	await recordMutation(
		"plan-save",
		await service.planSave({ goal: fixture.goal, plan: fixture.plan }),
	);
	await recordMutation("plan-approve", await service.planApprove());

	for (const feature of fixture.plan.features) {
		await recordMutation(
			`run-start:${feature.id}`,
			await service.runStart({ featureId: feature.id }),
		);
		const execution = await service.status({
			request: { view: "execution" },
		});
		assertSuccessful(execution, `execution:${feature.id}`);
		executionBytes.push(utf8Bytes(requireProjection(execution)));
		const executionReference = await service.status({
			request: { view: "detail" },
		});
		assertSuccessful(executionReference, `execution:${feature.id}:detail`);
		referenceOutputs.push(executionReference);
		currentOutputs.push(execution);

		const running = repository.requireSession();
		const featureAssignmentOperation = `review-start:feature:${feature.id}`;
		await recordMutation(
			featureAssignmentOperation,
			await service.reviewStart({
				request: {
					operationId: featureAssignmentOperation,
					expectedRevision: running.causal.revision,
					expectedSnapshotId: running.causal.snapshotId,
					featureId: feature.id,
					reviewKind: "feature",
					validationScope: "targeted",
					packet: {
						summary: `Review ${feature.id} against its assigned targets.`,
						riskLenses: ["behavior", "regression"],
					},
					validations: validationObservations(
						feature.id,
						running.featureRuns.find(
							(run) => run.id === running.activeFeatureRunId,
						)?.startedAt ?? running.timestamps.updatedAt,
					),
				},
			}),
			false,
		);
		const afterFeatureAssignment = repository.requireSession();
		const featureAssignment = afterFeatureAssignment.reviewAssignments.find(
			(assignment) => assignment.operationId === featureAssignmentOperation,
		);
		if (!featureAssignment) {
			throw new Error(`Expected feature assignment for '${feature.id}'.`);
		}
		const reviewer = await service.status({
			request: {
				view: "reviewer",
				assignmentId: featureAssignment.id,
			},
		});
		assertSuccessful(reviewer, `reviewer:${feature.id}`);
		const reviewerReference = await service.status({
			request: { view: "detail" },
		});
		referenceOutputs.push(reviewerReference);
		currentOutputs.push(reviewer);
		reviewerBytes.push(utf8Bytes(reviewer));

		const finalFeature =
			afterFeatureAssignment.plan?.features.every(
				(candidate) =>
					candidate.id === feature.id || candidate.status === "completed",
			) ?? false;
		let finalAssignment: ReviewAssignment | undefined;
		if (finalFeature) {
			const finalAssignmentOperation = `review-start:final:${feature.id}`;
			const beforeFinalAssignment = repository.requireSession();
			await recordMutation(
				finalAssignmentOperation,
				await service.reviewStart({
					request: {
						operationId: finalAssignmentOperation,
						expectedRevision: beforeFinalAssignment.causal.revision,
						expectedSnapshotId: beforeFinalAssignment.causal.snapshotId,
						featureId: feature.id,
						reviewKind: "final",
						validationScope: "broad",
						featureReview: passingAssignmentResult(featureAssignment),
						packet: {
							summary:
								"Review the completed plan and broad validation evidence.",
							riskLenses: ["integration", "release-readiness"],
						},
						validations: validationObservations(
							feature.id,
							featureAssignment.startedAt,
						),
					},
				}),
				false,
			);
			const afterFinalAssignment = repository.requireSession();
			finalAssignment = afterFinalAssignment.reviewAssignments.find(
				(assignment) => assignment.operationId === finalAssignmentOperation,
			);
			if (!finalAssignment) {
				throw new Error(`Expected final assignment for '${feature.id}'.`);
			}
			const finalReviewer = await service.status({
				request: {
					view: "reviewer",
					assignmentId: finalAssignment.id,
				},
			});
			assertSuccessful(finalReviewer, `reviewer:final:${feature.id}`);
			const finalReviewerReference = await service.status({
				request: { view: "detail" },
			});
			referenceOutputs.push(finalReviewerReference);
			currentOutputs.push(finalReviewer);
			reviewerBytes.push(utf8Bytes(finalReviewer));
		}

		const beforeCompletion = repository.requireSession();
		await recordMutation(
			`feature-complete:${feature.id}`,
			await service.featureComplete({
				request: {
					operationId: `feature-complete:${feature.id}`,
					expectedRevision: beforeCompletion.causal.revision,
					expectedSnapshotId: beforeCompletion.causal.snapshotId,
					featureId: feature.id,
					result: finalAssignment
						? {
								kind: "completed",
								summary: `Completed ${feature.id} in the deterministic transport fixture.`,
								artifactsChanged: [{ path: `src/${feature.id}.ts` }],
								validationScope: "broad",
								finalReview: passingAssignmentResult(finalAssignment),
								orchestrationPasses: [],
							}
						: {
								kind: "completed",
								summary: `Completed ${feature.id} in the deterministic transport fixture.`,
								artifactsChanged: [{ path: `src/${feature.id}.ts` }],
								validationScope: "targeted",
								featureReview: passingAssignmentResult(featureAssignment),
								orchestrationPasses: [],
							},
				},
			}),
		);
	}

	const reference = aggregateOutputs(referenceOutputs);
	const current = aggregateOutputs(currentOutputs);
	const reductionUtf8Bytes = reference.utf8Bytes - current.utf8Bytes;
	const reductionBasisPoints = Math.floor(
		(reductionUtf8Bytes * 10_000) / reference.utf8Bytes,
	);
	const sameRuntimeTransitionDecisions =
		JSON.stringify(referenceDecisions) === JSON.stringify(currentDecisions);
	const projectionKeys = ["revision", "snapshotId", "view"] as const;
	const metadataOnly = unchangedProjectionKeys.every(
		(keys) => JSON.stringify(keys) === JSON.stringify(projectionKeys),
	);
	const compactMaximum = Math.max(...compactBytes);
	const receiptMaximum = Math.max(...receiptBytes);
	const reviewerMaximum = Math.max(...reviewerBytes);
	const executionMaximum = Math.max(...executionBytes);
	const unchangedMaximum = Math.max(...unchangedBytes);
	const localGatesPass =
		compactMaximum <= 3000 &&
		receiptMaximum <= 2000 &&
		reviewerMaximum <= 3000 &&
		executionMaximum <= MAX_EXECUTION_PROJECTION_BYTES &&
		metadataOnly &&
		reductionBasisPoints >= 6000 &&
		sameRuntimeTransitionDecisions;

	return {
		reportVersion: 1,
		fixture: {
			id: fixture.fixtureId,
			version: fixture.fixtureVersion,
			featureCount: 6,
			measuredAt: fixture.measuredAt,
		},
		phase2Acceptance: {
			status: localGatesPass ? "blocked" : "failed",
			localGatesPass,
			sameCorpusGatePass: null,
			blockingReasonCodes: localGatesPass
				? [
						"missing_sanitized_call_kind_result_shape_histogram_and_complete_replay_corpus",
					]
				: ["one_or_more_local_phase2_gates_failed"],
		},
		localGates: {
			sixFeatureCompactStatus: {
				maximumUtf8Bytes: compactMaximum,
				limitUtf8Bytes: 3000,
				pass: compactMaximum <= 3000,
			},
			ordinaryMutationReceipt: {
				maximumUtf8Bytes: receiptMaximum,
				limitUtf8Bytes: 2000,
				changedEntityIncluded: true,
				changedEntityExclusionApplied: false,
				pass: receiptMaximum <= 2000,
			},
			reviewerContext: {
				maximumUtf8Bytes: reviewerMaximum,
				limitUtf8Bytes: 3000,
				pass: reviewerMaximum <= 3000,
			},
			executionContext: {
				maximumUtf8Bytes: executionMaximum,
				limitUtf8Bytes: MAX_EXECUTION_PROJECTION_BYTES,
				headroomUtf8Bytes: MAX_EXECUTION_PROJECTION_BYTES - executionMaximum,
				pass: executionMaximum <= MAX_EXECUTION_PROJECTION_BYTES,
			},
			unchangedPolling: {
				maximumUtf8Bytes: unchangedMaximum,
				projectionKeys: [...projectionKeys],
				metadataOnly,
				pass: metadataOnly,
			},
			currentRunStatefulOutput: {
				referenceTransport: "explicit_detail_projection",
				currentTransport:
					"mutation_receipt_compact_execution_reviewer_and_unchanged",
				reference,
				current,
				reductionUtf8Bytes,
				reductionBasisPoints,
				requiredReductionBasisPoints: 6000,
				sameRuntimeTransitionDecisions,
				decisionCount: referenceDecisions.length,
				referenceDecisions,
				currentDecisions,
				pass: reductionBasisPoints >= 6000 && sameRuntimeTransitionDecisions,
			},
		},
		sameCorpusFlowToolResultCharacters: {
			availability: "unavailable",
			baselineCharacters: 1_007_950,
			targetMaximumCharacters: 302_385,
			requiredReductionBasisPoints: 7000,
			observedCharacters: null,
			reductionBasisPoints: null,
			pass: null,
			reasonCode:
				"missing_sanitized_call_kind_result_shape_histogram_and_complete_replay_corpus",
			reason:
				"The investigation attachment does not contain a sanitized call-kind/result-shape histogram or a complete replay corpus, so the same-corpus result cannot be measured locally.",
		},
	};
}
