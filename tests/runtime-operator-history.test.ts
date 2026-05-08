import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	FLOW_HISTORY_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_STATUS_COMMAND,
	flowSessionActivateCommand,
} from "../src/runtime/constants";
import {
	getFeatureDocPath,
	getFeatureDocPathFromSessionDir,
	getSessionPath,
	getStoredSessionDir,
	getStoredSessionsDir,
} from "../src/runtime/paths";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

function createSessionWithActiveFeature(goal: string) {
	const session = createSession(goal);
	session.plan = samplePlan();
	session.status = "ready";
	session.approval = "approved";
	session.execution.activeFeatureId = "setup-runtime";
	if (!session.plan) {
		throw new Error("Expected sample plan to be present.");
	}
	const [firstFeature] = session.plan.features;
	if (!firstFeature) {
		throw new Error("Expected sample plan to include a first feature.");
	}
	session.plan.features[0] = {
		...firstFeature,
		status: "in_progress",
	};
	return session;
}

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime operator history and session lifecycle", () => {
	test("flow_history returns a machine-readable missing-history summary", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_history.execute(
			{},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing");
		expect(parsed.summary).toBe("No Flow session history found.");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.blocker).toBe(
			"No active Flow session exists for this workspace.",
		);
		expect(parsed.history.activeSessionId).toBeNull();
		expect(parsed.history.active).toBeNull();
		expect(parsed.history.stored).toEqual([]);
		expect(parsed.history.completed).toEqual([]);
		expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
	});

	test("flow_session_close requires an explicit closure kind", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_session_close.execute(
			undefined as never,
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(String(parsed.summary)).toContain("kind");
	});

	test("flow_history lists stored and completed session runs", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));

		const resetResponse = await tools.flow_session_close.execute(
			{ kind: "completed" },
			toolContext(worktree),
		);
		const resetParsed = JSON.parse(resetResponse);
		expect(resetParsed.completedSessionId).toBe(second.id);
		expect(resetParsed.completedTo).toMatch(
			new RegExp(`^\\.flow/completed/${second.id}-`),
		);
		await expect(
			readFile(join(worktree, resetParsed.completedTo, "session.json"), "utf8"),
		).resolves.toContain('"goal": "Second goal"');

		const response = await tools.flow_history.execute(
			{},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toContain("2 Flow session entries");
		expect(parsed.summary).toContain("1 stored/1 parked");
		expect(parsed.warning).toContain("parked/inactive snapshots");
		expect(parsed.history.activeSessionId).toBeNull();
		expect(parsed.history.active).toBeNull();
		expect(parsed.history.stored).toHaveLength(1);
		expect(parsed.history.stored[0]).toMatchObject({
			id: first.id,
			goal: "First goal",
			active: false,
			path: `.flow/stored/${first.id}`,
		});
		expect(parsed.history.completed).toHaveLength(1);
		expect(parsed.history.completed[0]).toMatchObject({
			id: second.id,
			goal: "Second goal",
			active: false,
			completedPath: resetParsed.completedTo,
		});
		expect(parsed.history.completed[0].path).toBe(resetParsed.completedTo);
		expect(parsed.nextCommand).toBe(flowSessionActivateCommand(first.id));
	});

	test("flow_status exposes active feature doc drilldowns", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSessionWithActiveFeature("Active drilldown goal"),
		);

		const response = await tools.flow_status.execute(
			{ view: "detailed" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const expectedPath = getFeatureDocPath(
			worktree,
			saved.id,
			"setup-runtime",
			"active",
		);

		expect(parsed.status).toBe("ready");
		expect(parsed.activeFeatureDrilldown).toMatchObject({
			kind: "feature_doc",
			label: "Open feature details",
			featureId: "setup-runtime",
			path: expectedPath,
			available: true,
			availability: "available",
			sessionLocation: "active",
			sessionId: saved.id,
		});
		expect(parsed.session.activeFeature.featureDrilldown).toMatchObject({
			path: expectedPath,
			available: true,
		});
		expect(parsed.session.taskProgress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "feature:setup-runtime",
					featureId: "setup-runtime",
					featureDrilldown: expect.objectContaining({
						path: expectedPath,
						available: true,
					}),
				}),
			]),
		);
	});

	test("flow_status compact view exposes active feature doc drilldown", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSessionWithActiveFeature("Compact drilldown goal"),
		);

		const response = await tools.flow_status.execute(
			{ view: "compact" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const expectedPath = getFeatureDocPath(
			worktree,
			saved.id,
			"setup-runtime",
			"active",
		);

		expect(parsed.activeFeatureDrilldown).toMatchObject({
			kind: "feature_doc",
			featureId: "setup-runtime",
			path: expectedPath,
			available: true,
			availability: "available",
			sessionLocation: "active",
			sessionId: saved.id,
		});
		expect(parsed.session).toBeUndefined();
	});

	test("flow_status reports missing feature doc fallback without mutating the session", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSessionWithActiveFeature("Missing doc goal"),
		);
		const expectedPath = getFeatureDocPath(
			worktree,
			saved.id,
			"setup-runtime",
			"active",
		);
		await rm(expectedPath);

		const response = await tools.flow_status.execute(
			{ view: "detailed" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.activeFeatureDrilldown).toMatchObject({
			kind: "feature_doc",
			featureId: "setup-runtime",
			path: expectedPath,
			available: false,
			availability: "missing_feature_doc",
			sessionLocation: "active",
			sessionId: saved.id,
		});
		expect(parsed.session.taskProgress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "feature:setup-runtime",
					featureDrilldown: expect.objectContaining({
						path: expectedPath,
						available: false,
						availability: "missing_feature_doc",
					}),
				}),
			]),
		);
		expect(await activeSessionId(worktree)).toBe(saved.id);
	});

	test("flow_status remains readable when drilldown enrichment source is malformed", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSessionWithActiveFeature("Malformed drilldown source"),
		);
		const sessionPath = getSessionPath(worktree, saved.id, "active");
		const session = JSON.parse(await readFile(sessionPath, "utf8"));
		session.id = "../escape";
		await writeFile(
			sessionPath,
			`${JSON.stringify(session, null, 2)}\n`,
			"utf8",
		);

		const response = await tools.flow_status.execute(
			{ view: "detailed" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ready");
		expect(parsed.activeFeatureDrilldown).toBeUndefined();
		expect(parsed.session.activeFeature.featureDrilldown).toBeUndefined();
		const activeFeatureRow = parsed.session.taskProgress.find(
			(row: { id: string }) => row.id === "feature:setup-runtime",
		);
		expect(activeFeatureRow?.featureDrilldown).toBeUndefined();
		expect(await activeSessionId(worktree)).toBe(saved.id);
	});

	test("flow_history_show resolves stored feature doc drilldowns", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const stored = await saveSession(
			worktree,
			createSessionWithActiveFeature("Stored drilldown goal"),
		);
		await saveSession(worktree, createSession("Current active goal"));

		const response = await tools.flow_history_show.execute(
			{ sessionId: stored.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const expectedPath = getFeatureDocPath(
			worktree,
			stored.id,
			"setup-runtime",
			"stored",
		);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("stored");
		expect(parsed.session.activeFeature.featureDrilldown).toMatchObject({
			path: expectedPath,
			available: true,
			availability: "available",
			sessionLocation: "stored",
			sessionId: stored.id,
		});
		expect(parsed.session.taskProgress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "feature:setup-runtime",
					featureDrilldown: expect.objectContaining({
						path: expectedPath,
						available: true,
					}),
				}),
			]),
		);
	});

	test("flow_history_show remains readable when stored drilldown enrichment source is malformed", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const stored = await saveSession(
			worktree,
			createSessionWithActiveFeature("Stored malformed drilldown source"),
		);
		await saveSession(worktree, createSession("Current active goal"));

		const storedSessionPath = getSessionPath(worktree, stored.id, "stored");
		const storedSession = JSON.parse(await readFile(storedSessionPath, "utf8"));
		storedSession.id = "../escape";
		await writeFile(
			storedSessionPath,
			`${JSON.stringify(storedSession, null, 2)}\n`,
			"utf8",
		);

		const response = await tools.flow_history_show.execute(
			{ sessionId: stored.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("stored");
		expect(parsed.session.activeFeature.featureDrilldown).toBeUndefined();
		const storedFeatureRow = parsed.session.taskProgress.find(
			(row: { id: string }) => row.id === "feature:setup-runtime",
		);
		expect(storedFeatureRow?.featureDrilldown).toBeUndefined();
	});

	test("flow_history_show resolves completed feature doc drilldowns", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSessionWithActiveFeature("Completed drilldown goal"),
		);
		const closeResponse = await tools.flow_session_close.execute(
			{ kind: "completed" },
			toolContext(worktree),
		);
		const closeParsed = JSON.parse(closeResponse);

		const response = await tools.flow_history_show.execute(
			{ sessionId: saved.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const expectedPath = getFeatureDocPathFromSessionDir(
			join(worktree, closeParsed.completedTo),
			"setup-runtime",
		);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("completed");
		expect(parsed.session.activeFeature).toBeNull();
		expect(parsed.session.taskProgress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "feature:setup-runtime",
					featureId: "setup-runtime",
					featureDrilldown: expect.objectContaining({
						path: expectedPath,
						available: true,
						availability: "available",
						sessionLocation: "completed",
						sessionId: saved.id,
					}),
				}),
			]),
		);
	});

	test("flow_history_show returns stored session details by id", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));

		const response = await tools.flow_history_show.execute(
			{ sessionId: first.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toBe(`Showing parked Flow session '${first.id}'.`);
		expect(parsed.source).toBe("stored");
		expect(parsed.active).toBe(false);
		expect(parsed.parked).toBe(true);
		expect(parsed.warning).toContain("parked/inactive");
		expect(parsed.warning).toContain(
			"Direct work outside Flow will not update",
		);
		expect(parsed.path).toBe(`.flow/stored/${first.id}`);
		expect(parsed.completedPath).toBeNull();
		expect(parsed.phase).toBe("planning");
		expect(parsed.lane).toBe("lite");
		expect(parsed.blocker).toBe("No draft plan exists yet.");
		expect(parsed.reason).toBe(
			"Planning is still active because Flow does not have an execution-ready draft plan yet.",
		);
		expect(parsed.session.id).toBe(first.id);
		expect(parsed.session.goal).toBe("First goal");
		expect(parsed.session.nextCommand).toBe(
			flowSessionActivateCommand(first.id),
		);
		expect(parsed.session.taskProgress).toEqual([
			expect.objectContaining({
				id: "planning",
				ownerRole: "flow-planner",
				phase: "planning",
				status: "active",
				next: "Activate this session to continue it in the current worktree.",
			}),
		]);
		expect(parsed.guidance.nextCommand).toBe(
			flowSessionActivateCommand(first.id),
		);
		expect(parsed.operatorSummary).toBe(
			[
				"Flow: Flow needs a draft plan before execution can begin.",
				"Blocker: No draft plan exists yet.",
				"Next: Activate this session to continue it in the current worktree.",
				`Command: ${flowSessionActivateCommand(first.id)}`,
				"Progress: 0/0 completed",
				"Task progress:",
				"- flow-planner | planning | active | Planning | next: Activate this session to continue it in the current worktree.",
				"Goal: First goal",
			].join("\n"),
		);
		expect(parsed.nextCommand).toBe(flowSessionActivateCommand(first.id));
		expect(await activeSessionId(worktree)).toBe(second.id);
	});

	test("flow_history_show falls back to stored copy when active session file is missing", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = await saveSession(
			worktree,
			createSession("Recoverable goal"),
		);
		await mkdir(getStoredSessionDir(worktree, session.id), { recursive: true });
		await writeFile(
			getSessionPath(worktree, session.id, "stored"),
			`${JSON.stringify(session, null, 2)}\n`,
			"utf8",
		);
		await rm(getSessionPath(worktree, session.id, "active"));

		const response = await tools.flow_history_show.execute(
			{ sessionId: session.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("stored");
		expect(parsed.active).toBe(false);
		expect(parsed.session.goal).toBe("Recoverable goal");
	});

	test("flow_history_show surfaces active session read errors when no fallback exists", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = await saveSession(worktree, createSession("Broken active"));
		await rm(getSessionPath(worktree, session.id, "active"));

		await expect(
			tools.flow_history_show.execute(
				{ sessionId: session.id },
				toolContext(worktree),
			),
		).rejects.toThrow("ENOENT");
	});

	test("flow_history_show neutralizes parked ready-session task progress next steps", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const readySession = createSession("Ready goal");
		readySession.plan = samplePlan();
		readySession.status = "ready";
		readySession.approval = "approved";
		const saved = await saveSession(worktree, readySession);
		await saveSession(worktree, createSession("Current active goal"));

		const response = await tools.flow_history_show.execute(
			{ sessionId: saved.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("stored");
		expect(parsed.parked).toBe(true);
		expect(parsed.session.taskProgress).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "planning",
					status: "completed",
					next: "Plan is approved; no planning action needed.",
				}),
				expect.objectContaining({
					id: "feature:setup-runtime",
					next: "Activate this session to continue it in the current worktree.",
				}),
			]),
		);
		expect(parsed.operatorSummary).toContain(
			"next: Activate this session to continue it in the current worktree.",
		);
		expect(parsed.operatorSummary).not.toContain(
			"next: Waiting for execution selection.",
		);
	});

	test("flow_history_show returns completed session details by id", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(worktree, createSession("Completed goal"));

		const resetResponse = await tools.flow_session_close.execute(
			{ kind: "completed" },
			toolContext(worktree),
		);
		const resetParsed = JSON.parse(resetResponse);
		const response = await tools.flow_history_show.execute(
			{ sessionId: saved.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("completed");
		expect(parsed.active).toBe(false);
		expect(parsed.path).toBe(resetParsed.completedTo);
		expect(parsed.completedPath).toBe(resetParsed.completedTo);
		expect(parsed.phase).toBe("completed");
		expect(parsed.lane).toBe("lite");
		expect(parsed.blocker).toBeNull();
		expect(parsed.reason).toBe(
			"The active session is complete, so Flow is no longer holding execution state for it.",
		);
		expect(parsed.session.id).toBe(saved.id);
		expect(parsed.session.goal).toBe("Completed goal");
		expect(parsed.session.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
		expect(parsed.guidance.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
		expect(parsed.operatorSummary).toBe(
			[
				"Flow: Completed the Flow session.",
				"Next: Start a new goal when you are ready for more work.",
				"Command: /flow-plan <goal>",
				"Progress: 0/0 completed",
				"Goal: Completed goal",
			].join("\n"),
		);
		expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
	});

	test("flow_history_show does not suggest activation for completed stored sessions", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const completed = createSession("Completed goal");
		const saved = await saveSession(worktree, {
			...completed,
			status: "completed",
			timestamps: {
				...completed.timestamps,
				completedAt: new Date().toISOString(),
			},
		});
		await saveSession(worktree, createSession("Current active goal"));

		const response = await tools.flow_history_show.execute(
			{ sessionId: saved.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.source).toBe("completed");
		expect(parsed.session.status).toBe("completed");
		expect(parsed.session.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
		expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
	});

	test("flow_session_activate switches the active session directory", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));

		expect(await activeSessionId(worktree)).toBe(second.id);

		const response = await tools.flow_session_activate.execute(
			{ sessionId: first.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toBe("Activated Flow session: First goal");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.session.id).toBe(first.id);
		expect(parsed.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(await activeSessionId(worktree)).toBe(first.id);
		expect((await loadSession(worktree))?.id).toBe(first.id);
	});

	test("flow_session_activate recreates missing .flow/stored before parking current active session", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const first = await saveSession(worktree, createSession("First goal"));
		const second = await saveSession(worktree, createSession("Second goal"));
		await rm(getStoredSessionsDir(worktree), { recursive: true, force: true });
		await mkdir(getStoredSessionDir(worktree, first.id), { recursive: true });
		await writeFile(
			getSessionPath(worktree, first.id, "stored"),
			`${JSON.stringify(first, null, 2)}\n`,
			"utf8",
		);

		const response = await tools.flow_session_activate.execute(
			{ sessionId: first.id },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(await activeSessionId(worktree)).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, second.id, "stored"), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
	});

	test("history show and session activate report missing ids clearly", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const showResponse = await tools.flow_history_show.execute(
			{ sessionId: "missing-id" },
			toolContext(worktree),
		);
		const showParsed = JSON.parse(showResponse);
		expect(showParsed.status).toBe("missing_session");
		expect(showParsed.nextCommand).toBe(FLOW_HISTORY_COMMAND);

		const activateResponse = await tools.flow_session_activate.execute(
			{ sessionId: "missing-id" },
			toolContext(worktree),
		);
		const activateParsed = JSON.parse(activateResponse);
		expect(activateParsed.status).toBe("missing_session");
		expect(activateParsed.nextCommand).toBe(FLOW_HISTORY_COMMAND);
	});

	test("flow_session_close completes the active session and clears the active pointer", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSession("Build a workflow plugin"),
		);

		const response = await tools.flow_session_close.execute(
			{ kind: "completed" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.summary).toBe("Closed the active Flow session as completed.");
		expect(parsed.phase).toBe("idle");
		expect(parsed.lane).toBe("lite");
		expect(parsed.completedSessionId).toBe(saved.id);
		expect(parsed.closureKind).toBe("completed");
		expect(parsed.completedTo).toMatch(
			new RegExp(`^\\.flow/completed/${saved.id}-`),
		);
		expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
		expect(await loadSession(worktree)).toBeNull();
		await expect(
			readFile(join(worktree, parsed.completedTo, "session.json"), "utf8"),
		).resolves.toContain('"goal": "Build a workflow plugin"');
		await expect(
			readFile(join(worktree, parsed.completedTo, "docs", "index.md"), "utf8"),
		).resolves.toContain("# Flow Session");
	});

	test("flow_session_close can defer the active session with explicit closure metadata", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const saved = await saveSession(
			worktree,
			createSession("Defer a workflow plugin"),
		);

		const response = await tools.flow_session_close.execute(
			{
				kind: "deferred",
				summary: "Deferred until the API contract is stable.",
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.closureKind).toBe("deferred");
		expect(parsed.completedSessionId).toBe(saved.id);
		const persisted = JSON.parse(
			await readFile(
				join(worktree, parsed.completedTo, "session.json"),
				"utf8",
			),
		);
		expect(persisted.closure).toMatchObject({
			kind: "deferred",
			summary: "Deferred until the API contract is stable.",
		});
	});
});
