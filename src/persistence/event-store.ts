import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	replayWorkflowEvents,
	type WorkflowEvent,
	type WorkflowState,
} from "../core";
import {
	getWorkflowEventLogPath,
	sanitizePathComponent,
} from "../runtime/paths";
import { assertMutableWorkspaceRoot } from "../runtime/workspace-root";
import { readWorkflowCheckpoint } from "./checkpoint-store";
import { withPersistenceLock } from "./locks";

export type WorkflowEventRecord = {
	version: 1;
	sessionId: string;
	sequence: number;
	event: WorkflowEvent;
};

const WORKFLOW_EVENT_TYPES = new Set<string>([
	"workflow_started",
	"planning_context_recorded",
	"plan_applied",
	"plan_approved",
	"plan_features_selected",
	"run_started",
	"reviewer_decision_recorded",
	"run_completed",
	"feature_reset",
	"workflow_completed",
]);

function assertRecordObject(
	value: unknown,
): asserts value is WorkflowEventRecord {
	if (!value || typeof value !== "object") {
		throw new Error("Workflow event record must be a JSON object.");
	}
	const record = value as Partial<WorkflowEventRecord>;
	if (record.version !== 1) {
		throw new Error("Workflow event record version must be 1.");
	}
	if (typeof record.sessionId !== "string" || record.sessionId.length === 0) {
		throw new Error(
			"Workflow event record sessionId must be a non-empty string.",
		);
	}
	if (
		typeof record.sequence !== "number" ||
		!Number.isInteger(record.sequence) ||
		record.sequence < 1
	) {
		throw new Error(
			"Workflow event record sequence must be a positive integer.",
		);
	}
	if (!record.event || typeof record.event !== "object") {
		throw new Error("Workflow event record event must be a JSON object.");
	}
	const eventType = (record.event as { type?: unknown }).type;
	const recordedAt = (record.event as { recordedAt?: unknown }).recordedAt;
	if (typeof eventType !== "string" || eventType.length === 0) {
		throw new Error("Workflow event type must be a non-empty string.");
	}
	if (!WORKFLOW_EVENT_TYPES.has(eventType)) {
		throw new Error(`Unsupported workflow event type '${eventType}'.`);
	}
	if (typeof recordedAt !== "string" || recordedAt.length === 0) {
		throw new Error("Workflow event recordedAt must be a non-empty string.");
	}
}

function parseEventRecord(
	line: string,
	lineNumber: number,
): WorkflowEventRecord {
	try {
		const parsed = JSON.parse(line) as unknown;
		assertRecordObject(parsed);
		return parsed;
	} catch (error) {
		throw new Error(
			`Invalid workflow event record at line ${lineNumber}: ${(error as Error).message}`,
		);
	}
}

function assertSequentialRecords(
	records: readonly WorkflowEventRecord[],
	sessionId: string,
): void {
	sanitizePathComponent("event", sessionId);
	records.forEach((record, index) => {
		if (record.sessionId !== sessionId) {
			throw new Error(
				`Workflow event record ${record.sequence} belongs to session '${record.sessionId}', expected '${sessionId}'.`,
			);
		}
		if (record.sequence !== index + 1) {
			throw new Error(
				`Workflow event log sequence gap at line ${index + 1}: expected ${index + 1}, found ${record.sequence}.`,
			);
		}
	});
}

function assertReplayableEventLog(
	sessionId: string,
	events: readonly WorkflowEvent[],
): void {
	const replayed = replayWorkflowEvents(events);
	if (!replayed) {
		throw new Error("Workflow event log must produce a workflow state.");
	}
	if (replayed.id !== sessionId) {
		throw new Error(
			`Workflow event log replay produced session '${replayed.id}', expected '${sessionId}'.`,
		);
	}
}

export async function readWorkflowEventRecords(
	worktree: string,
	sessionId: string,
): Promise<WorkflowEventRecord[]> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const eventLogPath = getWorkflowEventLogPath(mutableWorktree, sessionId);
	let raw: string;
	try {
		raw = await readFile(eventLogPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw error;
	}

	const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
	const records = lines.map((line, index) => parseEventRecord(line, index + 1));
	assertSequentialRecords(records, sessionId);
	return records;
}

