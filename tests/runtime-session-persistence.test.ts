import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getFeatureDocPath,
	getIndexDocPath,
	getSessionPath,
} from "../src/runtime/paths";
import {
	createSession,
	deleteSessionArtifacts,
	deleteSessionState,
	loadSession,
	saveSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../src/runtime/session";
import { applyPlan, selectPlanFeatures } from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function activeSessionPath(worktree: string): Promise<string> {
	return getSessionPath(worktree, await activeSessionId(worktree));
}

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

async function activeFeatureDocPath(
	worktree: string,
	featureId: string,
): Promise<string> {
	return getFeatureDocPath(
		worktree,
		await activeSessionId(worktree),
		featureId,
	);
}

describe("runtime session persistence", () => {
	test("creates, saves, and loads a session", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		await saveSession(worktree, created);

		const loaded = await loadSession(worktree);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(loaded?.goal).toBe("Build a workflow plugin");
		expect(loaded?.status).toBe("planning");
		expect(indexDoc).toContain("# Flow Session");
		expect(indexDoc).toContain("goal: Build a workflow plugin");
	});

	test("stores active sessions under .flow/active and parked sessions under .flow/stored", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));

		expect(await activeSessionId(worktree)).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getIndexDocPath(worktree, first.id), "utf8"),
		).resolves.toContain("goal: First goal");

		const second = await saveSession(worktree, createSession("Second goal"));

		expect(await activeSessionId(worktree)).toBe(second.id);
		await expect(
			readFile(getSessionPath(worktree, first.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
		await expect(
			readFile(getIndexDocPath(worktree, second.id), "utf8"),
		).resolves.toContain("goal: Second goal");
	});

	test("rejects malformed persisted session data", async () => {
		const worktree = makeTempDir();
		const sessionId = "malformed-session";
		mkdirSync(join(worktree, ".flow", "active", sessionId), {
			recursive: true,
		});
		await writeFile(
			getSessionPath(worktree, sessionId),
			"{not valid json",
			"utf8",
		);

		await expect(loadSession(worktree)).rejects.toThrow();
	});

	test("rejects persisted session data with duplicate keys", async () => {
		const worktree = makeTempDir();
		const sessionId = "duplicate-session";
		mkdirSync(join(worktree, ".flow", "active", sessionId), {
			recursive: true,
		});
		await writeFile(
			getSessionPath(worktree, sessionId),
			'{"id":"a","id":"b"}',
			"utf8",
		);

		await expect(loadSession(worktree)).rejects.toThrow("Duplicate JSON key");
	});

	test("saveSession refreshes updatedAt while preserving createdAt", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const firstSave = await saveSession(worktree, created);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const secondSave = await saveSession(worktree, firstSave);

		expect(secondSave.timestamps.createdAt).toBe(
			firstSave.timestamps.createdAt,
		);
		expect(new Date(secondSave.timestamps.updatedAt).getTime()).toBeGreaterThan(
			new Date(firstSave.timestamps.updatedAt).getTime(),
		);
	});

	test("saveSessionState persists source-of-truth session state without rendering docs", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");

		const saved = await saveSessionState(worktree, created);

		await expect(
			readFile(await activeSessionPath(worktree), "utf8"),
		).resolves.toContain('"goal": "Build a workflow plugin"');
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).rejects.toThrow();
		expect(saved.goal).toBe("Build a workflow plugin");
	});

	test("syncSessionArtifacts renders docs from persisted session state", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const saved = await saveSessionState(worktree, created);

		await syncSessionArtifacts(worktree, saved);

		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).resolves.toContain("# Flow Session");
	});

	test("deleteSessionState and deleteSessionArtifacts can clean persistence and docs independently", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const saved = await saveSession(worktree, created);
		expect(saved.goal).toBe("Build a workflow plugin");

		await deleteSessionState(worktree);
		await expect(
			readFile(await activeSessionPath(worktree), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).resolves.toContain("# Flow Session");

		await deleteSessionArtifacts(worktree);
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).rejects.toThrow();
	});

	test("renders feature docs for planned work", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(featureDoc).toContain("# Feature setup-runtime");
		expect(featureDoc).toContain("Create runtime helpers");
		expect(featureDoc).toContain("src/runtime/session.ts");
	});

	test("prunes stale feature docs when a plan is narrowed", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		await expect(
			readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8"),
		).resolves.toContain("# Feature execute-feature");

		const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		await saveSession(worktree, selected.value);

		await expect(
			readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8"),
		).resolves.toContain("# Feature setup-runtime");
		await expect(
			readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8"),
		).rejects.toThrow();
	});

	test("renders multiline content without breaking markdown structure", async () => {
		const worktree = makeTempDir();
		const session = createSession(
			"Build a workflow plugin\nwith multiline context",
		);
		const applied = applyPlan(session, {
			...samplePlan(),
			summary: "Implement docs\nwithout malformed markdown",
			features: [
				{
					id: "setup-runtime",
					title: "Create runtime helpers\ncarefully",
					summary: "Line one\n## not a real heading\nLine three",
					fileTargets: ["src/runtime/session.ts"],
					verification: ["bun test\nwith extra notes"],
				},
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(indexDoc).toContain(
			"goal: Build a workflow plugin / with multiline context",
		);
		expect(indexDoc).toContain(
			"summary: Implement docs / without malformed markdown",
		);
		expect(featureDoc).toContain("> ## not a real heading");
		expect(featureDoc).toContain("- bun test / with extra notes");
	});
});
