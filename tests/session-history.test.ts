import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	archiveSession,
	createSession,
	listSessionHistory,
	saveSession,
} from "../src/runtime/session";
import * as time from "../src/runtime/util";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("session history archive parsing", () => {
	test("listSessionHistory parses millisecond archive timestamps and sorts descending", async () => {
		const worktree = makeTempDir();
		const first = createSession("Older archived session");
		const second = createSession("Newer archived session");

		spyOn(time, "archiveTimestampNow")
			.mockReturnValueOnce("20250405T194213.482")
			.mockReturnValueOnce("20250405T194213.483");
		await saveSession(worktree, first);
		const olderArchive = await archiveSession(worktree);
		expect(olderArchive).not.toBeNull();

		await saveSession(worktree, second);
		const newerArchive = await archiveSession(worktree);
		expect(newerArchive).not.toBeNull();

		const history = await listSessionHistory(worktree);
		expect(history.activeSessionId).toBeNull();
		expect(history.sessions).toEqual([]);
		expect(history.archived).toHaveLength(2);
		expect(history.archived.map((entry) => entry.id)).toEqual([
			second.id,
			first.id,
		]);
		expect(history.archived.map((entry) => entry.archivedAt)).toEqual([
			"20250405T194213.483",
			"20250405T194213.482",
		]);
		expect(history.archived.map((entry) => entry.archivePath)).toEqual([
			expect.any(String),
			expect.any(String),
		]);
		expect(history.archived[0]?.archivePath).toBe(newerArchive?.archivedTo);
		expect(history.archived[1]?.archivePath).toBe(olderArchive?.archivedTo);
	});
});
