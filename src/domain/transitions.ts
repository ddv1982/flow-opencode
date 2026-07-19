import {
	MAX_HISTORY_ENTRIES,
	MAX_ORCHESTRATION_PASSES,
	MAX_REVIEW_ASSIGNMENT_RESULT_BYTES,
	MAX_SESSION_ID_LENGTH,
} from "./limits.js";
import {
	hasCandidateExecutionEvidence,
	hasVerifierExecutionEvidence,
} from "./orchestration-policy.js";
import type {
	BudgetTelemetry,
	CausalGuard,
	CausalMutationRecord,
	EvidenceId,
	EvidenceRecord,
	ExecutionHistoryEntry,
	ExecutionProjection,
	Feature,
	FeatureId,
	FeatureRun,
	FeatureRunId,
	OrchestrationPassRecord,
	Plan,
	PlanInput,
	ReviewAssignment,
	ReviewAssignmentId,
	ReviewAssignmentResultInput,
	ReviewCorrectionBinding,
	ReviewExecution,
	ReviewExecutionFindingInput,
	ReviewExecutionInput,
	ReviewerProjection,
	ReviewerProjectionRequest,
	Session,
	SessionId,
	SnapshotId,
} from "./session.js";

export const MAX_EXECUTION_PROJECTION_BYTES = 12 * 1024;
export const MAX_REVIEWER_PROJECTION_BYTES = 3_000;
export const MAX_PLAN_FEATURES = MAX_HISTORY_ENTRIES;
export const MAX_ORCHESTRATION_COLLECTION_BYTES =
	MAX_REVIEW_ASSIGNMENT_RESULT_BYTES;

const MAX_EXECUTION_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_EXECUTION_SNAPSHOT_ID = `sha256:${"f".repeat(64)}`;
const MAX_EXECUTION_FEATURE_RUN_ID = "f".repeat(
	MAX_SESSION_ID_LENGTH,
) as FeatureRunId;
const MAX_PERSISTED_REVIEW_ID = "r".repeat(MAX_SESSION_ID_LENGTH);
export const MAX_CORRECTION_CHANGED_PATHS = 256;
export const MAX_CORRECTION_PATH_BYTES = 512;

export type TransitionEnvironment = {
	now(): string;
	newSessionId(): SessionId;
	newOperationId?(revision: number): string;
	newRuntimeId?(kind: "feature-run" | "review-assignment"): string;
};

export type TransitionResult<T> =
	| { ok: true; value: T }
	| { ok: false; message: string; recovery?: string; session?: Session };

export type ReviewStartInput = CausalGuard & {
	requestDigest: string;
	featureId: FeatureId;
	reviewKind: "feature" | "final";
	validationScope: "targeted" | "broad";
	packetSummary: string;
	riskLenses: string[];
	sourceDigest: string;
	validationEvidence: Extract<EvidenceRecord, { kind: "validation" }>[];
	featureReview?: ReviewAssignmentResultInput | undefined;
	correctionOfAssignmentId?: ReviewAssignmentId | undefined;
	sourceManifestArtifactRef?: ReviewAssignment["sourceManifestArtifactRef"];
	correction?: ReviewCorrectionBinding | undefined;
};

export type AssignedFeatureCompletionInput = CausalGuard & {
	featureId: FeatureId;
	sourceDigest: string;
	result:
		| {
				kind: "completed";
				summary: string;
				artifactsChanged: Array<{ path: string }>;
				validationScope: "targeted";
				featureReview: ReviewAssignmentResultInput;
				orchestrationPasses: OrchestrationPassRecord[];
		  }
		| {
				kind: "completed";
				summary: string;
				artifactsChanged: Array<{ path: string }>;
				validationScope: "broad";
				finalReview: ReviewAssignmentResultInput;
				orchestrationPasses: OrchestrationPassRecord[];
		  }
		| {
				kind: "blocked";
				summary: string;
				review: ReviewAssignmentResultInput;
				resolutionHint?: string | undefined;
				orchestrationPasses: OrchestrationPassRecord[];
		  };
};

export type AssignedFeatureCompletionPreflightInput = Omit<
	AssignedFeatureCompletionInput,
	"sourceDigest"
>;

function cloneOrchestrationPass(
	pass: OrchestrationPassRecord,
): OrchestrationPassRecord {
	return {
		...pass,
		decisionFactors: [...pass.decisionFactors],
		modes: [...pass.modes],
		sliceIds: [...pass.sliceIds],
		dependsOn: [...pass.dependsOn],
		handoffRefs: [...pass.handoffRefs],
	};
}

function normalizeFingerprintComponent(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function fingerprintPayloadPart(value: string): string {
	const normalized = normalizeFingerprintComponent(value);
	return `${normalized.length}:${normalized}`;
}

function fnv1a64(value: string, offset: bigint): string {
	let hash = offset;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= BigInt(value.charCodeAt(index));
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return hash.toString(16).padStart(16, "0");
}

const SHA256_ROUND_CONSTANTS = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(value: string): string {
	const input = new TextEncoder().encode(value);
	const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
	const bytes = new Uint8Array(paddedLength);
	bytes.set(input);
	bytes[input.length] = 0x80;
	const bitLength = input.length * 8;
	const view = new DataView(bytes.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
	view.setUint32(paddedLength - 4, bitLength >>> 0);

	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	]);
	const words = new Uint32Array(64);
	for (let offset = 0; offset < bytes.length; offset += 64) {
		for (let index = 0; index < 16; index += 1) {
			words[index] = view.getUint32(offset + index * 4);
		}
		for (let index = 16; index < 64; index += 1) {
			const prior15 = words[index - 15] ?? 0;
			const prior2 = words[index - 2] ?? 0;
			const sigma0 =
				rotateRight(prior15, 7) ^ rotateRight(prior15, 18) ^ (prior15 >>> 3);
			const sigma1 =
				rotateRight(prior2, 17) ^ rotateRight(prior2, 19) ^ (prior2 >>> 10);
			words[index] =
				((words[index - 16] ?? 0) +
					sigma0 +
					(words[index - 7] ?? 0) +
					sigma1) >>>
				0;
		}

		let [a, b, c, d, e, f, g, h] = hash;
		if (
			a === undefined ||
			b === undefined ||
			c === undefined ||
			d === undefined ||
			e === undefined ||
			f === undefined ||
			g === undefined ||
			h === undefined
		) {
			throw new Error("SHA-256 state initialization failed.");
		}
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
			const choose = (e & f) ^ (~e & g);
			const temporary1: number =
				(h +
					sum1 +
					choose +
					(SHA256_ROUND_CONSTANTS[index] ?? 0) +
					(words[index] ?? 0)) >>>
				0;
			const sum0: number =
				rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const temporary2: number = (sum0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d + temporary1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temporary1 + temporary2) >>> 0;
		}
		hash[0] = ((hash[0] ?? 0) + a) >>> 0;
		hash[1] = ((hash[1] ?? 0) + b) >>> 0;
		hash[2] = ((hash[2] ?? 0) + c) >>> 0;
		hash[3] = ((hash[3] ?? 0) + d) >>> 0;
		hash[4] = ((hash[4] ?? 0) + e) >>> 0;
		hash[5] = ((hash[5] ?? 0) + f) >>> 0;
		hash[6] = ((hash[6] ?? 0) + g) >>> 0;
		hash[7] = ((hash[7] ?? 0) + h) >>> 0;
	}
	return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJsonValue);
	if (!value || typeof value !== "object") return value;
	const source = value as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(source).sort()) {
		if (source[key] !== undefined) {
			result[key] = canonicalJsonValue(source[key]);
		}
	}
	return result;
}

function deterministicDigest(prefix: string, value: unknown): string {
	const payload = JSON.stringify(canonicalJsonValue(value));
	return `sha256:${sha256Hex(`${prefix}\u0000${payload}`)}`;
}

export function canonicalReviewAssignmentResultDigest(
	result: ReviewAssignmentResultInput,
): string {
	return deterministicDigest("review-assignment-result-v1", result);
}

export function canonicalReviewAttemptId(
	assignmentId: ReviewAssignmentId,
): string {
	return `review-attempt:${deterministicDigest("review-attempt-v1", {
		assignmentId,
	}).slice("sha256:".length, "sha256:".length + 32)}`;
}

export function canonicalLogicalReviewPassId(
	featureRunId: FeatureRunId,
	reviewKind: ReviewAssignment["reviewKind"],
): string {
	return `review-pass:${deterministicDigest("logical-review-pass-v1", {
		featureRunId,
		reviewKind,
	}).slice("sha256:".length, "sha256:".length + 32)}`;
}

export function canonicalReviewPacketDigest(
	assignment: Pick<
		ReviewAssignment,
		| "featureRunId"
		| "featureId"
		| "reviewKind"
		| "validationScope"
		| "validationEvidenceRefs"
		| "sourceDigest"
		| "packetSummary"
		| "riskLenses"
		| "prerequisite"
		| "sourceManifestArtifactRef"
		| "correction"
	>,
): string {
	const base = {
		featureRunId: assignment.featureRunId,
		featureId: assignment.featureId,
		reviewKind: assignment.reviewKind,
		validationScope: assignment.validationScope,
		validationEvidenceRefs: assignment.validationEvidenceRefs,
		sourceDigest: assignment.sourceDigest,
		packetSummary: assignment.packetSummary,
		riskLenses: assignment.riskLenses,
		prerequisite: assignment.prerequisite
			? {
					assignmentId: assignment.prerequisite.assignmentId,
					resultDigest: assignment.prerequisite.resultDigest,
				}
			: null,
	};
	// Historical Session v4 assignments omitted both extension fields. Preserve
	// their exact v2 golden digest instead of treating absence as a migration.
	if (
		assignment.sourceManifestArtifactRef === undefined &&
		assignment.correction === undefined
	) {
		return deterministicDigest("review-packet-v2", base);
	}
	return deterministicDigest("review-packet-v3", {
		...base,
		sourceManifestArtifactRef: assignment.sourceManifestArtifactRef ?? null,
		correction: assignment.correction
			? {
					...assignment.correction,
					changedRelativePaths: [...assignment.correction.changedRelativePaths],
				}
			: null,
	});
}

export function canonicalSourceDeltaDigest(input: {
	predecessorSourceDigest: string;
	currentSourceDigest: string;
	sourceChanged: boolean;
	changedRelativePaths: readonly string[];
}): string {
	return deterministicDigest("source-delta-v1", {
		predecessorSourceDigest: input.predecessorSourceDigest,
		currentSourceDigest: input.currentSourceDigest,
		sourceChanged: input.sourceChanged,
		changedRelativePaths: [...input.changedRelativePaths],
	});
}

function cloneReviewAssignmentResult(
	result: ReviewAssignmentResultInput,
): ReviewAssignmentResultInput {
	return {
		...result,
		findings: result.findings.map((finding) => ({ ...finding })),
	};
}

export function canonicalValidationCommandDigest(command: string): string {
	return deterministicDigest("validation-command-v1", command.trim());
}

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isSha256Digest(value: string): boolean {
	return SHA256_DIGEST_PATTERN.test(value);
}

function mutationDigestPayload(
	record: Omit<CausalMutationRecord, "mutationDigest">,
): unknown {
	return record;
}

function canonicalMutationDigest(
	record: Omit<CausalMutationRecord, "mutationDigest">,
): string {
	return deterministicDigest("mutation-v1", mutationDigestPayload(record));
}

export function canonicalOperationRequestDigest(
	kind: CausalMutationRecord["operationKind"],
	input: unknown,
): string {
	return deterministicDigest(`operation-request-v1:${kind}`, input);
}

function snapshotPayload(session: Session): unknown {
	return {
		version: session.version,
		id: session.id,
		goal: session.goal,
		status: session.status,
		approval: session.approval,
		plan: session.plan,
		activeFeatureId: session.activeFeatureId,
		activeFeatureRunId: session.activeFeatureRunId,
		featureRuns: session.featureRuns,
		reviewAssignments: session.reviewAssignments,
		history: session.history,
		budget: session.budget,
		closure: session.closure,
		lastError: session.lastError,
		timestamps: session.timestamps,
		evidence: session.causal.evidence,
	};
}

export function canonicalSessionSnapshotId(session: Session): SnapshotId {
	return deterministicDigest("snapshot-v1", snapshotPayload(session));
}

export function canonicalEvidenceId(evidence: EvidenceRecord): string {
	const { evidenceId: _ignored, ...identity } = evidence;
	return deterministicDigest("evidence-v1", identity);
}

export function validateCausalChain(session: Session): string | null {
	if (
		!Number.isSafeInteger(session.causal.revision) ||
		session.causal.revision < 0
	) {
		return "Causal revision must be a nonnegative safe integer.";
	}
	if (!isSha256Digest(session.causal.snapshotId)) {
		return "Current snapshot identity is not a canonical SHA-256 digest.";
	}
	if (!isSha256Digest(session.causal.genesisSnapshotId)) {
		return "Genesis snapshot identity is not a canonical SHA-256 digest.";
	}
	if (session.causal.snapshotId !== canonicalSessionSnapshotId(session)) {
		return "Current snapshot identity does not match durable session state.";
	}
	if (session.causal.mutations.length !== session.causal.revision) {
		return "Causal revision does not match the append-only mutation count.";
	}
	if (
		session.causal.mutations.length === 0 &&
		session.causal.genesisSnapshotId !== session.causal.snapshotId
	) {
		return "Genesis snapshot identity does not match the initial session snapshot.";
	}
	const operationIds = new Set<string>();
	let priorMutationDigest: string | null = null;
	let priorSnapshotId: string | null = null;
	for (const [index, mutation] of session.causal.mutations.entries()) {
		const expectedRevision = index + 1;
		if (
			mutation.priorRevision !== index ||
			mutation.revision !== expectedRevision
		) {
			return `Causal mutation ${expectedRevision} has a broken revision link.`;
		}
		if (operationIds.has(mutation.operationId)) {
			return `Causal operation '${mutation.operationId}' is duplicated.`;
		}
		if (!isSha256Digest(mutation.requestDigest)) {
			return `Causal mutation ${expectedRevision} has an invalid request digest.`;
		}
		if (
			!isSha256Digest(mutation.priorSnapshotId) ||
			!isSha256Digest(mutation.currentSnapshotId)
		) {
			return `Causal mutation ${expectedRevision} has an invalid snapshot identity.`;
		}
		operationIds.add(mutation.operationId);
		if (mutation.priorMutationDigest !== priorMutationDigest) {
			return `Causal mutation ${expectedRevision} has a broken digest link.`;
		}
		const { mutationDigest: _storedDigest, ...unsigned } = mutation;
		if (
			!isSha256Digest(mutation.mutationDigest) ||
			mutation.mutationDigest !== canonicalMutationDigest(unsigned)
		) {
			return `Causal mutation ${expectedRevision} has an invalid digest.`;
		}
		if (
			mutation.priorSnapshotId !==
			(priorSnapshotId ?? session.causal.genesisSnapshotId)
		) {
			return `Causal mutation ${expectedRevision} has a broken snapshot link.`;
		}
		priorMutationDigest = mutation.mutationDigest;
		priorSnapshotId = mutation.currentSnapshotId;
	}
	const latest = session.causal.mutations.at(-1);
	if (latest && latest.currentSnapshotId !== session.causal.snapshotId) {
		return "Latest causal mutation does not reference the current snapshot.";
	}
	return null;
}

