import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	parseReplayFixture,
	REPLAY_SCENARIO_IDS,
	type ReplayFixture,
	type ReplayScenario,
	type ReplayScenarioId,
	reduceReviewPasses,
	replayFixture,
	replayScenario,
} from "../src/application/replay/index.js";

const FIXTURE_PATH = "tests/fixtures/replay/long-running-v5/fixture.json";

const TERMINAL_MISMATCHES = [
	"terminal_decision_mismatch",
	"terminal_reason_mismatch",
	"terminal_revision_mismatch",
	"terminal_digest_mismatch",
	"terminal_decision_missing",
	"terminal_decision_multiple",
	"terminal_not_final",
] as const;

function loadFixture(): ReplayFixture {
	return parseReplayFixture(
		JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown,
	);
}

function scenarioById(id: ReplayScenarioId): ReplayScenario {
	const scenario = loadFixture().scenarios.find(
		(candidate) => candidate.id === id,
	);
	if (!scenario) throw new Error(`Missing fixture scenario ${id}.`);
	return structuredClone(scenario);
}

function terminalOf(scenario: ReplayScenario) {
	const terminal = scenario.events.findLast(
		(event) => event.kind === "terminal_decision",
	);
	if (terminal?.kind !== "terminal_decision") {
		throw new Error(`Scenario ${scenario.id} has no terminal event.`);
	}
	return terminal;
}

function withTerminal(
	scenario: ReplayScenario,
	patch: Partial<ReturnType<typeof terminalOf>>,
): ReplayScenario {
	const clone = structuredClone(scenario);
	const index = clone.events.findLastIndex(
		(event) => event.kind === "terminal_decision",
	);
	const current = clone.events[index];
	if (current?.kind !== "terminal_decision") {
		throw new Error("Expected a terminal event to patch.");
	}
	clone.events[index] = { ...current, ...patch };
	return clone;
}

type ReviewAttemptEvent = Extract<
	ReplayScenario["events"][number],
	{ kind: "feature_review_attempt" | "final_review_attempt" }
>;

type RetryFindingDeltaEvent = Extract<
	ReplayScenario["events"][number],
	{ kind: "retry_finding_delta" }
>;

function reviewAttemptOf(
	scenario: ReplayScenario,
	attemptId: string,
): ReviewAttemptEvent {
	const attempt = scenario.events.find(
		(event) =>
			(event.kind === "feature_review_attempt" ||
				event.kind === "final_review_attempt") &&
			event.attemptId === attemptId,
	);
	if (
		attempt?.kind !== "feature_review_attempt" &&
		attempt?.kind !== "final_review_attempt"
	) {
		throw new Error(`Missing review attempt ${attemptId}.`);
	}
	return attempt;
}

function retryDeltaOf(scenario: ReplayScenario): RetryFindingDeltaEvent {
	const delta = scenario.events.find(
		(event) => event.kind === "retry_finding_delta",
	);
	if (delta?.kind !== "retry_finding_delta") {
		throw new Error("Missing retry finding delta.");
	}
	return delta;
}

