import type { AutoDriveProjection } from "./auto-drive.js";

function isMechanical(projection: AutoDriveProjection): boolean {
	return projection.nextAction === "flow_run_start"
		? projection.status === "ready"
		: projection.nextAction === "flow_session_close" &&
				(projection.status === "completed" || projection.status === "closed");
}
function isCheckpoint(projection: AutoDriveProjection): boolean {
	return ["flow_plan_approve", "await-user-direction"].includes(
		projection.nextAction ?? "",
	);
}
export function isPendingReviewer(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "running" &&
		projection.nextAction === "dispatch-flow-reviewer"
	);
}
export function isHandback(projection: AutoDriveProjection): boolean {
	return (
		projection.status === "blocked" ||
		projection.nextAction === "flow_feature_reset" ||
		projection.nextAction === "dispatch-flow-reviewer"
	);
}

export type LeaseView = Readonly<{
	baseline: AutoDriveProjection;
	checkpoint: Readonly<{
		revision: number;
		answered: boolean;
		advance?: number;
	}> | null;
	pendingReply: boolean;
	lastPromptedRevision: number | null;
	hasDelivery: boolean;
}>;

export type IdleDecision =
	| Readonly<{ kind: "deactivate" }>
	| Readonly<{ kind: "stop"; warning?: string }>
	| Readonly<{ kind: "prompt-initial" }>
	| Readonly<{ kind: "handback-and-wait" }>
	| Readonly<{ kind: "answered" }>
	| Readonly<{ kind: "handback-or-deactivate" }>
	| Readonly<{ kind: "pause"; warning: string; clearCheckpoint: boolean }>
	| Readonly<{ kind: "continue"; clearCheckpoint: boolean }>;

/**
 * Pure routing for one idle event. Mirrors the branch order of the previous
 * inline `onIdle` exactly; the executor applies side effects.
 */
export function decideOnIdle(
	lease: LeaseView,
	projection: AutoDriveProjection,
): IdleDecision {
	const { baseline, checkpoint } = lease;
	const anchored = checkpoint !== null;
	if (projection.status === "idle") {
		if (
			baseline.status !== "idle" ||
			baseline.sessionId ||
			lease.lastPromptedRevision === 0 ||
			!lease.hasDelivery
		)
			return { kind: "deactivate" };
		return { kind: "prompt-initial" };
	}
	if (projection.nextAction === null) return { kind: "deactivate" };
	if (projection.sessionId !== baseline.sessionId)
		return {
			kind: "stop",
			warning: "Flow auto-drive stopped: unowned session.",
		};
	const boundary = isCheckpoint(projection);
	const advance = checkpoint?.advance;
	const mutationAdvanced =
		advance !== undefined &&
		projection.revision === advance &&
		isMechanical(projection);
	if (lease.pendingReply) {
		if (boundary && (!checkpoint || projection.revision > checkpoint.revision))
			return { kind: "handback-and-wait" };
		if (!checkpoint || (!boundary && !mutationAdvanced))
			return { kind: "deactivate" };
		return { kind: "answered" };
	}
	if (boundary) {
		if (checkpoint && projection.revision < checkpoint.revision)
			return { kind: "deactivate" };
		return { kind: "handback-and-wait" };
	}
	if (!isMechanical(projection)) return { kind: "handback-or-deactivate" };
	let clearCheckpoint = false;
	if (checkpoint) {
		if (projection.revision <= checkpoint.revision || !mutationAdvanced)
			return { kind: "deactivate" };
		clearCheckpoint = true;
	}
	if (lease.lastPromptedRevision === projection.revision)
		return {
			kind: "pause",
			warning: `Flow auto-drive paused after revision ${projection.revision} made no lifecycle progress.`,
			clearCheckpoint,
		};
	if (
		baseline.sessionId
			? projection.revision <= baseline.revision ||
				(!anchored && !isPendingReviewer(baseline))
			: projection.sessionId === undefined
	)
		return { kind: "stop", warning: "Flow auto-drive stopped: no progress." };
	if (!lease.hasDelivery)
		return { kind: "stop", warning: "Flow auto-drive stopped: no delivery." };
	return { kind: "continue", clearCheckpoint };
}