export function stableReviewFindingFingerprint(
	finding: ReviewExecutionFindingInput,
): string {
	const payload = [
		finding.taxonomy,
		finding.subject,
		finding.requirementOrRisk,
		finding.evidenceLocator,
	]
		.map(fingerprintPayloadPart)
		.join("|");
	return `${FINDING_FINGERPRINT_VERSION}-${fnv1a64(
		payload,
		0xcbf29ce484222325n,
	)}${fnv1a64(payload, 0x84222325cbf29ce4n)}`;
}

function canonicalReviewExecution(
	input: ReviewExecutionInput,
): ReviewExecution {
	return {
		assignmentId: input.assignmentId,
		featureRunId: input.featureRunId,
		attemptId: input.attemptId,
		logicalPassId: input.logicalPassId,
		featureId: input.featureId,
		reviewKind: input.reviewKind,
		reviewSnapshotId: input.reviewSnapshotId,
		verdict: input.verdict,
		findings: input.findings.map((finding) => ({
			taxonomy: finding.taxonomy,
			subject: finding.subject,
			requirementOrRisk: finding.requirementOrRisk,
			evidenceLocator: finding.evidenceLocator,
			summary: finding.summary,
			severity: finding.severity,
			fingerprint: stableReviewFindingFingerprint(finding),
		})),
		startedAt: input.startedAt,
		completedAt: input.completedAt,
		terminalDisposition: input.terminalDisposition,
	};
}

function cloneReviewExecution(execution: ReviewExecution): ReviewExecution {
	return {
		...execution,
		findings: execution.findings.map((finding) => ({ ...finding })),
	};
}

function reviewExecutionSignature(execution: ReviewExecution): string {
	return JSON.stringify({
		assignmentId: execution.assignmentId,
		featureRunId: execution.featureRunId,
		attemptId: execution.attemptId,
		logicalPassId: execution.logicalPassId,
		featureId: execution.featureId,
		reviewKind: execution.reviewKind,
		reviewSnapshotId: execution.reviewSnapshotId,
		verdict: execution.verdict,
		findings: execution.findings.map((finding) => ({
			taxonomy: finding.taxonomy,
			subject: finding.subject,
			requirementOrRisk: finding.requirementOrRisk,
			evidenceLocator: finding.evidenceLocator,
			summary: finding.summary,
			severity: finding.severity,
			fingerprint: finding.fingerprint,
		})),
		startedAt: execution.startedAt,
		completedAt: execution.completedAt,
		terminalDisposition: execution.terminalDisposition,
	});
}

// A feature run gets one initial review attempt and one autonomous retry.
const MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE = 2;

const FINDING_FINGERPRINT_VERSION = "finding-v1";

function appendHistory(
	history: readonly ExecutionHistoryEntry[],
	entry: ExecutionHistoryEntry,
): ExecutionHistoryEntry[] {
	const next = [...history, entry];
	return next.length > MAX_HISTORY_ENTRIES
		? next.slice(next.length - MAX_HISTORY_ENTRIES)
		: next;
}

function initialBudgetTelemetry(): BudgetTelemetry {
	return {
		reviewCount: 0,
		failedReviewCount: 0,
		failedReviewAttemptsByFeatureRun: {},
		reviewExecutions: [],
		reviewLifecycle: {
			featureAttemptCount: 0,
			finalAttemptCount: 0,
			passedVerdictCount: 0,
			failedVerdictCount: 0,
			retryConsumedCount: 0,
		},
		observedReviewWorkers: {
			source: "unavailable",
			reconciliationStatus: "unreconciled",
			observedExecutionCount: null,
		},
		orchestration: {
			passCount: 0,
			workerCount: 0,
			candidatePassCount: 0,
			verifierPassCount: 0,
			candidateEligibleCount: 0,
			candidateUsedDecisionCount: 0,
			candidateSerialRequiredDecisionCount: 0,
			skippedCandidateDecisionCount: 0,
			latestPasses: [],
		},
	};
}

function cloneBudgetTelemetry(session: Session): BudgetTelemetry {
	return {
		reviewCount: session.budget.reviewCount,
		failedReviewCount: session.budget.failedReviewCount,
		failedReviewAttemptsByFeatureRun: {
			...session.budget.failedReviewAttemptsByFeatureRun,
		},
		reviewExecutions: session.budget.reviewExecutions.map(cloneReviewExecution),
		reviewLifecycle: { ...session.budget.reviewLifecycle },
		observedReviewWorkers: { ...session.budget.observedReviewWorkers },
		orchestration: {
			...session.budget.orchestration,
			latestPasses: [...session.budget.orchestration.latestPasses],
		},
	};
}

function saturatingOrchestrationTotal(
	current: number,
	increment: number,
): number {
	return increment >= Number.MAX_SAFE_INTEGER - current
		? Number.MAX_SAFE_INTEGER
		: current + increment;
}

function recordOrchestrationPasses(
	budget: BudgetTelemetry,
	passes: readonly OrchestrationPassRecord[],
): BudgetTelemetry {
	if (passes.length === 0) return budget;
	// Idempotency is intentionally bounded to the retained telemetry window.
	// Adding each accepted id to this set also deduplicates within one payload.
	const seenPassIds = new Set(
		budget.orchestration.latestPasses.map((pass) => pass.id),
	);
	const newPasses: OrchestrationPassRecord[] = [];
	for (const pass of passes) {
		if (seenPassIds.has(pass.id)) continue;
		seenPassIds.add(pass.id);
		newPasses.push(cloneOrchestrationPass(pass));
	}
	if (newPasses.length === 0) return budget;
	const tally = {
		workerCount: 0,
		candidatePassCount: 0,
		verifierPassCount: 0,
		candidateEligibleCount: 0,
		candidateUsedDecisionCount: 0,
		candidateSerialRequiredDecisionCount: 0,
		skippedCandidateDecisionCount: 0,
	};
	for (const pass of newPasses) {
		tally.workerCount = saturatingOrchestrationTotal(
			tally.workerCount,
			pass.workerCount,
		);
		if (hasCandidateExecutionEvidence(pass)) tally.candidatePassCount += 1;
		if (hasVerifierExecutionEvidence(pass)) tally.verifierPassCount += 1;
		// The schema restricts candidate accounting decisions to
		// implementation-decision records, so these are single-field checks.
		if (pass.kind !== "implementation-decision") continue;
		if (pass.candidateEligibility === "eligible") {
			tally.candidateEligibleCount += 1;
		}
		if (pass.candidateDecision === "used") {
			tally.candidateUsedDecisionCount += 1;
		}
		if (pass.candidateDecision === "serial_required") {
			tally.candidateSerialRequiredDecisionCount += 1;
		}
		if (pass.candidateDecision === "skipped") {
			tally.skippedCandidateDecisionCount += 1;
		}
	}
	let latestPasses = [...budget.orchestration.latestPasses, ...newPasses].slice(
		-MAX_ORCHESTRATION_PASSES,
	);
	while (
		latestPasses.length > 0 &&
		serializedUtf8JsonBytes(latestPasses) > MAX_ORCHESTRATION_COLLECTION_BYTES
	) {
		latestPasses = latestPasses.slice(1);
	}
	return {
		...budget,
		orchestration: {
			passCount: saturatingOrchestrationTotal(
				budget.orchestration.passCount,
				newPasses.length,
			),
			workerCount: saturatingOrchestrationTotal(
				budget.orchestration.workerCount,
				tally.workerCount,
			),
			candidatePassCount: saturatingOrchestrationTotal(
				budget.orchestration.candidatePassCount,
				tally.candidatePassCount,
			),
			verifierPassCount: saturatingOrchestrationTotal(
				budget.orchestration.verifierPassCount,
				tally.verifierPassCount,
			),
			candidateEligibleCount: saturatingOrchestrationTotal(
				budget.orchestration.candidateEligibleCount,
				tally.candidateEligibleCount,
			),
			candidateUsedDecisionCount: saturatingOrchestrationTotal(
				budget.orchestration.candidateUsedDecisionCount,
				tally.candidateUsedDecisionCount,
			),
			candidateSerialRequiredDecisionCount: saturatingOrchestrationTotal(
				budget.orchestration.candidateSerialRequiredDecisionCount,
				tally.candidateSerialRequiredDecisionCount,
			),
			skippedCandidateDecisionCount: saturatingOrchestrationTotal(
				budget.orchestration.skippedCandidateDecisionCount,
				tally.skippedCandidateDecisionCount,
			),
			latestPasses,
		},
	};
}

function sessionWithOrchestrationPasses(
	session: Session,
	passes: readonly OrchestrationPassRecord[],
): Session {
	const budget = recordOrchestrationPasses(
		cloneBudgetTelemetry(session),
		passes,
	);
	return budget === session.budget ? session : { ...session, budget };
}

function appendReviewExecutions(
	session: Session,
	inputs: readonly ReviewExecutionInput[],
): TransitionResult<{ session: Session; appendedAttemptIds: Set<string> }> {
	if (inputs.length === 0) {
		return ok({ session, appendedAttemptIds: new Set() });
	}

	const budget = cloneBudgetTelemetry(session);
	const knownAttempts = new Map(
		budget.reviewExecutions.map((execution) => [
			execution.attemptId,
			reviewExecutionSignature(execution),
		]),
	);
	const additions: ReviewExecution[] = [];
	for (const input of inputs) {
		const execution = canonicalReviewExecution(input);
		const signature = reviewExecutionSignature(execution);
		const knownSignature = knownAttempts.get(execution.attemptId);
		if (knownSignature) {
			if (knownSignature !== signature) {
				return fail(
					`Review attempt '${execution.attemptId}' was reused with conflicting evidence.`,
					"Use a new attemptId for a distinct execution; never rewrite an observed review attempt.",
					session,
				);
			}
			continue;
		}
		knownAttempts.set(execution.attemptId, signature);
		additions.push(execution);
	}

	if (additions.length === 0) {
		return ok({ session, appendedAttemptIds: new Set() });
	}

	const failedReviewAttemptsByFeatureRun = {
		...budget.failedReviewAttemptsByFeatureRun,
	};
	const reviewLifecycle = { ...budget.reviewLifecycle };
	for (const execution of additions) {
		if (execution.reviewKind === "feature") {
			reviewLifecycle.featureAttemptCount += 1;
		} else {
			reviewLifecycle.finalAttemptCount += 1;
		}
		if (execution.verdict === "passed") {
			reviewLifecycle.passedVerdictCount += 1;
		} else {
			reviewLifecycle.failedVerdictCount += 1;
			reviewLifecycle.retryConsumedCount += 1;
			failedReviewAttemptsByFeatureRun[execution.featureRunId] =
				(failedReviewAttemptsByFeatureRun[execution.featureRunId] ?? 0) + 1;
		}
	}
	const failedAdditions = additions.filter(
		(execution) => execution.verdict === "failed",
	).length;
	const nextBudget: BudgetTelemetry = {
		...budget,
		failedReviewCount: budget.failedReviewCount + failedAdditions,
		failedReviewAttemptsByFeatureRun,
		reviewExecutions: [
			...budget.reviewExecutions,
			...additions.map(cloneReviewExecution),
		],
		reviewLifecycle,
	};
	return ok({
		session: { ...session, budget: nextBudget },
		appendedAttemptIds: new Set(
			additions.map((execution) => execution.attemptId),
		),
	});
}

function evidenceSignature(evidence: EvidenceRecord): string {
	return JSON.stringify(canonicalJsonValue(evidence));
}

function cloneEvidence(evidence: EvidenceRecord): EvidenceRecord {
	return evidence.kind === "validation"
		? {
				...evidence,
				...(evidence.artifactRef
					? { artifactRef: { ...evidence.artifactRef } }
					: {}),
				environmentKeys: [...evidence.environmentKeys],
			}
		: { ...evidence };
}

function safeArtifactRef(
	reference: NonNullable<
		Extract<EvidenceRecord, { kind: "validation" }>["artifactRef"]
	>,
): boolean {
	return (
		reference.kind === "restricted_evidence_v1" &&
		isSha256Digest(reference.digest) &&
		Number.isSafeInteger(reference.byteLength) &&
		reference.byteLength >= 0
	);
}

function evidenceAppliesToActiveRun(
	session: Session,
	evidence: EvidenceRecord,
): boolean {
	return evidence.featureRunId === session.activeFeatureRunId;
}

function appendEvidenceForCompletion(
	session: Session,
	evidenceRecords: readonly EvidenceRecord[],
): TransitionResult<{
	session: Session;
	appendedEvidenceIds: Set<EvidenceId>;
}> {
	if (evidenceRecords.length === 0) {
		return ok({ session, appendedEvidenceIds: new Set() });
	}
	const knownEvidence = new Map(
		session.causal.evidence.map((evidence) => [
			evidence.evidenceId,
			evidenceSignature(evidence),
		]),
	);
	const additions: EvidenceRecord[] = [];
	for (const candidate of evidenceRecords) {
		const evidence = cloneEvidence(candidate);
		if (
			!isSha256Digest(evidence.snapshotId) ||
			!isSha256Digest(evidence.sourceDigest) ||
			(evidence.kind === "validation" &&
				!isSha256Digest(evidence.outputDigest)) ||
			(evidence.kind === "review" && !isSha256Digest(evidence.packetDigest))
		) {
			return fail(
				`Evidence '${evidence.evidenceId}' contains a non-canonical digest.`,
				"Use lowercase SHA-256 identities for snapshot, source, output, packet, and artifact references.",
				session,
			);
		}
		if (
			!Number.isFinite(Date.parse(evidence.startedAt)) ||
			!Number.isFinite(Date.parse(evidence.completedAt)) ||
			Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)
		) {
			return fail(
				`Evidence '${evidence.evidenceId}' has invalid chronology.`,
				"Record valid offset timestamps whose completion does not precede start.",
				session,
			);
		}
		if (
			evidence.kind === "validation" &&
			evidence.environmentKeys.some(
				(key) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(key),
			)
		) {
			return fail(
				`Evidence '${evidence.evidenceId}' contains unsafe environment metadata.`,
				"Record only allowlisted environment key names; never record values.",
				session,
			);
		}
		if (evidence.evidenceId !== canonicalEvidenceId(evidence)) {
			return fail(
				`Evidence '${evidence.evidenceId}' does not match its canonical digest.`,
				"Rebuild the safe evidence record from the immutable source state and retry.",
				session,
			);
		}
		if (
			evidence.featureRunId !== session.activeFeatureRunId ||
			evidence.capturedAtRevision !== session.causal.revision ||
			evidence.capturedAtSnapshotId !== session.causal.snapshotId ||
			evidence.snapshotId !== evidence.capturedAtSnapshotId
		) {
			return fail(
				`Evidence '${evidence.evidenceId}' is stale for the active feature run or capture snapshot.`,
				"Rerun validation or review against the active feature run and current source state.",
				session,
			);
		}
		if (
			evidence.kind === "validation" &&
			evidence.artifactRef !== undefined &&
			!safeArtifactRef(evidence.artifactRef)
		) {
			return fail(
				`Evidence '${evidence.evidenceId}' contains an unsafe artifact reference.`,
				"Use the digest and byte-length reference returned by the supported evidence publisher; never publish paths or raw command arguments.",
				session,
			);
		}
		const signature = evidenceSignature(evidence);
		const knownSignature = knownEvidence.get(evidence.evidenceId);
		if (knownSignature) {
			if (knownSignature !== signature) {
				return fail(
					`Evidence id '${evidence.evidenceId}' was reused with different metadata.`,
					"Use the canonical evidence id for each distinct immutable record.",
					session,
				);
			}
			continue;
		}
		knownEvidence.set(evidence.evidenceId, signature);
		additions.push(evidence);
	}
	if (additions.length === 0) {
		return ok({ session, appendedEvidenceIds: new Set() });
	}
	return ok({
		session: {
			...session,
			causal: {
				...session.causal,
				evidence: [...session.causal.evidence, ...additions.map(cloneEvidence)],
			},
		},
		appendedEvidenceIds: new Set(
			additions.map((evidence) => evidence.evidenceId),
		),
	});
}

