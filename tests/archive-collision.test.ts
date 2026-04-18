import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getArchiveDir } from "../src/runtime/paths";
import {
	archiveSession,
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

describe("archive timestamp handling", () => {
	test("toArchiveTimestamp and archiveTimestampNow use millisecond precision", () => {
		expect(time.toArchiveTimestamp("2025-04-05T19:42:13.482Z")).toBe(
			"20250405T194213.482",
		);

		const nowIsoSpy = spyOn(time, "nowIso").mockReturnValue(
			"2025-04-05T19:42:13.482Z",
		);
		expect(time.archiveTimestampNow()).toBe("20250405T194213.482");
		expect(nowIsoSpy).toHaveBeenCalled();
	});

	test("archiveSession retries with numeric suffixes when a timestamp collides", async () => {
		const worktree = makeTempDir();
		const session = createSession("Archive collisions");

		spyOn(time, "nowIso").mockReturnValue("2025-04-05T19:42:13.482Z");

		await saveSession(worktree, session);
		const first = await archiveSession(worktree);
		expect(first).not.toBeNull();

		await saveSession(worktree, session);
		const second = await archiveSession(worktree);
		expect(second).not.toBeNull();

		expect(first?.archivedTo).toBe(
			`.flow/archive/${session.id}-20250405T194213.482`,
		);
		expect(second?.archivedTo).toBe(
			`.flow/archive/${session.id}-20250405T194213.482-1`,
		);

		const archiveEntries = await readdir(getArchiveDir(worktree));
		expect(archiveEntries.sort()).toEqual([
			`${session.id}-20250405T194213.482`,
			`${session.id}-20250405T194213.482-1`,
		]);
	});

	test("loadStoredSession prefers the newest archived session by millisecond timestamp", async () => {
		const worktree = makeTempDir();
		const session = createSession("Newest archive wins");

		spyOn(time, "archiveTimestampNow")
			.mockReturnValueOnce("20250405T194213.482")
			.mockReturnValueOnce("20250405T194213.483");
		await saveSession(worktree, {
			...session,
			goal: "Older archived copy",
		});
		const firstArchive = await archiveSession(worktree);
		expect(firstArchive).not.toBeNull();

		await saveSession(worktree, {
			...session,
			goal: "Newer archived copy",
		});
		const secondArchive = await archiveSession(worktree);
		expect(secondArchive).not.toBeNull();

		const loaded = await loadStoredSession(worktree, session.id);
		expect(loaded?.source).toBe("archive");
		expect(loaded?.archivePath).toBe(
			`.flow/archive/${session.id}-20250405T194213.483`,
		);
		expect(loaded?.archivedAt).toBe("20250405T194213.483");
		expect(loaded?.session.goal).toBe("Newer archived copy");

		await expect(
			Bun.file(
				join(
					worktree,
					`.flow/archive/${session.id}-20250405T194213.483`,
					"session.json",
				),
			).text(),
		).resolves.toContain('"goal": "Newer archived copy"');
	});
});
