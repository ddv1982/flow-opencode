import { describe, expect, test } from "bun:test";
import {
	executeLifecycleInvariantRegistry,
	LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS,
	LIFECYCLE_INVARIANT_REQUIREMENTS,
	missingLifecycleCoverage,
	missingLifecycleExternalProofs,
	missingLifecycleProofs,
} from "./support/lifecycle-invariant-registry.js";
import {
	assertLifecycleLiveProofObservation,
	LIFECYCLE_LIVE_PROOF_REGISTRY,
	missingLifecycleLiveEvidence,
	PINNED_LIVE_OPENCODE_VERSION,
} from "./support/lifecycle-live-proof-registry.js";
import { LIFECYCLE_PROOF_REGISTRY } from "./support/lifecycle-proof-registry.js";
import { REQUIRED_REPOSITORY_SEQUENCE_ACTIONS } from "./support/lifecycle-repository-sequence.js";

const REQUIRED_INVARIANT_IDS = [
	"S4-STATE-01",
	"S4-TIME-01",
	"S4-FINAL-REC-01",
	"S4-CLOSE-REC-01",
	"S4-HOST-01",
	"S4-ATOMIC-01",
	"S4-V4-ONLY-01",
] as const;

const REQUIRED_TIME_BOUNDARIES = [
	"run-validation-start",
	"validation-start-completion",
	"validation-completion-assignment-start",
	"assignment-start-reported-result",
	"reported-result-runtime-acceptance",
	"feature-result-broad-validation-start",
	"broad-validation-completion-final-assignment",
] as const;

const REQUIRED_TIME_DELTAS = ["-1", "0", "+1", "future"] as const;

const REQUIRED_TIME_PERTURBATIONS = REQUIRED_TIME_BOUNDARIES.flatMap(
	(boundary) => REQUIRED_TIME_DELTAS.map((delta) => `${boundary}:${delta}`),
);