function ok<T>(value: T): TransitionResult<T> {
	return { ok: true, value };
}

function fail<T>(
	message: string,
	recovery?: string,
	session?: Session,
): TransitionResult<T> {
	return {
		ok: false,
		message,
		...(recovery ? { recovery } : {}),
		...(session ? { session } : {}),
	};
}

function clonePlan(input: PlanInput): Plan {
	return {
		summary: input.summary,
		overview: input.overview,
		requirements: [...(input.requirements ?? [])],
		decisions: [...(input.decisions ?? [])],
		finalReviewPolicy: input.finalReviewPolicy ?? "detailed",
		features: input.features.map((feature) => ({
			id: feature.id,
			title: feature.title,
			summary: feature.summary,
			status: "pending",
			reviewDepth: feature.reviewDepth ?? "standard",
			targets: [...(feature.targets ?? [])],
			validation: [...(feature.validation ?? [])],
			dependsOn: [...(feature.dependsOn ?? [])],
		})),
	};
}

function planCardinalityFailure(plan: Plan | PlanInput): string | null {
	if (plan.features.length === 0) {
		return "Plan must contain at least one feature.";
	}
	if (plan.features.length > MAX_PLAN_FEATURES) {
		return `Plan cannot contain more than ${MAX_PLAN_FEATURES} features.`;
	}
	for (const [name, values] of [
		["requirements", plan.requirements ?? []],
		["decisions", plan.decisions ?? []],
	] as const) {
		if (values.length > MAX_PLAN_FEATURES) {
			return `Plan ${name} cannot contain more than ${MAX_PLAN_FEATURES} items.`;
		}
	}
	for (const feature of plan.features) {
		for (const [name, values] of [
			["targets", feature.targets ?? []],
			["validation commands", feature.validation ?? []],
			["dependencies", feature.dependsOn ?? []],
		] as const) {
			if (values.length > MAX_PLAN_FEATURES) {
				return `Plan feature '${feature.id}' cannot contain more than ${MAX_PLAN_FEATURES} ${name}.`;
			}
		}
	}
	return null;
}

export function validatePlan(plan: Plan): string | null {
	const cardinalityError = planCardinalityFailure(plan);
	if (cardinalityError) return cardinalityError;
	const seen = new Set<string>();
	for (const feature of plan.features) {
		if (seen.has(feature.id)) {
			return `Plan feature '${feature.id}' is duplicated.`;
		}
		seen.add(feature.id);
	}
	for (const feature of plan.features) {
		for (const dependency of feature.dependsOn) {
			if (!seen.has(dependency)) {
				return `Plan feature '${feature.id}' depends on unknown feature '${dependency}'.`;
			}
			if (dependency === feature.id) {
				return `Plan feature '${feature.id}' cannot depend on itself.`;
			}
		}
	}

	const remainingDependencies = new Map<FeatureId, number>();
	const dependents = new Map<FeatureId, FeatureId[]>();
	const ready: FeatureId[] = [];
	for (const feature of plan.features) {
		remainingDependencies.set(feature.id, feature.dependsOn.length);
		if (feature.dependsOn.length === 0) ready.push(feature.id);
		for (const dependency of feature.dependsOn) {
			const current = dependents.get(dependency) ?? [];
			current.push(feature.id);
			dependents.set(dependency, current);
		}
	}
	let visitedCount = 0;
	for (let index = 0; index < ready.length; index += 1) {
		const featureId = ready[index];
		if (!featureId) continue;
		visitedCount += 1;
		for (const dependent of dependents.get(featureId) ?? []) {
			const remaining = (remainingDependencies.get(dependent) ?? 0) - 1;
			remainingDependencies.set(dependent, remaining);
			if (remaining === 0) ready.push(dependent);
		}
	}
	return visitedCount === plan.features.length
		? null
		: "Plan feature dependencies contain a cycle.";
}

export function createSession(
	goal: string,
	environment: TransitionEnvironment,
): Session {
	const now = environment.now();
	const session: Session = {
		version: 4,
		id: environment.newSessionId(),
		goal,
		status: "planning",
		approval: "pending",
		plan: null,
		activeFeatureId: null,
		activeFeatureRunId: null,
		featureRuns: [],
		reviewAssignments: [],
		history: [],
		budget: initialBudgetTelemetry(),
		causal: {
			revision: 0,
			genesisSnapshotId: "snapshot-v1-pending",
			snapshotId: "snapshot-v1-pending",
			mutations: [],
			evidence: [],
		},
		closure: null,
		lastError: null,
		timestamps: {
			createdAt: now,
			updatedAt: now,
			completedAt: null,
		},
	};
	const snapshotId = canonicalSessionSnapshotId(session);
	return {
		...session,
		causal: {
			...session.causal,
			genesisSnapshotId: snapshotId,
			snapshotId,
		},
	};
}

type MutationDescriptor = {
	operationId?: string | undefined;
	operationKind: CausalMutationRecord["operationKind"];
	requestDigest?: string | undefined;
	featureRunId?: FeatureRunId | null | undefined;
	recordedAt?: string | undefined;
	changedEntity?: CausalMutationRecord["changedEntity"] | undefined;
	changedFields?: string[] | undefined;
	blockerDelta?: CausalMutationRecord["blockerDelta"] | undefined;
	evidenceRefs?: string[] | undefined;
};

function touch(
	session: Session,
	environment: TransitionEnvironment,
	descriptor: MutationDescriptor,
): Session {
	const recordedAt = descriptor.recordedAt ?? environment.now();
	const priorRevision = session.causal.revision;
	const revision = priorRevision + 1;
	const priorSnapshotId = session.causal.snapshotId;
	const nextWithoutMutation: Session = {
		...session,
		timestamps: { ...session.timestamps, updatedAt: recordedAt },
	};
	const currentSnapshotId = canonicalSessionSnapshotId(nextWithoutMutation);
	const operationKind = descriptor.operationKind;
	const proposedOperationId =
		descriptor.operationId ??
		environment.newOperationId?.(revision) ??
		`${session.id}:operation:${revision}`;
	const knownOperationIds = new Set(
		session.causal.mutations.map((mutation) => mutation.operationId),
	);
	let operationId = proposedOperationId;
	for (let attempt = 0; knownOperationIds.has(operationId); attempt += 1) {
		operationId = `flow-${revision}-${sha256Hex(
			`${session.id}\u0000${revision}\u0000${attempt}`,
		).slice(0, 32)}`;
	}
	const unsignedMutation: Omit<CausalMutationRecord, "mutationDigest"> = {
		operationId,
		operationKind,
		requestDigest:
			descriptor.requestDigest ??
			canonicalOperationRequestDigest(operationKind, {
				priorSnapshotId,
				changedEntity: descriptor.changedEntity,
				changedFields: descriptor.changedFields,
			}),
		featureRunId:
			descriptor.featureRunId !== undefined
				? descriptor.featureRunId
				: session.activeFeatureRunId,
		priorMutationDigest:
			session.causal.mutations.at(-1)?.mutationDigest ?? null,
		priorRevision,
		revision,
		priorSnapshotId,
		currentSnapshotId,
		changedEntity: descriptor.changedEntity ?? {
			kind: "session",
			id: session.id,
		},
		changedFields: [...(descriptor.changedFields ?? ["timestamps.updatedAt"])],
		blockerDelta: {
			added: [...(descriptor.blockerDelta?.added ?? [])],
			removed: [...(descriptor.blockerDelta?.removed ?? [])],
		},
		evidenceRefs: [...(descriptor.evidenceRefs ?? [])],
		recordedAt,
	};
	const mutation: CausalMutationRecord = {
		...unsignedMutation,
		mutationDigest: canonicalMutationDigest(unsignedMutation),
	};
	return {
		...nextWithoutMutation,
		causal: {
			...nextWithoutMutation.causal,
			revision,
			snapshotId: currentSnapshotId,
			mutations: [...nextWithoutMutation.causal.mutations, mutation],
		},
	};
}

function pendingArchiveFailure<T>(
	session: Session,
): TransitionResult<T> | null {
	if (!session.closure) return null;
	return fail(
		"This Flow session is closed and pending archival.",
		"Retry flow_session_close to finish archiving it before making another change.",
	);
}

function causalPreflight<T>(session: Session): TransitionResult<T> | null {
	const chainError = validateCausalChain(session);
	return chainError
		? fail(
				`Flow causal state is invalid: ${chainError}`,
				"Preserve the session and use the existing quarantine/recovery path; do not rewrite causal history.",
			)
		: null;
}

function operationReplay(
	session: Session,
	operationId: string | undefined,
	operationKind: CausalMutationRecord["operationKind"],
	requestDigest: string,
): TransitionResult<"new" | "replay"> {
	if (!operationId) return ok("new");
	const existing = session.causal.mutations.find(
		(mutation) => mutation.operationId === operationId,
	);
	if (!existing) return ok("new");
	if (
		existing.operationKind === operationKind &&
		existing.requestDigest === requestDigest
	) {
		return ok("replay");
	}
	return fail(
		`Operation id '${operationId}' was already used for a different request.`,
		"Use the original receipt for an exact replay or generate a new operationId for new work.",
		session,
	);
}

export function applyPlan(
	session: Session,
	planInput: PlanInput,
	environment: TransitionEnvironment,
): TransitionResult<Session> {
	const preflight = causalPreflight<Session>(session);
	if (preflight) return preflight;
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	if (session.approval === "approved" || session.status !== "planning") {
		return fail(
			"Approved plans cannot be changed. Reset or start a new session.",
		);
	}
	const cardinalityError = planCardinalityFailure(planInput);
	if (cardinalityError) return fail(cardinalityError);
	const plan = clonePlan(planInput);
	const planError = validatePlan(plan);
	if (planError) return fail(planError);
	const projectionBudgetError = planProjectionBudgetFailure(session.goal, plan);
	if (projectionBudgetError) {
		return fail(
			projectionBudgetError,
			"Shorten the goal, plan context, feature ids, or assigned target references and save the complete plan again.",
		);
	}
	const requestDigest = canonicalOperationRequestDigest("plan_save", plan);
	return ok(
		touch(
			{
				...session,
				status: "planning",
				approval: "pending",
				plan,
				activeFeatureId: null,
				activeFeatureRunId: null,
				featureRuns: [],
				reviewAssignments: [],
				history: [],
				budget: initialBudgetTelemetry(),
				closure: null,
				lastError: null,
				timestamps: { ...session.timestamps, completedAt: null },
			},
			environment,
			{
				operationKind: "plan_save",
				requestDigest,
				changedEntity: { kind: "plan", id: session.id },
				changedFields: ["plan", "approval", "status", "budget"],
			},
		),
	);
}

export function approvePlan(
	session: Session,
	environment: TransitionEnvironment,
): TransitionResult<Session> {
	const preflight = causalPreflight<Session>(session);
	if (preflight) return preflight;
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	if (!session.plan) return fail("There is no draft plan to approve.");
	if (session.approval === "approved" && session.status === "ready") {
		return ok(session);
	}
	if (session.status !== "planning") {
		return fail("Only planning sessions can be approved.");
	}
	return ok(
		touch({ ...session, approval: "approved", status: "ready" }, environment, {
			operationKind: "plan_approve",
			requestDigest: canonicalOperationRequestDigest("plan_approve", {
				approval: "approved",
			}),
			changedEntity: { kind: "plan", id: session.id },
			changedFields: ["approval", "status"],
		}),
	);
}

function featureIsRunnable(
	feature: Feature,
	completed: Set<FeatureId>,
): boolean {
	return (
		feature.status === "pending" &&
		feature.dependsOn.every((dependency) => completed.has(dependency))
	);
}

function nextRunnableFeature(
	features: Feature[],
	requestedId?: FeatureId,
): TransitionResult<Feature> {
	const completed = new Set(
		features
			.filter((feature) => feature.status === "completed")
			.map((feature) => feature.id),
	);
	const byId = new Map(features.map((feature) => [feature.id, feature]));
	if (requestedId) {
		const feature = byId.get(requestedId);
		if (!feature) return fail(`Feature '${requestedId}' is not in the plan.`);
		if (feature.status === "completed") {
			return fail(`Feature '${requestedId}' is already completed.`);
		}
		if (feature.status !== "pending") {
			return fail(
				`Feature '${requestedId}' is ${feature.status} and must be reset before it can run.`,
			);
		}
		if (!featureIsRunnable(feature, completed)) {
			return fail(`Feature '${requestedId}' has incomplete dependencies.`);
		}
		return ok(feature);
	}

	const feature = features.find((item) => featureIsRunnable(item, completed));
	return feature ? ok(feature) : fail("No runnable feature is available.");
}

function updateFeature(
	features: Feature[],
	featureId: FeatureId,
	status: Feature["status"],
): Feature[] {
	return features.map((feature) =>
		feature.id === featureId
			? { ...feature, status }
			: feature.status === "in_progress" && status === "in_progress"
				? { ...feature, status: "pending" }
				: feature,
	);
}

function closeFeatureRun(
	runs: readonly FeatureRun[],
	featureRunId: FeatureRunId | null,
	status: Exclude<FeatureRun["status"], "active">,
	endedAt: string,
): FeatureRun[] {
	if (!featureRunId) return [...runs];
	return runs.map((run) =>
		run.id === featureRunId && run.status === "active"
			? { ...run, status, endedAt }
			: run,
	);
}

function runtimeId(
	session: Session,
	environment: TransitionEnvironment,
	kind: "feature-run" | "review-assignment",
	identity: unknown,
): string {
	return (
		environment.newRuntimeId?.(kind) ??
		`${kind}:${deterministicDigest(`${kind}-v1`, {
			sessionId: session.id,
			identity,
		}).slice("sha256:".length, "sha256:".length + 32)}`
	);
}

export function startRun(
	session: Session,
	environment: TransitionEnvironment,
	featureId?: FeatureId,
): TransitionResult<{ session: Session; feature: Feature }> {
	const preflight = causalPreflight<{ session: Session; feature: Feature }>(
		session,
	);
	if (preflight) return preflight;
	const pendingArchive = pendingArchiveFailure<{
		session: Session;
		feature: Feature;
	}>(session);
	if (pendingArchive) return pendingArchive;
	if (session.status === "completed") {
		return fail("This Flow session is already completed.");
	}
	if (!session.plan || session.approval !== "approved") {
		return fail("There is no approved plan to run.");
	}
	if (session.status === "blocked") {
		return fail(
			"Blocked features must be reset before rerun.",
			"Call flow_feature_reset for the blocked feature, then start it again.",
		);
	}
	const budget = cloneBudgetTelemetry(session);
	if (session.activeFeatureId) {
		if (!session.activeFeatureRunId) {
			return fail(
				"The active feature predates native feature-run identity.",
				"Reset the active feature before resuming so Flow can start a native execution epoch.",
			);
		}
		if (!featureId || featureId === session.activeFeatureId) {
			const active = session.plan.features.find(
				(feature) => feature.id === session.activeFeatureId,
			);
			if (active) return ok({ session, feature: active });
		}
		return fail(`Feature '${session.activeFeatureId}' is already in progress.`);
	}

	const selected = nextRunnableFeature(session.plan.features, featureId);
	if (!selected.ok) return selected;
	const nextPlan = {
		...session.plan,
		features: updateFeature(
			session.plan.features,
			selected.value.id,
			"in_progress",
		),
	};
	const sequence =
		session.featureRuns.filter((run) => run.featureId === selected.value.id)
			.length + 1;
	const featureRunId = runtimeId(session, environment, "feature-run", {
		featureId: selected.value.id,
		sequence,
	}) as FeatureRunId;
	const acceptedAt = environment.now();
	const featureRun: FeatureRun = {
		id: featureRunId,
		featureId: selected.value.id,
		sequence,
		status: "active",
		startedAt: acceptedAt,
		endedAt: null,
	};
	const next = touch(
		{
			...session,
			status: "running",
			plan: nextPlan,
			budget,
			activeFeatureId: selected.value.id,
			activeFeatureRunId: featureRunId,
			featureRuns: [...session.featureRuns, featureRun],
			lastError: null,
		},
		environment,
		{
			operationKind: "run_start",
			recordedAt: acceptedAt,
			requestDigest: canonicalOperationRequestDigest("run_start", {
				featureId: selected.value.id,
			}),
			changedEntity: { kind: "feature", id: selected.value.id },
			changedFields: [
				"status",
				"activeFeatureId",
				"activeFeatureRunId",
				"featureRuns",
			],
		},
	);
	return ok({
		session: next,
		feature:
			next.plan?.features.find((feature) => feature.id === selected.value.id) ??
			selected.value,
	});
}

