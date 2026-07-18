import { MAX_ORCHESTRATION_PASSES } from "./limits.js";
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
	FeatureReviewDepth,
	OrchestrationPassRecord,
	Plan,
	PlanInput,
	Review,
	ReviewExecution,
	ReviewExecutionFindingInput,
	ReviewExecutionInput,
	ReviewerProjection,
	ReviewerProjectionRequest,
	Session,
	SessionId,
	SnapshotId,
	WorkerOutcome,
	WorkerResult,
} from "./session.js";
import { validationCommandClass } from "./validation-command.js";

export const MAX_EXECUTION_PROJECTION_BYTES = 12 * 1024;

const MAX_EXECUTION_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_EXECUTION_SNAPSHOT_ID = `sha256:${"f".repeat(64)}`;

export type TransitionEnvironment = {
	now(): string;
	newSessionId(): SessionId;
	newOperationId?(revision: number): string;
};

export type TransitionResult<T> =
	| { ok: true; value: T }
	| { ok: false; message: string; recovery?: string; session?: Session };

type CompletedWorkerResult = Extract<WorkerResult, { status: "ok" }>;

function cloneReview<T extends Review>(review: T | undefined): T | undefined {
	if (!review) return undefined;
	return {
		...review,
		blockingFindings: review.blockingFindings.map((finding) => ({
			...finding,
		})),
	};
}

function cloneWorkerOutcome<T extends WorkerOutcome>(
	outcome: T | undefined,
): T | undefined {
	return outcome ? { ...outcome } : undefined;
}

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

// Bound the persisted history so a long autonomous retry loop cannot grow
// session.json without limit (every mutation re-reads/re-validates the whole
// file). The cap is generous; only pathological loops ever reach it.
const MAX_HISTORY_ENTRIES = 500;
const MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE = 2;

const FINDING_FINGERPRINT_VERSION = "finding-v1";

const FEATURE_REVIEW_DEPTH_RANK: Record<FeatureReviewDepth, number> = {
	quick: 0,
	standard: 1,
	detailed: 2,
};

function appendHistory(
	history: readonly ExecutionHistoryEntry[],
	entry: ExecutionHistoryEntry,
): ExecutionHistoryEntry[] {
	const next = [...history, entry];
	return next.length > MAX_HISTORY_ENTRIES
		? next.slice(next.length - MAX_HISTORY_ENTRIES)
		: next;
}

function historyEntryFor(
	worker: WorkerResult,
	status: ExecutionHistoryEntry["status"],
	environment: TransitionEnvironment,
	outcome: WorkerOutcome | undefined = worker.outcome,
	summary: string = worker.summary,
): ExecutionHistoryEntry {
	return {
		featureId: worker.featureId,
		status,
		summary,
		recordedAt: environment.now(),
		artifactsChanged: worker.artifactsChanged.map((artifact) => ({
			...artifact,
		})),
		validationRun: worker.validationRun.map((run) => ({ ...run })),
		validationScope: worker.validationScope,
		featureReviewDepth: worker.featureReviewDepth,
		featureReview: cloneReview(worker.featureReview),
		finalReview: cloneReview(worker.finalReview),
		outcome: cloneWorkerOutcome(outcome),
		orchestrationPasses: worker.orchestrationPasses.map(cloneOrchestrationPass),
	};
}

