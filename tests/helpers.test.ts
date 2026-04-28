import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	InvalidFlowWorkspaceRootError,
	inspectWorkspaceContext,
	resolveMutableSessionRoot,
	resolveSessionRoot,
} from "../src/runtime/application";

describe("resolveSessionRoot", () => {
	test("falls back to process.cwd when worktree and directory resolve to filesystem roots", () => {
		const originalCwd = process.cwd();
		const tempDir = mkdtempSync(join(tmpdir(), "flow-opencode-"));

		try {
			process.chdir(tempDir);

			expect(resolveSessionRoot({ worktree: "/", directory: "/" })).toBe(
				process.cwd(),
			);
		} finally {
			process.chdir(originalCwd);
			rmSync(tempDir, { recursive: true, maxRetries: 3 });
		}
	});

	test("respects a non-root directory even when worktree is a root path", () => {
		const otherDir = mkdtempSync(join(tmpdir(), "flow-opencode-"));

		try {
			expect(resolveSessionRoot({ worktree: "/", directory: otherDir })).toBe(
				otherDir,
			);
		} finally {
			rmSync(otherDir, { recursive: true, maxRetries: 3 });
		}
	});
});

describe("resolveMutableSessionRoot", () => {
	test("does not fall back to process.cwd when mutating context lacks a usable worktree or directory", () => {
		const originalCwd = process.cwd();
		const tempDir = mkdtempSync(join(tmpdir(), "flow-opencode-"));

		try {
			process.chdir(tempDir);

			expect(() =>
				resolveMutableSessionRoot({ worktree: "/", directory: "/" }),
			).toThrow(InvalidFlowWorkspaceRootError);
		} finally {
			process.chdir(originalCwd);
			rmSync(tempDir, { recursive: true, maxRetries: 3 });
		}
	});

	test("uses a non-root directory for mutation when worktree resolves to a root alias", () => {
		const otherDir = mkdtempSync(join(tmpdir(), "flow-opencode-"));

		try {
			expect(
				resolveMutableSessionRoot({ worktree: "/", directory: otherDir }),
			).toMatchObject({
				root: otherDir,
				source: "directory",
				trusted: false,
			});
		} finally {
			rmSync(otherDir, { recursive: true, maxRetries: 3 });
		}
	});

	test("allows mutable roots under hidden home directories", () => {
		const originalHome = process.env.HOME;
		const fakeHome = mkdtempSync(join(tmpdir(), "flow-home-"));
		const hiddenWorkspace = join(fakeHome, ".factory");

		process.env.HOME = fakeHome;
		try {
			expect(
				resolveMutableSessionRoot({ directory: hiddenWorkspace }),
			).toMatchObject({
				root: hiddenWorkspace,
				source: "directory",
				trusted: false,
			});
			expect(inspectWorkspaceContext({ directory: hiddenWorkspace })).toEqual(
				expect.objectContaining({
					root: hiddenWorkspace,
					source: "directory",
					mutationAllowed: true,
				}),
			);
		} finally {
			process.env.HOME = originalHome;
			rmSync(fakeHome, { recursive: true, maxRetries: 3 });
		}
	});

	test("rejects using $HOME itself as a mutable workspace root", () => {
		const originalHome = process.env.HOME;
		const fakeHome = mkdtempSync(join(tmpdir(), "flow-home-"));

		process.env.HOME = fakeHome;
		try {
			expect(() => resolveMutableSessionRoot({ directory: fakeHome })).toThrow(
				InvalidFlowWorkspaceRootError,
			);
			expect(inspectWorkspaceContext({ directory: fakeHome })).toEqual(
				expect.objectContaining({
					root: fakeHome,
					source: "directory",
					mutationAllowed: false,
				}),
			);
		} finally {
			process.env.HOME = originalHome;
			rmSync(fakeHome, { recursive: true, maxRetries: 3 });
		}
	});

	test("trusted roots metadata still resolves when multiple paths are configured", () => {
		const originalHome = process.env.HOME;
		const originalTrusted = process.env.FLOW_TRUSTED_WORKSPACE_ROOTS;
		const fakeHome = mkdtempSync(join(tmpdir(), "flow-home-"));
		const trustedA = join(fakeHome, ".factory");
		const trustedB = join(fakeHome, ".config", "flow");

		process.env.HOME = fakeHome;
		process.env.FLOW_TRUSTED_WORKSPACE_ROOTS = [trustedA, trustedB].join(
			delimiter,
		);
		try {
			expect(resolveMutableSessionRoot({ directory: trustedB })).toMatchObject({
				root: trustedB,
				source: "directory",
				trusted: true,
			});
		} finally {
			process.env.HOME = originalHome;
			process.env.FLOW_TRUSTED_WORKSPACE_ROOTS = originalTrusted;
			rmSync(fakeHome, { recursive: true, maxRetries: 3 });
		}
	});
});