type ReviewCorrectionPreflight = {
	assignment: ReviewAssignment;
	execution: ReviewExecution;
};

/**
 * Resolve a correction predecessor from durable state before any filesystem
 * measurement or artifact read. The caller may name only the immediately
 * preceding recorded failure in the active logical pass.
 */
export function preflightReviewCorrection(
	session: Session,
	input: {
		featureId: FeatureId;
		reviewKind: ReviewAssignment["reviewKind"];
		correctionOfAssignmentId?: ReviewAssignmentId | undefined;
	},
): TransitionResult<ReviewCorrectionPreflight | null> {
	if (!input.correctionOfAssignmentId) return ok(null);
	if (
		!session.activeFeatureRunId ||
		session.activeFeatureId !== input.featureId
	) {
		return fail(
			"Correction review requires the active native feature run.",
			"Reload compact status and use a failed assignment from the active run.",
			session,
		);
	}
	const logicalPassId = canonicalLogicalReviewPassId(
		session.activeFeatureRunId,
		input.reviewKind,
	);
	const pending = session.reviewAssignments.find(
		(assignment) =>
			assignment.featureRunId === session.activeFeatureRunId &&
			assignment.reviewKind === input.reviewKind &&
			assignment.status === "pending",
	);
	if (pending) {
		return fail(
			`Review assignment '${pending.id}' is still pending.`,
			"Record its terminal result before starting correction work.",
			session,
		);
	}
	const terminal = session.reviewAssignments.flatMap((assignment) => {
		if (
			assignment.featureRunId !== session.activeFeatureRunId ||
			assignment.featureId !== input.featureId ||
			assignment.reviewKind !== input.reviewKind ||
			assignment.logicalPassId !== logicalPassId ||
			(assignment.status !== "submitted" &&
				assignment.status !== "observed_unsubmitted")
		) {
			return [];
		}
		const execution = session.budget.reviewExecutions.find(
			(candidate) => candidate.assignmentId === assignment.id,
		);
		return execution ? [{ assignment, execution }] : [];
	});
	const predecessor = terminal.at(-1);
	if (
		!predecessor ||
		predecessor.assignment.id !== input.correctionOfAssignmentId ||
		predecessor.execution.verdict !== "failed"
	) {
		return fail(
			`Review assignment '${input.correctionOfAssignmentId}' is not the latest recorded failure for this logical pass.`,
			"Reload detail status and use the immediately preceding failed assignment exactly.",
			session,
		);
	}
	const reviewEvidence = session.causal.evidence.filter(
		(evidence) =>
			evidence.kind === "review" &&
			evidence.assignmentId === predecessor.assignment.id &&
			evidence.featureRunId === predecessor.assignment.featureRunId &&
			evidence.packetDigest === predecessor.assignment.packetDigest,
	);
	if (
		predecessor.assignment.completedAt !== predecessor.execution.completedAt ||
		predecessor.execution.findings.every(
			(finding) => finding.severity !== "blocking",
		) ||
		reviewEvidence.length !== 1 ||
		!session.causal.mutations.some(
			(mutation) =>
				mutation.operationKind === "feature_complete" &&
				mutation.featureRunId === predecessor.assignment.featureRunId &&
				mutation.evidenceRefs.includes(reviewEvidence[0]?.evidenceId ?? ""),
		)
	) {
		return fail(
			`Review assignment '${predecessor.assignment.id}' does not have one durable failed result.`,
			"Preserve the session and repair review evidence before starting a correction.",
			session,
		);
	}
	const failedAttempts =
		session.budget.failedReviewAttemptsByFeatureRun[
			session.activeFeatureRunId
		] ?? 0;
	if (failedAttempts >= MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE) {
		return fail(
			"The review retry budget is exhausted for this feature run.",
			"Keep the two-failure terminal result; reset or replan only after explicit user direction.",
			session,
		);
	}
	return ok(predecessor);
}

function validationEvidenceSignature(
	evidence: Extract<EvidenceRecord, { kind: "validation" }>,
): string {
	return JSON.stringify(
		canonicalJsonValue({
			commandDigest: evidence.commandDigest,
			commandClass: evidence.commandClass,
			startedAt: evidence.startedAt,
			completedAt: evidence.completedAt,
			exitCode: evidence.exitCode,
			outputDigest: evidence.outputDigest,
			artifactRef: evidence.artifactRef ?? null,
			environmentKeys: evidence.environmentKeys,
		}),
	);
}

function hasDistinctValidationEvidence(
	session: Session,
	predecessor: ReviewAssignment,
	current: readonly Extract<EvidenceRecord, { kind: "validation" }>[],
): boolean {
	const prior = new Set(
		predecessor.validationEvidenceRefs.flatMap((reference) => {
			const evidence = session.causal.evidence.find(
				(candidate) => candidate.evidenceId === reference,
			);
			return evidence?.kind === "validation"
				? [validationEvidenceSignature(evidence)]
				: [];
		}),
	);
	return current.some(
		(evidence) => !prior.has(validationEvidenceSignature(evidence)),
	);
}

function safeCorrectionPath(path: string): boolean {
	if (
		path.length === 0 ||
		path.includes("\\") ||
		path.includes("\u0000") ||
		path.startsWith("/") ||
		/^[A-Za-z]:/.test(path) ||
		utf8ByteLength(path) > MAX_CORRECTION_PATH_BYTES
	) {
		return false;
	}
	return path
		.split("/")
		.every(
			(segment) => segment.length > 0 && segment !== "." && segment !== "..",
		);
}

function compareUtf8(left: string, right: string): number {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.min(leftBytes.length, rightBytes.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return leftBytes.length - rightBytes.length;
}

function validateCorrectionBinding(
	session: Session,
	input: ReviewStartInput,
	preflight: ReviewCorrectionPreflight | null,
): TransitionResult<true> {
	if (!input.correctionOfAssignmentId) {
		return input.correction === undefined
			? ok(true)
			: fail(
					"Runtime correction metadata cannot exist without a requested predecessor.",
					undefined,
					session,
				);
	}
	if (!preflight || !input.correction) {
		return fail(
			"Correction review is missing runtime-derived source context.",
			"Retry flow_review_start so Flow can derive the source delta transactionally.",
			session,
		);
	}
	const correction = input.correction;
	const sourceChanged =
		preflight.assignment.sourceDigest !== input.sourceDigest;
	if (
		correction.predecessorAssignmentId !== input.correctionOfAssignmentId ||
		correction.sourceChanged !== sourceChanged ||
		correction.changedRelativePaths.length > MAX_CORRECTION_CHANGED_PATHS ||
		new Set(correction.changedRelativePaths).size !==
			correction.changedRelativePaths.length ||
		correction.changedRelativePaths.some((path) => !safeCorrectionPath(path)) ||
		correction.changedRelativePaths.some(
			(path, index, paths) =>
				index > 0 && compareUtf8(paths[index - 1] ?? "", path) >= 0,
		) ||
		(!sourceChanged && correction.changedRelativePaths.length > 0) ||
		!isSha256Digest(correction.sourceDeltaDigest) ||
		((correction.contextCompleteness === "complete" ||
			correction.fallbackReason === "projection_context_too_large") &&
			correction.sourceDeltaDigest !==
				canonicalSourceDeltaDigest({
					predecessorSourceDigest: preflight.assignment.sourceDigest,
					currentSourceDigest: input.sourceDigest,
					sourceChanged,
					changedRelativePaths: correction.changedRelativePaths,
				}))
	) {
		return fail(
			"Correction review source context is inconsistent or unsafe.",
			"Retry flow_review_start and use only runtime-derived correction metadata.",
			session,
		);
	}
	if (
		(correction.reviewMode === "correction" &&
			(correction.contextCompleteness !== "complete" ||
				correction.fallbackReason !== null)) ||
		(correction.reviewMode === "full" && correction.fallbackReason === null)
	) {
		return fail(
			"Correction review mode disagrees with its completeness or fallback reason.",
			undefined,
			session,
		);
	}
	if (!sourceChanged) {
		const blocking = preflight.execution.findings.filter(
			(finding) => finding.severity === "blocking",
		);
		if (blocking.some((finding) => finding.taxonomy !== "evidence_gap")) {
			return fail(
				"Implementation correction requires a changed source state.",
				"Change the implementation, rerun validation, and start correction review again.",
				session,
			);
		}
		if (
			!hasDistinctValidationEvidence(
				session,
				preflight.assignment,
				input.validationEvidence,
			)
		) {
			return fail(
				"Same-source evidence correction requires genuinely distinct validation evidence.",
				"Run a new applicable validation or change the source before retrying.",
				session,
			);
		}
	}
	return ok(true);
}

export function startReviewAssignment(
	session: Session,
	input: ReviewStartInput,
	environment: TransitionEnvironment,
): TransitionResult<{ session: Session; assignment: ReviewAssignment }> {
	const requestDigest = input.requestDigest;
	const checkedGuard = causalMutationGuard(
		session,
		input,
		"Review assignment",
		"review_start",
		requestDigest,
	);
	if (!checkedGuard.ok) return checkedGuard;
	if (checkedGuard.value === "replay") {
		const assignment = session.reviewAssignments.find(
			(candidate) => candidate.operationId === input.operationId,
		);
		return assignment
			? ok({ session, assignment })
			: fail(
					`Review assignment operation '${input.operationId}' has no durable assignment.`,
					"Preserve the session and use causal recovery; do not recreate the assignment identity.",
					session,
				);
	}
	if (
		!session.plan ||
		session.status !== "running" ||
		session.activeFeatureId !== input.featureId
	) {
		return fail("Review assignment requires the active in-progress feature.");
	}
	if (!session.activeFeatureRunId) {
		return fail(
			"Review assignment requires native feature-run identity.",
			"Reset and restart the active feature to establish a valid feature run.",
		);
	}
	const activeRun = session.featureRuns.find(
		(run) => run.id === session.activeFeatureRunId && run.status === "active",
	);
	if (!activeRun) {
		return fail(
			"Review assignment requires one coherent active feature run.",
			"Preserve the session and repair invalid Session v4 state before retrying.",
			session,
		);
	}
	const correctionPreflight = preflightReviewCorrection(session, input);
	if (!correctionPreflight.ok) return correctionPreflight;
	const acceptedAt = environment.now();
	const feature = session.plan.features.find(
		(candidate) => candidate.id === input.featureId,
	);
	if (!feature) return fail(`Feature '${input.featureId}' is not in the plan.`);
	if (input.reviewKind === "final" && !finalFeature(session, feature.id)) {
		return fail(
			`Feature '${feature.id}' is not eligible for final review.`,
			"Complete every other approved feature before starting final review.",
		);
	}
	const requiredScope = input.reviewKind === "final" ? "broad" : "targeted";
	if (input.validationScope !== requiredScope) {
		return fail(
			`${input.reviewKind === "final" ? "Final" : "Feature"} review requires ${requiredScope} validation.`,
			`Record validationScope: ${requiredScope} for this assignment.`,
		);
	}
	if (input.validationEvidence.length === 0) {
		return fail(
			"Review assignment requires source-bound validation observations.",
			"Run the required validation and include at least one passing observation.",
		);
	}
	if (
		new Set(input.validationEvidence.map((evidence) => evidence.evidenceId))
			.size !== input.validationEvidence.length
	) {
		return fail(
			"Review assignment validation evidence ids must be unique.",
			"Submit each canonical validation observation exactly once.",
			session,
		);
	}
	if (
		input.validationEvidence.some(
			(evidence) =>
				evidence.featureRunId !== session.activeFeatureRunId ||
				evidence.sourceDigest !== input.sourceDigest ||
				evidence.exitCode !== 0 ||
				!evidence.commandDigest ||
				Date.parse(evidence.startedAt) < Date.parse(activeRun.startedAt) ||
				Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt) ||
				Date.parse(evidence.completedAt) > Date.parse(acceptedAt),
		)
	) {
		return fail(
			"Review assignment validation is failed, stale, future-dated, out of order, or missing command identity.",
			"Submit passing observations captured within the active feature run and no later than runtime acceptance.",
		);
	}
	const correctionBinding = validateCorrectionBinding(
		session,
		input,
		correctionPreflight.value,
	);
	if (!correctionBinding.ok) return correctionBinding;
	if (
		input.sourceManifestArtifactRef !== undefined &&
		!safeArtifactRef(input.sourceManifestArtifactRef)
	) {
		return fail(
			"Review assignment contains an unsafe source-manifest artifact reference.",
			"Retry so Flow can publish the canonical restricted source manifest.",
			session,
		);
	}
	if (input.reviewKind === "feature" && input.featureReview) {
		return fail(
			"Feature review assignment cannot declare a feature-review prerequisite.",
			"Remove featureReview; only final review is sequenced after a passing feature review.",
			session,
		);
	}
	const startedAt = acceptedAt;
	let prerequisite: ReviewAssignment["prerequisite"] = null;
	if (input.reviewKind === "final") {
		if (!input.featureReview) {
			return fail(
				"Final review assignment requires the passing feature-review result.",
				"Complete feature review, then bind its exact result when starting final review.",
				session,
			);
		}
		const resolvedPrerequisite = resolveAssignmentResult(
			session,
			input.featureReview,
			input.sourceDigest,
			acceptedAt,
		);
		if (!resolvedPrerequisite.ok) return resolvedPrerequisite;
		if (
			resolvedPrerequisite.value.assignment.reviewKind !== "feature" ||
			resolvedPrerequisite.value.execution.verdict !== "passed" ||
			resolvedPrerequisite.value.execution.terminalDisposition !== "submitted"
		) {
			return fail(
				"Final review assignment requires one submitted passing feature-review result.",
				"Use the exact passing result returned for the active feature assignment.",
				session,
			);
		}
		if (
			Date.parse(resolvedPrerequisite.value.execution.completedAt) >
			Date.parse(startedAt)
		) {
			return fail(
				"Final review cannot start before feature review has completed.",
				"Use the reviewer-reported completion time and start final review afterward.",
				session,
			);
		}
		if (
			input.validationEvidence.some(
				(evidence) =>
					Date.parse(evidence.startedAt) <
					Date.parse(resolvedPrerequisite.value.execution.completedAt),
			)
		) {
			return fail(
				"Final review broad validation started before feature review completed.",
				"Complete feature review first, then run broad validation and start final review.",
				session,
			);
		}
		const proposedResultDigest = canonicalReviewAssignmentResultDigest(
			input.featureReview,
		);
		const durableRetryBinding = session.reviewAssignments.find(
			(assignment) =>
				assignment.featureRunId === session.activeFeatureRunId &&
				assignment.reviewKind === "final" &&
				assignment.sourceDigest === input.sourceDigest &&
				assignment.prerequisite?.assignmentId ===
					resolvedPrerequisite.value.assignment.id &&
				assignment.prerequisite !== null,
		)?.prerequisite;
		if (
			durableRetryBinding &&
			(durableRetryBinding.assignmentId !==
				resolvedPrerequisite.value.assignment.id ||
				durableRetryBinding.resultDigest !== proposedResultDigest)
		) {
			return fail(
				"Final review retry must reuse the exact durable feature-review prerequisite.",
				'Reload flow_status { request: { view: "detail" } } and copy workflowData.projection.finalReviewRetry.prerequisite.result unchanged.',
				session,
			);
		}
		prerequisite = durableRetryBinding
			? {
					assignmentId: durableRetryBinding.assignmentId,
					result: cloneReviewAssignmentResult(durableRetryBinding.result),
					resultDigest: durableRetryBinding.resultDigest,
				}
			: {
					assignmentId: resolvedPrerequisite.value.assignment.id,
					result: cloneReviewAssignmentResult(input.featureReview),
					resultDigest: proposedResultDigest,
				};
	}
	const pending = session.reviewAssignments.find(
		(assignment) =>
			assignment.featureRunId === session.activeFeatureRunId &&
			assignment.reviewKind === input.reviewKind &&
			assignment.status === "pending",
	);
	if (pending && pending.sourceDigest === input.sourceDigest) {
		return fail(
			`Review assignment '${pending.id}' is still pending.`,
			'Recover it with flow_status { request: { view: "reviewer", assignmentId } } or submit its terminal result.',
		);
	}
	const reviewAssignments = session.reviewAssignments.map((assignment) =>
		assignment === pending
			? {
					...assignment,
					status: "invalidated" as const,
					completedAt: null,
					invalidatedAt: startedAt,
					invalidationReason: "source_changed" as const,
				}
			: assignment,
	);
	const mergedEvidence = appendEvidenceForCompletion(
		session,
		input.validationEvidence,
	);
	if (!mergedEvidence.ok) return mergedEvidence;
	const validationEvidenceRefs = input.validationEvidence.map(
		(evidence) => evidence.evidenceId,
	);
	const samePassAssignments = session.reviewAssignments.filter(
		(assignment) =>
			assignment.featureRunId === session.activeFeatureRunId &&
			assignment.reviewKind === input.reviewKind,
	);
	const logicalPassId = canonicalLogicalReviewPassId(
		session.activeFeatureRunId,
		input.reviewKind,
	);
	const assignmentId = runtimeId(session, environment, "review-assignment", {
		featureRunId: session.activeFeatureRunId,
		reviewKind: input.reviewKind,
		attempt: samePassAssignments.length + 1,
	}) as ReviewAssignmentId;
	const packetIdentity = {
		featureRunId: session.activeFeatureRunId,
		featureId: input.featureId,
		reviewKind: input.reviewKind,
		validationScope: input.validationScope,
		validationEvidenceRefs,
		sourceDigest: input.sourceDigest,
		packetSummary: input.packetSummary,
		riskLenses: input.riskLenses,
		prerequisite,
		...(input.sourceManifestArtifactRef
			? { sourceManifestArtifactRef: input.sourceManifestArtifactRef }
			: {}),
		...(input.correction ? { correction: input.correction } : {}),
	};
	let assignment: ReviewAssignment = {
		id: assignmentId,
		operationId: input.operationId,
		featureRunId: session.activeFeatureRunId,
		featureId: input.featureId,
		reviewKind: input.reviewKind,
		validationScope: input.validationScope,
		validationEvidenceRefs,
		sourceDigest: input.sourceDigest,
		packetDigest: canonicalReviewPacketDigest(packetIdentity),
		packetSummary: input.packetSummary,
		riskLenses: [...input.riskLenses],
		prerequisite,
		...(input.sourceManifestArtifactRef
			? { sourceManifestArtifactRef: { ...input.sourceManifestArtifactRef } }
			: {}),
		...(input.correction
			? {
					correction: {
						...input.correction,
						changedRelativePaths: [...input.correction.changedRelativePaths],
					},
				}
			: {}),
		attemptId: canonicalReviewAttemptId(assignmentId),
		logicalPassId,
		startedAt,
		requiredDepth:
			input.reviewKind === "final"
				? session.plan.finalReviewPolicy
				: feature.reviewDepth,
		status: "pending",
		completedAt: null,
		invalidatedAt: null,
		invalidationReason: null,
	};
	let provisional: Session = {
		...mergedEvidence.value.session,
		reviewAssignments: [...reviewAssignments, assignment],
	};
	let projection = reviewerSessionProjection(provisional, {
		assignmentId: assignment.id,
	});
	if (
		input.correction &&
		(!projection.ok ||
			serializedUtf8JsonBytes(projection.value) > MAX_REVIEWER_PROJECTION_BYTES)
	) {
		const correction: ReviewCorrectionBinding = {
			...input.correction,
			reviewMode: "full",
			contextCompleteness: "fallback",
			fallbackReason: "projection_context_too_large",
		};
		assignment = {
			...assignment,
			correction,
			packetDigest: canonicalReviewPacketDigest({
				...packetIdentity,
				correction,
			}),
		};
		provisional = {
			...mergedEvidence.value.session,
			reviewAssignments: [...reviewAssignments, assignment],
		};
		projection = reviewerSessionProjection(provisional, {
			assignmentId: assignment.id,
		});
	}
	const next = touch(provisional, environment, {
		operationId: input.operationId,
		operationKind: "review_start",
		requestDigest,
		recordedAt: acceptedAt,
		changedEntity: { kind: "review", id: assignment.id },
		changedFields: ["causal.evidence", "reviewAssignments"],
		evidenceRefs: validationEvidenceRefs,
	});
	projection = reviewerSessionProjection(next, {
		assignmentId: assignment.id,
	});
	if (
		!projection.ok ||
		serializedUtf8JsonBytes(projection.value) > MAX_REVIEWER_PROJECTION_BYTES
	) {
		return fail(
			`Reviewer assignment exceeds the ${MAX_REVIEWER_PROJECTION_BYTES}-byte projection limit.`,
			"Shorten the packet summary or risk lenses and retry with the same operation id; if a minimal packet still fails, preserve the session for invalid-plan recovery.",
			session,
		);
	}
	return ok({ session: next, assignment });
}