function initialBudgetTelemetry(): BudgetTelemetry {
	return {
		reviewCount: 0,
		failedReviewCount: 0,
		failedReviewAttemptsByFeature: {},
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
		failedReviewAttemptsByFeature: {
			...session.budget.failedReviewAttemptsByFeature,
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
		tally.workerCount += pass.workerCount;
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
	const latestPasses = [...budget.orchestration.latestPasses, ...newPasses];
	return {
		...budget,
		orchestration: {
			passCount: budget.orchestration.passCount + newPasses.length,
			workerCount: budget.orchestration.workerCount + tally.workerCount,
			candidatePassCount:
				budget.orchestration.candidatePassCount + tally.candidatePassCount,
			verifierPassCount:
				budget.orchestration.verifierPassCount + tally.verifierPassCount,
			candidateEligibleCount:
				budget.orchestration.candidateEligibleCount +
				tally.candidateEligibleCount,
			candidateUsedDecisionCount:
				budget.orchestration.candidateUsedDecisionCount +
				tally.candidateUsedDecisionCount,
			candidateSerialRequiredDecisionCount:
				budget.orchestration.candidateSerialRequiredDecisionCount +
				tally.candidateSerialRequiredDecisionCount,
			skippedCandidateDecisionCount:
				budget.orchestration.skippedCandidateDecisionCount +
				tally.skippedCandidateDecisionCount,
			latestPasses:
				latestPasses.length > MAX_ORCHESTRATION_PASSES
					? latestPasses.slice(latestPasses.length - MAX_ORCHESTRATION_PASSES)
					: latestPasses,
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

export type LogicalReviewPassProjection = {
	logicalPassId: string;
	featureId: FeatureId;
	reviewKind: ReviewExecution["reviewKind"];
	reviewSnapshotId: string;
	latestAttemptId: string;
	verdict: ReviewExecution["verdict"];
	attemptCount: number;
};

function latestLogicalReviewExecutions(
	executions: readonly ReviewExecution[],
): Map<string, { execution: ReviewExecution; attemptCount: number }> {
	const latest = new Map<
		string,
		{ execution: ReviewExecution; attemptCount: number }
	>();
	for (const execution of executions) {
		const key = `${execution.featureId}\u0000${execution.reviewKind}\u0000${execution.logicalPassId}`;
		const previous = latest.get(key);
		latest.set(key, {
			execution,
			attemptCount: (previous?.attemptCount ?? 0) + 1,
		});
	}
	return latest;
}

export function projectLogicalReviewPasses(
	executions: readonly ReviewExecution[],
): LogicalReviewPassProjection[] {
	return [...latestLogicalReviewExecutions(executions).values()].map(
		({ execution, attemptCount }) => ({
			logicalPassId: execution.logicalPassId,
			featureId: execution.featureId,
			reviewKind: execution.reviewKind,
			reviewSnapshotId: execution.reviewSnapshotId,
			latestAttemptId: execution.attemptId,
			verdict: execution.verdict,
			attemptCount,
		}),
	);
}

function latestReviewTruth(
	executions: readonly ReviewExecution[],
	featureId: FeatureId,
	reviewKind: ReviewExecution["reviewKind"],
): ReviewExecution[] {
	return [...latestLogicalReviewExecutions(executions).values()]
		.map(({ execution }) => execution)
		.filter(
			(execution) =>
				execution.featureId === featureId &&
				execution.reviewKind === reviewKind,
		);
}

function contradictoryReviewSnapshot(
	executions: readonly ReviewExecution[],
): string | null {
	const verdictsBySnapshot = new Map<string, Set<ReviewExecution["verdict"]>>();
	for (const projection of projectLogicalReviewPasses(executions)) {
		const verdicts =
			verdictsBySnapshot.get(projection.reviewSnapshotId) ?? new Set();
		verdicts.add(projection.verdict);
		verdictsBySnapshot.set(projection.reviewSnapshotId, verdicts);
	}
	for (const [snapshotId, verdicts] of verdictsBySnapshot) {
		if (verdicts.size > 1) return snapshotId;
	}
	return null;
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

	const failedReviewAttemptsByFeature = {
		...budget.failedReviewAttemptsByFeature,
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
			failedReviewAttemptsByFeature[execution.featureId] =
				(failedReviewAttemptsByFeature[execution.featureId] ?? 0) + 1;
		}
	}
	const failedAdditions = additions.filter(
		(execution) => execution.verdict === "failed",
	).length;
	const nextBudget: BudgetTelemetry = {
		...budget,
		failedReviewCount: budget.failedReviewCount + failedAdditions,
		failedReviewAttemptsByFeature,
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

export function recordReviewExecutions(
	session: Session,
	executions: readonly ReviewExecutionInput[],
	environment: TransitionEnvironment,
	operationId?: string,
	guard?: Pick<CausalGuard, "expectedRevision" | "expectedSnapshotId">,
): TransitionResult<Session> {
	const preflight = causalPreflight<Session>(session);
	if (preflight) return preflight;
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	const requestDigest = canonicalOperationRequestDigest("review_record", {
		executions,
		expectedRevision: guard?.expectedRevision,
		expectedSnapshotId: guard?.expectedSnapshotId,
	});
	const replay = operationReplay(
		session,
		operationId,
		"review_record",
		requestDigest,
	);
	if (!replay.ok) return replay;
	if (replay.value === "replay") return ok(session);
	if (
		guard &&
		(guard.expectedRevision !== session.causal.revision ||
			guard.expectedSnapshotId !== session.causal.snapshotId)
	) {
		return fail(
			"Review evidence is stale for the current session revision or snapshot.",
			"Reload compact status and record review evidence only for its exact causal identity.",
			session,
		);
	}
	const recorded = mergeReviewExecutionsForCompletion(session, executions);
	if (!recorded.ok) return recorded;
	return ok(
		recorded.value === session
			? session
			: touch(recorded.value, environment, {
					operationId,
					operationKind: "review_record",
					requestDigest,
					changedEntity: { kind: "review", id: session.id },
					changedFields: [
						"budget.reviewExecutions",
						"budget.reviewLifecycle",
						"budget.failedReviewCount",
					],
				}),
	);
}

export function mergeReviewExecutionsForCompletion(
	session: Session,
	executions: readonly ReviewExecutionInput[],
): TransitionResult<Session> {
	const recorded = appendReviewExecutions(session, executions);
	return recorded.ok ? ok(recorded.value.session) : recorded;
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
		if (evidence.snapshotId !== session.causal.snapshotId) {
			return fail(
				`Evidence '${evidence.evidenceId}' is stale for the current snapshot.`,
				"Rerun validation or review against the current snapshot before completion.",
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
				"Use a workspace-relative safe artifact reference; never publish absolute paths or raw command arguments.",
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

export function mergeEvidenceForCompletion(
	session: Session,
	evidenceRecords: readonly EvidenceRecord[],
): TransitionResult<Session> {
	const appended = appendEvidenceForCompletion(session, evidenceRecords);
	return appended.ok ? ok(appended.value.session) : appended;
}

export function recordEvidence(
	session: Session,
	evidenceRecords: readonly EvidenceRecord[],
	environment: TransitionEnvironment,
	operationId?: string,
): TransitionResult<Session> {
	const preflight = causalPreflight<Session>(session);
	if (preflight) return preflight;
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	const requestDigest = canonicalOperationRequestDigest(
		"evidence_record",
		evidenceRecords,
	);
	const replay = operationReplay(
		session,
		operationId,
		"evidence_record",
		requestDigest,
	);
	if (!replay.ok) return replay;
	if (replay.value === "replay") return ok(session);
	const merged = mergeEvidenceForCompletion(session, evidenceRecords);
	if (!merged.ok) return merged;
	if (merged.value === session) return ok(session);
	return ok(
		touch(merged.value, environment, {
			operationId,
			operationKind: "evidence_record",
			requestDigest,
			changedEntity: { kind: "evidence", id: session.id },
			changedFields: ["causal.evidence"],
			evidenceRefs: evidenceRecords.map((evidence) => evidence.evidenceId),
		}),
	);
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

function validatePlan(plan: Plan): string | null {
	const seen = new Set<string>();
	for (const feature of plan.features) {
		if (seen.has(feature.id)) return `Duplicate feature id '${feature.id}'.`;
		seen.add(feature.id);
	}
	for (const feature of plan.features) {
		for (const dependency of feature.dependsOn) {
			if (!seen.has(dependency)) {
				return `Feature '${feature.id}' depends on unknown feature '${dependency}'.`;
			}
			if (dependency === feature.id) {
				return `Feature '${feature.id}' cannot depend on itself.`;
			}
		}
	}

	const visiting = new Set<FeatureId>();
	const visited = new Set<FeatureId>();
	const byId = new Map(plan.features.map((feature) => [feature.id, feature]));
	function visit(id: FeatureId): boolean {
		if (visited.has(id)) return false;
		if (visiting.has(id)) return true;
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependsOn ?? []) {
			if (visit(dependency)) return true;
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	}
	return plan.features.some((feature) => visit(feature.id))
		? "Feature dependencies contain a cycle."
		: null;
}

export function createSession(
	goal: string,
	environment: TransitionEnvironment,
): Session {
	const now = environment.now();
	const session: Session = {
		version: 3,
		id: environment.newSessionId(),
		goal,
		status: "planning",
		approval: "pending",
		plan: null,
		activeFeatureId: null,
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
	operationKind?: CausalMutationRecord["operationKind"] | undefined;
	requestDigest?: string | undefined;
	recordedAt?: string | undefined;
	changedEntity?: CausalMutationRecord["changedEntity"] | undefined;
	changedFields?: string[] | undefined;
	blockerDelta?: CausalMutationRecord["blockerDelta"] | undefined;
	evidenceRefs?: string[] | undefined;
};

function touch(
	session: Session,
	environment: TransitionEnvironment,
	descriptor: MutationDescriptor = {},
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
	const operationKind = descriptor.operationKind ?? "evidence_record";
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
	const plan = clonePlan(planInput);
	const planError = validatePlan(plan);
	if (planError) return fail(planError);
	const executionBudgetError = planExecutionBudgetFailure(session.goal, plan);
	if (executionBudgetError) {
		return fail(
			executionBudgetError,
			"Shorten the goal or active-feature execution context and save the complete plan again.",
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
	const next = touch(
		{
			...session,
			status: "running",
			plan: nextPlan,
			budget,
			activeFeatureId: selected.value.id,
			lastError: null,
		},
		environment,
		{
			operationKind: "run_start",
			requestDigest: canonicalOperationRequestDigest("run_start", {
				featureId: selected.value.id,
			}),
			changedEntity: { kind: "feature", id: selected.value.id },
			changedFields: ["status", "activeFeatureId"],
		},
	);
	return ok({
		session: next,
		feature:
			next.plan?.features.find((feature) => feature.id === selected.value.id) ??
			selected.value,
	});
}

function isPassingReview(review: {
	status: string;
	blockingFindings: unknown[];
}) {
	return review.status === "passed" && review.blockingFindings.length === 0;
}

function finalFeature(session: Session, featureId: FeatureId): boolean {
	if (!session.plan) return false;
	return session.plan.features.every(
		(feature) => feature.id === featureId || feature.status === "completed",
	);
}

function activeFeature(session: Session, featureId: FeatureId): Feature | null {
	return (
		session.plan?.features.find((feature) => feature.id === featureId) ?? null
	);
}

function reviewDepthMeetsRequirement(
	actual: FeatureReviewDepth,
	required: FeatureReviewDepth,
): boolean {
	return (
		FEATURE_REVIEW_DEPTH_RANK[actual] >= FEATURE_REVIEW_DEPTH_RANK[required]
	);
}

function completionFailure<T>(
	session: Session,
	tool: string,
	message: string,
	recovery: string,
	environment: TransitionEnvironment,
	descriptor: MutationDescriptor = {},
): TransitionResult<T> {
	const now = environment.now();
	return fail<T>(
		message,
		recovery,
		touch(
			{
				...session,
				lastError: {
					tool,
					summary: message,
					recovery,
					recordedAt: now,
				},
			},
			environment,
			{
				...descriptor,
				recordedAt: now,
				changedFields: [...(descriptor.changedFields ?? []), "lastError"],
			},
		),
	);
}

function validateCompletion(
	session: Session,
	worker: CompletedWorkerResult,
	environment: TransitionEnvironment,
	descriptor: MutationDescriptor = {},
): TransitionResult<void> {
	const wasFinal = finalFeature(session, worker.featureId);
	const feature = activeFeature(session, worker.featureId);
	const requiredReviewDepth = feature?.reviewDepth ?? "standard";
	if (worker.validationRun.length === 0) {
		return completionFailure(
			session,
			"flow_feature_complete",
			"Completion requires recorded validation evidence.",
			"Run the targeted or broad validation command and record the result.",
			environment,
			descriptor,
		);
	}
	if (!worker.validationRun.every((item) => item.status === "passed")) {
		return completionFailure(
			session,
			"flow_feature_complete",
			"Completion requires all recorded validation to pass.",
			"Fix failures, rerun validation, then complete the feature.",
			environment,
			descriptor,
		);
	}
	if (!wasFinal && worker.validationScope !== "targeted") {
		return completionFailure(
			session,
			"flow_feature_complete",
			"Non-final feature completion requires targeted validation.",
			"Record validationScope: targeted for ordinary feature completion.",
			environment,
			descriptor,
		);
	}
	if (
		!reviewDepthMeetsRequirement(worker.featureReviewDepth, requiredReviewDepth)
	) {
		return completionFailure(
			session,
			"flow_feature_complete",
			`Feature review depth '${worker.featureReviewDepth}' does not meet the plan requirement '${requiredReviewDepth}'.`,
			"Run the feature review at the planned depth or reset/replan if the depth is wrong.",
			environment,
			descriptor,
		);
	}
	if (wasFinal && worker.validationScope !== "broad") {
		return completionFailure(
			session,
			"flow_feature_complete",
			"Final feature completion requires broad validation.",
			"Run the project-level gate and record validationScope: broad.",
			environment,
			descriptor,
		);
	}
	if (!isPassingReview(worker.featureReview)) {
		return completionFailure(
			session,
			"flow_feature_complete",
			"Completion requires a passing featureReview with no blocking findings.",
			"Fix or acknowledge the review findings before completing.",
			environment,
			descriptor,
		);
	}
	if (wasFinal) {
		if (!worker.finalReview) {
			return completionFailure(
				session,
				"flow_feature_complete",
				"Final feature completion requires a finalReview.",
				"Run final review and include the finalReview payload.",
				environment,
				descriptor,
			);
		}
		if (!isPassingReview(worker.finalReview)) {
			return completionFailure(
				session,
				"flow_feature_complete",
				"Final completion requires a passing finalReview.",
				"Resolve final review findings before completing the session.",
				environment,
				descriptor,
			);
		}
		const policy = session.plan?.finalReviewPolicy ?? "detailed";
		if (worker.finalReview.reviewDepth !== policy) {
			return completionFailure(
				session,
				"flow_feature_complete",
				`Final review depth must match the plan policy '${policy}'.`,
				"Record a finalReview whose reviewDepth matches the approved plan.",
				environment,
				descriptor,
			);
		}
	}
	return ok(undefined);
}

function validationEvidenceFailure(
	session: Session,
	worker: CompletedWorkerResult,
): { message: string; recovery: string } | null {
	const evidence = session.causal.evidence.filter(
		(record): record is Extract<EvidenceRecord, { kind: "validation" }> =>
			record.kind === "validation" &&
			record.snapshotId === session.causal.snapshotId,
	);
	if (evidence.length < worker.validationRun.length) {
		return {
			message: "Completion is missing source-bound validation evidence.",
			recovery:
				"Rerun every declared validation command and attach its canonical safe evidence record for the current snapshot.",
		};
	}
	const expected = new Map<string, number>();
	for (const run of worker.validationRun) {
		const key = `${validationCommandClass(run.command)}:${run.status}`;
		expected.set(key, (expected.get(key) ?? 0) + 1);
	}
	const observed = new Map<string, number>();
	for (const record of evidence) {
		const status = record.exitCode === 0 ? "passed" : "failed";
		const key = `${record.commandClass}:${status}`;
		observed.set(key, (observed.get(key) ?? 0) + 1);
	}
	if ([...expected].some(([key, count]) => (observed.get(key) ?? 0) < count)) {
		return {
			message:
				"Validation summaries do not match the bound evidence command classes and exit codes.",
			recovery:
				"Do not rewrite validation summaries; rerun validation and submit evidence whose canonical digest and exit code match the result.",
		};
	}
	return null;
}

function boundReviewEvidence(
	session: Session,
	executions: readonly ReviewExecution[],
): Extract<EvidenceRecord, { kind: "review" }>[] {
	const bound: Extract<EvidenceRecord, { kind: "review" }>[] = [];
	for (const execution of executions) {
		const evidence = session.causal.evidence.find(
			(record): record is Extract<EvidenceRecord, { kind: "review" }> =>
				record.kind === "review" &&
				record.attemptId === execution.attemptId &&
				record.snapshotId === session.causal.snapshotId,
		);
		if (evidence) bound.push(evidence);
	}
	return bound;
}

function reviewEvidenceFailure(
	session: Session,
	executions: readonly ReviewExecution[],
): { message: string; recovery: string } | null {
	for (const execution of executions) {
		const evidence = session.causal.evidence.find(
			(record): record is Extract<EvidenceRecord, { kind: "review" }> =>
				record.kind === "review" && record.attemptId === execution.attemptId,
		);
		if (!evidence) {
			return {
				message: `Review execution '${execution.attemptId}' has no source-bound review evidence.`,
				recovery:
					"Attach the canonical review packet evidence for each latest logical review pass.",
			};
		}
		if (
			evidence.snapshotId !== session.causal.snapshotId ||
			evidence.packetDigest !== execution.reviewSnapshotId
		) {
			return {
				message: `Review execution '${execution.attemptId}' has stale or digest-mismatched evidence.`,
				recovery:
					"Rebuild the immutable review packet and rerun review against the current session snapshot.",
			};
		}
	}
	return null;
}

function incrementFailedReviewAttempt(
	session: Session,
	worker: CompletedWorkerResult,
	review: Review,
	reviewKind: "feature" | "final",
	environment: TransitionEnvironment,
): {
	session: Session;
	attempts: number;
	exhausted: boolean;
} {
	const budget = cloneBudgetTelemetry(session);
	const attempts = budget.failedReviewAttemptsByFeature[worker.featureId] ?? 0;
	const exhausted = attempts >= MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE;
	const nextBudget = budget;
	if (!exhausted) {
		return {
			session: { ...session, budget: nextBudget },
			attempts,
			exhausted,
		};
	}
	const entry = historyEntryFor(
		worker,
		"blocked",
		environment,
		{
			kind: "blocked",
			summary: review.summary,
			resolutionHint:
				"Report the review blocker and wait for explicit reset, replan, or repair approval.",
		},
		`${reviewKind === "final" ? "Final review" : "Feature review"} failed after ${attempts} attempts: ${review.summary}`,
	);
	return {
		session: {
			...session,
			status: "blocked",
			activeFeatureId: null,
			plan: session.plan
				? {
						...session.plan,
						features: updateFeature(
							session.plan.features,
							worker.featureId,
							"blocked",
						),
					}
				: session.plan,
			history: appendHistory(session.history, entry),
			budget: nextBudget,
		},
		attempts,
		exhausted,
	};
}

function failedReviewCompletion<T>(
	delta: CompletionDelta,
	worker: CompletedWorkerResult,
	review: Review,
	reviewKind: "feature" | "final",
	environment: TransitionEnvironment,
): TransitionResult<T> {
	const failedReview = incrementFailedReviewAttempt(
		delta.session,
		worker,
		review,
		reviewKind,
		environment,
	);
	const failedDelta = advanceCompletionDelta(
		delta,
		failedReview.session,
		failedReview.exhausted
			? ["status", "activeFeatureId", "plan.features.status", "history"]
			: [],
	);
	const reviewName = reviewKind === "final" ? "finalReview" : "featureReview";
	return completionFailure(
		failedDelta.session,
		"flow_feature_complete",
		failedReview.exhausted
			? "Review retry budget exhausted for this feature."
			: `Completion requires a passing ${reviewName} with no blocking findings.`,
		failedReview.exhausted
			? "Stop and report the remaining review blocker. Reset or replan only after explicit user direction."
			: `Pause and report the review blocker. If autonomous repair was explicitly authorized, make at most one repair and retry once; this was failed review attempt ${failedReview.attempts}/${MAX_FAILED_REVIEW_ATTEMPTS_PER_FEATURE}.`,
		environment,
		completionMutationDescriptor(worker, failedDelta),
	);
}

function clearFailedReviewAttempts(
	budget: BudgetTelemetry,
	featureId: FeatureId,
): BudgetTelemetry {
	const { [featureId]: _cleared, ...remainingAttempts } =
		budget.failedReviewAttemptsByFeature;
	return {
		...budget,
		failedReviewAttemptsByFeature: remainingAttempts,
	};
}

function completionBudget(
	session: Session,
	worker: CompletedWorkerResult,
): BudgetTelemetry {
	const budget = clearFailedReviewAttempts(
		cloneBudgetTelemetry(session),
		worker.featureId,
	);
	const reviewCount = budget.reviewCount + (worker.finalReview ? 2 : 1);
	return {
		...budget,
		reviewCount,
	};
}

type CompletionChangedField =
	| "activeFeatureId"
	| "budget.failedReviewAttemptsByFeature"
	| "budget.failedReviewCount"
	| "budget.orchestration"
	| "budget.reviewCount"
	| "budget.reviewExecutions"
	| "budget.reviewLifecycle"
	| "causal.evidence"
	| "closure"
	| "history"
	| "lastError"
	| "plan.features.status"
	| "status"
	| "timestamps.completedAt";

type CompletionDelta = Readonly<{
	session: Session;
	changedFields: readonly CompletionChangedField[];
	appendedReviewAttemptIds: readonly string[];
	newEvidenceIds: readonly EvidenceId[];
}>;

function uniqueCompletionFields(
	fields: readonly CompletionChangedField[],
): CompletionChangedField[] {
	return [...new Set(fields)];
}

function advanceCompletionDelta(
	delta: CompletionDelta,
	session: Session,
	changedFields: readonly CompletionChangedField[],
	appendedReviewAttemptIds: readonly string[] = [],
	newEvidenceIds: readonly EvidenceId[] = [],
): CompletionDelta {
	return {
		session,
		changedFields: uniqueCompletionFields([
			...delta.changedFields,
			...changedFields,
		]),
		appendedReviewAttemptIds: [
			...delta.appendedReviewAttemptIds,
			...appendedReviewAttemptIds,
		],
		newEvidenceIds: [...delta.newEvidenceIds, ...newEvidenceIds],
	};
}

function completionOperationDescriptor(
	worker: WorkerResult,
): MutationDescriptor & {
	operationKind: "feature_complete";
	requestDigest: string;
} {
	return {
		operationId: worker.operationId,
		operationKind: "feature_complete",
		requestDigest:
			worker.requestDigest ??
			canonicalOperationRequestDigest("feature_complete", worker),
	};
}

function completionMutationDescriptor(
	worker: WorkerResult,
	delta: CompletionDelta,
	additionalFields: readonly CompletionChangedField[] = [],
): MutationDescriptor & {
	operationKind: "feature_complete";
	requestDigest: string;
} {
	return {
		...completionOperationDescriptor(worker),
		changedEntity: { kind: "feature", id: worker.featureId },
		changedFields: uniqueCompletionFields([
			...delta.changedFields,
			...additionalFields,
		]),
		evidenceRefs: [...delta.newEvidenceIds],
	};
}

export function completeFeature(
	session: Session,
	worker: WorkerResult,
	environment: TransitionEnvironment,
): TransitionResult<Session> {
	const preflight = causalPreflight<Session>(session);
	if (preflight) return preflight;
	if (!worker.operationId) {
		return fail(
			"Completion requires a stable operationId.",
			"Generate one operation identity and reuse it only when replaying the exact same completion.",
			session,
		);
	}
	const completionOperation = completionOperationDescriptor(worker);
	const replay = operationReplay(
		session,
		worker.operationId,
		"feature_complete",
		completionOperation.requestDigest,
	);
	if (!replay.ok) return replay;
	if (replay.value === "replay") {
		const replayedOperation = session.causal.mutations.find(
			(mutation) => mutation.operationId === worker.operationId,
		);
		if (!replayedOperation) {
			return fail(
				`Operation '${worker.operationId}' could not be resolved from causal history.`,
				"Preserve the session and use the existing quarantine/recovery path; do not rewrite causal history.",
				session,
			);
		}
		return replayedOperation.changedFields.includes("lastError")
			? fail(
					`Operation '${worker.operationId}' was already recorded as a rejected completion.`,
					"Use the existing receipt; use a new operationId only for a new attempt against current status.",
					session,
				)
			: ok(session);
	}
	const pendingArchive = pendingArchiveFailure<Session>(session);
	if (pendingArchive) return pendingArchive;
	if (
		!session.plan ||
		session.status !== "running" ||
		!session.activeFeatureId
	) {
		return fail("No feature is currently running.");
	}
	if (worker.featureId !== session.activeFeatureId) {
		return fail(
			`Worker result feature '${worker.featureId}' does not match active feature '${session.activeFeatureId}'.`,
		);
	}
	if (
		worker.expectedRevision === undefined ||
		worker.expectedSnapshotId === undefined
	) {
		return fail(
			"Completion requires expectedRevision and expectedSnapshotId causal guards.",
			"Reload compact status and retry with its exact revision and snapshot identity.",
			session,
		);
	}
	if (
		worker.expectedRevision !== session.causal.revision ||
		worker.expectedSnapshotId !== session.causal.snapshotId
	) {
		return fail(
			"Completion evidence is stale for the current session revision or snapshot.",
			"Reload compact status, rerun source-bound evidence, and retry against the current causal identity.",
			session,
		);
	}
	const sessionWithPasses = sessionWithOrchestrationPasses(
		session,
		worker.orchestrationPasses,
	);
	let completionDelta: CompletionDelta = {
		session: sessionWithPasses,
		changedFields:
			sessionWithPasses.budget.orchestration.passCount !==
			session.budget.orchestration.passCount
				? ["budget.orchestration"]
				: [],
		appendedReviewAttemptIds: [],
		newEvidenceIds: [],
	};
	const completionDescriptor = (
		additionalFields: readonly CompletionChangedField[] = [],
	) => completionMutationDescriptor(worker, completionDelta, additionalFields);
	const reviewExecutions = worker.reviewExecutions ?? [];
	if (
		reviewExecutions.some(
			(execution) => execution.featureId !== worker.featureId,
		)
	) {
		return completionFailure(
			completionDelta.session,
			"flow_feature_complete",
			"Review execution evidence does not match the active feature.",
			"Submit only review executions for the active feature in this completion attempt.",
			environment,
			completionDescriptor(),
		);
	}
	const recordedReviews = appendReviewExecutions(
		completionDelta.session,
		reviewExecutions,
	);
	if (!recordedReviews.ok) {
		return completionFailure(
			completionDelta.session,
			"flow_feature_complete",
			recordedReviews.message,
			recordedReviews.recovery ??
				"Use a new attemptId for a distinct review execution.",
			environment,
			completionDescriptor(),
		);
	}
	const appendedReviewAttemptIds = [
		...recordedReviews.value.appendedAttemptIds,
	];
	const appendedFailedReview = reviewExecutions.some(
		(execution) =>
			recordedReviews.value.appendedAttemptIds.has(execution.attemptId) &&
			execution.verdict === "failed",
	);
	completionDelta = advanceCompletionDelta(
		completionDelta,
		recordedReviews.value.session,
		appendedReviewAttemptIds.length > 0
			? [
					"budget.reviewExecutions",
					"budget.reviewLifecycle",
					...(appendedFailedReview
						? ([
								"budget.failedReviewCount",
								"budget.failedReviewAttemptsByFeature",
							] as const)
						: []),
				]
			: [],
		appendedReviewAttemptIds,
	);
	const mergedEvidence = appendEvidenceForCompletion(
		completionDelta.session,
		worker.evidence ?? [],
	);
	if (!mergedEvidence.ok) {
		return completionFailure(
			completionDelta.session,
			"flow_feature_complete",
			mergedEvidence.message,
			mergedEvidence.recovery ??
				"Regenerate safe evidence against the current snapshot.",
			environment,
			completionDescriptor(),
		);
	}
	const newEvidenceIds = [...mergedEvidence.value.appendedEvidenceIds];
	completionDelta = advanceCompletionDelta(
		completionDelta,
		mergedEvidence.value.session,
		newEvidenceIds.length > 0 ? ["causal.evidence"] : [],
		[],
		newEvidenceIds,
	);
	const sessionWithBoundEvidence = completionDelta.session;
	const currentSnapshotEvidence =
		sessionWithBoundEvidence.causal.evidence.filter(
			(evidence) =>
				evidence.snapshotId === sessionWithBoundEvidence.causal.snapshotId,
		);
	const currentSourceDigests = new Set(
		currentSnapshotEvidence.map((evidence) => evidence.sourceDigest),
	);
	if (currentSourceDigests.size > 1) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			"Completion evidence refers to multiple source-state digests.",
			"Rerun validation and review on one immutable source/worktree state.",
			environment,
			completionDescriptor(),
		);
	}
	const contradictorySnapshotId = contradictoryReviewSnapshot(
		sessionWithBoundEvidence.budget.reviewExecutions,
	);
	if (contradictorySnapshotId) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			`Review snapshot '${contradictorySnapshotId}' has contradictory terminal verdicts from distinct logical passes.`,
			"Reconcile the review passes on one immutable snapshot before completing the feature.",
			environment,
			completionDescriptor(),
		);
	}

	if (worker.status === "needs_input") {
		const entry = historyEntryFor(worker, "needs_input", environment);
		const budget = cloneBudgetTelemetry(sessionWithBoundEvidence);
		return ok(
			touch(
				{
					...sessionWithBoundEvidence,
					status: "blocked",
					activeFeatureId: null,
					plan: {
						...session.plan,
						features: updateFeature(
							session.plan.features,
							worker.featureId,
							"blocked",
						),
					},
					history: appendHistory(sessionWithBoundEvidence.history, entry),
					budget,
					lastError: null,
				},
				environment,
				{
					...completionDescriptor([
						"status",
						"plan.features.status",
						"history",
						"activeFeatureId",
						...(sessionWithBoundEvidence.lastError
							? (["lastError"] as const)
							: []),
					]),
					blockerDelta: { added: [worker.outcome.summary], removed: [] },
				},
			),
		);
	}
	const featureTruth = latestReviewTruth(
		sessionWithBoundEvidence.budget.reviewExecutions,
		worker.featureId,
		"feature",
	);
	const failedFeatureTruth = featureTruth.find(
		(execution) => execution.verdict === "failed",
	);
	const featureEvidenceFailure = reviewEvidenceFailure(
		sessionWithBoundEvidence,
		featureTruth,
	);
	if (featureEvidenceFailure) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			featureEvidenceFailure.message,
			featureEvidenceFailure.recovery,
			environment,
			completionDescriptor(),
		);
	}

	if (!isPassingReview(worker.featureReview)) {
		if (!failedFeatureTruth) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				"The failed featureReview has no matching failed review execution.",
				"Record the observed failed review execution with a distinct attemptId before retrying completion.",
				environment,
				completionDescriptor(),
			);
		}
		return failedReviewCompletion(
			completionDelta,
			worker,
			worker.featureReview,
			"feature",
			environment,
		);
	}
	if (featureTruth.length === 0) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			"Completion requires a recorded feature review execution.",
			"Include the observed feature review attempt and immutable reviewSnapshotId; summary review fields are not execution evidence.",
			environment,
			completionDescriptor(),
		);
	}
	if (failedFeatureTruth) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			`Feature review execution '${failedFeatureTruth.attemptId}' remains failed.`,
			"Record a passing retry under the same logicalPassId before claiming a passing featureReview.",
			environment,
			completionDescriptor(),
		);
	}
	const validationEvidenceError = validationEvidenceFailure(
		sessionWithBoundEvidence,
		worker,
	);
	if (validationEvidenceError) {
		return completionFailure(
			sessionWithBoundEvidence,
			"flow_feature_complete",
			validationEvidenceError.message,
			validationEvidenceError.recovery,
			environment,
			completionDescriptor(),
		);
	}

	const isFinalFeature = finalFeature(
		sessionWithBoundEvidence,
		worker.featureId,
	);
	if (isFinalFeature && worker.finalReview) {
		const finalTruth = latestReviewTruth(
			sessionWithBoundEvidence.budget.reviewExecutions,
			worker.featureId,
			"final",
		);
		const failedFinalTruth = finalTruth.find(
			(execution) => execution.verdict === "failed",
		);
		const finalEvidenceFailure = reviewEvidenceFailure(
			sessionWithBoundEvidence,
			finalTruth,
		);
		if (finalEvidenceFailure) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				finalEvidenceFailure.message,
				finalEvidenceFailure.recovery,
				environment,
				completionDescriptor(),
			);
		}
		if (!isPassingReview(worker.finalReview)) {
			if (!failedFinalTruth) {
				return completionFailure(
					sessionWithBoundEvidence,
					"flow_feature_complete",
					"The failed finalReview has no matching failed review execution.",
					"Record the observed failed final review execution with a distinct attemptId before retrying completion.",
					environment,
					completionDescriptor(),
				);
			}
			return failedReviewCompletion(
				completionDelta,
				worker,
				worker.finalReview,
				"final",
				environment,
			);
		}
		if (finalTruth.length === 0) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				"Final completion requires a recorded final review execution.",
				"Run final review after the passing feature review and record its immutable review execution before completion.",
				environment,
				completionDescriptor(),
			);
		}
		if (failedFinalTruth) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				`Final review execution '${failedFinalTruth.attemptId}' remains failed.`,
				"Record a passing retry under the same logicalPassId before claiming a passing finalReview.",
				environment,
				completionDescriptor(),
			);
		}
		const latestFeatureCompletion = Math.max(
			...featureTruth.map((execution) => Date.parse(execution.completedAt)),
		);
		const prematureFinal = finalTruth.find(
			(execution) => Date.parse(execution.startedAt) < latestFeatureCompletion,
		);
		if (prematureFinal) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				`Final review execution '${prematureFinal.attemptId}' started before feature review passed.`,
				"Economy mode requires a passing feature review before final review begins.",
				environment,
				completionDescriptor(),
			);
		}
		// Cross-check the bound review *evidence* chronology, not just the execution
		// timestamps: final-review evidence must not predate the feature-review
		// evidence it follows, even when the two agree at the execution level.
		const featureEvidenceCompletions = boundReviewEvidence(
			sessionWithBoundEvidence,
			featureTruth,
		).map((evidence) => Date.parse(evidence.completedAt));
		const latestFeatureEvidenceCompletion =
			featureEvidenceCompletions.length > 0
				? Math.max(...featureEvidenceCompletions)
				: latestFeatureCompletion;
		const prematureFinalEvidence = boundReviewEvidence(
			sessionWithBoundEvidence,
			finalTruth,
		).find(
			(evidence) =>
				Date.parse(evidence.startedAt) < latestFeatureEvidenceCompletion,
		);
		if (prematureFinalEvidence) {
			return completionFailure(
				sessionWithBoundEvidence,
				"flow_feature_complete",
				`Final review evidence '${prematureFinalEvidence.evidenceId}' predates the feature review it follows.`,
				"Final review must run after the passing feature review; rebuild its evidence against the current source state.",
				environment,
				completionDescriptor(),
			);
		}
	}

	const validation = validateCompletion(
		sessionWithBoundEvidence,
		worker,
		environment,
		completionDescriptor(),
	);
	if (!validation.ok) return validation;

	const entry = historyEntryFor(worker, "completed", environment);
	const features = updateFeature(
		session.plan.features,
		worker.featureId,
		"completed",
	);
	const allComplete = features.every(
		(feature) => feature.status === "completed",
	);
	const now = environment.now();
	const hadFailedReviewAttempts = Object.hasOwn(
		session.budget.failedReviewAttemptsByFeature,
		worker.featureId,
	);
	completionDelta = {
		...completionDelta,
		changedFields: completionDelta.changedFields.filter(
			(field) => field !== "budget.failedReviewAttemptsByFeature",
		),
	};
	const budget = completionBudget(sessionWithBoundEvidence, worker);
	return ok(
		touch(
			{
				...sessionWithBoundEvidence,
				status: allComplete ? "completed" : "ready",
				activeFeatureId: null,
				plan: { ...session.plan, features },
				history: appendHistory(sessionWithBoundEvidence.history, entry),
				budget,
				closure: allComplete
					? { kind: "completed", summary: worker.summary, recordedAt: now }
					: null,
				lastError: null,
				timestamps: {
					...sessionWithBoundEvidence.timestamps,
					completedAt: allComplete
						? now
						: sessionWithBoundEvidence.timestamps.completedAt,
				},
			},
			environment,
			{
				...completionDescriptor([
					"status",
					"plan.features.status",
					"activeFeatureId",
					"history",
					"budget.reviewCount",
					...(hadFailedReviewAttempts
						? (["budget.failedReviewAttemptsByFeature"] as const)
						: []),
					...(allComplete ? (["closure"] as const) : []),
					...(sessionWithBoundEvidence.lastError
						? (["lastError"] as const)
						: []),
					...(allComplete ? (["timestamps.completedAt"] as const) : []),
				]),
				recordedAt: now,
				blockerDelta: {
					added: [],
					removed: sessionWithBoundEvidence.lastError
						? [sessionWithBoundEvidence.lastError.summary]
						: [],
				},
			},
		),
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
	if (!session.plan) return fail("There is no active plan to reset.");
	if (!session.plan.features.some((feature) => feature.id === featureId)) {
		return fail(`Feature '${featureId}' is not in the plan.`);
	}
	const affected = dependentFeatureIds(session.plan.features, featureId);
	const activeFeatureId =
		session.activeFeatureId && affected.has(session.activeFeatureId)
			? null
			: session.activeFeatureId;
	const nextFeatures = session.plan.features.map((feature) =>
		affected.has(feature.id)
			? { ...feature, status: "pending" as const }
			: feature,
	);
	const budget = cloneBudgetTelemetry(session);
	const failedReviewAttemptsByFeature = {
		...budget.failedReviewAttemptsByFeature,
	};
	for (const featureIdToClear of affected) {
		delete failedReviewAttemptsByFeature[featureIdToClear];
	}
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
				plan: {
					...session.plan,
					features: nextFeatures,
				},
				budget: {
					...budget,
					failedReviewAttemptsByFeature,
				},
				lastError: null,
				timestamps: { ...session.timestamps, completedAt: null },
			},
			environment,
			{
				operationId: guard?.operationId,
				operationKind: "feature_reset",
				requestDigest,
				changedEntity: { kind: "feature", id: featureId },
				changedFields: [
					"status",
					"plan.features.status",
					"activeFeatureId",
					"budget.failedReviewAttemptsByFeature",
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
	const requestDigest = canonicalOperationRequestDigest("session_close", {
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
	if (session.closure) return ok(session);
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
	}
	const closureSummary = summary ?? `Session closed as ${kind}.`;
	const now = environment.now();
	return ok(
		touch(
			{
				...session,
				status: kind === "completed" ? "completed" : session.status,
				activeFeatureId: null,
				closure: {
					kind,
					summary: closureSummary,
					recordedAt: now,
				},
				timestamps: {
					...session.timestamps,
					completedAt:
						kind === "completed" ? now : session.timestamps.completedAt,
				},
			},
			environment,
			{
				operationId: guard?.operationId,
				operationKind: "session_close",
				requestDigest,
				recordedAt: now,
				changedEntity: { kind: "closure", id: session.id },
				changedFields: ["closure", "activeFeatureId", "status"],
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
		return "Close/archive the session or start a new goal.";
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
	isFinalFeature: boolean,
	expectedRevision: number,
	expectedSnapshotId: SnapshotId,
): ExecutionProjection {
	return {
		view: "execution",
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

function planExecutionBudgetFailure(goal: string, plan: Plan): string | null {
	for (const feature of plan.features) {
		for (const isFinalFeature of [false, true]) {
			const projection = buildExecutionProjection(
				goal,
				plan,
				feature,
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
		closure: session.closure ? { kind: session.closure.kind } : null,
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
	return {
		view: "detail" as const,
		compact: compactSessionProjection(session),
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
			featureId: entry.featureId,
			status: entry.status,
			summary: boundedText(entry.summary, 500),
			recordedAt: entry.recordedAt,
			validation: entry.validationRun.map((run) => ({
				status: run.status,
				summary: boundedText(run.summary, 300),
			})),
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
	if (
		(request.expectedRevision !== undefined &&
			request.expectedRevision !== session.causal.revision) ||
		(request.expectedSnapshotId !== undefined &&
			request.expectedSnapshotId !== session.causal.snapshotId)
	) {
		return fail(
			"Reviewer assignment is stale for the current revision or snapshot.",
			"Regenerate the review packet and reviewer projection from compact status.",
		);
	}
	if (
		!isSha256Digest(request.packetHash) ||
		request.evidenceRefs.some((reference) => !isSha256Digest(reference))
	) {
		return fail(
			"Reviewer projection requires canonical packet and evidence digests.",
			"Build the reviewer packet from immutable hash-addressed artifacts.",
		);
	}
	if (!session.plan || session.approval !== "approved") {
		return fail(
			"Reviewer assignment requires an approved Flow plan.",
			"Approve the plan before assigning feature or final review.",
		);
	}
	const feature = session.plan.features.find(
		(candidate) => candidate.id === request.featureId,
	);
	if (!feature)
		return fail(`Feature '${request.featureId}' is not in the plan.`);
	if (
		session.activeFeatureId !== feature.id ||
		feature.status !== "in_progress"
	) {
		return fail(
			`Feature '${request.featureId}' is not the active in-progress feature.`,
			"Start the approved feature before assigning its review.",
		);
	}
	const common = {
		view: "reviewer",
		featureId: feature.id,
		packetHash: boundedText(request.packetHash, 80),
		evidenceRefs: boundedStrings(request.evidenceRefs, 8, 80),
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
	} as const;
	if (request.reviewKind === "feature") {
		return ok({
			...common,
			reviewKind: "feature",
			assignedScope: feature.targets.slice(0, 12).map(boundedScopeReference),
			requiredDepth: feature.reviewDepth,
		});
	}
	if (!finalFeature(session, feature.id)) {
		return fail(
			`Feature '${request.featureId}' is not eligible for final review.`,
			"Complete every other approved feature before assigning final review.",
		);
	}
	const assignedScope = [
		...new Set(
			session.plan.features.flatMap((plannedFeature) => plannedFeature.targets),
		),
	]
		.slice(0, 32)
		.map(boundedScopeReference);
	return ok({
		...common,
		reviewKind: "final",
		assignedScope,
		requiredDepth: session.plan.finalReviewPolicy,
		requirements: boundedStrings(session.plan.requirements, 32, 240),
		decisions: boundedStrings(session.plan.decisions, 32, 240),
	});
}

export function mutationReceiptProjection(
	session: Session,
	warnings: readonly string[] = [],
	operationId?: string,
) {
	const mutation = operationId
		? (session.causal.mutations.find(
				(candidate) => candidate.operationId === operationId,
			) ?? null)
		: (session.causal.mutations.at(-1) ?? null);
	return {
		view: "mutation_receipt" as const,
		status: session.status,
		operationId: mutation?.operationId ?? null,
		revision: mutation?.revision ?? session.causal.revision,
		snapshotId: mutation?.currentSnapshotId ?? session.causal.snapshotId,
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
