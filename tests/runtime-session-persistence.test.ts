import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	activateSession,
	createSession,
	loadSession,
	saveSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../src/runtime/lifecycle";
import {
	getActiveSessionDir,
	getActiveSessionsDir,
	getFeatureDocPath,
	getIndexDocPath,
	getSessionPath,
	getStoredSessionDir,
	getStoredSessionsDir,
} from "../src/runtime/paths";
import { SessionActivationRollbackError } from "../src/runtime/session-live-storage";
import {
	resetSessionWorkspaceFsForTests,
	setSessionWorkspaceFsForTests,
	withSessionSaveLock,
} from "../src/runtime/session-workspace";
import { applyPlan, selectPlanFeatures } from "../src/runtime/transitions";
import { assertMutableWorkspaceRoot } from "../src/runtime/workspace-root";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	resetSessionWorkspaceFsForTests();
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
		expect(created.version).toBe(1);
		expect(loaded?.version).toBe(1);
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

	test("activating a stored session parks the prior active session", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));

		const activated = await activateSession(worktree, first.id);

		expect(activated?.id).toBe(first.id);
		expect(await activeSessionId(worktree)).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
	});

	test("keeps prior active session when a new open session write fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = createSession("Second goal");

		setSessionWorkspaceFsForTests({
			open: async (path, flags, mode) => {
				if (String(path).includes(`${second.id}/session.json.`)) {
					throw new Error("injected session write failure");
				}

				return open(path, flags, mode);
			},
		});

		await expect(saveSession(worktree, second)).rejects.toThrow(
			"injected session write failure",
		);

		expect(await activeSessionId(worktree)).toBe(first.id);
		expect((await loadSession(worktree))?.id).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).rejects.toThrow();
	});

	test("keeps prior active session when requested session promotion fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = createSession("Second goal");

		setSessionWorkspaceFsForTests({
			rename: async (from, to) => {
				if (
					String(from) === getStoredSessionDir(worktree, second.id) &&
					String(to) === getActiveSessionDir(worktree, second.id)
				) {
					throw new Error("injected promotion rename failure");
				}

				return rename(from, to);
			},
		});

		await expect(saveSession(worktree, second)).rejects.toThrow(
			"injected promotion rename failure",
		);

		expect(await activeSessionId(worktree)).toBe(first.id);
		expect((await loadSession(worktree))?.id).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).rejects.toThrow();
	});

	test("keeps prior active session when direct activation promotion fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));

		setSessionWorkspaceFsForTests({
			rename: async (from, to) => {
				if (
					String(from) === getStoredSessionDir(worktree, first.id) &&
					String(to) === getActiveSessionDir(worktree, first.id)
				) {
					throw new Error("injected direct activation promotion failure");
				}

				return rename(from, to);
			},
		});

		await expect(activateSession(worktree, first.id)).rejects.toThrow(
			"injected direct activation promotion failure",
		);

		expect(await activeSessionId(worktree)).toBe(second.id);
		expect((await loadSession(worktree))?.id).toBe(second.id);
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
		await expect(
			readFile(getSessionPath(worktree, first.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).rejects.toThrow();
	});

	test("exposes structured diagnostics when direct activation rollback restore fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));
		const promotionError = new Error("injected activation promotion failure");
		const rollbackError = new Error("injected rollback restore failure");

		setSessionWorkspaceFsForTests({
			rename: async (from, to) => {
				if (
					String(from) === getStoredSessionDir(worktree, first.id) &&
					String(to) === getActiveSessionDir(worktree, first.id)
				) {
					throw promotionError;
				}
				if (
					String(from) === getStoredSessionDir(worktree, second.id) &&
					String(to) === getActiveSessionDir(worktree, second.id)
				) {
					throw rollbackError;
				}

				return rename(from, to);
			},
		});

		let caught: unknown;
		try {
			await activateSession(worktree, first.id);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(SessionActivationRollbackError);
		expect((caught as SessionActivationRollbackError).code).toBe(
			"SESSION_ACTIVATION_ROLLBACK_FAILED",
		);
		expect((caught as SessionActivationRollbackError).rollbackPhase).toBe(
			"restore_prior_active",
		);
		expect((caught as SessionActivationRollbackError).promotionError).toBe(
			promotionError,
		);
		expect((caught as SessionActivationRollbackError).rollbackError).toBe(
			rollbackError,
		);
		expect((caught as Error).cause).toEqual({
			promotionError,
			rollbackError,
			rollbackPhase: "restore_prior_active",
		});
	});

	test("exposes structured diagnostics when direct activation rollback sync fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));
		const promotionError = new Error("injected activation promotion failure");
		const rollbackSyncError = new Error("injected rollback sync failure");

		setSessionWorkspaceFsForTests({
			rename: async (from, to) => {
				if (
					String(from) === getStoredSessionDir(worktree, first.id) &&
					String(to) === getActiveSessionDir(worktree, first.id)
				) {
					throw promotionError;
				}

				return rename(from, to);
			},
			open: async (path, flags, mode) => {
				if (String(path) === getActiveSessionsDir(worktree)) {
					throw rollbackSyncError;
				}

				return open(path, flags, mode);
			},
		});

		let caught: unknown;
		try {
			await activateSession(worktree, first.id);
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(SessionActivationRollbackError);
		expect((caught as SessionActivationRollbackError).rollbackPhase).toBe(
			"sync_live_parent_directories",
		);
		expect((caught as SessionActivationRollbackError).promotionError).toBe(
			promotionError,
		);
		expect((caught as SessionActivationRollbackError).rollbackError).toBe(
			rollbackSyncError,
		);
		expect((caught as Error).cause).toEqual({
			promotionError,
			rollbackError: rollbackSyncError,
			rollbackPhase: "sync_live_parent_directories",
		});
		expect(await activeSessionId(worktree)).toBe(second.id);
	});

	test("keeps a consistent active session after promotion directory sync fails", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = createSession("Second goal");

		setSessionWorkspaceFsForTests({
			open: async (path, flags, mode) => {
				if (String(path) === getActiveSessionsDir(worktree)) {
					throw new Error("injected promotion sync failure");
				}

				return open(path, flags, mode);
			},
		});

		await expect(saveSession(worktree, second)).rejects.toThrow(
			"injected promotion sync failure",
		);

		expect(await activeSessionId(worktree)).toBe(second.id);
		expect((await loadSession(worktree))?.id).toBe(second.id);
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
		await expect(
			readFile(getSessionPath(worktree, first.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "First goal"');
	});

	test("flow_plan_start recreates missing .flow/stored before parking the prior active session", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const first = await saveSession(worktree, createSession("First goal"));
		await rm(getStoredSessionsDir(worktree), { recursive: true, force: true });

		const response = await tools.flow_plan_save.execute(
			{ goal: "Second goal" },
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(await activeSessionId(worktree)).not.toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "First goal"');
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

	test("rejects persisted session data with unsupported future schema versions", async () => {
		const worktree = makeTempDir();
		const saved = await saveSessionState(
			worktree,
			createSession("Build a workflow plugin"),
		);
		const persisted = JSON.parse(
			await readFile(getSessionPath(worktree, saved.id), "utf8"),
		);

		await writeFile(
			getSessionPath(worktree, saved.id),
			`${JSON.stringify({ ...persisted, version: 2 }, null, "\t")}\n`,
			"utf8",
		);

		await expect(loadSession(worktree)).rejects.toThrow();
	});

	test("withSessionSaveLock runs a queued same-worktree task after an earlier task rejects", async () => {
		const worktree = assertMutableWorkspaceRoot(makeTempDir());
		let releaseFirstTask!: () => void;
		const firstTaskCanFinish = new Promise<void>((resolve) => {
			releaseFirstTask = resolve;
		});
		let secondTaskRan = false;

		const firstTask = withSessionSaveLock(worktree, async () => {
			await firstTaskCanFinish;
			throw new Error("first task failed");
		});
		const secondTask = withSessionSaveLock(worktree, async () => {
			secondTaskRan = true;
			return "second task completed";
		});
		expect(secondTaskRan).toBe(false);

		releaseFirstTask();

		let firstTaskError: unknown;
		try {
			await firstTask;
		} catch (error) {
			firstTaskError = error;
		}
		expect(firstTaskError).toBeInstanceOf(Error);
		expect((firstTaskError as Error).message).toBe("first task failed");
		expect(await secondTask).toBe("second task completed");
		expect(secondTaskRan).toBe(true);
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