function reviewExecutionFromAssignment(
	assignment: ReviewAssignment,
	result: ReviewAssignmentResultInput,
): ReviewExecutionInput {
	return {
		assignmentId: assignment.id,
		featureRunId: assignment.featureRunId,
		attemptId: assignment.attemptId,
		logicalPassId: assignment.logicalPassId,
		featureId: assignment.featureId,
		reviewKind: assignment.reviewKind,
		reviewSnapshotId: assignment.packetDigest,
		verdict: result.verdict,
		findings: result.findings.map((finding) => ({ ...finding })),
		startedAt: assignment.startedAt,
		completedAt: result.completedAt,
		terminalDisposition: result.terminalDisposition,
	};
}

function assignmentReviewEvidence(
	session: Session,
	assignment: ReviewAssignment,
	result: ReviewAssignmentResultInput,
): Extract<EvidenceRecord, { kind: "review" }> {
	const provisional: Extract<EvidenceRecord, { kind: "review" }> = {
		kind: "review",
		evidenceId: "",
		featureRunId: assignment.featureRunId,
		assignmentId: assignment.id,
		capturedAtRevision: session.causal.revision,
		capturedAtSnapshotId: session.causal.snapshotId,
		snapshotId: session.causal.snapshotId,
		sourceDigest: assignment.sourceDigest,
		attemptId: assignment.attemptId,
		packetDigest: assignment.packetDigest,
		startedAt: assignment.startedAt,
		completedAt: result.completedAt,
	};
	return { ...provisional, evidenceId: canonicalEvidenceId(provisional) };
}

function assignmentFailure(
	message: string,
	recovery: string,
	session: Session,
): TransitionResult<never> {
	return fail(message, recovery, session);
}

type AssignmentResultObservation = {
	assignment: ReviewAssignment;
	execution: ReviewExecutionInput;
};

function resolveAssignmentResultIdentity(
	session: Session,
	result: ReviewAssignmentResultInput,
	acceptedAt?: string,
): TransitionResult<AssignmentResultObservation> {
	const assignment = session.reviewAssignments.find(
		(candidate) => candidate.id === result.assignmentId,
	);
	if (!assignment) {
		return assignmentFailure(
			`Review assignment '${result.assignmentId}' was not found.`,
			"Use the exact assignmentId returned by flow_review_start.",
			session,
		);
	}
	if (assignment.status !== "pending") {
		return assignmentFailure(
			`Review assignment '${assignment.id}' already has a terminal result.`,
			"Replay the original completion operation or start a new review assignment for a retry.",
			session,
		);
	}
	if (
		assignment.featureRunId !== session.activeFeatureRunId ||
		assignment.featureId !== session.activeFeatureId
	) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' belongs to a historical feature run.`,
			"Start a new assignment for the active feature run.",
			session,
		);
	}
	if (Date.parse(result.completedAt) < Date.parse(assignment.startedAt)) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' has invalid completion chronology.`,
			"Submit a completion time that does not precede the runtime-owned assignment start.",
			session,
		);
	}
	if (
		acceptedAt !== undefined &&
		Date.parse(result.completedAt) > Date.parse(acceptedAt)
	) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' has a completion time later than runtime acceptance.`,
			"Submit an actor-reported completion time no later than the accepting Flow mutation.",
			session,
		);
	}
	const hasBlockingFinding = result.findings.some(
		(finding) => finding.severity === "blocking",
	);
	if (
		(result.verdict === "failed" && !hasBlockingFinding) ||
		(result.verdict === "passed" && hasBlockingFinding) ||
		(result.terminalDisposition === "observed_unsubmitted" &&
			result.verdict !== "failed")
	) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' has an inconsistent verdict, findings, or disposition.`,
			"A failure needs a blocking finding; a pass cannot retain one; unsubmitted work must fail closed.",
			session,
		);
	}
	return ok({
		assignment,
		execution: reviewExecutionFromAssignment(assignment, result),
	});
}

function resolveAssignmentResult(
	session: Session,
	result: ReviewAssignmentResultInput,
	sourceDigest: string,
	acceptedAt?: string,
): TransitionResult<AssignmentResultObservation> {
	const identified = resolveAssignmentResultIdentity(
		session,
		result,
		acceptedAt,
	);
	if (!identified.ok) return identified;
	const { assignment } = identified.value;
	if (assignment.sourceDigest !== sourceDigest) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' is stale for the current source state.`,
			"Rerun validation and start a new review assignment after the last source change.",
			session,
		);
	}
	const validationEvidence = assignment.validationEvidenceRefs.map(
		(reference) =>
			session.causal.evidence.find(
				(evidence) => evidence.evidenceId === reference,
			),
	);
	if (
		validationEvidence.some((evidence) => {
			if (!evidence) return true;
			return (
				evidence.kind !== "validation" ||
				!evidenceAppliesToActiveRun(session, evidence) ||
				evidence.sourceDigest !== sourceDigest ||
				evidence.exitCode !== 0
			);
		})
	) {
		return assignmentFailure(
			`Review assignment '${assignment.id}' has missing, failed, or stale validation evidence.`,
			"Rerun validation and create a new assignment for the current source state.",
			session,
		);
	}
	return identified;
}

function completionResultInputs(
	session: Session,
	input: AssignedFeatureCompletionPreflightInput,
): TransitionResult<ReviewAssignmentResultInput[]> {
	const result = input.result;
	if (result.kind === "blocked") {
		const failedAssignment = session.reviewAssignments.find(
			(assignment) => assignment.id === result.review.assignmentId,
		);
		const failedAttempts = session.activeFeatureRunId
			? (session.budget.failedReviewAttemptsByFeatureRun[
					session.activeFeatureRunId
				] ?? 0)
			: 0;
		if (
			failedAssignment?.reviewKind === "final" &&
			failedAssignment.prerequisite &&
			failedAttempts + 1 >= MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE
		) {
			return ok([
				cloneReviewAssignmentResult(failedAssignment.prerequisite.result),
				result.review,
			]);
		}
		return ok([result.review]);
	}
	if (result.validationScope === "targeted") {
		return ok([result.featureReview]);
	}
	const finalAssignment = session.reviewAssignments.find(
		(assignment) => assignment.id === result.finalReview.assignmentId,
	);
	if (
		finalAssignment?.reviewKind !== "final" ||
		!finalAssignment.prerequisite
	) {
		return fail(
			"Final completion requires a final assignment with a durable feature-review prerequisite.",
			"Recover the pending final assignment and submit only its final-assignment result.",
			session,
		);
	}
	return ok([
		cloneReviewAssignmentResult(finalAssignment.prerequisite.result),
		result.finalReview,
	]);
}

function validateCompletionResultSemantics(
	session: Session,
	input: AssignedFeatureCompletionPreflightInput,
	observations: AssignmentResultObservation[],
): TransitionResult<true> {
	if (
		observations.some((item) => item.assignment.featureId !== input.featureId)
	) {
		return fail(
			"Review assignments do not match the active feature.",
			undefined,
			session,
		);
	}
	if (input.result.kind === "completed") {
		const featureObservation = observations[0];
		if (
			featureObservation?.assignment.reviewKind !== "feature" ||
			featureObservation?.execution.verdict !== "passed"
		) {
			return fail(
				"Completed results require one passing feature-review assignment.",
				"Submit the passing result from the feature assignment returned by flow_review_start.",
				session,
			);
		}
		const isFinal = finalFeature(session, input.featureId);
		const finalObservation = observations[1];
		if (
			isFinal &&
			(finalObservation?.assignment.reviewKind !== "final" ||
				finalObservation?.execution.verdict !== "passed")
		) {
			return fail(
				"Final completion requires one passing final-review assignment.",
				"Run broad validation, start final review, and submit its passing assignment result.",
				session,
			);
		}
		if (!isFinal && finalObservation) {
			return fail(
				"Non-final completion cannot submit a final-review assignment.",
				"Submit only the passing feature-review result.",
				session,
			);
		}
		const requiredScope = isFinal ? "broad" : "targeted";
		if (
			input.result.validationScope !== requiredScope ||
			(isFinal && finalObservation?.assignment.validationScope !== "broad")
		) {
			return fail(
				`${isFinal ? "Final" : "Feature"} completion requires ${requiredScope} validation.`,
				`Submit validationScope: ${requiredScope} with an assignment bound to that validation scope.`,
				session,
			);
		}
		if (
			finalObservation &&
			(finalObservation.assignment.prerequisite?.assignmentId !==
				featureObservation.assignment.id ||
				finalObservation.assignment.prerequisite.result.assignmentId !==
					featureObservation.assignment.id ||
				finalObservation.assignment.prerequisite.resultDigest !==
					canonicalReviewAssignmentResultDigest(
						finalObservation.assignment.prerequisite.result,
					))
		) {
			return fail(
				"Final review assignment has an invalid durable feature-review binding.",
				"Preserve the session and repair the bound prerequisite before retrying final completion.",
				session,
			);
		}
		if (
			finalObservation &&
			Date.parse(finalObservation.assignment.startedAt) <
				Date.parse(featureObservation.execution.completedAt)
		) {
			return fail(
				"Final review started before feature review passed.",
				"Complete feature review, then run broad validation and start final review.",
				session,
			);
		}
	} else {
		const failedObservation = observations.at(-1);
		if (failedObservation?.execution.verdict !== "failed") {
			return fail(
				"Blocked results require one failed assignment result.",
				"Submit a failed verdict with at least one blocking finding.",
				session,
			);
		}
		if (observations.length > 1) {
			const featureObservation = observations[0];
			if (
				featureObservation?.assignment.reviewKind !== "feature" ||
				featureObservation.execution.verdict !== "passed" ||
				failedObservation.assignment.reviewKind !== "final" ||
				failedObservation.assignment.prerequisite?.assignmentId !==
					featureObservation.assignment.id
			) {
				return fail(
					"Terminal final-review failure has an invalid durable prerequisite.",
					"Preserve the session and repair the bound review graph before retrying.",
					session,
				);
			}
		}
	}
	return ok(true);
}

