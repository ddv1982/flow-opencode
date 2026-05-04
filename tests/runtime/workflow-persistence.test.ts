import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayWorkflowEvents, type WorkflowEvent } from "../../src/core";
import {
	appendWorkflowEvents,
	createWorkflowCheckpoint,
	hashWorkflowEventPrefix,
	readWorkflowCheckpoint,
	readWorkflowEventRecords,
	replayWorkflowEventLog,
	writeWorkflowCheckpoint,
} from "../../src/persistence";
import { getWorkflowCheckpointPath } from "../../src/runtime/paths";
import { createTempDirRegistry, samplePlan } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-persistence-");

function planningEvents(): WorkflowEvent[] {
	const plan = samplePlan();
	return [
		{
			type: "workflow_started",
			sessionId: "event-session-1",
			goal: "Persist workflow events.",
			recordedAt: "2026-05-03T12:00:00.000Z",
		},
		{
			type: "planning_context_recorded",
			planning: {
				repoProfile: ["TypeScript workflow package"],
				packageManager: "bun",
			},
			recordedAt: "2026-05-03T12:01:00.000Z",
		},
		{
			type: "plan_applied",
			plan,
			recordedAt: "2026-05-03T12:02:00.000Z",
		},
		{
			type: "plan_approved",
			plan,
			recordedAt: "2026-05-03T12:03:00.000Z",
		},
	];
}

describe("workflow persistence stores", () => {
	afterEach(() => {
		cleanupTempDirs();
	});

	test("replayed event log matches the checkpoint state", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		const records = await appendWorkflowEvents(
			worktree,
			"event-session-1",
			events,
		);
		const replayed = await replayWorkflowEventLog(worktree, "event-session-1");
		const directReplay = replayWorkflowEvents(events);
		if (!replayed || !directReplay) {
			throw new Error("Expected replay to produce workflow state.");
		}

		expect(records.map((record) => record.sequence)).toEqual([1, 2, 3, 4]);
		expect(replayed).toEqual(directReplay);
		expect(replayed.status).toBe("ready");

		await writeWorkflowCheckpoint(
			worktree,
			createWorkflowCheckpoint(replayed, {
				eventSequence: records.length,
				eventPrefixHash: hashWorkflowEventPrefix(events, records.length),
				recordedAt: "2026-05-03T12:04:00.000Z",
				source: "event_replay",
			}),
		);

		const checkpoint = await readWorkflowCheckpoint(
			worktree,
			"event-session-1",
		);
		expect(checkpoint?.eventSequence).toBe(records.length);
		expect(checkpoint?.source).toBe("event_replay");
		expect(checkpoint?.state).toEqual(replayed);
	});

	test("rejects cross-session events before appending them", async () => {
		const worktree = makeTempDir();
		await expect(
			appendWorkflowEvents(worktree, "event-session-1", [
				{
					type: "workflow_started",
					sessionId: "different-session",
					goal: "Poison the wrong log.",
					recordedAt: "2026-05-03T12:00:00.000Z",
				},
			]),
		).rejects.toThrow("expected 'event-session-1'");
	});

	test("event replay can resume from a stored checkpoint sequence", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		await appendWorkflowEvents(worktree, "event-session-1", events.slice(0, 2));
		const checkpointState = await replayWorkflowEventLog(
			worktree,
			"event-session-1",
		);
		if (!checkpointState) {
			throw new Error("Expected replay to produce a checkpoint state.");
		}
		await writeWorkflowCheckpoint(
			worktree,
			createWorkflowCheckpoint(checkpointState, {
				eventSequence: 2,
				eventPrefixHash: hashWorkflowEventPrefix(events, 2),
				recordedAt: "2026-05-03T12:02:30.000Z",
				source: "event_replay",
			}),
		);
		await appendWorkflowEvents(worktree, "event-session-1", events.slice(2));

		const checkpoint = await readWorkflowCheckpoint(
			worktree,
			"event-session-1",
		);
		if (!checkpoint) {
			throw new Error("Expected checkpoint to be saved.");
		}
		const persistedTailEvents = (
			await readWorkflowEventRecords(worktree, "event-session-1")
		)
			.filter((record) => record.sequence > checkpoint.eventSequence)
			.map((record) => record.event);
		const tailState = replayWorkflowEvents(
			persistedTailEvents,
			checkpoint.state,
		);
		const fullReplay = await replayWorkflowEventLog(
			worktree,
			"event-session-1",
		);
		expect(tailState).toEqual(fullReplay);
		expect(persistedTailEvents).toEqual(events.slice(checkpoint.eventSequence));
		expect(fullReplay?.approval).toBe("approved");

		const explicitResumeReplay = await replayWorkflowEventLog(
			worktree,
			"event-session-1",
			checkpoint.state,
			checkpoint.eventSequence,
		);
		expect(explicitResumeReplay).toEqual(fullReplay);
	});

	test("rejects checkpoints with sequence beyond persisted event log", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		await appendWorkflowEvents(worktree, "event-session-1", events.slice(0, 2));
		const state = replayWorkflowEvents(events.slice(0, 2));
		if (!state) {
			throw new Error("Expected replay to produce workflow state.");
		}
		await writeWorkflowCheckpoint(
			worktree,
			createWorkflowCheckpoint(state, {
				eventSequence: 10,
				eventPrefixHash: hashWorkflowEventPrefix(events, 2),
				source: "event_replay",
			}),
		);

		await expect(
			replayWorkflowEventLog(worktree, "event-session-1"),
		).rejects.toThrow("exceeds persisted event count");
	});

	test("rejects invalid explicit initialEventSequence values", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		await appendWorkflowEvents(worktree, "event-session-1", events);
		const state = replayWorkflowEvents(events.slice(0, 2));
		if (!state) {
			throw new Error("Expected replay to produce workflow state.");
		}

		await expect(
			replayWorkflowEventLog(worktree, "event-session-1", state, -1),
		).rejects.toThrow("non-negative integer");
		await expect(
			replayWorkflowEventLog(worktree, "event-session-1", state, 999),
		).rejects.toThrow("exceeds persisted event count");
	});

	test("rejects checkpoint prefix hash mismatch", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		await appendWorkflowEvents(worktree, "event-session-1", events);
		const state = replayWorkflowEvents(events.slice(0, 2));
		if (!state) {
			throw new Error("Expected replay to produce workflow state.");
		}
		await writeWorkflowCheckpoint(
			worktree,
			createWorkflowCheckpoint(state, {
				eventSequence: 2,
				eventPrefixHash: "tampered-prefix-hash",
				source: "event_replay",
			}),
		);

		await expect(
			replayWorkflowEventLog(worktree, "event-session-1"),
		).rejects.toThrow("prefix hash mismatch");
	});

	test("checkpoint reads reject files for a different session", async () => {
		const worktree = makeTempDir();
		const events = planningEvents();
		const otherState = replayWorkflowEvents(events);
		if (!otherState) {
			throw new Error("Expected replay to produce workflow state.");
		}
		const requestedPath = getWorkflowCheckpointPath(
			worktree,
			"requested-session",
		);
		await mkdir(dirname(requestedPath), { recursive: true });
		await writeFile(
			requestedPath,
			`${JSON.stringify(
				createWorkflowCheckpoint(otherState, {
					eventSequence: events.length,
					eventPrefixHash: hashWorkflowEventPrefix(events, events.length),
					source: "event_replay",
				}),
				null,
				2,
			)}\n`,
		);

		await expect(
			readWorkflowCheckpoint(worktree, "requested-session"),
		).rejects.toThrow("expected 'requested-session'");
	});
});
