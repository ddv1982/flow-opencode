import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionPath } from "../src/runtime/paths";
import { createSession, saveSession } from "../src/runtime/session";
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
	test("flow_auto_prepare returns missing_goal for empty input without a session", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.mode).toBe("missing_goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.blocker).toBe(
			"No active Flow session exists for this workspace.",
		);
		expect(parsed.nextCommand).toBe("/flow-auto <goal>");
	});

	test("flow_auto_prepare resumes an existing session for empty input", async () => {
		const worktree = makeTempDir();
		await saveSession(worktree, createSession("Build a workflow plugin"));
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.mode).toBe("resume");
		expect(parsed.goal).toBe("Build a workflow plugin");
		expect(parsed.phase).toBe("planning");
		expect(parsed.lane).toBe("lite");
	});

	test("flow_auto_prepare does not resume a completed session", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		session.status = "completed";
		session.approval = "approved";
		session.timestamps.completedAt = new Date().toISOString();
		await saveSession(worktree, session);
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.mode).toBe("missing_goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.nextCommand).toBe("/flow-auto <goal>");
	});

	test("flow_auto_prepare treats resume as missing_goal when no session exists", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "resume" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_goal");
		expect(parsed.mode).toBe("missing_goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
	});

	test("flow_auto_prepare classifies explicit goals as start_new_goal", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "Improve Flow recovery behavior" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.mode).toBe("start_new_goal");
		expect(parsed.goal).toBe("Improve Flow recovery behavior");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.blocker).toBeNull();
		expect(parsed.reason).toBe(
			"A new explicit goal was provided, so Flow should start a fresh session for it.",
		);
	});

	test("flow_auto_prepare classification is read-only when worktree resolves to root", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "Improve Flow recovery behavior" },
			toolContext("/", directory),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.mode).toBe("start_new_goal");
		await expect(
			readFile(join(directory, ".flow", ".gitignore"), "utf8"),
		).rejects.toThrow();
	});

	test("flow_auto_prepare classification is read-only for root-like worktree aliases", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_auto_prepare.execute(
			{ argumentString: "Improve Flow recovery behavior" },
			toolContext("///", directory),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.mode).toBe("start_new_goal");
		await expect(
			readFile(join(directory, ".flow", ".gitignore"), "utf8"),
		).rejects.toThrow();
	});

	test("flow_plan_start persists under context.directory when worktree resolves to root", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_plan_start.execute(
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

	test("flow_plan_start persists under context.directory when worktree resolves to a root-like alias", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();

		const response = await tools.flow_plan_start.execute(
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
