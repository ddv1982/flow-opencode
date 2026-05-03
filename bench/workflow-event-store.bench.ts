import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench } from "mitata";
import { createCoreTools } from "../src/adapters/opencode/tools";
import {
	decideWorkflowCommand,
	replayWorkflowEvents,
	type WorkflowCommand,
	type WorkflowEvent,
	type WorkflowState,
} from "../src/core";
import {
	appendWorkflowEvents,
	createWorkflowCheckpoint,
	renderWorkflowProjection,
	writeWorkflowCheckpoint,
} from "../src/persistence";
import {
	createCompletedSession,
	createPlan,
	createWorkerResult,
} from "./fixtures";

function withTempDir<T>(
	prefix: string,
	run: (worktree: string) => Promise<T>,
): () => Promise<T> {
	return async () => {
		const worktree = mkdtempSync(join(tmpdir(), prefix));
		try {
			return await run(worktree);
		} finally {
			rmSync(worktree, { recursive: true, force: true });
		}
	};
}

function approvedFeatureDecision(featureId: string) {
	return {
		scope: "feature" as const,
		featureId,
		status: "approved" as const,
		summary: `Approved ${featureId}.`,
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function collectAcceptedEvents(
	commands: readonly WorkflowCommand[],
): WorkflowEvent[] {
	let state: WorkflowState | null = null;
	const events: WorkflowEvent[] = [];

	commands.forEach((command, index) => {
		const decision = decideWorkflowCommand(state, command, {
			recordedAt: new Date(Date.UTC(2026, 4, 3, 13, index, 0)).toISOString(),
		});
		if (!decision.accepted) {
			throw new Error(
				`Workflow benchmark command '${command.type}' rejected: ${decision.message}`,
			);
		}

		for (const event of decision.events) {
			state = replayWorkflowEvents([event], state);
			events.push(event);
		}
	});

	return events;
}

const sessionId = "bench-workflow-event-session";
const completedSession = createCompletedSession(5);
const eventLog = collectAcceptedEvents([
	{
		type: "start_workflow",
		sessionId,
		goal: "Benchmark realistic workflow event replay.",
	},
	{ type: "apply_plan", plan: createPlan(2) },
	{ type: "approve_plan" },
	{ type: "start_run" },
	{
		type: "record_reviewer_decision",
		decision: approvedFeatureDecision("feature-1"),
	},
	{
		type: "complete_run",
		worker: createWorkerResult("feature-1"),
	},
]);

bench(
	"workflow events / append 6-event log",
	withTempDir("flow-bench-event-append-", async (worktree) => {
		await appendWorkflowEvents(worktree, sessionId, eventLog);
	}),
);

bench("workflow events / replay 6-event log", () => {
	replayWorkflowEvents(eventLog);
});

bench(
	"workflow checkpoint / write completed state",
	withTempDir("flow-bench-checkpoint-", async (worktree) => {
		await writeWorkflowCheckpoint(
			worktree,
			createWorkflowCheckpoint(completedSession, {
				eventSequence: eventLog.length,
				source: "event_replay",
			}),
		);
	}),
);

bench(
	"workflow projection / render completed state",
	withTempDir("flow-bench-projection-", async (worktree) => {
		await renderWorkflowProjection(worktree, completedSession);
	}),
);

bench("opencode tool projection / createCoreTools", () => {
	createCoreTools();
});