describe("Session v4 executable invariant registry", () => {
	test("defines exactly the seven lifecycle invariant rows", () => {
		expect(Object.keys(LIFECYCLE_INVARIANT_REQUIREMENTS)).toEqual([
			...REQUIRED_INVARIANT_IDS,
		]);
		expect(Object.keys(LIFECYCLE_PROOF_REGISTRY)).toEqual([
			...REQUIRED_INVARIANT_IDS,
		]);
		expect(missingLifecycleProofs(LIFECYCLE_PROOF_REGISTRY)).toEqual([]);
		expect(Object.keys(LIFECYCLE_EXTERNAL_PROOF_REQUIREMENTS)).toEqual([
			"S4-FINAL-REC-01",
			"S4-HOST-01",
		]);
		expect(
			missingLifecycleExternalProofs(LIFECYCLE_LIVE_PROOF_REGISTRY),
		).toEqual([]);
		expect(
			missingLifecycleCoverage(
				LIFECYCLE_PROOF_REGISTRY,
				LIFECYCLE_LIVE_PROOF_REGISTRY,
			),
		).toEqual([]);
	});

	test("reports a deliberately removed required proof deterministically", () => {
		const withoutPersistenceReload = {
			...LIFECYCLE_PROOF_REGISTRY,
			"S4-STATE-01": {
				...LIFECYCLE_PROOF_REGISTRY["S4-STATE-01"],
				proofs: {
					...LIFECYCLE_PROOF_REGISTRY["S4-STATE-01"].proofs,
					persistence_reload: undefined,
				},
			},
		};
		expect(missingLifecycleProofs(withoutPersistenceReload)).toEqual([
			{
				invariantId: "S4-STATE-01",
				proofClass: "persistence_reload",
			},
		]);
	});

	test("reports a deliberately removed external live-host proof deterministically", () => {
		const withoutFinalLiveHost = {
			...LIFECYCLE_LIVE_PROOF_REGISTRY,
			"S4-FINAL-REC-01": {
				...LIFECYCLE_LIVE_PROOF_REGISTRY["S4-FINAL-REC-01"],
				proofs: {
					...LIFECYCLE_LIVE_PROOF_REGISTRY["S4-FINAL-REC-01"].proofs,
					pinned_packed_live_host: undefined,
				},
			},
		};
		expect(missingLifecycleExternalProofs(withoutFinalLiveHost)).toEqual([
			{
				invariantId: "S4-FINAL-REC-01",
				proofClass: "pinned_packed_live_host",
			},
		]);
		expect(
			missingLifecycleCoverage(LIFECYCLE_PROOF_REGISTRY, withoutFinalLiveHost),
		).toEqual([
			{
				invariantId: "S4-FINAL-REC-01",
				proofClass: "pinned_packed_live_host",
			},
		]);
	});

	test("rejects incomplete structured evidence from the pinned live-host gate", () => {
		const completeEvidence = {
			"S4-FINAL-REC-01": [
				...LIFECYCLE_LIVE_PROOF_REGISTRY["S4-FINAL-REC-01"].proofs
					.pinned_packed_live_host.requiredEvidence,
			],
			"S4-HOST-01": [
				...LIFECYCLE_LIVE_PROOF_REGISTRY["S4-HOST-01"].proofs
					.pinned_packed_live_host.requiredEvidence,
			],
		};
		const observation = {
			boundary: "packed-plugin-real-opencode" as const,
			hostPackage: "opencode-ai" as const,
			hostVersion: PINNED_LIVE_OPENCODE_VERSION,
			pluginArtifact: "current-build-packed-tarball" as const,
			evidence: completeEvidence,
		};
		expect(missingLifecycleLiveEvidence(observation)).toEqual([]);
		expect(() =>
			assertLifecycleLiveProofObservation(observation),
		).not.toThrow();

		const withoutCloseRetry = {
			...observation,
			evidence: {
				...completeEvidence,
				"S4-HOST-01": completeEvidence["S4-HOST-01"].filter(
					(item) => item !== "close-retry-archive-published",
				),
			},
		};
		expect(missingLifecycleLiveEvidence(withoutCloseRetry)).toEqual([
			{
				invariantId: "S4-HOST-01",
				proofClass: "pinned_packed_live_host",
				evidence: "close-retry-archive-published",
			},
		]);
		expect(() =>
			assertLifecycleLiveProofObservation(withoutCloseRetry),
		).toThrow(/omitted required external lifecycle evidence/);
	});

	test("executes every required proof class and observes real assertions", async () => {
		const executions = await executeLifecycleInvariantRegistry(
			LIFECYCLE_PROOF_REGISTRY,
		);
		const requiredProofCount = Object.values(
			LIFECYCLE_INVARIANT_REQUIREMENTS,
		).reduce((sum, proofs) => sum + proofs.length, 0);
		expect(executions).toHaveLength(requiredProofCount);
		expect(executions.every(({ assertionCount }) => assertionCount > 0)).toBe(
			true,
		);
		const expectEvidence = (
			invariantId: (typeof REQUIRED_INVARIANT_IDS)[number],
			proofClass: string,
			requiredEvidence: readonly string[],
		) => {
			const execution = executions.find(
				(candidate) =>
					candidate.invariantId === invariantId &&
					candidate.proofClass === proofClass,
			);
			expect(execution).toBeDefined();
			for (const evidence of requiredEvidence) {
				expect(execution?.evidence).toContain(evidence);
			}
		};
		expectEvidence(
			"S4-STATE-01",
			"deterministic_state_machine",
			REQUIRED_REPOSITORY_SEQUENCE_ACTIONS,
		);
		expectEvidence("S4-TIME-01", "boundary_examples", [
			...REQUIRED_TIME_BOUNDARIES.map((boundary) => `${boundary}:0`),
		]);
		expectEvidence(
			"S4-TIME-01",
			"timestamp_perturbation",
			REQUIRED_TIME_PERTURBATIONS,
		);
		expectEvidence("S4-TIME-01", "atomic_rejection", [
			"assignment-start-reported-result:-1",
			"assignment-start-reported-result:future",
			"reported-result-runtime-acceptance:+1",
			"reported-result-runtime-acceptance:future",
		]);
		expectEvidence("S4-TIME-01", "persistence_parse", [
			"active-run-status",
			"run-end",
			"validation-run",
			"assignment-validation",
			"review-assignment",
			"mutation-order",
			"final-prerequisite",
			"run-start-owner",
			"run-completed-owner",
			"run-blocked-owner",
			"run-reset-owner",
			"run-deferred-owner",
			"run-abandoned-owner",
			"invalidation-source-owner",
			"invalidation-reset-owner",
			"invalidation-deferred-owner",
			"invalidation-abandoned-owner",
		]);
		expectEvidence("S4-CLOSE-REC-01", "failure_injection_matrix", [
			"canonical-history-scan-before-save",
			"canonical-history-rescan-before-retry-publication",
			"before-state-save",
			"after-closure-state-save",
			"before-archive-publication",
			"after-publication-before-active-delete",
			"after-active-state-delete",
		]);
		expectEvidence("S4-CLOSE-REC-01", "no_clobber_archive", [
			"session-id archive boundary",
			"fixed-digest-archive-name",
			"case-distinct-archive-identity",
			"pinned archive topology",
			"pinned-history-publication",
			"pinned-active-deletion",
			"session-id collision",
			"workspace close-operation identity",
			"historical-close-survives-later-non-close-reuse",
		]);
		expectEvidence("S4-HOST-01", "shared_corpus", [
			"canonical-corpus-100-plus",
			"operation-status",
			"operation-review-start",
			"operation-feature-complete",
			"operation-close",
			"aggregate-result-budget",
		]);
		expectEvidence("S4-HOST-01", "actual_registration_differential", [
			"actual-registration",
			"all-canonical-cases",
			"aggregate-result-budget",
		]);
		expectEvidence("S4-HOST-01", "emitted_json_schema", [
			"request-envelope",
			"strict-branches",
			"nonnegative-integers",
			"safe-integer-bounds",
		]);
		expectEvidence("S4-HOST-01", "registered_host_calls", [
			"actual-registration",
			"invalid-before-flow",
			"unknown-outer-envelope-before-flow",
			"unchanged-state",
			"corrected-call",
			"flow_status",
			"flow_review_start",
			"flow_feature_complete",
			"flow_session_close",
		]);
		expectEvidence("S4-V4-ONLY-01", "package_surface", [
			"build",
			"pack",
			"declarations",
			"type-consumer",
			"runtime-consumer",
		]);
	}, 120_000);
});
