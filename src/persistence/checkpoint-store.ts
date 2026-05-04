import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkflowState } from "../core";
import { parseStrictJsonObject } from "../runtime/json/strict-object";
import { getWorkflowCheckpointPath } from "../runtime/paths";
import { SessionSchema } from "../runtime/schema";
import { assertMutableWorkspaceRoot } from "../runtime/workspace-root";
import { writeFileAtomically } from "./atomic-file";
import { withPersistenceLock } from "./locks";

export type WorkflowCheckpointSource = "event_replay";

export type WorkflowCheckpoint = {
	version: 1;
	sessionId: string;
	eventSequence: number;
	eventPrefixHash: string;
	recordedAt: string;
	source: WorkflowCheckpointSource;
	state: WorkflowState;
};

const preparedCheckpointDirs = new Set<string>();

async function ensureCheckpointDir(checkpointPath: string): Promise<void> {
	const checkpointDir = dirname(checkpointPath);
	if (preparedCheckpointDirs.has(checkpointDir)) {
		return;
	}
	await mkdir(checkpointDir, { recursive: true });
	preparedCheckpointDirs.add(checkpointDir);
}

function parseWorkflowCheckpoint(
	value: unknown,
	expectedSessionId?: string,
): WorkflowCheckpoint {
	if (!value || typeof value !== "object") {
		throw new Error("Workflow checkpoint must be a JSON object.");
	}
	const checkpoint = value as Partial<WorkflowCheckpoint>;
	if (checkpoint.version !== 1) {
		throw new Error("Workflow checkpoint version must be 1.");
	}
	if (
		typeof checkpoint.sessionId !== "string" ||
		checkpoint.sessionId.length === 0
	) {
		throw new Error(
			"Workflow checkpoint sessionId must be a non-empty string.",
		);
	}
	if (
		typeof checkpoint.eventSequence !== "number" ||
		!Number.isInteger(checkpoint.eventSequence) ||
		checkpoint.eventSequence < 0
	) {
		throw new Error(
			"Workflow checkpoint eventSequence must be a non-negative integer.",
		);
	}
	if (
		typeof checkpoint.eventPrefixHash !== "string" ||
		checkpoint.eventPrefixHash.length === 0
	) {
		throw new Error(
			"Workflow checkpoint eventPrefixHash must be a non-empty string.",
		);
	}
	if (
		typeof checkpoint.recordedAt !== "string" ||
		checkpoint.recordedAt.length === 0
	) {
		throw new Error(
			"Workflow checkpoint recordedAt must be a non-empty string.",
		);
	}
	if (checkpoint.source !== "event_replay") {
		throw new Error("Workflow checkpoint source is invalid.");
	}
	const state = SessionSchema.parse(checkpoint.state);
	if (state.id !== checkpoint.sessionId) {
		throw new Error(
			`Workflow checkpoint state belongs to session '${state.id}', expected '${checkpoint.sessionId}'.`,
		);
	}
	if (expectedSessionId && checkpoint.sessionId !== expectedSessionId) {
		throw new Error(
			`Workflow checkpoint belongs to session '${checkpoint.sessionId}', expected '${expectedSessionId}'.`,
		);
	}
	return {
		version: 1,
		sessionId: checkpoint.sessionId,
		eventSequence: checkpoint.eventSequence,
		eventPrefixHash: checkpoint.eventPrefixHash,
		recordedAt: checkpoint.recordedAt,
		source: checkpoint.source,
		state,
	};
}

export function createWorkflowCheckpoint(
	state: WorkflowState,
	options: {
		eventSequence: number;
		eventPrefixHash: string;
		recordedAt?: string | undefined;
		source: WorkflowCheckpointSource;
	},
): WorkflowCheckpoint {
	return {
		version: 1,
		sessionId: state.id,
		eventSequence: options.eventSequence,
		eventPrefixHash: options.eventPrefixHash,
		recordedAt: options.recordedAt ?? state.timestamps.updatedAt,
		source: options.source,
		state: SessionSchema.parse(state),
	};
}

async function writeCheckpointAtPath(
	worktree: string,
	checkpoint: WorkflowCheckpoint,
	checkpointPath: string,
	lockName: string,
): Promise<void> {
	await withPersistenceLock(worktree, lockName, async () => {
		await ensureCheckpointDir(checkpointPath);
		await writeFileAtomically(
			checkpointPath,
			`${JSON.stringify(checkpoint, null, 2)}\n`,
		);
	});
}

export async function writeWorkflowCheckpoint(
	worktree: string,
	checkpoint: WorkflowCheckpoint,
): Promise<void> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const normalized = parseWorkflowCheckpoint(checkpoint);
	await writeCheckpointAtPath(
		mutableWorktree,
		normalized,
		getWorkflowCheckpointPath(mutableWorktree, normalized.sessionId),
		`checkpoint-${normalized.sessionId}`,
	);
}

export async function readWorkflowCheckpoint(
	worktree: string,
	sessionId: string,
): Promise<WorkflowCheckpoint | null> {
	const mutableWorktree = assertMutableWorkspaceRoot(worktree);
	const checkpointPath = getWorkflowCheckpointPath(mutableWorktree, sessionId);
	let raw: string;
	try {
		raw = await readFile(checkpointPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
	const object = parseStrictJsonObject(raw, "Workflow checkpoint");
	if (!object.ok) {
		throw new Error(object.error);
	}
	return parseWorkflowCheckpoint(object.value, sessionId);
}
