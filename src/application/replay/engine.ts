import type {
	OpaqueId,
	ReplayControlDefect,
	ReplayDecision,
	ReplayFixture,
	ReplayReason,
	ReplayScenario,
	ReplayScenarioId,
	ReplayVariant,
	Sha256Digest,
} from "./contract.js";

export type ReplayMismatch =
	| "contradictory_review_verdicts"
	| "duplicate_mutation_commit"
	| "mutation_left_uncommitted"
	| "recovery_without_crash"
	| "snapshot_revision_mismatch"
	| "terminal_decision_missing"
	| "terminal_decision_multiple"
	| "terminal_not_final"
	| "terminal_decision_mismatch"
	| "terminal_reason_mismatch"
	| "terminal_revision_mismatch"
	| "terminal_digest_mismatch";

export interface ReplayCounters {
	readonly validationAttempts: number;
	readonly featureReviewAttempts: number;
	readonly finalReviewAttempts: number;
	readonly submittedReviewAttempts: number;
	readonly failedReviewAttempts: number;
	readonly retries: number;
	readonly findingCount: number;
	readonly duplicateFindingCount: number;
	readonly invalidHandoffs: number;
	readonly invalidTelemetry: number;
	readonly schemaFailures: number;
	readonly compactions: number;
	readonly mutationStarts: number;
	readonly mutationCommits: number;
	readonly crashes: number;
	readonly recoveries: number;
}

/** Terminal truth the fixture asserts; the oracle treats it as an expectation. */
export interface ReplayTerminalExpectation {
	readonly decision: ReplayDecision;
	readonly reason: ReplayReason;
	readonly revision: number;
	readonly stateDigest: Sha256Digest;
}

/**
 * Per-field comparison of the fixture's asserted terminal against independently
 * derived truth. `unavailable` means no independent state-bearing event derived
 * the field, so the assertion is neither confirmed nor refuted — never assumed.
 */
export type TerminalComparisonStatus = "matched" | "mismatched" | "unavailable";

export interface ReplayTerminalComparison {
	readonly decision: TerminalComparisonStatus;
	readonly reason: TerminalComparisonStatus;
	readonly revision: TerminalComparisonStatus;
	readonly stateDigest: TerminalComparisonStatus;
	/** Roll-up: mismatched if any field mismatched, else unavailable, else matched. */
	readonly status: TerminalComparisonStatus;
}

interface CommonScenarioResult {
	readonly scenarioId: ReplayScenarioId;
	readonly variant: ReplayVariant;
	readonly counters: ReplayCounters;
	readonly evidenceRefs: readonly OpaqueId[];
	readonly stateDigestRefs: readonly Sha256Digest[];
	readonly defects: readonly ReplayControlDefect[];
	readonly mismatches: readonly ReplayMismatch[];
	/** Durable revision derived from state-bearing events, or null when absent. */
	readonly derivedRevision: number | null;
	/** Durable state digest derived from state-bearing events, or null. */
	readonly derivedStateDigest: Sha256Digest | null;
	/** The fixture's asserted terminal truth, compared against derived truth. */
	readonly expectedTerminal: ReplayTerminalExpectation | null;
	/** Fail-closed comparison of the asserted terminal against derived truth. */
	readonly terminalComparison: ReplayTerminalComparison;
}

export type ReplayScenarioResult =
	| (CommonScenarioResult & {
			readonly supported: false;
			readonly decision: null;
			readonly reason: "unsupported_variant";
	  })
	| (CommonScenarioResult & {
			readonly variant: "A";
			readonly supported: true;
			readonly decision: ReplayDecision;
			readonly reason: ReplayReason;
	  });

export interface ReplayFixtureResult {
	readonly fixtureId: OpaqueId;
	readonly variant: ReplayVariant;
	readonly supported: boolean;
	readonly scenarios: readonly ReplayScenarioResult[];
}

function emptyCounters(): ReplayCounters {
	return {
		validationAttempts: 0,
		featureReviewAttempts: 0,
		finalReviewAttempts: 0,
		submittedReviewAttempts: 0,
		failedReviewAttempts: 0,
		retries: 0,
		findingCount: 0,
		duplicateFindingCount: 0,
		invalidHandoffs: 0,
		invalidTelemetry: 0,
		schemaFailures: 0,
		compactions: 0,
		mutationStarts: 0,
		mutationCommits: 0,
		crashes: 0,
		recoveries: 0,
	};
}

type TerminalEvent = Extract<
	ReplayScenario["events"][number],
	{ kind: "terminal_decision" }
