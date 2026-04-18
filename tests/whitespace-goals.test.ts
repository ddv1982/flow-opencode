import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTempDirRegistry, createTestTools } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-whitespace-goals-",
);

afterEach(() => {
	cleanupTempDirs();
});

function toolContext(worktree: string) {
	return { worktree } as Parameters<
		ReturnType<typeof createTestTools>["flow_status"]["execute"]
	>[1];
}

describe("whitespace-only goals", () => {
	test("flow_plan_start rejects whitespace-only goals with no session creation", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const sessionsDir = join(worktree, ".flow", "sessions");
		mkdirSync(sessionsDir, { recursive: true });

		for (const goal of [" ", "\t", "\n\t "]) {
			const before = await readdir(sessionsDir);
			const response = await tools.flow_plan_start.execute(
				{ goal },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("error");
			expect(parsed.summary).toContain("goal");
			expect(await readdir(sessionsDir)).toEqual(before);
		}
	});
});
