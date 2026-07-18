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
	type ReviewExecutionInput,
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
	if (!receipt?.operationId) {
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
	const baseline = Date.parse(fixture.measuredAt);
	return {
		now: () => new Date(baseline + tick++ * 1000).toISOString(),
		newSessionId: () => toSessionId(fixture.sessionId),
		newOperationId: (revision) => `measurement-operation-${revision}`,
	};
}

function completionPayload(session: Session, featureIndex: number) {
	const featureId = session.activeFeatureId;
	if (!featureId) throw new Error("Expected an active feature for completion.");
	const finalFeature =
		session.plan?.features.every(
			(feature) => feature.id === featureId || feature.status === "completed",
		) ?? false;
	const minute = String(10 + featureIndex * 4).padStart(2, "0");
	const nextMinute = String(11 + featureIndex * 4).padStart(2, "0");
	const finalStartMinute = String(12 + featureIndex * 4).padStart(2, "0");
	const finalEndMinute = String(13 + featureIndex * 4).padStart(2, "0");
	const featurePacket = sha256(`${featureId}:feature-review-packet`);
	const finalPacket = sha256(`${featureId}:final-review-packet`);
	if (!digestPattern.test(featurePacket) || !digestPattern.test(finalPacket)) {
		throw new Error("Measurement packet digests must be canonical.");
	}
	const reviewExecutions: ReviewExecutionInput[] = [
		{
			attemptId: `${featureId}-feature-review`,
			logicalPassId: `${featureId}-feature-pass`,
			featureId,
			reviewKind: "feature",
			reviewSnapshotId: featurePacket,
			verdict: "passed",
			findings: [],
			startedAt: `2026-07-18T10:${minute}:00.000Z`,
			completedAt: `2026-07-18T10:${nextMinute}:00.000Z`,
			terminalDisposition: "submitted",
		},
	];
	if (finalFeature) {
		reviewExecutions.push({
			attemptId: `${featureId}-final-review`,
			logicalPassId: `${featureId}-final-pass`,
			featureId,
			reviewKind: "final",
			reviewSnapshotId: finalPacket,
			verdict: "passed",
			findings: [],
			startedAt: `2026-07-18T10:${finalStartMinute}:00.000Z`,
			completedAt: `2026-07-18T10:${finalEndMinute}:00.000Z`,
			terminalDisposition: "submitted",
		});
	}
	const outputDigest = sha256(`${featureId}:validation-output`);
	const validations = [
		{
			command: "bun test tests/causal-transport-measurement.test.ts",
			summary: "Deterministic transport measurement passed.",
			startedAt: `2026-07-18T10:${minute}:00.000Z`,
			completedAt: `2026-07-18T10:${nextMinute}:00.000Z`,
			exitCode: 0,
			outputDigest,
			environmentKeys: [],
		},
	];
	return {
		status: "ok" as const,
		operationId: `complete-${featureId}`,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId,
		summary: `Completed ${featureId} in the deterministic transport fixture.`,
		artifactsChanged: [{ path: `src/${featureId}.ts` }],
		validations,
		validationScope: finalFeature ? ("broad" as const) : ("targeted" as const),
		featureReviewDepth:
			session.plan?.features.find((feature) => feature.id === featureId)
				?.reviewDepth ?? "standard",
		featureReview: {
			status: "passed" as const,
			summary: "Feature review passed against the immutable packet.",
			blockingFindings: [],
		},
		...(finalFeature
			? {
					finalReview: {
						status: "passed" as const,
						summary: "Final review passed against the final packet.",
						blockingFindings: [],
						reviewDepth: "detailed" as const,
					},
				}
			: {}),
		reviewExecutions,
		orchestrationPasses: [],
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
	): Promise<void> => {
		assertSuccessful(response, id);
		const detail = await service.status({ view: "detail" });
		const compact = await service.status({});
		const compactProjection = requireProjection(compact);
		if (typeof compactProjection.revision !== "number") {
			throw new Error("Compact output is missing its revision.");
		}
		const unchanged = await service.status({
			sinceRevision: compactProjection.revision,
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
		receiptBytes.push(utf8Bytes(response));
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

	for (const [featureIndex, feature] of fixture.plan.features.entries()) {
		await recordMutation(
			`run-start:${feature.id}`,
			await service.runStart({ featureId: feature.id }),
		);
		const session = repository.requireSession();
		const execution = await service.status({ view: "execution" });
		assertSuccessful(execution, `execution:${feature.id}`);
		executionBytes.push(utf8Bytes(requireProjection(execution)));
		const executionReference = await service.status({ view: "detail" });
		assertSuccessful(executionReference, `execution:${feature.id}:detail`);
		referenceOutputs.push(executionReference);
		currentOutputs.push(execution);
		const packetHash = sha256(`${feature.id}:feature-review-packet`);
		const reviewer = await service.status({
			view: "reviewer",
			featureId: feature.id,
			packetHash,
			evidenceRefs: Array.from({ length: 8 }, (_, index) =>
				sha256(`${feature.id}:evidence-ref:${index}`),
			),
			reviewKind: "feature",
			expectedRevision: session.causal.revision,
			expectedSnapshotId: session.causal.snapshotId,
		});
		assertSuccessful(reviewer, `reviewer:${feature.id}`);
		const reviewerReference = await service.status({ view: "detail" });
		referenceOutputs.push(reviewerReference);
		currentOutputs.push(reviewer);
		reviewerBytes.push(utf8Bytes(reviewer));
		await recordMutation(
			`feature-complete:${feature.id}`,
			await service.featureComplete(completionPayload(session, featureIndex)),
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
