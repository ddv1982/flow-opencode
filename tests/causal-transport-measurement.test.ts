import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { measureCausalTransport } from "../scripts/lib/causal-transport-measurement.js";

const FIXTURE = resolve(
	process.cwd(),
	"tests/fixtures/transport/phase2-current-run.json",
);

describe("causal transport measurement", () => {
	test("measures every local Phase 2 size and parity gate deterministically", async () => {
		const first = await measureCausalTransport(FIXTURE);
		const second = await measureCausalTransport(FIXTURE);

		expect(second).toEqual(first);
		expect(first.fixture).toMatchObject({
			id: "phase2-current-run-six-feature",
			featureCount: 6,
		});
		expect(first.phase2Acceptance).toEqual({
			status: "blocked",
			localGatesPass: true,
			sameCorpusGatePass: null,
			blockingReasonCodes: [
				"missing_sanitized_call_kind_result_shape_histogram_and_complete_replay_corpus",
			],
		});
		expect(first.localGates.sixFeatureCompactStatus).toMatchObject({
			limitUtf8Bytes: 3000,
			pass: true,
		});
		expect(
			first.localGates.sixFeatureCompactStatus.maximumUtf8Bytes,
		).toBeLessThanOrEqual(3000);
		expect(first.localGates.ordinaryMutationReceipt).toMatchObject({
			limitUtf8Bytes: 2000,
			changedEntityIncluded: true,
			changedEntityExclusionApplied: false,
			pass: true,
		});
		expect(
			first.localGates.ordinaryMutationReceipt.maximumUtf8Bytes,
		).toBeLessThanOrEqual(2000);
		expect(first.localGates.reviewerContext).toMatchObject({
			limitUtf8Bytes: 3000,
			pass: true,
		});
		expect(
			first.localGates.reviewerContext.maximumUtf8Bytes,
		).toBeLessThanOrEqual(3000);
		expect(first.localGates.executionContext).toMatchObject({
			limitUtf8Bytes: 12 * 1024,
			pass: true,
		});
		expect(
			first.localGates.executionContext.maximumUtf8Bytes,
		).toBeLessThanOrEqual(12 * 1024);
		expect(first.localGates.executionContext.headroomUtf8Bytes).toBe(
			12 * 1024 - first.localGates.executionContext.maximumUtf8Bytes,
		);
		expect(first.localGates.unchangedPolling).toMatchObject({
			projectionKeys: ["revision", "snapshotId", "view"],
			metadataOnly: true,
			pass: true,
		});

		const currentRun = first.localGates.currentRunStatefulOutput;
		expect(currentRun.currentTransport).toBe(
			"mutation_receipt_compact_execution_reviewer_and_unchanged",
		);
		expect(currentRun.reference.count).toBe(currentRun.current.count);
		expect(currentRun.current.count).toBe(54);
		expect(currentRun.reductionBasisPoints).toBeGreaterThanOrEqual(6000);
		expect(currentRun.sameRuntimeTransitionDecisions).toBe(true);
		expect(currentRun.referenceDecisions).toEqual(currentRun.currentDecisions);
		expect(currentRun.decisionCount).toBe(14);
		expect(currentRun.pass).toBe(true);
	});

	test("keeps the unmeasurable investigation-corpus result explicitly null", async () => {
		const report = await measureCausalTransport(FIXTURE);
		const sameCorpus = report.sameCorpusFlowToolResultCharacters;

		expect(sameCorpus).toEqual({
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
		});
	});

	test("prints the same machine-readable report through the CLI", () => {
		const result = Bun.spawnSync({
			cmd: ["bun", "run", "scripts/causal-transport-report.ts"],
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode).toBe(0);
		const report = JSON.parse(result.stdout.toString()) as {
			fixture: { id: string };
			phase2Acceptance: { status: string };
			sameCorpusFlowToolResultCharacters: { observedCharacters: null };
		};
		expect(report.fixture.id).toBe("phase2-current-run-six-feature");
		expect(report.phase2Acceptance.status).toBe("blocked");
		expect(
			report.sameCorpusFlowToolResultCharacters.observedCharacters,
		).toBeNull();
	});
});
