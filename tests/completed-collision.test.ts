import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCompletedSessionsDir } from "../src/runtime/paths";
import {
	closeSession,
	createSession,
	loadStoredSession,
	saveSession,
} from "../src/runtime/session";
import * as time from "../src/runtime/util";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("completed timestamp handling", () => {
	test("toCompletedTimestamp and completedTimestampNow use millisecond precision", () => {
		expect(time.toCompletedTimestamp("2025-04-05T19:42:13.482Z")).toBe(
			"20250405T194213.482",
		);

		const nowIsoSpy = spyOn(time, "nowIso").mockReturnValue(
			"2025-04-05T19:42:13.482Z",
		);
		expect(time.completedTimestampNow()).toBe("20250405T194213.482");
		expect(nowIsoSpy).toHaveBeenCalled();
	});

	test("closeSession retries with numeric suffixes when a timestamp collides", async () => {
		const worktree = makeTempDir();
		const session = createSession("Completed collisions");

		spyOn(time, "nowIso").mockReturnValue("2025-04-05T19:42:13.482Z");

		await saveSession(worktree, session);
		const first = await closeSession(worktree, "completed");
		expect(first).not.toBeNull();

		await saveSession(worktree, session);
		const second = await closeSession(worktree, "completed");
		expect(second).not.toBeNull();

		expect(first?.completedTo).toBe(
			`.flow/completed/${session.id}-20250405T194213.482`,
		);
		expect(second?.completedTo).toBe(
			`.flow/completed/${session.id}-20250405T194213.482-1`,
		);

		const completedEntries = await readdir(getCompletedSessionsDir(worktree));
		expect(completedEntries.sort()).toEqual([
			`${session.id}-20250405T194213.482`,
			`${session.id}-20250405T194213.482-1`,
		]);
	});

	test("loadStoredSession prefers the newest completed session by millisecond timestamp", async () => {
		const worktree = makeTempDir();
		const session = createSession("Newest completion wins");

		spyOn(time, "completedTimestampNow")
			.mockReturnValueOnce("20250405T194213.482")
			.mockReturnValueOnce("20250405T194213.483");
		await saveSession(worktree, {
			...session,
			goal: "Older completed copy",
		});
		const firstCompleted = await closeSession(worktree, "completed");
		expect(firstCompleted).not.toBeNull();

		await saveSession(worktree, {
			...session,
			goal: "Newer completed copy",
		});
		const secondCompleted = await closeSession(worktree, "completed");
		expect(secondCompleted).not.toBeNull();

		const loaded = await loadStoredSession(worktree, session.id);
		expect(loaded?.source).toBe("completed");
		expect(loaded?.completedPath).toBe(
			`.flow/completed/${session.id}-20250405T194213.483`,
		);
		expect(loaded?.completedAt).toBe("20250405T194213.483");
		expect(loaded?.session.goal).toBe("Newer completed copy");

		await expect(
			Bun.file(
				join(
					worktree,
					`.flow/completed/${session.id}-20250405T194213.483`,
					"session.json",
				),
			).text(),
		).resolves.toContain('"goal": "Newer completed copy"');
	});
});
