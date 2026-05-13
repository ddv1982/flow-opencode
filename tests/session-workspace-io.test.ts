import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionPathFromDir } from "../src/runtime/paths";
import {
	readSessionFromPath,
	writeSessionFileAtDir,
} from "../src/runtime/session-workspace";
import { createTempDirRegistry, sampleSession } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-session-io-");

afterEach(() => {
	cleanupTempDirs();
});

describe("session workspace I/O", () => {
	test("readSessionFromPath returns cache clones and writeSessionFileAtDir invalidates replaced bytes", async () => {
		const worktree = makeTempDir();
		const session = sampleSession("Initial cached session");
		const sessionDir = join(worktree, ".flow", "active", session.id);
		const sessionPath = getSessionPathFromDir(sessionDir);

		await writeSessionFileAtDir(sessionDir, session);

		const firstRead = await readSessionFromPath(sessionPath);
		firstRead.goal = "Mutated caller copy";
		firstRead.notes.push("caller-only mutation");

		const secondRead = await readSessionFromPath(sessionPath);
		expect(secondRead.goal).toBe("Initial cached session");
		expect(secondRead.notes).not.toContain("caller-only mutation");

		await writeSessionFileAtDir(sessionDir, {
			...session,
			goal: "Replaced session bytes",
		});
		const replacedRead = await readSessionFromPath(sessionPath);
		expect(replacedRead.goal).toBe("Replaced session bytes");
	});

	test("readSessionFromPath rejects duplicate JSON keys before schema parsing", async () => {
		const worktree = makeTempDir();
		const sessionDir = join(worktree, ".flow", "active", "duplicate-session");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			getSessionPathFromDir(sessionDir),
			'{"id":"first","id":"second"}',
			"utf8",
		);

		await expect(
			readSessionFromPath(getSessionPathFromDir(sessionDir)),
		).rejects.toThrow("Duplicate JSON key");
	});

	test("readSessionFromPath rejects invalid JSON before schema parsing", async () => {
		const worktree = makeTempDir();
		const sessionDir = join(worktree, ".flow", "active", "invalid-session");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			getSessionPathFromDir(sessionDir),
			"{not valid json",
			"utf8",
		);

		await expect(
			readSessionFromPath(getSessionPathFromDir(sessionDir)),
		).rejects.toThrow("Session file");
	});
});
