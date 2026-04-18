import { afterEach, describe, expect, test } from "bun:test";
import { createSession, saveSession } from "../src/runtime/session";
import { createTempDirRegistry, createTestTools } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("flow_auto_prepare semantics", () => {
	test("resume mode returns /flow-auto resume for empty input and explicit resume", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await saveSession(worktree, createSession("Build a workflow plugin"));

		for (const input of [{}, { argumentString: "resume" }]) {
			const response = await tools.flow_auto_prepare.execute(input, {
				worktree,
			} as never);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("ok");
			expect(parsed.mode).toBe("resume");
			expect(parsed.goal).toBe("Build a workflow plugin");
			expect(parsed.nextCommand).toBe("/flow-auto resume");
		}
	});

	test("missing session plus empty input returns missing_goal with /flow-auto <goal>", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute({}, {
			worktree,
		} as never);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.nextCommand).toBe("/flow-auto <goal>");
		expect(String(parsed.summary)).toContain("goal");
	});
});