>;

type ReviewAttemptEvent = Extract<
	ReplayScenario["events"][number],
	{ kind: "feature_review_attempt" | "final_review_attempt" }
>;

type RetryFindingDeltaEvent = Extract<
	ReplayScenario["events"][number],
	{ kind: "retry_finding_delta" }
>;

interface IndexedReviewAttempt {
	readonly event: ReviewAttemptEvent;
	readonly eventIndex: number;
}

interface ValidRetryDelta {
	readonly event: RetryFindingDeltaEvent;
	readonly current: IndexedReviewAttempt;
}

interface ReviewPassReduction {
	readonly featureReviewAttempts: number;
	readonly finalReviewAttempts: number;
	readonly submittedReviewAttempts: number;
	readonly failedReviewAttempts: number;
	readonly findingCount: number;
	readonly duplicateFindingCount: number;
	readonly evidenceRefs: readonly OpaqueId[];
	readonly invalidCausality: boolean;
	readonly contradictoryVerdicts: boolean;
	readonly retryUnchanged: boolean;
	readonly retryResolved: boolean;
	readonly unsubmittedFailure: boolean;
	readonly reviewFailed: boolean;
	readonly anyPassedReview: boolean;
}

function equalFingerprintMultiset(
	left: readonly Sha256Digest[],
	right: readonly Sha256Digest[],
): boolean {
	if (left.length !== right.length) return false;
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function equalFindingSet(
	left: readonly Sha256Digest[],
	right: readonly Sha256Digest[],
): boolean {
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	return (
		leftSet.size === rightSet.size &&
		[...leftSet].every((value) => rightSet.has(value))
	);
}

function findingOverlapCount(
	left: readonly Sha256Digest[],
	right: readonly Sha256Digest[],
): number {
	const leftSet = new Set(left);
	return new Set(right.filter((value) => leftSet.has(value))).size;
}

function sameReviewAttemptSemantics(
	left: ReviewAttemptEvent,
	right: ReviewAttemptEvent,
): boolean {
	return (
		left.kind === right.kind &&
		left.operationId === right.operationId &&
		left.workerId === right.workerId &&
		left.role === right.role &&
		left.modelClass === right.modelClass &&
		left.attemptId === right.attemptId &&
		left.logicalPassId === right.logicalPassId &&
		left.snapshotId === right.snapshotId &&
		left.evidenceRef === right.evidenceRef &&
		left.verdict === right.verdict &&
		left.submitted === right.submitted &&
		left.duplicateFindingCount === right.duplicateFindingCount &&
		equalFingerprintMultiset(
			left.findingFingerprints,
			right.findingFingerprints,
		)
	);
}

function validRetryDelta(
	delta: RetryFindingDeltaEvent,
	deltaIndex: number,
	attemptsById: ReadonlyMap<OpaqueId, IndexedReviewAttempt>,
	attemptsByPass: ReadonlyMap<OpaqueId, readonly IndexedReviewAttempt[]>,
): ValidRetryDelta | null {
	if (delta.previousAttemptId === delta.currentAttemptId) return null;
	const previous = attemptsById.get(delta.previousAttemptId);
	const current = attemptsById.get(delta.currentAttemptId);
	if (!previous || !current) return null;
	if (
		previous.event.logicalPassId !== delta.logicalPassId ||
		current.event.logicalPassId !== delta.logicalPassId ||
		previous.event.kind !== current.event.kind ||
		!previous.event.submitted ||
		!current.event.submitted ||
		previous.eventIndex >= current.eventIndex ||
		current.eventIndex >= deltaIndex ||
		previous.event.verdict !== "failed"
	) {
		return null;
	}

	const passAttempts = attemptsByPass.get(delta.logicalPassId);
	const previousIndex = passAttempts?.findIndex(
		(attempt) => attempt.event.attemptId === delta.previousAttemptId,
	);
	const currentIndex = passAttempts?.findIndex(
		(attempt) => attempt.event.attemptId === delta.currentAttemptId,
	);
	if (
		previousIndex === undefined ||
		currentIndex === undefined ||
		previousIndex < 0 ||
		currentIndex !== previousIndex + 1
	) {
		return null;
	}

	const previousFindings = previous.event.findingFingerprints;
	const currentFindings = current.event.findingFingerprints;
	if (
		delta.previousFindingCount !== previousFindings.length ||
		delta.currentFindingCount !== currentFindings.length ||
		delta.duplicateFindingCount !==
			findingOverlapCount(previousFindings, currentFindings)
	) {
		return null;
	}

	const findingSetsMatch = equalFindingSet(previousFindings, currentFindings);
	const semanticsMatch =
		delta.delta === "resolved"
			? current.event.verdict === "passed" && currentFindings.length === 0
			: delta.delta === "unchanged"
				? current.event.verdict === "failed" && findingSetsMatch
				: current.event.verdict === "failed" &&
					currentFindings.length > 0 &&
					!findingSetsMatch;
	return semanticsMatch ? { event: delta, current } : null;
}

/**
 * Projects append-only review evidence into latest logical-pass truth.
 *
 * The reduction is pure: repeated attempt identities with identical semantic
 * evidence are idempotent, conflicting reuse and invalid retry links fail
 * closed, and historical attempts never override the latest pass projection.
 */
export function reduceReviewPasses(
	events: readonly ReplayScenario["events"][number][],
): ReviewPassReduction {
	const attemptsById = new Map<OpaqueId, IndexedReviewAttempt>();
	const attemptsByPass = new Map<OpaqueId, IndexedReviewAttempt[]>();
	let invalidCausality = false;

	for (const [eventIndex, event] of events.entries()) {
		if (
			event.kind !== "feature_review_attempt" &&
			event.kind !== "final_review_attempt"
		) {
			continue;
		}
		const existing = attemptsById.get(event.attemptId);
		if (existing) {
			if (!sameReviewAttemptSemantics(existing.event, event)) {
				invalidCausality = true;
			}
			continue;
		}

		const indexed = { event, eventIndex };
		attemptsById.set(event.attemptId, indexed);
		const passAttempts = attemptsByPass.get(event.logicalPassId) ?? [];
		if (passAttempts.length > 0 && passAttempts[0]?.event.kind !== event.kind) {
			invalidCausality = true;
		}
		passAttempts.push(indexed);
		attemptsByPass.set(event.logicalPassId, passAttempts);
		if (!event.submitted && event.verdict === "passed") {
			invalidCausality = true;
		}
	}

	const validDeltas: ValidRetryDelta[] = [];
	for (const [eventIndex, event] of events.entries()) {
		if (event.kind !== "retry_finding_delta") continue;
		const validated = validRetryDelta(
			event,
			eventIndex,
			attemptsById,
			attemptsByPass,
		);
		if (validated) validDeltas.push(validated);
		else invalidCausality = true;
	}

	const attempts = [...attemptsById.values()].map(({ event }) => event);
	const latestAttempts = [...attemptsByPass.values()]
		.map((passAttempts) => passAttempts.at(-1))
		.filter(
			(attempt): attempt is IndexedReviewAttempt => attempt !== undefined,
		);
	const latestAttemptIds = new Set(
		latestAttempts.map(({ event }) => event.attemptId),
	);
	const latestVerdictsBySnapshot = new Map<
		OpaqueId,
		Set<"passed" | "failed">
	>();
	for (const { event } of latestAttempts) {
		const verdicts =
			latestVerdictsBySnapshot.get(event.snapshotId) ?? new Set();
		verdicts.add(event.verdict);
		latestVerdictsBySnapshot.set(event.snapshotId, verdicts);
	}

	return {
		featureReviewAttempts: attempts.filter(
			(event) => event.kind === "feature_review_attempt",
		).length,
		finalReviewAttempts: attempts.filter(
			(event) => event.kind === "final_review_attempt",
		).length,
		submittedReviewAttempts: attempts.filter((event) => event.submitted).length,
		failedReviewAttempts: attempts.filter((event) => event.verdict === "failed")
			.length,
		findingCount: attempts.reduce(
			(total, event) => total + event.findingFingerprints.length,
			0,
		),
		duplicateFindingCount: attempts.reduce(
			(total, event) => total + event.duplicateFindingCount,
			0,
		),
		evidenceRefs: [...new Set(attempts.map((event) => event.evidenceRef))],
		invalidCausality,
		contradictoryVerdicts: [...latestVerdictsBySnapshot.values()].some(
			(verdicts) => verdicts.size > 1,
		),
		retryUnchanged: validDeltas.some(
			({ event, current }) =>
				event.delta === "unchanged" &&
				latestAttemptIds.has(current.event.attemptId),
		),
		retryResolved: validDeltas.some(
			({ event, current }) =>
				event.delta === "resolved" &&
				latestAttemptIds.has(current.event.attemptId),
		),
		unsubmittedFailure: latestAttempts.some(
			({ event }) => !event.submitted && event.verdict === "failed",
		),
		reviewFailed: latestAttempts.some(
			({ event }) => event.verdict === "failed",
		),
		anyPassedReview: latestAttempts.some(
			({ event }) => event.submitted && event.verdict === "passed",
		),
	};
}

interface DerivedSignals {
	contradictoryVerdicts: boolean;
	invalidHandoff: boolean;
	malformedTelemetry: boolean;
	mutationRecovered: boolean;
	mutationIncomplete: boolean;
	retryUnchanged: boolean;
	retryResolved: boolean;
	unsubmittedFailure: boolean;
	staleValidation: boolean;
	reviewFailed: boolean;
	anyPassedReview: boolean;
	featureCompleted: boolean;
	activeFinalInProgress: boolean;
}

/**
 * Derives the actual terminal decision/reason from event causality alone.
 *
 * The oracle never reads the fixture's asserted terminal decision, reason,
 * revision, or state digest while deriving truth: the derivation consumes only
 * the causal signals produced by non-terminal events.
 */
function deriveTerminalTruth(signals: DerivedSignals): {
	decision: ReplayDecision;
	reason: ReplayReason;
} {
	if (signals.contradictoryVerdicts) {
		return { decision: "blocked", reason: "contradictory_review_verdicts" };
	}
	if (signals.invalidHandoff) {
		return { decision: "blocked", reason: "handoff_invalid" };
	}
	if (signals.malformedTelemetry) {
		return { decision: "blocked", reason: "optional_telemetry_malformed" };
	}
	if (signals.mutationRecovered) {
		return { decision: "recovered", reason: "mutation_recovered" };
	}
	if (signals.mutationIncomplete) {
		return { decision: "blocked", reason: "mutation_incomplete" };
	}
	if (signals.retryUnchanged) {
		return { decision: "retry", reason: "finding_unchanged" };
	}
	if (signals.unsubmittedFailure) {
		return { decision: "blocked", reason: "review_failure_unsubmitted" };
	}
	if (signals.reviewFailed) {
		return { decision: "blocked", reason: "review_failed" };
	}
	if (signals.retryResolved) {
		return { decision: "complete", reason: "review_retry_passed" };
	}
	if (signals.staleValidation && signals.anyPassedReview) {
		return { decision: "complete", reason: "validation_stale" };
	}
	if (signals.activeFinalInProgress) {
		return { decision: "blocked", reason: "active_final_feature_in_progress" };
	}
	if (
		signals.featureCompleted &&
		signals.anyPassedReview &&
		!signals.reviewFailed &&
		!signals.staleValidation
	) {
		return { decision: "complete", reason: "all_gates_passed" };
	}
	// A schema-valid but causally impossible sequence is failed, never coerced
	// into the last observed terminal label.
	return { decision: "failed", reason: "schema_invalid" };
}

function rollupComparison(
	fields: readonly TerminalComparisonStatus[],
): TerminalComparisonStatus {
	if (fields.some((field) => field === "mismatched")) return "mismatched";
	if (fields.some((field) => field === "unavailable")) return "unavailable";
	return "matched";
}

function buildTerminalComparison(
	actual: { decision: ReplayDecision; reason: ReplayReason },
	expected: ReplayTerminalExpectation,
	derived: {
		derivedRevision: number | null;
		derivedStateDigest: Sha256Digest | null;
	},
): ReplayTerminalComparison {
	const decision: TerminalComparisonStatus =
		actual.decision === expected.decision ? "matched" : "mismatched";
	const reason: TerminalComparisonStatus =
		actual.reason === expected.reason ? "matched" : "mismatched";
	const revision: TerminalComparisonStatus =
		derived.derivedRevision === null
			? "unavailable"
			: derived.derivedRevision === expected.revision
				? "matched"
				: "mismatched";
	const stateDigest: TerminalComparisonStatus =
		derived.derivedStateDigest === null
			? "unavailable"
			: derived.derivedStateDigest === expected.stateDigest
				? "matched"
				: "mismatched";
	return {
		decision,
		reason,
		revision,
		stateDigest,
		status: rollupComparison([decision, reason, revision, stateDigest]),
	};
}

export function replayScenario(
	scenario: ReplayScenario,
	variant: ReplayVariant,
): ReplayScenarioResult {
	const review = reduceReviewPasses(scenario.events);
	const mutableCounters: { -readonly [K in keyof ReplayCounters]: number } = {
		...emptyCounters(),
		featureReviewAttempts: review.featureReviewAttempts,
		finalReviewAttempts: review.finalReviewAttempts,
		submittedReviewAttempts: review.submittedReviewAttempts,
		failedReviewAttempts: review.failedReviewAttempts,
		findingCount: review.findingCount,
		duplicateFindingCount: review.duplicateFindingCount,
	};
	const evidenceRefs = new Set<OpaqueId>(review.evidenceRefs);
	const stateDigestRefs = new Set<Sha256Digest>([scenario.initialStateDigest]);
	const mismatches = new Set<ReplayMismatch>();
	if (review.contradictoryVerdicts) {
		mismatches.add("contradictory_review_verdicts");
	}
	const mutationStarts = new Set<OpaqueId>();
	const mutationCommits = new Set<OpaqueId>();
	const mutationRecoveries = new Set<OpaqueId>();
	const mutationCrashes = new Set<OpaqueId>();
	const snapshotRevisions = new Map<OpaqueId, number>();
	const terminalEvents: TerminalEvent[] = [];

	let lastDurableRevision: number | null = null;
	let lastDurableDigest: Sha256Digest | null = null;
	let lastFeatureStatus: "pending" | "in_progress" | "blocked" | "completed" =
		"pending";
	let lastSessionStatus:
		| "planning"
		| "ready"
		| "running"
		| "blocked"
		| "completed"
		| null = null;
	let sawSessionState = false;
	let invalidHandoff = false;
	let malformedTelemetry = false;
	let staleValidation = false;

	for (const event of scenario.events) {
		switch (event.kind) {
			case "session_state":
				stateDigestRefs.add(event.stateDigest);
				lastDurableRevision = event.revision;
				lastDurableDigest = event.stateDigest;
				lastFeatureStatus = event.featureStatus;
				lastSessionStatus = event.sessionStatus;
				sawSessionState = true;
				break;
			case "validation": {
				mutableCounters.validationAttempts += 1;
				evidenceRefs.add(event.evidenceRef);
				if (event.freshness === "stale") staleValidation = true;
				const knownRevision = snapshotRevisions.get(event.snapshotId);
				if (knownRevision !== undefined && knownRevision !== event.revision) {
					mismatches.add("snapshot_revision_mismatch");
				}
				snapshotRevisions.set(event.snapshotId, event.revision);
				break;
			}
			case "feature_review_attempt":
			case "final_review_attempt": {
				break;
			}
			case "handoff_validity":
				evidenceRefs.add(event.evidenceRef);
				if (event.status !== "valid") {
					mutableCounters.invalidHandoffs += 1;
					invalidHandoff = true;
				}
				break;
			case "telemetry_validity":
				if (event.status !== "valid") {
					mutableCounters.invalidTelemetry += 1;
					malformedTelemetry = true;
				}
				break;
			case "operation_metrics":
				break;
			case "retry_finding_delta":
				mutableCounters.retries += 1;
				mutableCounters.duplicateFindingCount += event.duplicateFindingCount;
				break;
			case "compaction":
				mutableCounters.compactions += 1;
				break;
			case "schema_failure":
				mutableCounters.schemaFailures += 1;
				if (event.target === "telemetry") malformedTelemetry = true;
				break;
			case "mutation_start":
				mutableCounters.mutationStarts += 1;
				mutationStarts.add(event.mutationId);
				break;
			case "mutation_commit":
				mutableCounters.mutationCommits += 1;
				if (mutationCommits.has(event.mutationId)) {
					mismatches.add("duplicate_mutation_commit");
				}
				mutationCommits.add(event.mutationId);
				stateDigestRefs.add(event.stateDigest);
				lastDurableRevision = event.revision;
				lastDurableDigest = event.stateDigest;
				break;
			case "mutation_crash":
				mutableCounters.crashes += 1;
				mutationCrashes.add(event.mutationId);
				break;
			case "mutation_recovery":
				mutableCounters.recoveries += 1;
				mutationRecoveries.add(event.mutationId);
				if (!mutationCrashes.has(event.mutationId)) {
					mismatches.add("recovery_without_crash");
				}
				stateDigestRefs.add(event.stateDigest);
				lastDurableRevision = event.revision;
				lastDurableDigest = event.stateDigest;
				break;
			case "terminal_decision":
				// The terminal decision is an expectation only. Its stateDigest and
				// evidenceRefs must never enter the observed/derived reference sets;
				// otherwise an unverified assertion would masquerade as observed data.
				terminalEvents.push(event);
				break;
		}
	}

	let mutationIncomplete = false;
	for (const mutationId of mutationStarts) {
		if (
			!mutationCommits.has(mutationId) &&
			!mutationRecoveries.has(mutationId)
		) {
			mismatches.add("mutation_left_uncommitted");
			mutationIncomplete = true;
		}
	}

	const signals: DerivedSignals = {
		contradictoryVerdicts: review.contradictoryVerdicts,
		invalidHandoff,
		malformedTelemetry,
		mutationRecovered: mutationRecoveries.size > 0,
		mutationIncomplete,
		retryUnchanged: review.retryUnchanged,
		retryResolved: review.retryResolved,
		unsubmittedFailure: review.unsubmittedFailure,
		staleValidation,
		reviewFailed: review.reviewFailed,
		anyPassedReview: review.anyPassedReview,
		featureCompleted: lastFeatureStatus === "completed",
		activeFinalInProgress:
			sawSessionState &&
			lastFeatureStatus === "in_progress" &&
			lastSessionStatus === "running",
	};

	const derived = deriveTerminalTruth(signals);

	// Terminal events assert expected truth; they must be singular and final.
	if (terminalEvents.length === 0) mismatches.add("terminal_decision_missing");
	if (terminalEvents.length > 1) mismatches.add("terminal_decision_multiple");
	const terminal =
		terminalEvents.length === 1 ? (terminalEvents[0] as TerminalEvent) : null;
	const lastEvent = scenario.events.at(-1);
	if (terminal && lastEvent && lastEvent.kind !== "terminal_decision") {
		mismatches.add("terminal_not_final");
	}

	const expectedTerminal: ReplayTerminalExpectation | null = terminal
		? {
				decision: terminal.decision,
				reason: terminal.reason,
				revision: terminal.revision,
				stateDigest: terminal.stateDigest,
			}
		: null;

	// A causally impossible layout (missing, duplicated, or non-final terminal)
	// resolves to a failure rather than trusting any asserted label.
	const causallyImpossible =
		terminalEvents.length !== 1 ||
		mismatches.has("terminal_not_final") ||
		review.invalidCausality;
	const actual: { decision: ReplayDecision; reason: ReplayReason } =
		causallyImpossible
			? { decision: "failed", reason: "schema_invalid" }
			: derived;

	// Compare each asserted field against independently derived truth. A field
	// with no independent state-bearing derivation is `unavailable` (explicitly
	// unverified) rather than silently omitted and left looking clean.
	const terminalComparison: ReplayTerminalComparison =
		variant !== "A" || terminal === null
			? {
					decision: "unavailable",
					reason: "unavailable",
					revision: "unavailable",
					stateDigest: "unavailable",
					status: "unavailable",
				}
			: buildTerminalComparison(actual, terminal, {
					derivedRevision: lastDurableRevision,
					derivedStateDigest: lastDurableDigest,
				});

	if (terminalComparison.decision === "mismatched") {
		mismatches.add("terminal_decision_mismatch");
	}
	if (terminalComparison.reason === "mismatched") {
		mismatches.add("terminal_reason_mismatch");
	}
	if (terminalComparison.revision === "mismatched") {
		mismatches.add("terminal_revision_mismatch");
	}
	if (terminalComparison.stateDigest === "mismatched") {
		mismatches.add("terminal_digest_mismatch");
	}

	const common: CommonScenarioResult = {
		scenarioId: scenario.id,
		variant,
		counters: mutableCounters,
		evidenceRefs: [...evidenceRefs].sort(),
		stateDigestRefs: [...stateDigestRefs].sort(),
		defects: [...scenario.controlDefects].sort(),
		mismatches: [...mismatches].sort(),
		derivedRevision: lastDurableRevision,
		derivedStateDigest: lastDurableDigest,
		expectedTerminal,
		terminalComparison,
	};

	if (variant !== "A") {
		return {
			...common,
			supported: false,
			decision: null,
			reason: "unsupported_variant",
		};
	}

	return {
		...common,
		variant: "A",
		supported: true,
		decision: actual.decision,
		reason: actual.reason,
	};
}

export function replayFixture(
	fixture: ReplayFixture,
	variant: ReplayVariant,
): ReplayFixtureResult {
	const scenarios = fixture.scenarios.map((scenario) =>
		replayScenario(scenario, variant),
	);
	return {
		fixtureId: fixture.fixtureId,
		variant,
		supported: scenarios.every(({ supported }) => supported),
		scenarios,
	};
}
