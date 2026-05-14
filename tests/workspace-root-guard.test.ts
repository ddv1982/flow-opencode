import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ensureMutableWorkspacePermission,
	MutableWorkspacePermissionError,
} from "../src/adapters/opencode/tool-surface/mutable-workspace-permission";
import {
	closeSession,
	createSession,
	ensureWorkspace,
	listSessionHistory,
	saveSession,
} from "../src/runtime/session";

async function makeTempDir(prefix: string) {
	return mkdtemp(join(tmpdir(), prefix));
}

async function withHomeEnv<T>(
	homeDir: string,
	run: () => Promise<T>,
): Promise<T> {
	const originalHome = process.env.HOME;
	process.env.HOME = homeDir;

	try {
		return await run();
	} finally {
		process.env.HOME = originalHome;
	}
}

afterEach(() => {
	delete process.env.FLOW_TRUSTED_WORKSPACE_ROOTS;
});

describe("workspace root guards", () => {
	test("adapter permission fails closed for hidden workspace roots when ask is unavailable", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");

		try {
			await withHomeEnv(fakeHome, async () => {
				await mkdir(hiddenWorkspace, { recursive: true });

				try {
					await ensureMutableWorkspacePermission({ worktree: hiddenWorkspace });
					throw new Error("expected hidden workspace permission rejection");
				} catch (error) {
					expect(error).toBeInstanceOf(MutableWorkspacePermissionError);
					expect((error as MutableWorkspacePermissionError).code).toBe(
						"MUTABLE_WORKSPACE_PERMISSION_REQUIRED",
					);
					expect((error as MutableWorkspacePermissionError).root).toBe(
						hiddenWorkspace,
					);
					expect(String((error as Error).message)).toContain(
						"ToolContext.ask is unavailable",
					);
				}

				expect(existsSync(join(hiddenWorkspace, ".flow"))).toBe(false);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("saveSession allows mutable roots under hidden home directories", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");

		try {
			await withHomeEnv(fakeHome, async () => {
				const saved = await saveSession(
					hiddenWorkspace,
					createSession("Guard hidden home workspace"),
				);
				expect(saved.goal).toBe("Guard hidden home workspace");
				expect(
					existsSync(join(hiddenWorkspace, ".flow", "active", saved.id)),
				).toBe(true);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("ensureWorkspace allows mutable roots under hidden home directories", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");

		try {
			await withHomeEnv(fakeHome, async () => {
				await ensureWorkspace(hiddenWorkspace);
				expect(existsSync(join(hiddenWorkspace, ".flow"))).toBe(true);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("hidden home workspaces remain usable for direct runtime session writes", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");

		try {
			await withHomeEnv(fakeHome, async () => {
				await mkdir(hiddenWorkspace, { recursive: true });
				const session = await saveSession(
					hiddenWorkspace,
					createSession("Hidden home workspace"),
				);
				const closed = await closeSession(hiddenWorkspace, "completed");

				expect(session.goal).toBe("Hidden home workspace");
				expect(closed?.sessionId).toBe(session.id);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("listSessionHistory stays read-only when the workspace has no Flow state yet", async () => {
		const worktree = await makeTempDir("flow-worktree-");

		try {
			expect(existsSync(join(worktree, ".flow"))).toBe(false);
			const history = await listSessionHistory(worktree);
			expect(history.activeSessionId).toBeNull();
			expect(existsSync(join(worktree, ".flow"))).toBe(false);
		} finally {
			rmSync(worktree, { recursive: true, force: true });
		}
	});
});
