import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readdir, readFile } from "node:fs/promises";
import { runFlowCoreCommand } from "../../src/runtime/application";
import { runMutationActionAtRoot } from "../../src/runtime/application/action-engine";
import { loadSession, saveSessionState } from "../../src/runtime/lifecycle";
import {
	getIndexDocPath,
	getSessionDir,
	getSessionPath,
} from "../../src/runtime/paths";
import { type Session, SessionSchema } from "../../src/runtime/schema";
import { succeed } from "../../src/runtime/transitions/shared";
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

	test("concurrent action-engine mutations compose state and docs instead of losing an update", async () => {
		const worktree = makeTempDir();
		const base = await saveSessionState(worktree, {
			...sampleSession("Compose concurrent mutations"),
			notes: [],
		});

		function appendNoteAction(note: string) {
			return {
				name: `append_${note}`,
				run: (session: Session) =>
					succeed({
						...session,
						notes: [...session.notes, note],
					}),
				getSession: (session: Session) => session,
				onSuccess: (saved: Session) => ({
					status: "ok",
					summary: `Saved ${saved.notes.join(",")}`,
				}),
			};
		}

		await Promise.all([
			runMutationActionAtRoot(worktree, appendNoteAction("note-a")),
			runMutationActionAtRoot(worktree, appendNoteAction("note-b")),
		]);

		const loaded = await loadSession(worktree);
		if (!loaded) {
			throw new Error("Expected active session after concurrent mutations.");
		}
		expect(new Set(loaded.notes)).toEqual(new Set(["note-a", "note-b"]));

		const indexDoc = await readFile(getIndexDocPath(worktree, base.id), "utf8");
		expect(indexDoc).toContain("- note-a");
		expect(indexDoc).toContain("- note-b");
	});

	test("concurrent plan_save calls merge planning context into the current session", async () => {
		const worktree = makeTempDir();

		await Promise.all([
			runFlowCoreCommand({ worktree }, "plan_save", {
				goal: "Merge concurrent planning context",
				planning: { repoProfile: ["profile-a"] },
				directory: worktree,
			}),
			runFlowCoreCommand({ worktree }, "plan_save", {
				goal: "Merge concurrent planning context",
				planning: { repoProfile: ["profile-b"] },
				directory: worktree,
			}),
		]);

		const loaded = await loadSession(worktree);
		if (!loaded) {
			throw new Error("Expected active session after concurrent plan saves.");
		}
		expect(loaded.goal).toBe("Merge concurrent planning context");
		expect(new Set(loaded.planning.repoProfile)).toEqual(
			new Set(["profile-a", "profile-b"]),
		);

		const indexDoc = await readFile(
			getIndexDocPath(worktree, loaded.id),
			"utf8",
		);
		expect(indexDoc).toContain("- profile-a");
		expect(indexDoc).toContain("- profile-b");
	});
});
