import { describe, expect, test } from "bun:test";
import type { AutoDriveProjection } from "../src/platform/opencode/auto-drive.js";
import {
	decideOnIdle,
	type LeaseView,
} from "../src/platform/opencode/auto-drive-decision.js";

const running: AutoDriveProjection = {
	sessionId: "s1",
	status: "running",
	revision: 5,
	nextAction: "flow_validation_start",
};

function lease(overrides: Partial<LeaseView> = {}): LeaseView {
	return {
		baseline: {
			sessionId: "s1",
			status: "ready",
			revision: 3,
			nextAction: "flow_run_start",
		},
		checkpoint: null,
		pendingReply: false,
		lastPromptedRevision: null,
		hasDelivery: true,
		...overrides,
	};
}

describe("decideOnIdle", () => {
	test("prompts the initial route from an idle workspace once", () => {
		const idle: AutoDriveProjection = {
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		};
		const fresh = lease({
			baseline: { status: "idle", revision: 0, nextAction: "flow_plan_save" },
		});
		expect(decideOnIdle(fresh, idle)).toEqual({ kind: "prompt-initial" });
		expect(decideOnIdle({ ...fresh, lastPromptedRevision: 0 }, idle)).toEqual({
			kind: "deactivate",
		});
	});

	test("deactivates when the projection has no next action", () => {
		expect(decideOnIdle(lease(), { ...running, nextAction: null })).toEqual({
			kind: "deactivate",
		});
	});

	test("stops on an unowned session", () => {
		expect(decideOnIdle(lease(), { ...running, sessionId: "other" })).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: unowned session.",
		});
	});

	test("hands back and waits at a checkpoint boundary", () => {
		const approve: AutoDriveProjection = {
			...running,
			status: "planning",
			nextAction: "flow_plan_approve",
		};
		expect(decideOnIdle(lease(), approve)).toEqual({
			kind: "handback-and-wait",
		});
	});

	test("deactivates when a boundary appears below the recorded checkpoint", () => {
		const approve: AutoDriveProjection = {
			...running,
			revision: 2,
			status: "planning",
			nextAction: "flow_plan_approve",
		};
		expect(
			decideOnIdle(
				lease({ checkpoint: { revision: 4, answered: false } }),
				approve,
			),
		).toEqual({ kind: "deactivate" });
	});

	test("treats a non-mechanical projection as handback-or-deactivate", () => {
		expect(decideOnIdle(lease(), running)).toEqual({
			kind: "handback-or-deactivate",
		});
	});

	test("continues on a mechanical advance past an answered checkpoint", () => {
		const ready: AutoDriveProjection = {
			sessionId: "s1",
			status: "ready",
			revision: 6,
			nextAction: "flow_run_start",
		};
		const view = lease({
			checkpoint: { revision: 4, answered: true, advance: 6 },
		});
		expect(decideOnIdle(view, ready)).toEqual({
			kind: "continue",
			clearCheckpoint: true,
		});
	});

	test("pauses when the same revision was already prompted", () => {
		const ready: AutoDriveProjection = {
			sessionId: "s1",
			status: "ready",
			revision: 6,
			nextAction: "flow_run_start",
		};
		expect(decideOnIdle(lease({ lastPromptedRevision: 6 }), ready)).toEqual({
			kind: "pause",
			warning:
				"Flow auto-drive paused after revision 6 made no lifecycle progress.",
			clearCheckpoint: false,
		});
	});

	test("stops without delivery once a checkpoint has been passed", () => {
		// Needs an anchored checkpoint with a matching advance: without one the
		// "no progress" rule fires first, and without the advance the checkpoint
		// rule deactivates. Only then does the delivery check become reachable.
		const ready: AutoDriveProjection = {
			sessionId: "s1",
			status: "ready",
			revision: 6,
			nextAction: "flow_run_start",
		};
		const view = lease({
			hasDelivery: false,
			checkpoint: { revision: 3, answered: true, advance: 6 },
		});
		expect(decideOnIdle(view, ready)).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: no delivery.",
		});
	});

	test("stops on no progress when the lease was never anchored", () => {
		const ready: AutoDriveProjection = {
			sessionId: "s1",
			status: "ready",
			revision: 6,
			nextAction: "flow_run_start",
		};
		expect(decideOnIdle(lease(), ready)).toEqual({
			kind: "stop",
			warning: "Flow auto-drive stopped: no progress.",
		});
	});

	test("marks a pending reply as answered when nothing moved", () => {
		const ready: AutoDriveProjection = {
			sessionId: "s1",
			status: "ready",
			revision: 4,
			nextAction: "flow_run_start",
		};
		const view = lease({
			pendingReply: true,
			checkpoint: { revision: 4, answered: false },
		});
		expect(decideOnIdle(view, ready)).toEqual({ kind: "deactivate" });
		const advanced = lease({
			pendingReply: true,
			checkpoint: { revision: 3, answered: false, advance: 4 },
		});
		expect(decideOnIdle(advanced, ready)).toEqual({ kind: "answered" });
	});
});