export function preflightAssignedFeatureCompletion(
	session: Session,
	input: AssignedFeatureCompletionPreflightInput,
	acceptedAt?: string,
): TransitionResult<"new" | "replay"> {
	const causal = causalPreflight<"new" | "replay">(session);
	if (causal) return causal;
	const pendingArchive = pendingArchiveFailure<"new" | "replay">(session);
	if (pendingArchive) return pendingArchive;
	if (input.result.orchestrationPasses.length > MAX_ORCHESTRATION_PASSES) {
		return fail(
			`Optional orchestration telemetry cannot contain more than ${MAX_ORCHESTRATION_PASSES} passes.`,
			"Omit older optional pass records and submit only the bounded current completion telemetry.",
			session,
		);
	}
	const orchestrationBytes = serializedUtf8JsonBytes(
		input.result.orchestrationPasses,
	);
	if (orchestrationBytes > MAX_ORCHESTRATION_COLLECTION_BYTES) {
		return fail(
			`Optional orchestration telemetry requires ${orchestrationBytes} UTF-8 bytes; the maximum is ${MAX_ORCHESTRATION_COLLECTION_BYTES}.`,
			"Omit the optional telemetry or shorten its bounded identifiers, reasons, and references.",
			session,
		);
	}
	const requestDigest = canonicalOperationRequestDigest(
		"feature_complete",
		input,
	);
	const checkedGuard = causalMutationGuard(
		session,
		input,
		"Feature completion",
		"feature_complete",
		requestDigest,
	);
	if (!checkedGuard.ok || checkedGuard.value === "replay") return checkedGuard;
	if (
		!session.plan ||
		session.status !== "running" ||
		session.activeFeatureId !== input.featureId ||
		!session.activeFeatureRunId
	) {
		return fail(
			"Assigned completion requires an active native feature run.",
			"Start or reset/restart the approved feature before completing it.",
			session,
		);
	}
	const completionInputs = completionResultInputs(session, input);
	if (!completionInputs.ok) return completionInputs;
	const resultInputs = completionInputs.value;
	if (
		new Set(resultInputs.map((result) => result.assignmentId)).size !==
		resultInputs.length
	) {
		return fail(
			"Completion cannot reuse one assignment for multiple review results.",
			"Submit each runtime assignment exactly once.",
			session,
		);
	}
	const resolved = resultInputs.map((result) =>
		resolveAssignmentResultIdentity(session, result, acceptedAt),
	);
	const rejected = resolved.find((item) => !item.ok);
	if (rejected && !rejected.ok) return rejected;
	const observations = resolved.map((item) => {
		if (!item.ok)
			throw new Error("Resolved review result unexpectedly failed preflight.");
		return item.value;
	});
	const semantics = validateCompletionResultSemantics(
		session,
		input,
		observations,
	);
	return semantics.ok ? ok("new") : semantics;
}

export function completeAssignedFeature(
	session: Session,
	input: AssignedFeatureCompletionInput,
	environment: TransitionEnvironment,
): TransitionResult<Session> {
	const acceptedAt = environment.now();
	const publicIntent = {
		operationId: input.operationId,
		expectedRevision: input.expectedRevision,
		expectedSnapshotId: input.expectedSnapshotId,
		featureId: input.featureId,
		result: input.result,
	};
	const requestDigest = canonicalOperationRequestDigest(
		"feature_complete",
		publicIntent,
	);
	const checked = preflightAssignedFeatureCompletion(
		session,
		publicIntent,
		acceptedAt,
	);
	if (!checked.ok) return checked;
	if (checked.value === "replay") return ok(session);
	if (!session.plan || !session.activeFeatureRunId) {
		return fail(
			"Assigned completion lost its active native feature run after preflight.",
			"Reload compact status and retry against the active feature run.",
			session,
		);
	}
	const completionInputs = completionResultInputs(session, input);
	if (!completionInputs.ok) return completionInputs;
	const resultInputs = completionInputs.value;
	const resolved = resultInputs.map((result) =>
		resolveAssignmentResult(session, result, input.sourceDigest, acceptedAt),
	);
	const rejected = resolved.find((item) => !item.ok);
	if (rejected && !rejected.ok) return rejected;
	const observations = resolved.map((item) => {
		if (!item.ok)
			throw new Error("Resolved review result unexpectedly failed.");
		return item.value;
	});
	const executions = observations.map((item) => item.execution);
	const recordedReviews = appendReviewExecutions(session, executions);
	if (!recordedReviews.ok)
		return fail(recordedReviews.message, recordedReviews.recovery, session);
	const reviewEvidence = observations.map((item, index) =>
		assignmentReviewEvidence(
			session,
			item.assignment,
			resultInputs[index] as ReviewAssignmentResultInput,
		),
	);
	const recordedEvidence = appendEvidenceForCompletion(
		recordedReviews.value.session,
		reviewEvidence,
	);
	if (!recordedEvidence.ok) {
		return fail(recordedEvidence.message, recordedEvidence.recovery, session);
	}
	const completedById = new Map(
		resultInputs.map((result) => [result.assignmentId, result]),
	);
	let candidate: Session = {
		...recordedEvidence.value.session,
		reviewAssignments: session.reviewAssignments.map((assignment) => {
			const completed = completedById.get(assignment.id);
			return completed
				? {
						...assignment,
						status: completed.terminalDisposition,
						completedAt: completed.completedAt,
						invalidatedAt: null,
						invalidationReason: null,
					}
				: assignment;
		}),
	};
	candidate = sessionWithOrchestrationPasses(
		candidate,
		input.result.orchestrationPasses,
	);
	const now = acceptedAt;
	const evidenceRefs = reviewEvidence.map((evidence) => evidence.evidenceId);
	if (input.result.kind === "blocked") {
		const observation = observations.at(-1);
		if (!observation)
			return fail(
				"Blocked review result was not resolved.",
				undefined,
				session,
			);
		const attempts =
			candidate.budget.failedReviewAttemptsByFeatureRun[
				session.activeFeatureRunId
			] ?? 0;
		const exhausted = attempts >= MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE;
		const history = exhausted
			? appendHistory(candidate.history, {
					featureRunId: observation.assignment.featureRunId,
					featureId: input.featureId,
					status: "blocked",
					summary: input.result.summary,
					recordedAt: now,
					artifactsChanged: [],
					validationScope: observation.assignment.validationScope,
					validationEvidenceRefs: [
						...observation.assignment.validationEvidenceRefs,
					],
					reviewAssignmentIds: observations.map((item) => item.assignment.id),
					outcome: {
						kind: "blocked",
						summary: input.result.summary,
						...(input.result.resolutionHint
							? { resolutionHint: input.result.resolutionHint }
							: {}),
					},
					orchestrationPasses: input.result.orchestrationPasses.map(
						cloneOrchestrationPass,
					),
				})
			: candidate.history;
		const next: Session = {
			...candidate,
			status: exhausted ? "blocked" : "running",
			activeFeatureId: exhausted ? null : candidate.activeFeatureId,
			activeFeatureRunId: exhausted ? null : candidate.activeFeatureRunId,
			featureRuns: exhausted
				? closeFeatureRun(
						candidate.featureRuns,
						candidate.activeFeatureRunId,
						"blocked",
						now,
					)
				: candidate.featureRuns,
			plan: exhausted
				? {
						...session.plan,
						features: updateFeature(
							session.plan.features,
							input.featureId,
							"blocked",
						),
					}
				: session.plan,
			history,
			lastError: exhausted
				? {
						tool: "flow_feature_complete",
						summary: input.result.summary,
						recovery:
							input.result.resolutionHint ??
							"Reset or replan only after explicit user direction.",
						recordedAt: now,
					}
				: null,
		};
		return ok(
			touch(next, environment, {
				operationId: input.operationId,
				operationKind: "feature_complete",
				featureRunId: session.activeFeatureRunId,
				requestDigest,
				recordedAt: now,
				changedEntity: { kind: "review", id: observation.assignment.id },
				changedFields: [
					"reviewAssignments",
					"budget.reviewExecutions",
					"budget.reviewLifecycle",
					"budget.failedReviewCount",
					"budget.failedReviewAttemptsByFeatureRun",
					"causal.evidence",
					...(exhausted
						? [
								"status",
								"activeFeatureId",
								"activeFeatureRunId",
								"featureRuns",
								"plan.features.status",
								"history",
								"lastError",
							]
						: []),
				],
				blockerDelta: {
					added: [input.result.summary],
					removed: [],
				},
				evidenceRefs,
			}),
		);
	}
	const featureObservation = observations[0];
	if (!featureObservation)
		return fail("Feature review result was not resolved.", undefined, session);
	const applicableValidationRefs = new Set(
		observations.flatMap((item) => item.assignment.validationEvidenceRefs),
	);
	const entry: ExecutionHistoryEntry = {
		featureRunId: featureObservation.assignment.featureRunId,
		featureId: input.featureId,
		status: "completed",
		summary: input.result.summary,
		recordedAt: now,
		artifactsChanged: input.result.artifactsChanged.map((artifact) => ({
			...artifact,
		})),
		validationScope: input.result.validationScope,
		validationEvidenceRefs: [...applicableValidationRefs],
		reviewAssignmentIds: observations.map((item) => item.assignment.id),
		outcome: { kind: "completed", summary: input.result.summary },
		orchestrationPasses: input.result.orchestrationPasses.map(
			cloneOrchestrationPass,
		),
	};
	const features = updateFeature(
		session.plan.features,
		input.featureId,
		"completed",
	);
	const allComplete = features.every(
		(feature) => feature.status === "completed",
	);
	const next: Session = {
		...candidate,
		status: allComplete ? "completed" : "ready",
		activeFeatureId: null,
		activeFeatureRunId: null,
		featureRuns: closeFeatureRun(
			candidate.featureRuns,
			candidate.activeFeatureRunId,
			"completed",
			now,
		),
		plan: { ...session.plan, features },
		history: appendHistory(candidate.history, entry),
		budget: {
			...candidate.budget,
			reviewCount: candidate.budget.reviewCount + observations.length,
		},
		closure: null,
		lastError: null,
		timestamps: {
			...candidate.timestamps,
			completedAt: allComplete ? now : candidate.timestamps.completedAt,
		},
	};
	return ok(
		touch(next, environment, {
			operationId: input.operationId,
			operationKind: "feature_complete",
			featureRunId: session.activeFeatureRunId,
			requestDigest,
			recordedAt: now,
			changedEntity: { kind: "feature", id: input.featureId },
			changedFields: [
				"reviewAssignments",
				"budget.reviewExecutions",
				"budget.reviewLifecycle",
				"budget.reviewCount",
				"causal.evidence",
				"status",
				"activeFeatureId",
				"activeFeatureRunId",
				"featureRuns",
				"plan.features.status",
				"history",
				...(allComplete ? ["timestamps.completedAt"] : []),
			],
			evidenceRefs,
		}),
	);
}

function finalFeature(session: Session, featureId: FeatureId): boolean {
	if (!session.plan) return false;
	return session.plan.features.every(
		(feature) => feature.id === featureId || feature.status === "completed",
	);
}
function dependentFeatureIds(
	features: Feature[],
	featureId: FeatureId,
): Set<FeatureId> {
	const affected = new Set([featureId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const feature of features) {
			if (affected.has(feature.id)) continue;
			if (feature.dependsOn.some((dependency) => affected.has(dependency))) {
				affected.add(feature.id);
				changed = true;
			}
		}
	}
	return affected;
}

function causalMutationGuard(
	session: Session,
	guard: CausalGuard | undefined,
	operation: string,
	operationKind: CausalMutationRecord["operationKind"],
	requestDigest: string,
): TransitionResult<"new" | "replay"> {
	const chainError = validateCausalChain(session);
	if (chainError) {
		return fail(
			`Flow causal state is invalid: ${chainError}`,
			"Preserve the session and use the existing quarantine/recovery path; do not rewrite causal history.",
		);
	}
	if (!guard?.operationId) {
		return fail(
			`${operation} requires operationId, expectedRevision, and expectedSnapshotId.`,
			"Reload compact status and retry with one stable operation identity and its exact causal guards.",
			session,
		);
	}
	const replay = operationReplay(
		session,
		guard.operationId,
		operationKind,
		requestDigest,
	);
	if (!replay.ok || replay.value === "replay") return replay;
	if (
		guard.expectedRevision !== session.causal.revision ||
		guard.expectedSnapshotId !== session.causal.snapshotId
	) {
		return fail(
			`${operation} is stale for the current session revision or snapshot.`,
			"Reload compact status and retry only after reconciling current state.",
			session,
		);
	}
	return ok("new");
}

export function resetFeature(
	session: Session,
	featureId: FeatureId,
	environment: TransitionEnvironment,
	guard?: CausalGuard,
): TransitionResult<Session> {
	const requestDigest = canonicalOperationRequestDigest("feature_reset", {
		featureId,
		expectedRevision: guard?.expectedRevision,
		expectedSnapshotId: guard?.expectedSnapshotId,
	});
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	const checkedGuard = causalMutationGuard(
		session,
		guard,
		"Feature reset",
		"feature_reset",
		requestDigest,
	);
	if (!checkedGuard.ok) return checkedGuard;
	if (checkedGuard.value === "replay") return ok(session);
	if (session.status === "completed") {
		return fail(
			"A completed Flow session cannot be reset.",
			"Close and archive it with flow_session_close before starting another goal.",
			session,
		);
	}
	if (!session.plan) return fail("There is no active plan to reset.");
	if (!session.plan.features.some((feature) => feature.id === featureId)) {
		return fail(`Feature '${featureId}' is not in the plan.`);
	}
	const affected = dependentFeatureIds(session.plan.features, featureId);
	const activeFeatureId =
		session.activeFeatureId && affected.has(session.activeFeatureId)
			? null
			: session.activeFeatureId;
	const resetActiveRun = activeFeatureId !== session.activeFeatureId;
	const activeFeatureRunId = resetActiveRun ? null : session.activeFeatureRunId;
	const resetAt = environment.now();
	const featureRuns = resetActiveRun
		? closeFeatureRun(
				session.featureRuns,
				session.activeFeatureRunId,
				"reset",
				resetAt,
			)
		: [...session.featureRuns];
	const reviewAssignments = session.reviewAssignments.map((assignment) =>
		resetActiveRun &&
		assignment.featureRunId === session.activeFeatureRunId &&
		assignment.status === "pending"
			? {
					...assignment,
					status: "invalidated" as const,
					completedAt: null,
					invalidatedAt: resetAt,
					invalidationReason: "feature_reset" as const,
				}
			: assignment,
	);
	const invalidatedAssignments = reviewAssignments.some(
		(assignment, index) => assignment !== session.reviewAssignments[index],
	);
	const nextFeatures = session.plan.features.map((feature) =>
		affected.has(feature.id)
			? { ...feature, status: "pending" as const }
			: feature,
	);
	const budget = cloneBudgetTelemetry(session);
	const nextStatus =
		session.approval !== "approved"
			? "planning"
			: activeFeatureId
				? "running"
				: nextFeatures.some((feature) => feature.status === "blocked")
					? "blocked"
					: "ready";
	return ok(
		touch(
			{
				...session,
				status: nextStatus,
				activeFeatureId,
				activeFeatureRunId,
				featureRuns,
				reviewAssignments,
				plan: {
					...session.plan,
					features: nextFeatures,
				},
				budget: {
					...budget,
				},
				lastError: nextStatus === "blocked" ? session.lastError : null,
				timestamps: { ...session.timestamps, completedAt: null },
			},
			environment,
			{
				operationId: guard?.operationId,
				operationKind: "feature_reset",
				featureRunId: session.activeFeatureRunId,
				requestDigest,
				recordedAt: resetAt,
				changedEntity: { kind: "feature", id: featureId },
				changedFields: [
					"status",
					"plan.features.status",
					"activeFeatureId",
					"activeFeatureRunId",
					"featureRuns",
					...(session.lastError && nextStatus !== "blocked"
						? ["lastError"]
						: []),
					...(invalidatedAssignments ? ["reviewAssignments"] : []),
				],
				blockerDelta: { added: [], removed: [...affected] },
			},
		),
	);
}

