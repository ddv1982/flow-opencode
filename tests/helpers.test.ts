import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSessionRoot } from "../src/runtime/application";

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
