import { describe, expect, test } from "bun:test";
import { SessionSchema } from "../src/application/schema.js";
import { canonicalValidationCommandDigest } from "../src/domain/transitions.js";
import { validationCommandClass } from "../src/domain/validation-command.js";
import {
	VALIDATION_RECEIPT_KIND,
	ValidationReceiptV1Schema,
} from "../src/domain/validation-receipt.js";
import {
	REQUIRED_REPOSITORY_SEQUENCE_ACTIONS,
	runDeterministicRepositoryLifecycleSequence,
} from "./support/lifecycle-repository-sequence.js";
import {
	parseBoundedInteger,
	runningSequenceSession,
} from "./support/lifecycle-sequence.js";

const seedStart = parseBoundedInteger(
	process.env.FLOW_LIFECYCLE_SEED_START,
	101,
	1,
	Number.MAX_SAFE_INTEGER,
);
const seedCount = parseBoundedInteger(
	process.env.FLOW_LIFECYCLE_SEED_COUNT,
	12,
	1,
	512,
);
const stepCount = parseBoundedInteger(
	process.env.FLOW_LIFECYCLE_STEP_COUNT,
	24,
	8,
	128,
);

describe("Session v4 deterministic lifecycle sequences", () => {
	test(`replays ${seedCount} bounded seeds from ${seedStart}`, async () => {
		for (let offset = 0; offset < seedCount; offset += 1) {
			const result = await runDeterministicRepositoryLifecycleSequence(
				seedStart + offset,
				stepCount,
			);
			expect(new Set(result.actionCoverage)).toEqual(
				new Set(REQUIRED_REPOSITORY_SEQUENCE_ACTIONS),
			);
			expect(result.acceptedMutationCount).toBeGreaterThanOrEqual(15);
			expect(result.atomicRejectionCount).toBeGreaterThanOrEqual(2);
			expect(result.repositoryReloadCount).toBeGreaterThanOrEqual(
				result.acceptedMutationCount,
			);
			expect(result.archivedSession.closure).not.toBeNull();
		}
	}, 600_000);

	test("rejects one-field persisted-state corruptions", () => {
		const running = runningSequenceSession();
		const corruptions = [
			{ ...running, activeFeatureRunId: null },
			{
				...running,
				featureRuns: running.featureRuns.map((run) =>
					run.status === "active"
						? { ...run, endedAt: "2026-07-19T12:00:00.000Z" }
						: run,
				),
			},
			{ ...running, version: 99 },
		];
		for (const corruption of corruptions) {
			expect(SessionSchema.safeParse(corruption).success).toBe(false);
		}
	});

	test("accepts inclusive validation equality and rejects reversed chronology", () => {
		const command = "bun test tests/lifecycle-invariant-sequences.test.ts";
		const base = {
			schemaVersion: 1 as const,
			kind: VALIDATION_RECEIPT_KIND,
			featureRunId: "feature-run:sequence",
			featureId: "sequence",
			sourceDigest: `sha256:${"b".repeat(64)}`,
			startedAt: "2026-07-19T12:00:00.000Z",
			completedAt: "2026-07-19T12:00:00.000Z",
			command,
			commandDigest: canonicalValidationCommandDigest(command),
			commandClass: validationCommandClass(command),
			coverageScope: "focused" as const,
			exitCode: 0,
			outputDigest: `sha256:${"a".repeat(64)}`,
			outputCompleteness: "complete" as const,
			environmentKeys: [],
		};
		expect(ValidationReceiptV1Schema.safeParse(base).success).toBe(true);
		expect(
			ValidationReceiptV1Schema.safeParse({
				...base,
				startedAt: "2026-07-19T12:00:00.001Z",
			}).success,
		).toBe(false);
	});
});
