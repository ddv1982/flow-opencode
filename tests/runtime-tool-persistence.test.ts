import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getIndexDocPath } from "../src/runtime/paths";
import { loadSession } from "../src/runtime/session";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

describe("runtime tool persistence", () => {
	test("runtime tool transitions persist session state and refresh docs", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const before = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(before).toContain("summary: No plan yet.");

		await tools.flow_plan_apply.execute(
			{ planJson: JSON.stringify({ plan: samplePlan() }) },
			toolContext(worktree),
		);
		const afterApply = await readFile(
			await activeIndexDocPath(worktree),
			"utf8",
		);
		const session = await loadSession(worktree);
		expect(session?.plan?.summary).toBe(samplePlan().summary);
		expect(afterApply).toContain(
			"summary: Implement a small workflow feature set.",
		);
	});
});
