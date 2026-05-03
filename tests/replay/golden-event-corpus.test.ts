import { describe, expect, test } from "bun:test";
import { replayWorkflowEvents } from "../../src/core";
import { GOLDEN_EVENT_LOG_CORPUS } from "./golden-event-corpus";
import {
	assertWorkflowSemanticInvariants,
	eventLogJsonl,
	eventRecordsForCase,
} from "./helpers";

describe("golden workflow event-log corpus", () => {
	test("contains release-gate replay paths", () => {
		expect(GOLDEN_EVENT_LOG_CORPUS.map((testCase) => testCase.name)).toEqual([
			"planning-ready",
			"single-feature-completion",
			"feature-reset-recovery",
		]);
		for (const testCase of GOLDEN_EVENT_LOG_CORPUS) {
			expect(testCase.events[0]?.type).toBe("workflow_started");
			expect(testCase.events.length).toBeGreaterThanOrEqual(4);
		}
	});

	for (const testCase of GOLDEN_EVENT_LOG_CORPUS) {
		test(`replays ${testCase.name} to its golden final state`, () => {
			const replayed = replayWorkflowEvents(testCase.events);
			expect(replayed).toEqual(testCase.finalState);
			assertWorkflowSemanticInvariants(
				testCase.finalState,
				`golden:${testCase.name}`,
			);
		});

		test(`serializes ${testCase.name} as an append-only JSONL event log`, () => {
			const jsonl = eventLogJsonl(testCase);
			const parsed = jsonl
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line) as unknown);
			expect(parsed).toEqual(eventRecordsForCase(testCase));
			expect(
				parsed.map((record) => (record as { sequence: number }).sequence),
			).toEqual(testCase.events.map((_event, index) => index + 1));
		});
	}
});
