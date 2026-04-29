import { afterEach, describe, expect, test } from "bun:test";
import { loadSession, saveSession } from "../src/runtime/session";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("flow_plan_start idempotency", () => {
	test("same-goal plan start preserves plan, approval, approvedAt, notes, and artifacts", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute({ goal: "Build a workflow plugin" }, {
			worktree,
		} as never);
		await tools.flow_plan_apply.execute(
			{ planJson: JSON.stringify({ plan: samplePlan() }) },
			{ worktree } as never,
		);
		await tools.flow_plan_approve.execute({}, { worktree } as never);

		const before = await loadSession(worktree);
		expect(before).not.toBeNull();
		if (!before) return;

		const approvedAt = before.timestamps.approvedAt ?? new Date().toISOString();
		const seeded = {
			...before,
			notes: ["keep note"],
			artifacts: [{ path: "src/runtime/session.ts", kind: "updated" }],
			timestamps: {
				...before.timestamps,
				approvedAt,
			},
		};
		await saveSession(worktree, seeded);

		const response = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);
		const after = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(after).not.toBeNull();
		if (!after) return;

		expect(after.plan).toEqual(seeded.plan);
		expect(after.approval).toBe(seeded.approval);
		expect(after.timestamps.approvedAt).toBe(seeded.timestamps.approvedAt);
		expect(after.notes).toEqual(seeded.notes);
		expect(after.artifacts).toEqual(seeded.artifacts);
	});
});
