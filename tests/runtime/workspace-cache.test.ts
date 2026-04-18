import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { ensureWorkspace, saveSession } from "../../src/runtime/session";
import { createTempDirRegistry, sampleSession } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-workspace-cache-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("workspace mkdir caching", () => {
	test("10 sequential saveSession calls issue at most two mkdir calls after ensureWorkspace", async () => {
		const worktree = makeTempDir();
		await ensureWorkspace(worktree);
		const mkdirSpy = spyOn(fsPromises, "mkdir");

		for (let index = 0; index < 10; index += 1) {
			await saveSession(worktree, sampleSession(`Workspace cache ${index}`));
		}

		expect(mkdirSpy.mock.calls).toHaveLength(30);
	});
});
