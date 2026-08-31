import { describe, expect, test } from "bun:test";
import {
	deriveEnvironmentReserveState,
	environmentStratumKey,
} from "../evals/environment-reserves.js";
import type {
	AttemptRecordV2,
	CampaignPlan,
	ScheduledCell,
} from "../evals/report.js";

const model = {
	routeProvider: "xai",
	gateway: null,
	family: "grok-4.6",
	model: "grok-4.6",
	revision: null,
};

function cell(
	cellId: string,
	repetition: number,
	schedule: ScheduledCell["schedule"],
): ScheduledCell {
	return {
		cellId,
		blockId: schedule === "primary" ? `block-${cellId}` : "reserve-stratum",
		caseId: "happy-path",
		caseVersion: 1,
		armToken: null,
		repetition,
		managerModel: model,
		reviewerModel: null,
		schedule,
	};
}

const primaryA = cell("primary-a", 0, "primary");
const primaryB = cell("primary-b", 1, "primary");
const reserve = cell("reserve", 2, "environment-reserve");

function plan(): CampaignPlan {
	return {
		schemaVersion: 1,
		planId: "environment-reserve-test",
		planSha256: `sha256:${"0".repeat(64)}`,
		randomizationSeed: "seed",
		cells: [primaryA, primaryB, reserve],
		abortPolicy: { retry: "environment-only", maxReplacementBlocks: 1 },
		stoppingRule: { kind: "fixed-attempts", count: 2 },
		analysis: {
			kind: "rate",
			primaryOutcome: "conformance-pass",
			versionSha256: `sha256:${"1".repeat(64)}`,
		},
		budget: {
			maxUsd: null,
			unknownCostPolicy: "token-wall-clock-bounds",
			maxOutputTokens: 600_000,
			maxWallClockMs: 3_600_000,
			maxAttempts: 3,
		},
	};
}

function attempt(
	cell: ScheduledCell,
	outcome: AttemptRecordV2["outcome"],
): AttemptRecordV2 {
	return {
		schemaVersion: 2,
		attemptId: `attempt-${cell.cellId}`,
		cellId: cell.cellId,
		blockId: cell.blockId,
		caseId: cell.caseId,
		caseVersion: cell.caseVersion,
		armToken: null,
		repetition: cell.repetition,
		artifact: {
			packageVersion: "1.0.0",
			sourceCommit: "commit",
			sourceTreeSha256: `sha256:${"2".repeat(64)}`,
			tarballSha256: `sha256:${"3".repeat(64)}`,
			unpackedManifestSha256: `sha256:${"4".repeat(64)}`,
		},
		evaluator: {
			sourceCommit: "commit",
			caseCatalogSha256: `sha256:${"5".repeat(64)}`,
			policyCatalogSha256: `sha256:${"6".repeat(64)}`,
			graderBundleSha256: `sha256:${"7".repeat(64)}`,
		},
		hostConfigSha256: `sha256:${"8".repeat(64)}`,
		actors: [],
		instructions: [],
		transcript: null,
		outcome,
		usage: { durationMs: 1, outputTokens: 0, costUsd: null },
	};
}

const product = {
	kind: "product" as const,
	passed: true,
	issues: [],
	endedBy: "quiet" as const,
	evidence: {
		kind: "conformance" as const,
		facts: {},
		falseCompletion: false,
		unsubmittedReviews: 0,
	},
};

function failure(
	origin: "host" | "provider" | "evaluator",
	retryable = true,
): AttemptRecordV2["outcome"] {
	const code =
		origin === "host"
			? "command-aborted"
			: origin === "provider"
				? "provider-rejected-turn"
				: "evaluator-failed";
	return { kind: "failure", origin, code, retryable };
}

describe("environment reserve activation", () => {
	test("activates the canonical same-stratum reserve for a retryable environment failure", () => {
		const state = deriveEnvironmentReserveState(plan(), [
			attempt(primaryA, failure("host")),
			attempt(primaryB, product),
		]);
		expect(state.activatedReserveCellIds).toEqual([reserve.cellId]);
		expect(state.nextReserveCellIds).toEqual([reserve.cellId]);
		expect(state.targetsSatisfied).toBe(false);
		expect(state.fatal).toBe(false);
	});

	test("reaches the original scored target without deleting the environment failure", () => {
		const state = deriveEnvironmentReserveState(plan(), [
			attempt(primaryA, failure("provider")),
			attempt(primaryB, product),
			attempt(reserve, product),
		]);
		expect(state.activatedReserveCellIds).toEqual([reserve.cellId]);
		expect(state.nextReserveCellIds).toEqual([]);
		expect(state.targetsSatisfied).toBe(true);
		expect(state.exhaustedStrata).toEqual([]);
	});

	test("does not spend one reserve on a stratum missing two scored outcomes", () => {
		const state = deriveEnvironmentReserveState(plan(), [
			attempt(primaryA, failure("host")),
			attempt(primaryB, {
				kind: "unscored-escalation",
				reason: "The model asked an unsupported question.",
			}),
		]);
		expect(state.activatedReserveCellIds).toEqual([]);
		expect(state.nextReserveCellIds).toEqual([]);
		expect(state.targetsSatisfied).toBe(false);
		expect(state.exhaustedStrata).toEqual([environmentStratumKey(primaryA)]);
	});

	test("never replaces product, evaluator, nonretryable, or reserve failures", () => {
		expect(
			deriveEnvironmentReserveState(plan(), [
				attempt(primaryA, { ...product, passed: false, issues: ["wrong"] }),
				attempt(primaryB, product),
			]).activatedReserveCellIds,
		).toEqual([]);
		expect(
			deriveEnvironmentReserveState(plan(), [
				attempt(primaryA, failure("evaluator", false)),
				attempt(primaryB, product),
			]).fatal,
		).toBe(true);
		expect(
			deriveEnvironmentReserveState(plan(), [
				attempt(primaryA, failure("host", false)),
				attempt(primaryB, product),
			]).activatedReserveCellIds,
		).toEqual([]);
		expect(
			deriveEnvironmentReserveState(plan(), [
				attempt(primaryA, {
					kind: "failure",
					origin: "host",
					code: "workspace-read-failed",
					retryable: true,
				}),
				attempt(primaryB, product),
			]).activatedReserveCellIds,
		).toEqual([]);
		const exhausted = deriveEnvironmentReserveState(plan(), [
			attempt(primaryA, failure("host")),
			attempt(primaryB, product),
			attempt(reserve, failure("host")),
		]);
		expect(exhausted.nextReserveCellIds).toEqual([]);
		expect(exhausted.exhaustedStrata).toEqual([
			environmentStratumKey(primaryA),
		]);
	});
});
