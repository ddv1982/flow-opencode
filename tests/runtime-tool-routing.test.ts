import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionPath } from "../src/runtime/paths";
import {
	createTempDirRegistry,
	createTestTools,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime tool routing", () => {
	test("flow_plan_save persists under context.directory when worktree resolves to root", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			toolContext("/", directory),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		const sessionPath = getSessionPath(directory, parsed.session.id);
		await expect(readFile(sessionPath, "utf8")).resolves.toContain(
			'"goal": "Build a workflow plugin"',
		);
		await expect(
			readFile(
				join(directory, ".flow", "active", parsed.session.id, "session.json"),
				"utf8",
			),
		).resolves.toContain(parsed.session.id);
	});

	test("flow_plan_save persists under context.directory when worktree resolves to a root-like alias", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			toolContext("///", directory),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		const sessionPath = getSessionPath(directory, parsed.session.id);
		await expect(readFile(sessionPath, "utf8")).resolves.toContain(
			'"goal": "Build a workflow plugin"',
		);
		await expect(
			readFile(
				join(directory, ".flow", "active", parsed.session.id, "session.json"),
				"utf8",
			),
		).resolves.toContain(parsed.session.id);
	});
});
