import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidFlowWorkspaceRootError } from "../src/runtime/application";
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
	test("saveSession rejects suspicious mutable roots under home dot-directories", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const suspiciousRoot = join(fakeHome, ".factory");

		try {
			await withHomeEnv(fakeHome, async () => {
				await expect(
					saveSession(suspiciousRoot, createSession("Guard suspicious root")),
				).rejects.toThrow(InvalidFlowWorkspaceRootError);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("ensureWorkspace rejects suspicious mutable roots under home dot-directories", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const suspiciousRoot = join(fakeHome, ".factory");

		try {
			await withHomeEnv(fakeHome, async () => {
				await expect(ensureWorkspace(suspiciousRoot)).rejects.toThrow(
					InvalidFlowWorkspaceRootError,
				);
			});
		} finally {
			rmSync(fakeHome, { recursive: true, force: true });
		}
	});

	test("trusted suspicious roots remain usable for direct runtime session writes", async () => {
		const fakeHome = await makeTempDir("flow-home-");
		const suspiciousRoot = join(fakeHome, ".factory");
		process.env.FLOW_TRUSTED_WORKSPACE_ROOTS = suspiciousRoot;

		try {
			await withHomeEnv(fakeHome, async () => {
				await mkdir(suspiciousRoot, { recursive: true });
				const session = await saveSession(
					suspiciousRoot,
					createSession("Trusted suspicious root"),
				);
				const closed = await closeSession(suspiciousRoot, "completed");

				expect(session.goal).toBe("Trusted suspicious root");
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