export function closeSession(
	session: Session,
	kind: "completed" | "deferred" | "abandoned",
	environment: TransitionEnvironment,
	summary?: string,
	guard?: CausalGuard,
): TransitionResult<Session> {
	if (session.closure) {
		return fail(
			"Session closure is already recorded; a new or repeated start request cannot adopt it.",
			`Retry flow_session_close { request: { mode: "retry", operationId: "${session.closure.retryOperationId}" } }.`,
			session,
		);
	}
	const requestDigest = canonicalOperationRequestDigest("session_close", {
		mode: "start",
		kind,
		summary,
		expectedRevision: guard?.expectedRevision,
		expectedSnapshotId: guard?.expectedSnapshotId,
	});
	const checkedGuard = causalMutationGuard(
		session,
		guard,
		"Session close",
		"session_close",
		requestDigest,
	);
	if (!checkedGuard.ok) return checkedGuard;
	if (checkedGuard.value === "replay") return ok(session);
	const retryOperationId = guard?.operationId;
	if (!retryOperationId) {
		return fail(
			"Session close requires a durable retry operation id.",
			"Reload compact status and start closure with complete causal guards.",
			session,
		);
	}
	if (session.status === "completed" && kind !== "completed") {
		return fail(
			"A completed Flow session must close as completed.",
			"Retry with kind 'completed' so canonical history preserves the delivered outcome.",
			session,
		);
	}
	if (kind === "completed") {
		if (!session.plan || session.approval !== "approved") {
			return fail(
				"Cannot close a Flow session as completed without an approved plan.",
			);
		}
		const unfinished = session.plan.features.filter(
			(feature) => feature.status !== "completed",
		);
		if (unfinished.length > 0) {
			return fail(
				"Cannot close a Flow session as completed with unfinished features.",
				`Unfinished features: ${unfinished.map((feature) => feature.id).join(", ")}`,
			);
		}
		if (session.status !== "completed") {
			return fail(
				"Cannot close a Flow session as completed before final completion gates pass.",
			);
		}
		if (
			session.activeFeatureId ||
			session.activeFeatureRunId ||
			session.reviewAssignments.some(
				(assignment) => assignment.status === "pending",
			)
		) {
			return fail(
				"A completed close requires quiescent completed session state.",
				"Finish final completion before closing the session as completed.",
				session,
			);
		}
	}
	const closureSummary = summary ?? `Session closed as ${kind}.`;
	const now = environment.now();
	const activeFeatureRunId = session.activeFeatureRunId;
	const invalidationReason =
		kind === "deferred"
			? ("session_deferred" as const)
			: ("session_abandoned" as const);
	const reviewAssignments =
		kind === "completed"
			? [...session.reviewAssignments]
			: session.reviewAssignments.map((assignment) =>
					assignment.status === "pending"
						? {
								...assignment,
								status: "invalidated" as const,
								completedAt: null,
								invalidatedAt: now,
								invalidationReason,
							}
						: assignment,
				);
	return ok(
		touch(
			{
				...session,
				status: kind === "completed" ? "completed" : session.status,
				activeFeatureId: null,
				activeFeatureRunId: null,
				featureRuns: activeFeatureRunId
					? closeFeatureRun(session.featureRuns, activeFeatureRunId, kind, now)
					: [...session.featureRuns],
				reviewAssignments,
				closure: {
					kind,
					summary: closureSummary,
					recordedAt: now,
					retryOperationId,
				},
			},
			environment,
			{
				operationId: guard?.operationId,
				operationKind: "session_close",
				featureRunId: activeFeatureRunId,
				requestDigest,
				recordedAt: now,
				changedEntity: { kind: "closure", id: session.id },
				changedFields: [
					"closure",
					...(session.activeFeatureId ? ["activeFeatureId"] : []),
					...(session.activeFeatureRunId
						? ["activeFeatureRunId", "featureRuns"]
						: []),
					...(reviewAssignments.some(
						(assignment, index) =>
							assignment !== session.reviewAssignments[index],
					)
						? ["reviewAssignments"]
						: []),
				],
			},
		),
	);
}

function nextAction(session: Session): string {
	if (session.closure) {
		return "Retry flow_session_close to finish archiving the closed session.";
	}
	if (!session.plan) return "Save a plan with flow_plan_save.";
	if (session.approval !== "approved") return "Approve the plan.";
	if (session.status === "ready") {
		const next = nextRunnableFeature(session.plan.features);
		return next.ok
			? "Start the feature identified under workflowData.projection.feature."
			: "No runnable feature is available; inspect feature dependencies or reset blocked work.";
	}
	if (session.status === "running")
		return session.activeFeatureId
			? "Complete or reset the active feature identified under workflowData.projection.feature."
			: "Complete or reset the active feature.";
	if (session.status === "blocked")
		return "Reset the blocked feature or close the session.";
	if (session.status === "completed")
		return "Call flow_session_close to archive the completed session before starting a new goal.";
	return "Inspect session state.";
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function serializedUtf8JsonBytes(value: unknown): number {
	return utf8ByteLength(JSON.stringify(value));
}

function boundedText(value: string, maximumBytes: number): string {
	if (utf8ByteLength(value) <= maximumBytes) return value;
	const suffix = "…";
	const suffixBytes = utf8ByteLength(suffix);
	let result = "";
	for (const character of value) {
		if (utf8ByteLength(result + character) > maximumBytes - suffixBytes) break;
		result += character;
	}
	return `${result}${suffix}`;
}

function boundedStrings(
	values: readonly string[],
	maximumItems: number,
	maximumBytes: number,
): string[] {
	return values
		.slice(0, maximumItems)
		.map((value) => boundedText(value, maximumBytes));
}

function scopeReference(value: string): string {
	const normalized = value.normalize("NFKC").trim();
	const unsafe =
		normalized.startsWith("/") ||
		normalized.startsWith("\\") ||
		/^[A-Za-z]:/.test(normalized) ||
		/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) ||
		/^~[^/\\]*(?:[/\\]|$)/.test(normalized) ||
		normalized.split(/[\\/]/).includes("..");
	return unsafe ? deterministicDigest("scope-v1", normalized) : normalized;
}

function boundedScopeReference(value: string): string {
	return boundedText(scopeReference(value), 120);
}

function buildExecutionProjection(
	goal: string,
	plan: Plan,
	feature: Feature,
	featureRunId: FeatureRunId | undefined,
	isFinalFeature: boolean,
	expectedRevision: number,
	expectedSnapshotId: SnapshotId,
): ExecutionProjection {
	return {
		view: "execution",
		...(featureRunId ? { featureRunId } : {}),
		goal,
		plan: {
			summary: plan.summary,
			overview: plan.overview,
			requirements: [...plan.requirements],
			decisions: [...plan.decisions],
			finalReviewPolicy: plan.finalReviewPolicy,
		},
		feature: {
			id: feature.id,
			title: feature.title,
			summary: feature.summary,
			targets: feature.targets.map(scopeReference),
			validation: [...feature.validation],
			dependsOn: [...feature.dependsOn],
			reviewDepth: feature.reviewDepth,
		},
		isFinalFeature,
		requiredValidationScope: isFinalFeature ? "broad" : "targeted",
		expectedRevision,
		expectedSnapshotId,
	};
}

type ReviewerProjectionSource = Pick<
	ReviewAssignment,
	| "id"
	| "status"
	| "featureRunId"
	| "featureId"
	| "reviewKind"
	| "requiredDepth"
	| "packetSummary"
	| "riskLenses"
	| "validationScope"
	| "validationEvidenceRefs"
	| "correction"
>;

type ReviewerCorrectionProjection = Pick<
	ReviewerProjection,
	| "reviewMode"
	| "predecessorAssignmentId"
	| "priorBlockingFindings"
	| "sourceChanged"
	| "changedRelativePaths"
	| "sourceDeltaDigest"
	| "correctionContextCompleteness"
	| "correctionFallbackReason"
>;

const FULL_REVIEW_PROJECTION: ReviewerCorrectionProjection = {
	reviewMode: "full",
	predecessorAssignmentId: null,
	priorBlockingFindings: [],
	sourceChanged: null,
	changedRelativePaths: [],
	sourceDeltaDigest: null,
	correctionContextCompleteness: "complete",
	correctionFallbackReason: null,
};

function assignedReviewScope(
	plan: Plan,
	feature: Feature,
	reviewKind: ReviewAssignment["reviewKind"],
): string[] {
	return reviewKind === "final"
		? [...new Set(plan.features.flatMap((item) => item.targets))]
				.slice(0, 32)
				.map(boundedScopeReference)
		: feature.targets.slice(0, 12).map(boundedScopeReference);
}

function buildReviewerProjection(
	plan: Plan,
	feature: Feature,
	assignment: ReviewerProjectionSource,
	assignedScope = assignedReviewScope(plan, feature, assignment.reviewKind),
	correctionProjection: ReviewerCorrectionProjection = FULL_REVIEW_PROJECTION,
): ReviewerProjection {
	return {
		view: "reviewer",
		assignmentId: assignment.id,
		assignmentStatus: assignment.status,
		featureRunId: assignment.featureRunId,
		featureId: assignment.featureId,
		reviewKind: assignment.reviewKind,
		assignedScope: [...assignedScope],
		requiredDepth: assignment.requiredDepth,
		packetSummary: boundedText(assignment.packetSummary, 1_000),
		riskLenses: boundedStrings(assignment.riskLenses, 16, 240),
		validationScope: assignment.validationScope,
		validationEvidenceCount: assignment.validationEvidenceRefs.length,
		terminalDisposition:
			assignment.status === "submitted" ||
			assignment.status === "observed_unsubmitted"
				? assignment.status
				: null,
		...correctionProjection,
	};
}

function planExecutionBudgetFailure(goal: string, plan: Plan): string | null {
	for (const feature of plan.features) {
		for (const isFinalFeature of [false, true]) {
			const projection = buildExecutionProjection(
				goal,
				plan,
				feature,
				MAX_EXECUTION_FEATURE_RUN_ID,
				isFinalFeature,
				MAX_EXECUTION_REVISION,
				MAX_EXECUTION_SNAPSHOT_ID,
			);
			const bytes = serializedUtf8JsonBytes(projection);
			if (bytes > MAX_EXECUTION_PROJECTION_BYTES) {
				return `Feature '${feature.id}' requires an execution projection of ${bytes} UTF-8 bytes; the maximum is ${MAX_EXECUTION_PROJECTION_BYTES}.`;
			}
		}
	}
	return null;
}

const MINIMUM_EXECUTION_FEATURE: Feature = {
	id: "x" as FeatureId,
	title: "x",
	summary: "x",
	status: "pending",
	reviewDepth: "quick",
	targets: [],
	validation: [],
	dependsOn: [],
};

const MINIMUM_EXECUTION_PLAN: Plan = {
	summary: "x",
	overview: "x",
	requirements: [],
	decisions: [],
	finalReviewPolicy: "broad",
	features: [MINIMUM_EXECUTION_FEATURE],
};

export function goalProjectionBudgetFailure(goal: string): string | null {
	let requiredBytes = 0;
	for (const isFinalFeature of [false, true]) {
		requiredBytes = Math.max(
			requiredBytes,
			serializedUtf8JsonBytes(
				buildExecutionProjection(
					goal,
					MINIMUM_EXECUTION_PLAN,
					MINIMUM_EXECUTION_FEATURE,
					MAX_EXECUTION_FEATURE_RUN_ID,
					isFinalFeature,
					MAX_EXECUTION_REVISION,
					MAX_EXECUTION_SNAPSHOT_ID,
				),
			),
		);
	}
	return requiredBytes > MAX_EXECUTION_PROJECTION_BYTES
		? `A Flow goal leaves no room for the smallest execution context (${requiredBytes} UTF-8 bytes; maximum ${MAX_EXECUTION_PROJECTION_BYTES}).`
		: null;
}

function planReviewerBudgetFailure(plan: Plan): string | null {
	const firstFeature = plan.features[0];
	if (!firstFeature) return "Plan must contain at least one feature.";
	const finalScope = assignedReviewScope(plan, firstFeature, "final");
	for (const feature of plan.features) {
		for (const reviewKind of ["feature", "final"] as const) {
			const projection = buildReviewerProjection(
				plan,
				feature,
				{
					id: MAX_PERSISTED_REVIEW_ID as ReviewAssignmentId,
					status: "pending",
					featureRunId: MAX_PERSISTED_REVIEW_ID as FeatureRunId,
					featureId: feature.id,
					reviewKind,
					requiredDepth:
						reviewKind === "final"
							? plan.finalReviewPolicy
							: feature.reviewDepth,
					packetSummary: "x",
					riskLenses: [],
					validationScope: reviewKind === "final" ? "broad" : "targeted",
					validationEvidenceRefs: [MAX_EXECUTION_SNAPSHOT_ID as EvidenceId],
				},
				reviewKind === "final"
					? finalScope
					: assignedReviewScope(plan, feature, reviewKind),
			);
			const bytes = serializedUtf8JsonBytes(projection);
			if (bytes > MAX_REVIEWER_PROJECTION_BYTES) {
				return `Feature '${feature.id}' requires a smallest ${reviewKind} reviewer projection of ${bytes} UTF-8 bytes; the maximum is ${MAX_REVIEWER_PROJECTION_BYTES}.`;
			}
		}
	}
	return null;
}

export function planProjectionBudgetFailure(
	goal: string,
	plan: Plan,
): string | null {
	return (
		planExecutionBudgetFailure(goal, plan) ?? planReviewerBudgetFailure(plan)
	);
}

function boundedMutation(record: CausalMutationRecord): CausalMutationRecord {
	return {
		...record,
		operationId: boundedText(record.operationId, 80),
		changedEntity: {
			...record.changedEntity,
			id: boundedText(record.changedEntity.id, 80),
		},
		changedFields: boundedStrings(record.changedFields, 8, 64),
		blockerDelta: {
			added: boundedStrings(record.blockerDelta.added, 2, 96),
			removed: boundedStrings(record.blockerDelta.removed, 2, 96),
		},
		evidenceRefs: boundedStrings(record.evidenceRefs, 4, 80),
	};
}

