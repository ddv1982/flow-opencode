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
		const session = sampleSession("Workspace cache");
		await ensureWorkspace(worktree);
		await saveSession(worktree, session);

		const mkdirSpy = spyOn(fsPromises, "mkdir");
		for (let index = 0; index < 10; index += 1) {
			await saveSession(worktree, {
				...session,
				notes: index === 0 ? session.notes : [`repeat-save-${index}`],
			});
		}

		expect(mkdirSpy.mock.calls.length).toBeLessThanOrEqual(2);
	});
});
