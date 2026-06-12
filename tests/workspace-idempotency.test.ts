import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeSessionFile } from "../src/runtime/session-workspace";
import { createTempDirRegistry, sampleSession } from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } =
	createTempDirRegistry("flow-workspace-");

afterEach(() => {
	mock.restore();
	cleanupTempDirs();
});

describe("workspace idempotency", () => {
	test("workspace preparation skips .gitignore writes on a second session write within the same process", async () => {
		const worktree = makeTempDir();
		const session = sampleSession("Workspace idempotency");
		const gitignorePath = join(worktree, ".flow", ".gitignore");
		const writeSpy = spyOn(fsPromises, "writeFile");

		await writeSessionFile(worktree, session);
		const writesAfterFirstCall = writeSpy.mock.calls.filter(
			([path]) => String(path) === gitignorePath,
		).length;
		const bytesAfterFirstCall = await readFile(gitignorePath, "utf8");

		await writeSessionFile(worktree, session);

		const writesAfterSecondCall = writeSpy.mock.calls.filter(
			([path]) => String(path) === gitignorePath,
		).length;
		const bytesAfterSecondCall = await readFile(gitignorePath, "utf8");

		expect(writesAfterFirstCall).toBe(1);
		expect(writesAfterSecondCall).toBe(1);
		expect(bytesAfterSecondCall).toBe(bytesAfterFirstCall);
	});

	test("workspace preparation restores missing required entries while preserving custom line order", async () => {
		const worktree = makeTempDir();
		const session = sampleSession("Workspace gitignore restore");
		const gitignorePath = join(worktree, ".flow", ".gitignore");

		await writeSessionFile(worktree, session);
		await writeFile(
			gitignorePath,
			"# local overrides\n/my-temp\nactive/\nstored/\n",
			"utf8",
		);

		await writeSessionFile(worktree, session);

		await expect(readFile(gitignorePath, "utf8")).resolves.toBe(
			"# local overrides\n/my-temp\nactive/\nstored/\ncompleted/\nevents/\ncheckpoints/\nprojections/\nlocks/\nstandards-profile.json\n",
		);
	});
});
