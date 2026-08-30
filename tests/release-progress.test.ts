import { describe, expect, test } from "bun:test";
import { parseCaseCatalog } from "../evals/catalog.js";
import { runQueues } from "../evals/harness.js";
import {
	deriveReleaseRunState,
	minimumPassingCount,
} from "../evals/release-progress.js";
import type {
	AttemptRecordV2,
	CampaignPlan,
	ScheduledCell,
} from "../evals/report.js";

const digest = (value: string) => `sha256:${value.repeat(64)}`;
const model = {
	routeProvider: "xai",
	gateway: null,
	family: "grok",
	model: "grok",
	revision: null,
};
const product = (
	passed: boolean,
	overrides: Partial<{
		falseCompletion: boolean;
		unsubmittedReviews: number;
	}> = {},
): AttemptRecordV2["outcome"] => ({
	kind: "product",
	passed,
	issues: passed ? [] : ["miss"],
	endedBy: "quiet",
	evidence: {
		kind: "conformance",
		falseCompletion: false,
		unsubmittedReviews: 0,
		facts: {},
		...overrides,
	},
});

function fixture(target: number, rate: number) {
	const cells: ScheduledCell[] = Array.from(
		{ length: target + 1 },
		(_, repetition) => ({
			cellId: `cell-${repetition}`,
			blockId: `block-${repetition}`,
			caseId: "case",
			caseVersion: 1,
			armToken: null,
			repetition,
			managerModel: model,
			reviewerModel: null,
			schedule: repetition === target ? "environment-reserve" : "primary",
		}),
	);
	const plan: CampaignPlan = {
		schemaVersion: 1,
		planId: "release-progress",
		planSha256: digest("0"),
		randomizationSeed: "seed",
		cells,
		abortPolicy: { retry: "environment-only", maxReplacementBlocks: 1 },
		stoppingRule: { kind: "fixed-attempts", count: target },
		analysis: {
			kind: "rate",
			primaryOutcome: "conformance-pass",
			versionSha256: digest("1"),
		},
		budget: {
			maxUsd: null,
			unknownCostPolicy: "token-wall-clock-bounds",
			maxOutputTokens: 1_000,
			maxWallClockMs: 1_000,
			maxAttempts: cells.length,
		},
	};
	const parsed = parseCaseCatalog([
		{
			caseId: "case",
			caseVersion: 1,
			evidenceClass: "conformance",
			oracle: "durable-state",
			release: "required",
			minProviders: 1,
			minScoredAttempts: target,
			minPassRate: rate,
			reviewerPromotionRecordSha256: null,
		},
	]);
	if (!parsed.ok) throw new Error("invalid fixture catalog");
	const attempt = (
		index: number,
		outcome: AttemptRecordV2["outcome"],
	): AttemptRecordV2 => {
		const cell = cells[index];
		if (!cell) throw new Error("missing fixture cell");
		return {
			schemaVersion: 2,
			attemptId: `attempt-${index}`,
			cellId: cell.cellId,
			blockId: cell.blockId,
			caseId: cell.caseId,
			caseVersion: cell.caseVersion,
			armToken: null,
			repetition: cell.repetition,
			artifact: {
				packageVersion: "1.0.0",
				sourceCommit: "commit",
				sourceTreeSha256: digest("2"),
				tarballSha256: digest("3"),
				unpackedManifestSha256: digest("4"),
			},
			evaluator: {
				sourceCommit: "commit",
				caseCatalogSha256: digest("5"),
				policyCatalogSha256: digest("6"),
				graderBundleSha256: digest("7"),
			},
			hostConfigSha256: digest("8"),
			actors: [],
			instructions: [],
			transcript: null,
			outcome,
			usage: { durationMs: 1, outputTokens: 0, costUsd: null },
		};
	};
	const state = (attempts: AttemptRecordV2[]) =>
		deriveReleaseRunState({ plan, catalog: parsed.value, attempts });
	return { attempt, state, target };
}

describe("prospective release progress", () => {
	test("uses auditable integer threshold counts", () => {
		expect(minimumPassingCount(3, 1)).toBe(3);
		expect(minimumPassingCount(10, 0.9)).toBe(9);
	});

	test("stops the first 100 percent miss but allows one 90 percent miss", () => {
		const strict = fixture(3, 1);
		expect(strict.state([strict.attempt(0, product(false))])).toEqual({
			kind: "stop",
			cause: "product",
			reason: "pass-rate-unreachable",
		});
		const tolerant = fixture(10, 0.9);
		expect(tolerant.state([tolerant.attempt(0, product(false))])).toEqual({
			kind: "continue",
		});
		expect(
			tolerant.state([
				tolerant.attempt(0, product(false)),
				tolerant.attempt(1, product(false)),
			]),
		).toEqual({
			kind: "stop",
			cause: "product",
			reason: "pass-rate-unreachable",
		});
	});

	test("continues through one eligible gap and stops at the second", () => {
		const value = fixture(3, 1);
		const gap = (origin: "host" | "provider") => ({
			kind: "failure" as const,
			origin,
			code: origin === "host" ? "command-aborted" : "provider-rejected-turn",
			retryable: true,
		});
		expect(value.state([value.attempt(0, gap("host"))])).toEqual({
			kind: "continue",
		});
		expect(
			value.state([
				value.attempt(0, gap("host")),
				value.attempt(1, gap("provider")),
			]),
		).toEqual({ kind: "stop", cause: "host" });
	});

	test("hard evidence stops even when the pass-rate budget could absorb it", () => {
		const value = fixture(10, 0.9);
		expect(
			value.state([
				value.attempt(0, product(false, { falseCompletion: true })),
			]),
		).toEqual({
			kind: "stop",
			cause: "product",
			reason: "false-completion",
		});
		expect(
			value.state([
				value.attempt(0, product(false, { unsubmittedReviews: 1 })),
			]),
		).toEqual({
			kind: "stop",
			cause: "product",
			reason: "unsubmitted-review",
		});
	});

	test("a final failed score completes collection before qualification", () => {
		const value = fixture(3, 1);
		const attempts = Array.from({ length: value.target }, (_, index) =>
			value.attempt(index, product(index !== value.target - 1)),
		);
		expect(value.state(attempts)).toEqual({ kind: "complete" });
	});

	test("checks the durable ledger before starting another paid job", async () => {
		const value = fixture(3, 1);
		const durable: AttemptRecordV2[] = [];
		const started: number[] = [];
		await runQueues(
			[[0, 1]],
			1,
			async (index) => {
				started.push(index);
				durable.push(value.attempt(index, product(false)));
				return value.state(durable);
			},
			(state) => state.kind === "stop",
		);
		expect(started).toEqual([0]);
		expect(durable).toHaveLength(1);
	});
});
