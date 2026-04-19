import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getActiveSessionPath,
	getIndexDocPath,
	getLegacyDocsDir,
	getLegacySessionPath,
	getSessionDir,
	getSessionPath,
} from "../src/runtime/paths";
import { createSession, loadSession } from "../src/runtime/session";
import { createTempDirRegistry } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry(
	"flow-legacy-migration-",
);

afterEach(() => {
	cleanupTempDirs();
});

describe("legacy session migration", () => {
	test("loadSession migrates legacy session.json into the new workspace layout", async () => {
		const worktree = makeTempDir();
		const legacySession = createSession("Legacy migration goal");
		const legacyFlowDir = join(worktree, ".flow");
		const legacyDocsDir = getLegacyDocsDir(worktree);
		const legacySessionPath = getLegacySessionPath(worktree);

		mkdirSync(legacyFlowDir, { recursive: true });
		mkdirSync(legacyDocsDir, { recursive: true });
		await writeFile(
			join(legacyDocsDir, "index.md"),
			"# stale legacy doc\n",
			"utf8",
		);
		await writeFile(
			legacySessionPath,
			`${JSON.stringify(legacySession, null, 2)}\n`,
			"utf8",
		);

		const migrated = await loadSession(worktree);

		expect(migrated?.id).toBe(legacySession.id);
		expect(await readFile(getActiveSessionPath(worktree), "utf8")).toBe(
			`${legacySession.id}\n`,
		);
		await expect(readFile(legacySessionPath, "utf8")).rejects.toThrow();
		await expect(
			readFile(join(legacyDocsDir, "index.md"), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(getSessionPath(worktree, legacySession.id), "utf8"),
		).resolves.toContain('"goal": "Legacy migration goal"');
		await expect(
			readFile(getIndexDocPath(worktree, legacySession.id), "utf8"),
		).resolves.toContain("goal: Legacy migration goal");
	});

	test("loadSession skips legacy migration when an active session already exists", async () => {
		const worktree = makeTempDir();
		const activeSession = createSession("Already active");
		const legacySession = createSession("Legacy should stay put");
		const legacySessionPath = getLegacySessionPath(worktree);

		mkdirSync(join(worktree, ".flow"), { recursive: true });
		await writeFile(
			legacySessionPath,
			`${JSON.stringify(legacySession, null, 2)}\n`,
			"utf8",
		);
		const beforeBytes = await readFile(legacySessionPath);
		const beforeStat = await stat(legacySessionPath);
		await writeFile(
			getActiveSessionPath(worktree),
			`${activeSession.id}\n`,
			"utf8",
		);
		mkdirSync(getSessionDir(worktree, activeSession.id), { recursive: true });
		await writeFile(
			getSessionPath(worktree, activeSession.id),
			`${JSON.stringify(activeSession, null, 2)}\n`,
			"utf8",
		);

		const loaded = await loadSession(worktree);

		expect(loaded?.id).toBe(activeSession.id);
		expect(await readFile(getActiveSessionPath(worktree), "utf8")).toBe(
			`${activeSession.id}\n`,
		);
		const afterBytes = await readFile(legacySessionPath);
		const afterStat = await stat(legacySessionPath);
		expect(Buffer.compare(afterBytes, beforeBytes)).toBe(0);
		expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
	});

	test("loadSession rejects malformed legacy session data with duplicate keys", async () => {
		const worktree = makeTempDir();
		const legacySessionPath = getLegacySessionPath(worktree);

		mkdirSync(join(worktree, ".flow"), { recursive: true });
		await writeFile(legacySessionPath, '{"id":"a","id":"b"}', "utf8");

		await expect(loadSession(worktree)).rejects.toThrow("Duplicate JSON key");
	});
});
