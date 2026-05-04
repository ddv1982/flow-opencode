import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { getSessionPath } from "../../src/runtime/paths";
import { ensureWorkspace, saveSession } from "../../src/runtime/session";
import { readSessionFromPath } from "../../src/runtime/session-workspace";
import { createTempDirRegistry, sampleSession } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-workspace-cache-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("workspace mkdir caching", () => {
	test("read session cache returns isolated copies", async () => {
		const worktree = makeTempDir();
		const session = sampleSession("Cache clone safety");
		await saveSession(worktree, session);

		const sessionPath = getSessionPath(worktree, session.id);
		const first = await readSessionFromPath(sessionPath);
		first.goal = "Mutated in-memory only";
		const second = await readSessionFromPath(sessionPath);

		expect(second.goal).toBe(session.goal);
		expect(second).not.toBe(first);
	});

	test("10 sequential saveSession calls re-ensure workspace roots on every save", async () => {
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

		const nonLockMkdirCalls = mkdirSpy.mock.calls.filter(
			([target]) => !String(target).endsWith(".lock"),
		);
		expect(nonLockMkdirCalls.length).toBe(30);
	});
});
