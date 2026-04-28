import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectPackageManager } from "../src/runtime/application/package-manager";
import { getIndexDocPath } from "../src/runtime/paths";
import { loadSession } from "../src/runtime/session";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function writeWorkspaceFile(
	worktree: string,
	filename: string,
	contents: string,
): Promise<void> {
	const absolutePath = join(worktree, filename);
	mkdirSync(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, contents, "utf8");
}

describe("package manager detection", () => {
	test("prefers package.json packageManager over conflicting lockfiles", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"package.json",
			JSON.stringify({ name: "fixture", packageManager: "pnpm@9.1.0" }),
		);
		await writeWorkspaceFile(worktree, "package-lock.json", "{}");

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "pnpm",
			ambiguous: false,
		});
	});

	test("detects npm from package-lock.json", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "package-lock.json", "{}");

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "npm",
			ambiguous: false,
		});
	});

	test("detects pnpm from pnpm-lock.yaml", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"pnpm-lock.yaml",
			"lockfileVersion: '9.0'",
		);

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "pnpm",
			ambiguous: false,
		});
	});

	test("treats conflicting same-directory lockfiles as ambiguous instead of guessing", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(worktree, "yarn.lock", "# yarn lockfile v1");
		await writeWorkspaceFile(worktree, "package-lock.json", "{}");
		await writeWorkspaceFile(
			worktree,
			"pnpm-lock.yaml",
			"lockfileVersion: '9.0'",
		);

		expect(await detectPackageManager(worktree)).toEqual({ ambiguous: true });
	});

	test("package.json packageManager still wins over conflicting same-directory lockfiles", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"package.json",
			JSON.stringify({ name: "fixture", packageManager: "pnpm@9.1.0" }),
		);
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(worktree, "yarn.lock", "# yarn lockfile v1");

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "pnpm",
			ambiguous: false,
		});
	});

	test("detects yarn from yarn.lock", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "yarn.lock", "# yarn lockfile v1");

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "yarn",
			ambiguous: false,
		});
	});

	test("detects bun from bun.lock", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");

		expect(await detectPackageManager(worktree)).toEqual({
			packageManager: "bun",
			ambiguous: false,
		});
	});

	test("prefers nearest package evidence inside the workspace over the root lockfile", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(worktree, "packages/app/package-lock.json", "{}");

		expect(
			await detectPackageManager(worktree, join(worktree, "packages/app/src")),
		).toEqual({
			packageManager: "npm",
			ambiguous: false,
		});
	});

	test("falls back to root package-manager evidence when the subdirectory has none", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(
			worktree,
			"package.json",
			JSON.stringify({ name: "fixture", packageManager: "pnpm@9.1.0" }),
		);

		expect(
			await detectPackageManager(worktree, join(worktree, "packages/app/src")),
		).toEqual({
			packageManager: "pnpm",
			ambiguous: false,
		});
	});

	test("resolves relative start directories against the workspace root", async () => {
		const worktree = makeTempDir();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(worktree, "packages/app/package-lock.json", "{}");

		expect(await detectPackageManager(worktree, "packages/app/src")).toEqual({
			packageManager: "npm",
			ambiguous: false,
		});
	});

	test("ignores start directories outside the workspace root", async () => {
		const worktree = makeTempDir();
		const outside = makeTempDir();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(outside, "package-lock.json", "{}");

		expect(await detectPackageManager(worktree, outside)).toEqual({
			packageManager: "bun",
			ambiguous: false,
		});
	});

	test("flow_plan_start records ambiguous package-manager evidence without guessing", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await writeWorkspaceFile(worktree, "package-lock.json", "{}");
		await writeWorkspaceFile(
			worktree,
			"pnpm-lock.yaml",
			"lockfileVersion: '9.0'",
		);

		const response = await tools.flow_plan_start.execute(
			{ goal: "Ship a workflow fix" },
			{ worktree } as never,
		);
		const parsed = JSON.parse(response);
		const session = await loadSession(worktree);
		const indexDoc = await readFile(
			getIndexDocPath(worktree, await activeSessionId(worktree)),
			"utf8",
		);

		expect(parsed.status).toBe("ok");
		expect(session?.planning.packageManager).toBeUndefined();
		expect(session?.planning.packageManagerAmbiguous).toBe(true);
		expect(indexDoc).toContain("package manager evidence: ambiguous");
	});

	test("flow_plan_start persists the nearest detected package manager into session planning state", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		await writeWorkspaceFile(worktree, "bun.lock", "# bun lockfile");
		await writeWorkspaceFile(
			worktree,
			"packages/app/package.json",
			JSON.stringify({ name: "fixture-app", packageManager: "yarn@4.8.1" }),
		);

		const response = await tools.flow_plan_start.execute(
			{ goal: "Ship a workflow fix" },
			{ worktree, directory: join(worktree, "packages/app/src") } as never,
		);
		const parsed = JSON.parse(response);
		const session = await loadSession(worktree);
		const indexDoc = await readFile(
			getIndexDocPath(worktree, await activeSessionId(worktree)),
			"utf8",
		);

		expect(parsed.status).toBe("ok");
		expect(session?.planning.packageManager).toBe("yarn");
		expect(indexDoc).toContain("package manager: yarn");
	});
});