export function hashWorkflowEventPrefix(
	events: readonly WorkflowEvent[],
	eventSequence: number,
): string {
	if (!Number.isInteger(eventSequence) || eventSequence < 0) {
		throw new Error(
			"Workflow event prefix sequence must be a non-negative integer.",
		);
	}
	if (eventSequence > events.length) {
		throw new Error(
			`Workflow event prefix sequence ${eventSequence} exceeds event count ${events.length}.`,
		);
	}
	const payload = JSON.stringify(events.slice(0, eventSequence));
	return createHash("sha256").update(payload).digest("hex");
}

export async function readWorkflowEvents(
	worktree: string,
	sessionId: string,
): Promise<WorkflowEvent[]> {
	return (await readWorkflowEventRecords(worktree, sessionId)).map(
		(record) => record.event,
	);
}

export async function appendWorkflowEvents(
	worktree: string,
	sessionId: string,
	events: readonly WorkflowEvent[],
): Promise<WorkflowEventRecord[]> {
	if (events.length === 0) {
		return [];
	}

	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	sanitizePathComponent("event", sessionId);
	return withPersistenceLock(
		mutableWorktree,
		`events-${sessionId}`,
		async () => {
			const existingRecords = await readWorkflowEventRecords(
				mutableWorktree,
				sessionId,
			);
			assertReplayableEventLog(sessionId, [
				...existingRecords.map((record) => record.event),
				...events,
			]);
			const eventLogPath = getWorkflowEventLogPath(mutableWorktree, sessionId);
			await mkdir(dirname(eventLogPath), { recursive: true });
			const nextRecords = events.map<WorkflowEventRecord>((event, index) => ({
				version: 1,
				sessionId,
				sequence: existingRecords.length + index + 1,
				event,
			}));
			const payload = nextRecords
				.map((record) => JSON.stringify(record))
				.join("\n");
			const fileHandle = await open(eventLogPath, "a");
			try {
				await fileHandle.writeFile(`${payload}\n`, "utf8");
				await fileHandle.sync();
			} finally {
				await fileHandle.close();
			}
			const directoryHandle = await open(dirname(eventLogPath), "r");
			try {
				await directoryHandle.sync();
			} finally {
				await directoryHandle.close();
			}
			return nextRecords;
		},
	);
}

export async function replayWorkflowEventLog(
	worktree: string,
	sessionId: string,
	initialState: WorkflowState | null = null,
	initialEventSequence = 0,
): Promise<WorkflowState | null> {
	const eventRecords = await readWorkflowEventRecords(worktree, sessionId);
	const events = eventRecords.map((record) => record.event);
	if (!Number.isInteger(initialEventSequence) || initialEventSequence < 0) {
		throw new Error(
			"Workflow replay initialEventSequence must be a non-negative integer.",
		);
	}
	if (initialEventSequence > eventRecords.length) {
		throw new Error(
			`Workflow replay initialEventSequence ${initialEventSequence} exceeds persisted event count ${eventRecords.length} for session '${sessionId}'.`,
		);
	}
	let replayBase = initialState;
	let replayEvents = events.slice(initialEventSequence);
	if (!replayBase) {
		const checkpoint = await readWorkflowCheckpoint(worktree, sessionId);
		if (checkpoint) {
			if (checkpoint.eventSequence > eventRecords.length) {
				throw new Error(
					`Workflow checkpoint sequence ${checkpoint.eventSequence} exceeds persisted event count ${eventRecords.length} for session '${sessionId}'.`,
				);
			}
			const checkpointPrefixHash = hashWorkflowEventPrefix(
				events,
				checkpoint.eventSequence,
			);
			if (checkpoint.eventPrefixHash !== checkpointPrefixHash) {
				throw new Error(
					`Workflow checkpoint prefix hash mismatch for session '${sessionId}'.`,
				);
			}
			replayBase = checkpoint.state;
			replayEvents = events.slice(checkpoint.eventSequence);
		}
	}
	const replayed = replayWorkflowEvents(replayEvents, replayBase);
	if (replayed && replayed.id !== sessionId) {
		throw new Error(
			`Workflow event log replay produced session '${replayed.id}', expected '${sessionId}'.`,
		);
	}
	return replayed;
}
