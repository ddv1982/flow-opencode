import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { getSessionPath } from "../../src/runtime/paths";
import {
	loadSession,
	saveSession,
	saveSessionState,
} from "../../src/runtime/session";
import { createTempDirRegistry, sampleSession } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-session-cache-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("session read cache", () => {
	test("second loadSession with no mutation issues zero additional session.json reads", async () => {
		const worktree = makeTempDir();
		const session = await saveSession(worktree, sampleSession("Cache fixture"));
		const sessionPath = getSessionPath(worktree, session.id);
		const readSpy = spyOn(fsPromises, "readFile");

		const first = await loadSession(worktree);
		const second = await loadSession(worktree);

		const sessionReads = readSpy.mock.calls.filter(
			([path]) => String(path) === sessionPath,
		).length;

		expect(first).toEqual(second);
		expect(sessionReads).toBe(1);
	});

	test("loadSession returns the in-process saveSession mutation", async () => {
		const worktree = makeTempDir();
		const base = await saveSessionState(
			worktree,
			sampleSession("Cache mutation"),
		);
		const mutated = await saveSession(worktree, {
			...base,
			notes: [...base.notes, "freshly-added"],
		});

		const loaded = await loadSession(worktree);

		expect(loaded).toEqual(mutated);
		expect(loaded?.notes.at(-1)).toBe("freshly-added");
	});

	test("loadSession invalidates cached content after external session.json rewrite and mtime bump", async () => {
		const worktree = makeTempDir();
		const session = await saveSession(
			worktree,
			sampleSession("External rewrite"),
		);
		const sessionPath = getSessionPath(worktree, session.id);

		await loadSession(worktree);

		const external = {
			...session,
			goal: "Externally rewritten session",
			notes: ["external-writer"],
		};

		await writeFile(
			sessionPath,
			`${JSON.stringify(external, null, 2)}\n`,
			"utf8",
		);
		const future = new Date(Date.now() + 2_000);
		await utimes(sessionPath, future, future);

		const loaded = await loadSession(worktree);
		const onDisk = JSON.parse(await readFile(sessionPath, "utf8"));

		expect(loaded?.goal).toBe("Externally rewritten session");
		expect(loaded?.notes).toEqual(["external-writer"]);
		expect(loaded).toEqual(onDisk);
	});
});
