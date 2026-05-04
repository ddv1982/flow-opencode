import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { replayWorkflowEvents } from "../../src/core";
import {
	appendWorkflowEvents,
	createWorkflowCheckpoint,
	hashWorkflowEventPrefix,
	readWorkflowCheckpoint,
	renderWorkflowProjection,
	replayWorkflowEventLog,
	writeWorkflowCheckpoint,
} from "../../src/persistence";
import { getWorkflowProjectionIndexPath } from "../../src/persistence/projection-store";
import { createTempDirRegistry } from "../runtime-test-helpers";
import { GOLDEN_EVENT_LOG_CORPUS } from "./golden-event-corpus";
import { assertWorkflowSemanticInvariants } from "./helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-replay-gate-");

describe("replay/checkpoint/projection release gate", () => {
	afterEach(() => {
		cleanupTempDirs();
	});

	for (const testCase of GOLDEN_EVENT_LOG_CORPUS) {
		test(`persists, checkpoints, and projects ${testCase.name}`, async () => {
			const worktree = makeTempDir();
			const records = await appendWorkflowEvents(
				worktree,
				testCase.sessionId,
				testCase.events,
			);
			expect(records.map((record) => record.sequence)).toEqual(
				testCase.events.map((_event, index) => index + 1),
			);

			const replayed = await replayWorkflowEventLog(
				worktree,
				testCase.sessionId,
			);
			expect(replayed).toEqual(testCase.finalState);
			if (!replayed) {
				throw new Error("Expected replay gate to produce state.");
			}
			assertWorkflowSemanticInvariants(replayed, `persisted:${testCase.name}`);

			const checkpointSequence = Math.max(1, records.length - 2);
			const partialState = replayWorkflowEvents(
				testCase.events.slice(0, checkpointSequence),
			);
			if (!partialState) {
				throw new Error("Expected partial replay to produce checkpoint state.");
			}
			await writeWorkflowCheckpoint(
				worktree,
				createWorkflowCheckpoint(partialState, {
					eventSequence: checkpointSequence,
					eventPrefixHash: hashWorkflowEventPrefix(
						testCase.events,
						checkpointSequence,
					),
					source: "event_replay",
				}),
			);
			const partialCheckpoint = await readWorkflowCheckpoint(
				worktree,
				testCase.sessionId,
			);
			const replayedFromPartialCheckpoint = replayWorkflowEvents(
				testCase.events.slice(partialCheckpoint?.eventSequence ?? 0),
				partialCheckpoint?.state ?? null,
			);
			expect(replayedFromPartialCheckpoint).toEqual(replayed);
			const replayedViaPersistenceCheckpoint = await replayWorkflowEventLog(
				worktree,
				testCase.sessionId,
			);
			expect(replayedViaPersistenceCheckpoint).toEqual(replayed);

			await writeWorkflowCheckpoint(
				worktree,
				createWorkflowCheckpoint(replayed, {
					eventSequence: records.length,
					eventPrefixHash: hashWorkflowEventPrefix(
						testCase.events,
						records.length,
					),
					source: "event_replay",
				}),
			);
			const checkpoint = await readWorkflowCheckpoint(
				worktree,
				testCase.sessionId,
			);
			expect(checkpoint?.state).toEqual(replayed);
			expect(checkpoint?.eventSequence).toBe(records.length);

			await renderWorkflowProjection(worktree, replayed);
			const indexMarkdown = await readFile(
				getWorkflowProjectionIndexPath(worktree, testCase.sessionId),
				"utf8",
			);
			expect(indexMarkdown).toContain(replayed.goal);
			expect(indexMarkdown).toContain(replayed.status);
		});
	}
});
