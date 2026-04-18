import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { getSessionDir, getSessionPath } from "../../src/runtime/paths";
import { SessionSchema } from "../../src/runtime/schema";
import { loadSession, saveSessionState } from "../../src/runtime/session";
import { createTempDirRegistry, sampleSession } from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-concurrent-writes-",
);

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("concurrent write safety", () => {
	test("50 randomized interleavings of two saveSessionState calls avoid torn JSON and temp artifacts", async () => {
		for (let iteration = 0; iteration < 50; iteration += 1) {
			const worktree = makeTempDir();
			const base = sampleSession(`Concurrent iteration ${iteration}`);
			const sessionPath = getSessionPath(worktree, base.id);
			const readSpy = spyOn(fsPromises, "readFile");

			const writerA = {
				...base,
				goal: `Concurrent iteration ${iteration} / writer-a`,
				notes: [`writer-a-${iteration}`],
			};
			const writerB = {
				...base,
				goal: `Concurrent iteration ${iteration} / writer-b`,
				notes: [`writer-b-${iteration}`],
			};

			if (Math.random() < 0.5) {
				await Promise.resolve();
			}

			await Promise.all([
				saveSessionState(worktree, writerA),
				saveSessionState(worktree, writerB),
			]);

			const loaded = await loadSession(worktree);
			if (!loaded) {
				throw new Error(
					"Expected loadSession to return the winning persisted state.",
				);
			}
			const sessionDirEntries = await readdir(getSessionDir(worktree, base.id));
			const onDisk = SessionSchema.parse(
				JSON.parse(await readFile(sessionPath, "utf8")),
			);
			const winners = [writerA.notes[0], writerB.notes[0]];
			const sessionReads = readSpy.mock.calls.filter(
				([path]) => String(path) === sessionPath,
			).length;

			expect(onDisk).toEqual(loaded);
			expect(winners).toContain(onDisk.notes[0]);
			expect(sessionDirEntries.some((entry) => entry.includes(".tmp"))).toBe(
				false,
			);
			expect(sessionReads).toBeGreaterThanOrEqual(1);
		}
	});
});