function resequence(scenario: ReplayScenario): ReplayScenario {
	for (const [index, event] of scenario.events.entries()) {
		event.seq = index + 1;
		event.atMs = index * 5;
	}
	return scenario;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

function expectSchemaInvalid(scenario: ReplayScenario): void {
	const result = replayScenario(scenario, "A");
	expect(result.decision).toBe("failed");
	expect(result.reason).toBe("schema_invalid");
}

describe("deterministic replay oracle", () => {
	test("derives every control scenario's terminal truth from events", () => {
		const first = replayFixture(loadFixture(), "A");
		const second = replayFixture(loadFixture(), "A");
		expect(first).toEqual(second);
		expect(first.supported).toBe(true);
		expect(first.scenarios).toHaveLength(9);

		const byId = new Map(loadFixture().scenarios.map((s) => [s.id, s]));
		for (const result of first.scenarios) {
			const scenario = byId.get(result.scenarioId);
			if (!scenario) throw new Error("Missing scenario source.");
			const expected = terminalOf(scenario);
			// Derived actual truth reproduces the honest fixture assertion...
			expect(result.decision).toBe(expected.decision);
			expect(result.reason).toBe(expected.reason);
			// ...and the honest fixture raises no terminal reconciliation mismatch.
			for (const mismatch of TERMINAL_MISMATCHES) {
				expect(result.mismatches).not.toContain(mismatch);
			}
			expect(result.expectedTerminal).toEqual({
				decision: expected.decision,
				reason: expected.reason,
				revision: expected.revision,
				stateDigest: expected.stateDigest,
			});
		}
	});

	test("never lets terminal expectation state enter observed reference sets", () => {
		// A scenario with durable state: an unrelated terminal digest/evidence must
		// be treated as an expectation only, never merged into observed references.
		const withState = withTerminal(
			scenarioById("active_final_feature_awaiting_review"),
			{
				stateDigest: "f".repeat(64),
				evidenceRefs: ["evidence_999"],
			},
		);
		const stated = replayScenario(withState, "A");
		expect(stated.stateDigestRefs).not.toContain("f".repeat(64));
		expect(stated.evidenceRefs).not.toContain("evidence_999");
		// The genuinely observed durable digest and event evidence remain present.
		expect(stated.stateDigestRefs).toContain(
			"de44d7486ef40efd092286206fe7b70f188ae3177c1fe224e4c137ab96b04665",
		);
		expect(stated.evidenceRefs).toContain("evidence_11");
		expect(stated.terminalComparison.stateDigest).toBe("mismatched");

		// A scenario lacking any independent state-bearing event: the terminal
		// digest/evidence still must not appear, and the comparison is unavailable.
		const noState = withTerminal(scenarioById("unsubmitted_review_failure"), {
			stateDigest: "f".repeat(64),
			evidenceRefs: ["evidence_999"],
		});
		const stateless = replayScenario(noState, "A");
		expect(stateless.stateDigestRefs).not.toContain("f".repeat(64));
		expect(stateless.evidenceRefs).not.toContain("evidence_999");
		expect(stateless.derivedRevision).toBeNull();
		expect(stateless.derivedStateDigest).toBeNull();
		expect(stateless.terminalComparison.revision).toBe("unavailable");
		expect(stateless.terminalComparison.stateDigest).toBe("unavailable");
	});

	test("classifies each terminal field as matched, mismatched, or unavailable", () => {
		// Honest scenario with durable state: every field matches.
		const withState = replayScenario(
			scenarioById("active_final_feature_awaiting_review"),
			"A",
		);
		expect(withState.terminalComparison).toEqual({
			decision: "matched",
			reason: "matched",
			revision: "matched",
			stateDigest: "matched",
			status: "matched",
		});

		// Honest scenario without durable state: decision/reason matched, but
		// revision/digest are explicitly unavailable, so the rollup is unavailable.
		const withoutState = replayScenario(
			scenarioById("failed_to_passed_retry"),
			"A",
		);
		expect(withoutState.terminalComparison).toMatchObject({
			decision: "matched",
			reason: "matched",
			revision: "unavailable",
			stateDigest: "unavailable",
			status: "unavailable",
		});

		// Unsupported variant never claims a matched expectation.
		const unsupported = replayScenario(
			scenarioById("active_final_feature_awaiting_review"),
			"B",
		);
		expect(unsupported.terminalComparison.status).toBe("unavailable");
	});

	test("reports future variants as structurally unsupported", () => {
		const scenario = scenarioById(REPLAY_SCENARIO_IDS[0]);
		for (const variant of ["B", "C", "D"] as const) {
			expect(replayScenario(scenario, variant)).toMatchObject({
				variant,
				supported: false,
				decision: null,
				reason: "unsupported_variant",
			});
		}
	});

	test("does not read the asserted label while deriving actual truth", () => {
		// Relabel the terminal decision and reason to a passing outcome; the
		// oracle must ignore the label and still derive the real blocked truth.
		const scenario = scenarioById("active_final_feature_awaiting_review");
		const relabeled = withTerminal(scenario, {
			decision: "complete",
			reason: "all_gates_passed",
		});
		const result = replayScenario(relabeled, "A");
		expect(result.decision).toBe("blocked");
		expect(result.reason).toBe("active_final_feature_in_progress");
		expect(result.mismatches).toContain("terminal_decision_mismatch");
		expect(result.mismatches).toContain("terminal_reason_mismatch");
	});

	test("emits mismatches for decision, revision, and digest tampering", () => {
		const scenario = scenarioById("active_final_feature_awaiting_review");
		const tampered = withTerminal(scenario, {
			decision: "complete",
			reason: "all_gates_passed",
			revision: 999,
			stateDigest: "f".repeat(64),
		});
		const result = replayScenario(tampered, "A");
		// Derived truth is unchanged by the tampering.
		expect(result.decision).toBe("blocked");
		expect(result.derivedRevision).toBe(5);
		expect(result.derivedStateDigest).toBe(
			"de44d7486ef40efd092286206fe7b70f188ae3177c1fe224e4c137ab96b04665",
		);
		expect(result.mismatches).toContain("terminal_decision_mismatch");
		expect(result.mismatches).toContain("terminal_reason_mismatch");
		expect(result.mismatches).toContain("terminal_revision_mismatch");
		expect(result.mismatches).toContain("terminal_digest_mismatch");
	});

	test("flags a revision disagreement without a decision mismatch", () => {
		const scenario = scenarioById("stale_validation");
		const result = replayScenario(
			withTerminal(scenario, { revision: 99 }),
			"A",
		);
		expect(result.decision).toBe("complete");
		expect(result.reason).toBe("validation_stale");
		expect(result.mismatches).toContain("terminal_revision_mismatch");
		expect(result.mismatches).not.toContain("terminal_decision_mismatch");
	});

	test("flags a digest disagreement bound to durable recovery state", () => {
		const scenario = scenarioById("crash_replay_around_mutation");
		const result = replayScenario(
			withTerminal(scenario, { stateDigest: "e".repeat(64) }),
			"A",
		);
		expect(result.decision).toBe("recovered");
		expect(result.mismatches).toContain("terminal_digest_mismatch");
		expect(result.mismatches).not.toContain("terminal_decision_mismatch");
	});

	test("fails causally impossible terminal layouts instead of trusting a label", () => {
		const scenario = scenarioById("stale_validation");

		const missing = structuredClone(scenario);
		missing.events = missing.events.filter(
			(event) => event.kind !== "terminal_decision",
		);
		const missingResult = replayScenario(missing, "A");
		expect(missingResult.decision).toBe("failed");
		expect(missingResult.reason).toBe("schema_invalid");
		expect(missingResult.mismatches).toContain("terminal_decision_missing");

		const terminal = terminalOf(scenario);
		const duplicated = structuredClone(scenario);
		const lastSeq = duplicated.events[duplicated.events.length - 1]?.seq ?? 0;
		duplicated.events.push({
			...terminal,
			seq: lastSeq + 1,
			atMs: terminal.atMs + 1,
		});
		const duplicatedResult = replayScenario(duplicated, "A");
		expect(duplicatedResult.decision).toBe("failed");
		expect(duplicatedResult.mismatches).toContain("terminal_decision_multiple");

		const premature = structuredClone(scenario);
		const tailSeq = premature.events[premature.events.length - 1]?.seq ?? 0;
		premature.events.push({
			kind: "compaction",
			seq: tailSeq + 1,
			atMs: terminal.atMs + 2,
			source: "replay_derived",
			operationId: "operation_79",
			beforeCharacterCount: { status: "available", value: 100 },
			afterCharacterCount: { status: "available", value: 50 },
		});
		const prematureResult = replayScenario(premature, "A");
		expect(prematureResult.decision).toBe("failed");
		expect(prematureResult.mismatches).toContain("terminal_not_final");
	});

	test("fails retry links with missing, identical, premature, non-adjacent, wrong-pass, or wrong-kind attempts", () => {
		const missing = scenarioById("failed_to_passed_retry");
		retryDeltaOf(missing).currentAttemptId = "attempt_99";

		const identical = scenarioById("failed_to_passed_retry");
		retryDeltaOf(identical).currentAttemptId = "attempt_31";

		const premature = scenarioById("failed_to_passed_retry");
		const prematureDeltaIndex = premature.events.findIndex(
			(event) => event.kind === "retry_finding_delta",
		);
		const [prematureDelta] = premature.events.splice(prematureDeltaIndex, 1);
		if (prematureDelta?.kind !== "retry_finding_delta") {
			throw new Error("Expected retry finding delta.");
		}
		premature.events.splice(1, 0, prematureDelta);
		resequence(premature);

		const nonAdjacent = scenarioById("failed_to_passed_retry");
		const previous = reviewAttemptOf(nonAdjacent, "attempt_31");
		const currentIndex = nonAdjacent.events.findIndex(
			(event) =>
				(event.kind === "feature_review_attempt" ||
					event.kind === "final_review_attempt") &&
				event.attemptId === "attempt_32",
		);
		nonAdjacent.events.splice(currentIndex, 0, {
			...previous,
			operationId: "operation_39",
			attemptId: "attempt_39",
			snapshotId: "snapshot_39",
			evidenceRef: "evidence_39",
		});
		resequence(nonAdjacent);

		const wrongPass = scenarioById("failed_to_passed_retry");
		reviewAttemptOf(wrongPass, "attempt_32").logicalPassId = "pass_31";

		const wrongKind = scenarioById("failed_to_passed_retry");
		const wrongKindIndex = wrongKind.events.findIndex(
			(event) =>
				(event.kind === "feature_review_attempt" ||
					event.kind === "final_review_attempt") &&
				event.attemptId === "attempt_32",
		);
		const wrongKindAttempt = wrongKind.events[wrongKindIndex];
		if (wrongKindAttempt?.kind !== "feature_review_attempt") {
			throw new Error("Expected feature retry attempt.");
		}
		wrongKind.events[wrongKindIndex] = {
			...wrongKindAttempt,
			kind: "final_review_attempt",
			role: "final_reviewer",
		};

		for (const scenario of [
			missing,
			identical,
			premature,
			nonAdjacent,
			wrongPass,
			wrongKind,
		]) {
			expectSchemaInvalid(scenario);
		}
	});

	test("fails retry deltas whose finding fingerprints or counts disagree", () => {
		const countMismatch = scenarioById("failed_to_passed_retry");
		retryDeltaOf(countMismatch).previousFindingCount = 2;

		const fingerprintMismatch = scenarioById("unchanged_finding_retry");
		reviewAttemptOf(fingerprintMismatch, "attempt_82").findingFingerprints = [
			"c".repeat(64),
		];
		retryDeltaOf(fingerprintMismatch).duplicateFindingCount = 0;

		expectSchemaInvalid(countMismatch);
		expectSchemaInvalid(fingerprintMismatch);
	});

	test("fails retry links when either referenced attempt is unsubmitted or the previous attempt passed", () => {
		const previousUnsubmitted = scenarioById("failed_to_passed_retry");
		reviewAttemptOf(previousUnsubmitted, "attempt_31").submitted = false;

		const currentUnsubmitted = scenarioById("unchanged_finding_retry");
		reviewAttemptOf(currentUnsubmitted, "attempt_82").submitted = false;

		const previousPassed = scenarioById("failed_to_passed_retry");
		reviewAttemptOf(previousPassed, "attempt_31").verdict = "passed";

		for (const invalid of [
			previousUnsubmitted,
			currentUnsubmitted,
			previousPassed,
		]) {
			expectSchemaInvalid(invalid);
		}
	});

	test("reduces deeply frozen review events without mutating input", () => {
		const events = structuredClone(
			scenarioById("failed_to_passed_retry").events,
		);
		const baseline = structuredClone(events);
		deepFreeze(events);

		const first = reduceReviewPasses(events);
		const second = reduceReviewPasses(events);

		expect(first).toEqual(second);
		expect(events).toEqual(baseline);
	});

	test("accepts only failed, nonempty, genuinely changed retry findings", () => {
		const changed = scenarioById("unchanged_finding_retry");
		const current = reviewAttemptOf(changed, "attempt_82");
		const delta = retryDeltaOf(changed);
		current.findingFingerprints = ["c".repeat(64)];
		delta.delta = "changed";
		delta.duplicateFindingCount = 0;
		const changedResult = replayScenario(changed, "A");
		expect(changedResult.decision).toBe("blocked");
		expect(changedResult.reason).toBe("review_failed");

		const unchangedSet = scenarioById("unchanged_finding_retry");
		retryDeltaOf(unchangedSet).delta = "changed";

		const passing = structuredClone(changed);
		reviewAttemptOf(passing, "attempt_82").verdict = "passed";

		const empty = structuredClone(changed);
		reviewAttemptOf(empty, "attempt_82").findingFingerprints = [];
		retryDeltaOf(empty).currentFindingCount = 0;
		retryDeltaOf(empty).duplicateFindingCount = 0;

		for (const invalid of [unchangedSet, passing, empty]) {
			expectSchemaInvalid(invalid);
		}
	});

	test("does not let one resolved retry mask an unrelated failed pass", () => {
		const scenario = scenarioById("failed_to_passed_retry");
		const failed = reviewAttemptOf(scenario, "attempt_31");
		const terminalIndex = scenario.events.findIndex(
			(event) => event.kind === "terminal_decision",
		);
		scenario.events.splice(terminalIndex, 0, {
			...failed,
			operationId: "operation_39",
			workerId: "worker_39",
			attemptId: "attempt_39",
			logicalPassId: "pass_39",
			snapshotId: "snapshot_39",
			evidenceRef: "evidence_39",
		});
		resequence(scenario);

		const result = replayScenario(scenario, "A");
		expect(result.decision).toBe("blocked");
		expect(result.reason).toBe("review_failed");
	});

	test("rejects unsubmitted passes and blocks latest unsubmitted failures", () => {
		const unsubmittedPass = scenarioById("unsubmitted_review_failure");
		reviewAttemptOf(unsubmittedPass, "attempt_41").verdict = "passed";
		expectSchemaInvalid(unsubmittedPass);

		const failure = replayScenario(
			scenarioById("unsubmitted_review_failure"),
			"A",
		);
		expect(failure.decision).toBe("blocked");
		expect(failure.reason).toBe("review_failure_unsubmitted");
	});

	test("accepts same-pass same-snapshot retries but blocks latest cross-pass contradictions", () => {
		const samePass = scenarioById("failed_to_passed_retry");
		reviewAttemptOf(samePass, "attempt_32").snapshotId = "snapshot_30";
		const samePassResult = replayScenario(samePass, "A");
		expect(samePassResult.decision).toBe("complete");
		expect(samePassResult.reason).toBe("review_retry_passed");
		expect(samePassResult.mismatches).not.toContain(
			"contradictory_review_verdicts",
		);

		const distinctPasses = replayScenario(
			scenarioById("contradictory_feature_final_verdicts"),
			"A",
		);
		expect(distinctPasses.decision).toBe("blocked");
		expect(distinctPasses.reason).toBe("contradictory_review_verdicts");
		expect(distinctPasses.mismatches).toContain(
			"contradictory_review_verdicts",
		);
	});

	test("counts identical attempt repeats once and fails conflicting identity reuse", () => {
		const repeated = scenarioById("failed_to_passed_retry");
		const previous = reviewAttemptOf(repeated, "attempt_31");
		const currentIndex = repeated.events.findIndex(
			(event) =>
				(event.kind === "feature_review_attempt" ||
					event.kind === "final_review_attempt") &&
				event.attemptId === "attempt_32",
		);
		repeated.events.splice(currentIndex, 0, { ...previous });
		resequence(repeated);
		const repeatedResult = replayScenario(repeated, "A");
		expect(repeatedResult.decision).toBe("complete");
		expect(repeatedResult.counters.featureReviewAttempts).toBe(2);
		expect(repeatedResult.counters.failedReviewAttempts).toBe(1);

		const conflicting = structuredClone(repeated);
		const repeatedAttempt = conflicting.events.findLast(
			(event) =>
				(event.kind === "feature_review_attempt" ||
					event.kind === "final_review_attempt") &&
				event.attemptId === "attempt_31",
		);
		if (
			repeatedAttempt?.kind !== "feature_review_attempt" &&
			repeatedAttempt?.kind !== "final_review_attempt"
		) {
			throw new Error("Expected repeated attempt.");
		}
		repeatedAttempt.verdict = "passed";
		expectSchemaInvalid(conflicting);
	});

	test("records the corrected unchanged-retry attempts, findings, and evidence", () => {
		const result = replayScenario(scenarioById("unchanged_finding_retry"), "A");
		expect(result.counters).toMatchObject({
			featureReviewAttempts: 2,
			submittedReviewAttempts: 2,
			failedReviewAttempts: 2,
			retries: 1,
			findingCount: 2,
			duplicateFindingCount: 1,
		});
		expect(result.evidenceRefs).toEqual(["evidence_81", "evidence_82"]);
	});

	test("crash recovery is idempotent and reuses the durable commit", () => {
		const scenario = scenarioById("crash_replay_around_mutation");
		const first = replayScenario(scenario, "A");
		const second = replayScenario(scenario, "A");
		expect(first).toEqual(second);
		expect(first.decision).toBe("recovered");
		expect(first.reason).toBe("mutation_recovered");
		expect(first.counters).toMatchObject({
			mutationStarts: 1,
			mutationCommits: 0,
			crashes: 1,
			recoveries: 1,
		});
		expect(first.mismatches).not.toContain("duplicate_mutation_commit");
		expect(first.derivedRevision).toBe(21);
	});

	test("reports duplicate commits and abandoned mutations explicitly", () => {
		const base = scenarioById("crash_replay_around_mutation");
		const start = base.events.find((event) => event.kind === "mutation_start");
		const terminal = terminalOf(base);
		if (start?.kind !== "mutation_start") {
			throw new Error("Expected a mutation_start event.");
		}
		const commit = {
			kind: "mutation_commit" as const,
			seq: 2,
			atMs: 2,
			source: "flow_ledger" as const,
			operationId: "operation_90",
			mutationId: "mutation_90",
			revision: 21,
			stateDigest: "d".repeat(64),
		};
		const duplicateCommit = replayScenario(
			{
				...base,
				events: [
					{ ...start, seq: 1, atMs: 1 },
					commit,
					{ ...commit, seq: 3, atMs: 3, operationId: "operation_91" },
					{ ...terminal, seq: 4, atMs: 4 },
				],
			},
			"A",
		);
		expect(duplicateCommit.mismatches).toContain("duplicate_mutation_commit");

		const abandoned = replayScenario(
			{
				...base,
				events: [
					{ ...start, seq: 1, atMs: 1 },
					{ ...terminal, seq: 2, atMs: 2 },
				],
			},
			"A",
		);
		expect(abandoned.mismatches).toContain("mutation_left_uncommitted");
	});
});