export function compactSessionProjection(session: Session) {
	const features = session.plan?.features ?? [];
	const completed = features.filter(
		(feature) => feature.status === "completed",
	).length;
	const active = session.activeFeatureId
		? (features.find((feature) => feature.id === session.activeFeatureId) ??
			null)
		: null;
	const runnable = nextRunnableFeature(features);
	const canonicalFeature = active ?? (runnable.ok ? runnable.value : null);
	return {
		view: "compact" as const,
		sessionId: session.id,
		status: session.status,
		approval: session.approval,
		revision: session.causal.revision,
		snapshotId: session.causal.snapshotId,
		featureRunId: session.activeFeatureRunId,
		feature: canonicalFeature
			? {
					id: canonicalFeature.id,
					status: canonicalFeature.status,
				}
			: null,
		progress: {
			completed,
			total: features.length,
			remaining: features.length - completed,
		},
		blockers: {
			featureIds: boundedStrings(
				features
					.filter((feature) => feature.status === "blocked")
					.map((feature) => feature.id),
				12,
				96,
			),
			summary: session.lastError
				? boundedText(session.lastError.summary, 240)
				: null,
		},
		closure: session.closure
			? {
					kind: session.closure.kind,
					retryOperationId: session.closure.retryOperationId,
				}
			: null,
		nextAction: boundedText(nextAction(session), 240),
	};
}

export function executionSessionProjection(
	session: Session,
): TransitionResult<ExecutionProjection> {
	if (!session.plan || session.approval !== "approved") {
		return fail(
			"Execution context requires an approved Flow plan.",
			"Approve the plan and start a feature before loading execution context.",
		);
	}
	if (!session.activeFeatureId) {
		return fail(
			"Execution context requires an active in-progress feature.",
			"Start a runnable approved feature before loading execution context.",
		);
	}
	const feature = session.plan.features.find(
		(candidate) => candidate.id === session.activeFeatureId,
	);
	if (feature?.status !== "in_progress") {
		return fail(
			"Execution context requires an active in-progress feature.",
			"Reload compact status and start or repair the active feature assignment.",
		);
	}
	const projection = buildExecutionProjection(
		session.goal,
		session.plan,
		feature,
		session.activeFeatureRunId ?? undefined,
		finalFeature(session, feature.id),
		session.causal.revision,
		session.causal.snapshotId,
	);
	const bytes = serializedUtf8JsonBytes(projection);
	if (bytes > MAX_EXECUTION_PROJECTION_BYTES) {
		return fail(
			`Execution context exceeds the ${MAX_EXECUTION_PROJECTION_BYTES}-byte UTF-8 limit.`,
			"Preserve the session and shorten the plan through the supported recovery path; execution context is never truncated.",
		);
	}
	return ok(projection);
}

export function detailSessionProjection(session: Session) {
	const recoverableFinalAssignment = session.reviewAssignments.findLast(
		(assignment) =>
			assignment.featureRunId === session.activeFeatureRunId &&
			assignment.reviewKind === "final" &&
			assignment.prerequisite !== null &&
			session.reviewAssignments.some(
				(prerequisiteAssignment) =>
					prerequisiteAssignment.id === assignment.prerequisite?.assignmentId &&
					prerequisiteAssignment.status === "pending",
			),
	);
	const recoverablePrerequisite = recoverableFinalAssignment?.prerequisite;
	return {
		view: "detail" as const,
		compact: compactSessionProjection(session),
		finalReviewRetry:
			recoverableFinalAssignment && recoverablePrerequisite
				? {
						finalReviewAssignmentId: recoverableFinalAssignment.id,
						featureRunId: recoverableFinalAssignment.featureRunId,
						sourceDigest: recoverableFinalAssignment.sourceDigest,
						prerequisite: {
							assignmentId: recoverablePrerequisite.assignmentId,
							result: cloneReviewAssignmentResult(
								recoverablePrerequisite.result,
							),
							resultDigest: recoverablePrerequisite.resultDigest,
						},
					}
				: null,
		plan: session.plan
			? {
					summary: boundedText(session.plan.summary, 1000),
					overview: boundedText(session.plan.overview, 2000),
					requirements: boundedStrings(session.plan.requirements, 64, 500),
					decisions: boundedStrings(session.plan.decisions, 64, 500),
					finalReviewPolicy: session.plan.finalReviewPolicy,
					features: session.plan.features.map((feature) => ({
						id: feature.id,
						title: boundedText(feature.title, 240),
						summary: boundedText(feature.summary, 500),
						status: feature.status,
						reviewDepth: feature.reviewDepth,
						targets: feature.targets.slice(0, 32).map(boundedScopeReference),
						dependsOn: [...feature.dependsOn],
					})),
				}
			: null,
		history: session.history.map((entry) => ({
			featureRunId: entry.featureRunId,
			featureId: entry.featureId,
			status: entry.status,
			summary: boundedText(entry.summary, 500),
			recordedAt: entry.recordedAt,
			validationScope: entry.validationScope,
			validation: entry.validationEvidenceRefs.flatMap((reference) => {
				const evidence = session.causal.evidence.find(
					(candidate) =>
						candidate.kind === "validation" &&
						candidate.evidenceId === reference,
				);
				return evidence?.kind === "validation"
					? [
							{
								evidenceId: evidence.evidenceId,
								commandClass: evidence.commandClass,
								status: evidence.exitCode === 0 ? "passed" : "failed",
								completedAt: evidence.completedAt,
							},
						]
					: [];
			}),
			reviews: entry.reviewAssignmentIds.flatMap((assignmentId) => {
				const assignment = session.reviewAssignments.find(
					(candidate) => candidate.id === assignmentId,
				);
				if (!assignment) return [];
				const execution = session.budget.reviewExecutions.find(
					(candidate) => candidate.assignmentId === assignmentId,
				);
				return [
					{
						assignmentId,
						reviewKind: assignment.reviewKind,
						requiredDepth: assignment.requiredDepth,
						status: assignment.status,
						verdict: execution?.verdict ?? null,
						blockingFindingCount:
							execution?.findings.filter(
								(finding) => finding.severity === "blocking",
							).length ?? 0,
					},
				];
			}),
		})),
		featureRuns: session.featureRuns.map((run) => ({ ...run })),
		reviewAssignments: session.reviewAssignments.map((assignment) => ({
			id: assignment.id,
			featureRunId: assignment.featureRunId,
			featureId: assignment.featureId,
			reviewKind: assignment.reviewKind,
			status: assignment.status,
			startedAt: assignment.startedAt,
			completedAt: assignment.completedAt,
			invalidatedAt: assignment.invalidatedAt,
			invalidationReason: assignment.invalidationReason,
			reviewMode: assignment.correction?.reviewMode ?? "full",
			predecessorAssignmentId:
				assignment.correction?.predecessorAssignmentId ?? null,
			sourceManifestArtifactRef: assignment.sourceManifestArtifactRef
				? { ...assignment.sourceManifestArtifactRef }
				: null,
			prerequisite: assignment.prerequisite
				? {
						assignmentId: assignment.prerequisite.assignmentId,
						resultDigest: assignment.prerequisite.resultDigest,
					}
				: null,
		})),
		causal: {
			revision: session.causal.revision,
			snapshotId: session.causal.snapshotId,
			mutations: session.causal.mutations.map(boundedMutation),
			evidence: session.causal.evidence.map(cloneEvidence),
		},
	};
}

export function reviewerSessionProjection(
	session: Session,
	request: ReviewerProjectionRequest,
): TransitionResult<ReviewerProjection> {
	const assignment = session.reviewAssignments.find(
		(candidate) => candidate.id === request.assignmentId,
	);
	if (!assignment) {
		return fail(
			`Review assignment '${request.assignmentId}' was not found.`,
			"Use the exact assignmentId returned by flow_review_start.",
		);
	}
	if (assignment.status === "invalidated") {
		const sourceChanged = assignment.invalidationReason === "source_changed";
		return fail(
			`Review assignment '${assignment.id}' was invalidated because ${sourceChanged ? "the source changed" : "its feature run was reset"}.`,
			sourceChanged
				? "Rerun validation and use the replacement assignment for the current source."
				: "Start a new feature run and create a new review assignment; historical assignments cannot be recovered as active work.",
		);
	}
	const plan = session.plan;
	const feature = plan?.features.find(
		(candidate) => candidate.id === assignment.featureId,
	);
	if (!plan || !feature) {
		return fail("The review assignment references a missing plan feature.");
	}
	let correctionProjection = FULL_REVIEW_PROJECTION;
	if (assignment.correction) {
		const predecessor = session.reviewAssignments.find(
			(candidate) =>
				candidate.id === assignment.correction?.predecessorAssignmentId,
		);
		const execution = predecessor
			? session.budget.reviewExecutions.find(
					(candidate) => candidate.assignmentId === predecessor.id,
				)
			: undefined;
		if (
			!predecessor ||
			!execution ||
			execution.verdict !== "failed" ||
			predecessor.featureRunId !== assignment.featureRunId ||
			predecessor.reviewKind !== assignment.reviewKind ||
			predecessor.logicalPassId !== assignment.logicalPassId
		) {
			return fail(
				`Review assignment '${assignment.id}' has an unavailable correction predecessor.`,
				"Preserve the session and repair the durable review graph before recovery.",
			);
		}
		const omitOversizedContext =
			assignment.correction.fallbackReason === "projection_context_too_large";
		correctionProjection = {
			reviewMode: assignment.correction.reviewMode,
			predecessorAssignmentId: predecessor.id,
			priorBlockingFindings: omitOversizedContext
				? []
				: execution.findings
						.filter((finding) => finding.severity === "blocking")
						.map((finding) => ({
							fingerprint: finding.fingerprint,
							evidenceLocator: finding.evidenceLocator,
						})),
			sourceChanged: assignment.correction.sourceChanged,
			changedRelativePaths: omitOversizedContext
				? []
				: [...assignment.correction.changedRelativePaths],
			sourceDeltaDigest: assignment.correction.sourceDeltaDigest,
			correctionContextCompleteness: assignment.correction.contextCompleteness,
			correctionFallbackReason: assignment.correction.fallbackReason,
		};
	}
	return ok(
		buildReviewerProjection(
			plan,
			feature,
			assignment,
			assignedReviewScope(plan, feature, assignment.reviewKind),
			correctionProjection,
		),
	);
}

export function mutationReceiptProjection(
	session: Session,
	warnings: readonly string[] = [],
	operationId?: string,
	operationKind?: CausalMutationRecord["operationKind"],
	acceptedWithoutMutation = false,
) {
	const mutation = operationId
		? (session.causal.mutations.find(
				(candidate) => candidate.operationId === operationId,
			) ?? null)
		: operationKind
			? (session.causal.mutations.findLast(
					(candidate) => candidate.operationKind === operationKind,
				) ?? null)
			: (session.causal.mutations.at(-1) ?? null);
	return {
		view: "mutation_receipt" as const,
		status: session.status,
		operationAccepted: mutation !== null || acceptedWithoutMutation,
		operationIdConsumed: mutation !== null,
		operationId: mutation?.operationId ?? null,
		revision: mutation?.revision ?? session.causal.revision,
		snapshotId: mutation?.currentSnapshotId ?? session.causal.snapshotId,
		featureRunId: mutation?.featureRunId ?? session.activeFeatureRunId,
		changedEntity: mutation ? { ...mutation.changedEntity } : null,
		changedFields: mutation
			? boundedStrings(mutation.changedFields, 8, 64)
			: [],
		blockerDelta: mutation
			? {
					added: boundedStrings(mutation.blockerDelta.added, 2, 96),
					removed: boundedStrings(mutation.blockerDelta.removed, 2, 96),
				}
			: { added: [], removed: [] },
		evidenceRefs: mutation ? boundedStrings(mutation.evidenceRefs, 4, 80) : [],
		warnings: boundedStrings(warnings, 2, 120),
		nextAction: boundedText(nextAction(session), 160),
	};
}

export function rejectedMutationReceiptProjection(
	session: Session | null,
	warnings: readonly string[] = [],
	operationId?: string,
) {
	return {
		view: "mutation_receipt" as const,
		status: session?.status ?? null,
		operationAccepted: false,
		operationIdConsumed: false,
		operationId: operationId ?? null,
		revision: session?.causal.revision ?? null,
		snapshotId: session?.causal.snapshotId ?? null,
		featureRunId: session?.activeFeatureRunId ?? null,
		changedEntity: null,
		changedFields: [],
		blockerDelta: { added: [], removed: [] },
		evidenceRefs: [],
		warnings: boundedStrings(warnings, 2, 120),
		nextAction: session
			? boundedText(nextAction(session), 160)
			: "Start a new Flow session with /flow-plan <goal>.",
	};
}

const MAX_DELTA_RECORDS = 20;
const MAX_DELTA_BYTES = 3_000;

function deltaProjectionBytes(
	session: Session,
	sinceRevision: number,
	mutations: readonly CausalMutationRecord[],
): number {
	const throughRevision = mutations.at(-1)?.revision ?? sinceRevision;
	const hasMore = session.causal.mutations.some(
		(mutation) => mutation.revision > throughRevision,
	);
	return utf8ByteLength(
		JSON.stringify({
			view: "delta",
			changed: mutations.length > 0,
			fromRevision: sinceRevision,
			throughRevision,
			currentRevision: session.causal.revision,
			snapshotId: session.causal.snapshotId,
			mutations,
			hasMore,
			nextSinceRevision: hasMore ? throughRevision : null,
		}),
	);
}

export function causalDeltaProjection(
	session: Session,
	sinceRevision: number,
): TransitionResult<{
	view: "delta";
	changed: boolean;
	fromRevision: number;
	throughRevision: number;
	currentRevision: number;
	snapshotId: SnapshotId;
	mutations: CausalMutationRecord[];
	hasMore: boolean;
	nextSinceRevision: number | null;
}> {
	if (
		!Number.isSafeInteger(sinceRevision) ||
		sinceRevision < 0 ||
		sinceRevision > session.causal.revision
	) {
		return fail(
			"sinceRevision must be a nonnegative existing session revision.",
			"Reload compact status and poll from a revision no newer than the current revision.",
		);
	}
	const available = session.causal.mutations.filter(
		(mutation) => mutation.revision > sinceRevision,
	);
	const selected: CausalMutationRecord[] = [];
	for (const mutation of available.slice(0, MAX_DELTA_RECORDS)) {
		const candidate = [...selected, boundedMutation(mutation)];
		if (
			deltaProjectionBytes(session, sinceRevision, candidate) > MAX_DELTA_BYTES
		) {
			break;
		}
		selected.push(candidate.at(-1) as CausalMutationRecord);
	}
	if (available.length > 0 && selected.length === 0) {
		selected.push(boundedMutation(available[0] as CausalMutationRecord));
	}
	const throughRevision = selected.at(-1)?.revision ?? sinceRevision;
	const hasMore = available.some(
		(mutation) => mutation.revision > throughRevision,
	);
	return ok({
		view: "delta",
		changed: selected.length > 0,
		fromRevision: sinceRevision,
		throughRevision,
		currentRevision: session.causal.revision,
		snapshotId: session.causal.snapshotId,
		mutations: selected,
		hasMore,
		nextSinceRevision: hasMore ? throughRevision : null,
	});
}
