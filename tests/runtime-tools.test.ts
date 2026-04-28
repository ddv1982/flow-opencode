import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveInstallTarget } from "../src/installer";
import {
	FLOW_HISTORY_COMMAND,
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
	FLOW_STATUS_COMMAND,
	flowSessionActivateCommand,
} from "../src/runtime/constants";
import { getIndexDocPath } from "../src/runtime/paths";
import {
	createSession,
	deleteSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	resetFeature,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	sampleSession,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

type FlowPluginWithHooks = {
	hooks?: {
		"experimental.chat.system.transform"?: (
			input: {
				sessionID?: string;
				model: { providerID: string; modelID: string };
			},
			output: { system: string[] },
		) => Promise<void>;
		"experimental.session.compacting"?: (
			input: unknown,
			context: ReturnType<typeof toolContext>,
			output: { context?: string[]; prompt?: string },
		) => Promise<void>;
	};
};

afterEach(() => {
	cleanupTempDirs();
});

function toolContext(
	worktree: string,
	directory?: string,
	extra?: Record<string, unknown>,
) {
	return (
		directory ? { worktree, directory, ...extra } : { worktree, ...extra }
	) as Parameters<
		ReturnType<typeof createTestTools>["flow_status"]["execute"]
	>[1];
}

async function installDoctorPluginFixture(homeDir: string) {
	const canonicalInstallPath = resolveInstallTarget({ homeDir });
	await mkdir(join(homeDir, ".config", "opencode", "plugins"), {
		recursive: true,
	});
	await writeFile(canonicalInstallPath, "// flow plugin");
	return canonicalInstallPath;
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

describe("runtime tools and recovery", () => {
	test("flow_status returns a machine-readable missing-session summary", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_status.execute({}, toolContext(worktree));
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing");
		expect(parsed.summary).toBe("No active Flow session found.");
		expect(parsed.guidance).toEqual({
			category: "no_session",
			status: "missing",
			summary: "No active Flow session exists for this workspace.",
			phase: "idle",
			lane: "lite",
			laneReason:
				"Flow can stay in the lite lane until a non-trivial plan or risk signal appears.",
			blocker: "No active Flow session exists for this workspace.",
			reason: "Flow has not started a tracked session for this workspace yet.",
			nextStep: "Start a new Flow session with /flow-plan <goal>.",
			nextCommand: FLOW_PLAN_WITH_GOAL_COMMAND,
		});
		expect(parsed.operatorSummary).toBe(
			[
				"Flow: No active Flow session exists for this workspace.",

				"Blocker: No active Flow session exists for this workspace.",
				"Next: Start a new Flow session with /flow-plan <goal>.",
				"Command: /flow-plan <goal>",
			].join("\n"),
		);
		expect(parsed.workspaceRoot).toBe(worktree);
		expect(parsed.workspace).toEqual(
			expect.objectContaining({
				root: worktree,
				source: "worktree",
				mutationAllowed: true,
			}),
		);
	});

	test("flow_status supports a compact view for easier operator scanning", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const response = await tools.flow_status.execute(
			{ view: "compact" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing");
		expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
		expect(parsed.operatorSummary).toBe(
			[
				"Flow: No active Flow session exists for this workspace.",

				"Blocker: No active Flow session exists for this workspace.",
				"Next: Start a new Flow session with /flow-plan <goal>.",
				"Command: /flow-plan <goal>",
			].join("\n"),
		);
		expect(parsed.workspaceRoot).toBe(worktree);
		expect(parsed.session).toBeUndefined();
		expect(response.includes("\n")).toBe(false);
	});

	test("flow_doctor reports install, config, workspace, and session readiness without mutating session state", async () => {
		const worktree = makeTempDir();
		const homeDir = makeTempDir();
		await installDoctorPluginFixture(homeDir);

		await withHomeEnv(homeDir, async () => {
			const tools = createTestTools();
			const response = await tools.flow_doctor.execute(
				{},
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("ok");
			expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
			expect(parsed.workspaceRoot).toBe(worktree);
			expect(parsed.session).toBeNull();
			expect(parsed.operatorSummary).toContain("Flow doctor: Ready.");
			expect(parsed.operatorSummary).toContain(
				"Blocker: No active Flow session exists for this workspace.",
			);
			expect(parsed.operatorSummary).toContain(
				"Next: Start a new Flow session with /flow-plan <goal>.",
			);
			expect(parsed.operatorSummary).toContain("Command: /flow-plan <goal>");

			expect(parsed.checks).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: "install",
						status: "pass",
					}),
					expect.objectContaining({
						id: "config",
						status: "pass",
					}),
					expect.objectContaining({
						id: "workspace",
						status: "pass",
					}),
					expect.objectContaining({
						id: "session_artifacts",
						status: "skip",
					}),
					expect.objectContaining({
						id: "guidance",
						status: "skip",
					}),
				]),
			);
		});
	});

	test("flow_doctor supports a compact view for easier operator scanning", async () => {
		const worktree = makeTempDir();
		const homeDir = makeTempDir();
		await withHomeEnv(homeDir, async () => {
			const tools = createTestTools();
			const response = await tools.flow_doctor.execute(
				{ view: "compact" },
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("warn");
			expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
			expect(parsed.operatorSummary).toContain(
				"Flow doctor warn: The canonical Flow plugin file was not found",
			);
			expect(parsed.operatorSummary).toContain(
				"Fix: Run `bun run install:opencode` from the Flow repo or reinstall the latest release if OpenCode cannot load Flow.",
			);
			expect(parsed.operatorSummary).toContain(
				"Next: Start a new Flow session with /flow-plan <goal>.",
			);
			expect(parsed.operatorSummary).toContain("Command: /flow-plan <goal>");
			expect(parsed.checks).toBeUndefined();
			expect(parsed.session).toBeUndefined();
			expect(parsed.issues).toEqual([
				expect.objectContaining({
					id: "install",
					status: "warn",
				}),
			]);
			expect(response.includes("\n")).toBe(false);
		});
	});

	test("flow_doctor warns when the canonical install path is missing", async () => {
		const worktree = makeTempDir();
		const homeDir = makeTempDir();
		await withHomeEnv(homeDir, async () => {
			const tools = createTestTools();
			const response = await tools.flow_doctor.execute(
				{},
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			const installCheck = parsed.checks.find(
				(check: { id: string }) => check.id === "install",
			);

			expect(parsed.status).toBe("warn");
			expect(installCheck?.status).toBe("warn");
			expect(String(installCheck?.remediation)).toContain(
				"bun run install:opencode",
			);
		});
	});

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

	test("no-arg tools accept undefined args", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const statusResponse = await tools.flow_status.execute(
			undefined as never,
			toolContext(worktree),
		);
		const statusParsed = JSON.parse(statusResponse);
		expect(statusParsed.status).toBe("missing");

		const doctorResponse = await tools.flow_doctor.execute(
			undefined as never,
			toolContext(worktree),
		);
		const doctorParsed = JSON.parse(doctorResponse);
		expect(typeof doctorParsed.status).toBe("string");

		const historyResponse = await tools.flow_history.execute(
			undefined as never,
			toolContext(worktree),
		);
		const historyParsed = JSON.parse(historyResponse);
		expect(historyParsed.status).toBe("missing");
	});

	test("flow_doctor reports missing rendered docs for an active session", async () => {
		const worktree = makeTempDir();
		const homeDir = makeTempDir();
		await installDoctorPluginFixture(homeDir);

		await withHomeEnv(homeDir, async () => {
			const saved = await saveSession(
				worktree,
				createSession("Doctor fixture"),
			);
			await rm(getIndexDocPath(worktree, saved.id), { force: true });

			const tools = createTestTools();
			const response = await tools.flow_doctor.execute(
				{},
				toolContext(worktree),
			);
			const parsed = JSON.parse(response);
			const artifactCheck = parsed.checks.find(
				(check: { id: string }) => check.id === "session_artifacts",
			);

			expect(parsed.status).toBe("fail");
			expect(parsed.nextCommand).toBe(FLOW_PLAN_WITH_GOAL_COMMAND);
			expect(artifactCheck?.status).toBe("fail");
			expect(artifactCheck?.details.indexDocReadable).toBe(false);
			expect(parsed.operatorSummary).toContain(
				"Flow doctor fail: Flow found an active session, but one or more persisted session artifacts are missing.",
			);
		});
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

	test("flow_plan_start accepts an OpenCode-like context payload and persists under directory", async () => {
		const directory = makeTempDir();
		const tools = createTestTools();
		const context = {
			worktree: "///",
			directory,
			sessionId: "opaque-runtime-session-id",
			commandName: "flow-plan",
		} as unknown as Parameters<
			ReturnType<typeof createTestTools>["flow_status"]["execute"]
		>[1];

		const response = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		await expect(
			readFile(
				join(directory, ".flow", "active", parsed.session.id, "session.json"),
				"utf8",
			),
		).resolves.toContain(parsed.session.id);
	});

	test("flow_plan_apply auto-approves lite single-feature drafts", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}

		await tools.flow_plan_start.execute(
			{ goal: "Ship a tiny fix" },
			toolContext(worktree),
		);
		const response = await tools.flow_plan_apply.execute(
			{
				plan: {
					...samplePlan(),
					features: [liteFeature],
				},
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const session = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(parsed.autoApproved).toBe(true);
		expect(parsed.summary).toBe(
			"Lite draft plan saved and auto-approved so execution can start immediately.",
		);
		expect(parsed.session.approval).toBe("approved");
		expect(parsed.session.status).toBe("ready");
		expect(parsed.session.operator.lane).toBe("lite");
		expect(session?.approval).toBe("approved");
		expect(session?.status).toBe("ready");
	});

	test("flow_plan_apply keeps standard multi-feature drafts pending approval", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const response = await tools.flow_plan_apply.execute(
			{ plan: samplePlan() },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const session = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(parsed.autoApproved).toBe(false);
		expect(parsed.summary).toBe("Draft plan saved.");
		expect(parsed.session.approval).toBe("pending");
		expect(parsed.session.status).toBe("planning");
		expect(parsed.session.operator.lane).toBe("standard");
		expect(session?.approval).toBe("pending");
		expect(session?.status).toBe("planning");
	});

	test("flow_plan_start asks permission before mutating a hidden workspace root", async () => {
		const fakeHome = makeTempDir();
		const hiddenWorkspace = join(fakeHome, ".factory");
		const ask = mock(async () => {});
		const tools = createTestTools();

		await withHomeEnv(fakeHome, async () => {
			await mkdir(hiddenWorkspace, { recursive: true });
			const response = await tools.flow_plan_start.execute(
				{ goal: "Keep Flow inside the repo" },
				toolContext("/", hiddenWorkspace, { ask }),
			);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("ok");
			expect(parsed.session.goal).toBe("Keep Flow inside the repo");
			expect(ask).toHaveBeenCalledTimes(1);
			expect(ask).toHaveBeenCalledWith({
				permission: "edit",
				patterns: [join(hiddenWorkspace, ".flow", "**")],
				always: [join(hiddenWorkspace, ".flow", "**")],
				metadata: expect.objectContaining({
					workspaceRoot: hiddenWorkspace,
					workspaceSource: "directory",
				}),
			});
		});
	});

	test("flow_run_start asks permission before mutating a hidden workspace root", async () => {
		const fakeHome = makeTempDir();
		const hiddenWorkspace = join(fakeHome, ".factory");
		const ask = mock(async () => {});
		const tools = createTestTools();

		await withHomeEnv(fakeHome, async () => {
			await saveSession(
				hiddenWorkspace,
				sampleSession("Hidden workspace fixture"),
			);

			const response = await tools.flow_run_start.execute(
				{},
				toolContext("/", hiddenWorkspace, { ask }),
			);
			const parsed = JSON.parse(response);

			expect(String(parsed.summary)).not.toContain(
				"Flow blocked mutable workspace root",
			);
			expect(ask).toHaveBeenCalledTimes(1);
		});
	});

	test("lite retryable non-human completion returns the session to ready without a manual reset", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}

		await tools.flow_plan_start.execute(
			{ goal: "Ship a tiny fix" },
			toolContext(worktree),
		);
		await tools.flow_plan_apply.execute(
			{
				plan: {
					...samplePlan(),
					features: [liteFeature],
				},
			},
			toolContext(worktree),
		);

		const startResponse = await tools.flow_run_start.execute(
			{},
			toolContext(worktree),
		);
		const started = JSON.parse(startResponse);
		expect(started.status).toBe("ok");

		const completeResponse = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "needs_input",
				summary: "A tiny retryable issue was found.",
				artifactsChanged: [],
				validationRun: [],
				validationScope: "targeted",
				reviewIterations: 0,
				decisions: [{ summary: "The tiny fix needs one more pass." }],
				nextStep: "Retry the tiny fix.",
				outcome: {
					kind: "blocked_external",
					summary: "The tiny fix can be retried immediately.",
					retryable: true,
					autoResolvable: true,
					needsHuman: false,
				},
				featureResult: {
					featureId: liteFeature.id,
					verificationStatus: "not_recorded",
				},
				featureReview: {
					status: "needs_followup",
					summary: "Retry with a smaller adjustment.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(completeResponse);

		expect(parsed.status).toBe("ok");
		expect(parsed.session.status).toBe("ready");
		expect(parsed.session.operator.lane).toBe("lite");
		expect(parsed.session.nextCommand).toBe(FLOW_RUN_COMMAND);
	});

	test("flow_doctor accepts hidden home workspace roots", async () => {
		const fakeHome = makeTempDir();
		const hiddenWorkspace = join(fakeHome, ".factory");
		const homeDir = makeTempDir();
		await installDoctorPluginFixture(homeDir);

		await withHomeEnv(fakeHome, async () => {
			await mkdir(hiddenWorkspace, { recursive: true });
			const tools = createTestTools();
			const response = await tools.flow_doctor.execute(
				{},
				toolContext("/", hiddenWorkspace),
			);
			const parsed = JSON.parse(response);
			const workspaceCheck = parsed.checks.find(
				(check: { id: string }) => check.id === "workspace",
			);

			expect(parsed.workspaceRoot).toBe(hiddenWorkspace);
			expect(parsed.workspace).toEqual(
				expect.objectContaining({
					root: hiddenWorkspace,
					source: "directory",
					mutationAllowed: true,
				}),
			);
			expect(workspaceCheck?.status).toBe("pass");
		});
	});

	test("flow_plan_start at a normal project root does not ask just because hidden dirs exist inside it", async () => {
		const worktree = makeTempDir();
		const hiddenChild = join(worktree, ".factory");
		const ask = mock(async () => {});
		const tools = createTestTools();

		await mkdir(hiddenChild, { recursive: true });
		const response = await tools.flow_plan_start.execute(
			{ goal: "Use project root state" },
			toolContext(worktree, hiddenChild, { ask }),
		);
		const parsed = JSON.parse(response);
		const saved = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(saved?.goal).toBe("Use project root state");
		expect(saved?.id).toBe(parsed.session.id);
		expect(ask).not.toHaveBeenCalled();
	});

	test("flow_plan_start does not ask when the mutable workspace root is .flow itself", async () => {
		const worktree = makeTempDir();
		const flowRoot = join(worktree, ".flow");
		const ask = mock(async () => {});
		const tools = createTestTools();

		await mkdir(flowRoot, { recursive: true });
		const response = await tools.flow_plan_start.execute(
			{ goal: "Use flow root directly" },
			toolContext("/", flowRoot, { ask }),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(ask).not.toHaveBeenCalled();
	});

	test("flow_plan_start still rejects using $HOME itself as the mutable workspace root", async () => {
		const fakeHome = makeTempDir();
		const tools = createTestTools();

		await withHomeEnv(fakeHome, async () => {
			const response = await tools.flow_plan_start.execute(
				{ goal: "Keep Flow out of home root" },
				toolContext("/", fakeHome),
			);
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe("error");
			expect(String(parsed.summary)).toContain(
				"Flow blocked mutable workspace root",
			);
			expect(parsed.workspaceRoot).toBe(fakeHome);
			expect(parsed.workspace).toEqual(
				expect.objectContaining({
					root: fakeHome,
					source: "directory",
					mutationAllowed: false,
				}),
			);
			expect(String(parsed.remediation)).toContain(
				"Choose a project/worktree subdirectory instead of using $HOME directly",
			);
		});
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
		expect(parsed.source).toBe("stored");
		expect(parsed.active).toBe(false);
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
				"Goal: First goal",
			].join("\n"),
		);
		expect(parsed.nextCommand).toBe(flowSessionActivateCommand(first.id));
		expect(await activeSessionId(worktree)).toBe(second.id);
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

	test("tools return machine-readable missing-session responses for plan, review, and reset operations", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const cases = [
			[
				"flow_plan_apply",
				{ plan: samplePlan() },
				"missing_session",
				"/flow-plan <goal>",
			],
			["flow_plan_approve", {}, "missing_session", undefined],
			[
				"flow_plan_select_features",
				{ featureIds: ["setup-runtime"] },
				"missing_session",
				undefined,
			],
			[
				"flow_review_record_feature",
				{
					scope: "feature",
					featureId: "setup-runtime",
					status: "approved",
					summary: "Looks good.",
				},
				"missing_session",
				undefined,
			],
			[
				"flow_review_record_final",
				{ scope: "final", status: "approved", summary: "Looks good." },
				"missing_session",
				undefined,
			],
			[
				"flow_reset_feature",
				{ featureId: "setup-runtime" },
				"missing_session",
				undefined,
			],
		] as const;

		for (const [toolName, args, expectedStatus, expectedNextCommand] of cases) {
			const response = await (
				tools[toolName] as {
					execute: (
						args: unknown,
						context: Parameters<
							ReturnType<typeof createTestTools>["flow_status"]["execute"]
						>[1],
					) => Promise<string>;
				}
			).execute(args, toolContext(worktree));
			const parsed = JSON.parse(response);

			expect(parsed.status).toBe(expectedStatus);
			expect(parsed.summary).toContain("No active Flow");
			if (expectedNextCommand) {
				expect(parsed.nextCommand).toBe(expectedNextCommand);
			}
		}
	});

	test("tool rejects flow_run_start for completed sessions", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
			status: "approved",
			summary: "Final review looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
			finalReview: {
				status: "passed",
				summary: "Repo-wide validation is clean.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		await saveSession(worktree, completed.value);
		const response = await tools.flow_run_start.execute(
			{ featureId: undefined },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("missing_session");
		expect(parsed.summary).toContain("No active Flow");
	});

	test("tool rejects the old nested worker payload shape", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		await saveSession(worktree, started.value.session);

		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				result: {
					status: "ok",
					summary: "Completed runtime setup.",
					artifactsChanged: [],
					validationRun: [],
					decisions: [],
					nextStep: "Run the next feature.",
					outcome: { kind: "completed" },
					featureResult: {
						featureId: "setup-runtime",
						verificationStatus: "passed",
					},
					featureReview: {
						status: "passed",
						summary: "Looks good.",
						blockingFindings: [],
					},
				},
			} as never,
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("validation failed");
	});

	test("tool rejects non-ok worker payloads missing outcome at parse time", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		await saveSession(worktree, started.value.session);

		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a new plan.",
				artifactsChanged: [],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: undefined,
				featureResult: {
					featureId: "setup-runtime",
				},
				featureReview: {
					status: "passed",
					summary: "No review yet.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain("Tool argument validation failed");
		expect(parsed.summary).toContain("outcome");
		expect(parsed.summary).not.toContain("Cannot read properties");
	});

	test("tool returns machine-readable recovery details for missing final reviewer approval", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		await saveSession(worktree, started.value.session);
		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed runtime setup.",
				artifactsChanged: [],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Runtime tests passed.",
					},
				],
				validationScope: "broad",
				reviewIterations: 1,
				decisions: [],
				nextStep: "Session should complete.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: {
					status: "passed",
					summary: "Repo-wide validation is clean.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_final_reviewer_decision");
		expect(parsed.recovery.recoveryStage).toBe("record_review");
		expect(parsed.recovery.prerequisite).toBe("reviewer_result_required");
		expect(parsed.recovery.requiredArtifact).toBe("final_reviewer_decision");
		expect(parsed.recovery.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
		expect(parsed.recovery.retryable).toBe(true);
	});

	test("tool persists worker evidence when completion fails with retryable recovery", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		await saveSession(worktree, started.value.session);
		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed runtime setup.",
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Runtime tests passed.",
					},
				],
				validationScope: "targeted",
				reviewIterations: 1,
				decisions: [{ summary: "Runtime wiring is complete." }],
				nextStep: "Run the next feature.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: undefined,
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_feature_reviewer_decision");

		const persisted = await loadSession(worktree);
		expect(persisted?.execution.activeFeatureId).toBe("setup-runtime");
		expect(persisted?.execution.lastSummary).toBe("Completed runtime setup.");
		expect(persisted?.execution.lastFeatureResult?.featureId).toBe(
			"setup-runtime",
		);
		expect(persisted?.execution.lastValidationRun).toEqual([
			{
				command: "bun test",
				status: "passed",
				summary: "Runtime tests passed.",
			},
		]);
		expect(persisted?.execution.history).toHaveLength(1);
		expect(persisted?.execution.history[0]?.summary).toBe(
			"Completed runtime setup.",
		);
		expect(persisted?.artifacts).toEqual([{ path: "src/runtime/session.ts" }]);
		expect(persisted?.notes).toEqual(["Runtime wiring is complete."]);
	});

	test("tool returns machine-readable recovery details for missing broad validation", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
			status: "approved",
			summary: "Final review looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		await saveSession(worktree, reviewed.value);
		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed runtime setup.",
				artifactsChanged: [],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Runtime tests passed.",
					},
				],
				validationScope: "targeted",
				reviewIterations: 1,
				decisions: [],
				nextStep: "Session should complete.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: "setup-runtime",
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: {
					status: "passed",
					summary: "Repo-wide validation is clean.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("error");
		expect(parsed.recovery.errorCode).toBe("missing_broad_validation");
		expect(parsed.recovery.recoveryStage).toBe("rerun_validation");
		expect(parsed.recovery.prerequisite).toBe("validation_rerun_required");
		expect(parsed.recovery.requiredArtifact).toBe("broad_validation_result");
		expect(parsed.recovery.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(parsed.recovery.nextRuntimeTool).toBeUndefined();
		expect(parsed.recovery.autoResolvable).toBe(true);
	});

	test("feature reviewer recovery exposes runtime tool guidance without suggesting flow-run", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const completed = completeRun(started.value.session, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe(
			"missing_feature_reviewer_decision",
		);
		expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
		expect(completed.recovery?.requiredArtifact).toBe(
			"feature_reviewer_decision",
		);
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
		expect(completed.recovery?.nextRuntimeArgs).toBeUndefined();
	});

	test("missing targeted validation recovery stays status-only and points back to validation", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe("missing_targeted_validation");
		expect(completed.recovery?.recoveryStage).toBe("rerun_validation");
		expect(completed.recovery?.prerequisite).toBe("validation_rerun_required");
		expect(completed.recovery?.requiredArtifact).toBe(
			"targeted_validation_result",
		);
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
		expect(completed.recovery?.nextRuntimeArgs).toBeUndefined();
	});

	test("missing final review payload exposes prerequisite instead of fake retry action", () => {
		const session = createSession("Build a workflow plugin");
		const plan = {
			...samplePlan(),
			completionPolicy: {
				minCompletedFeatures: 1,
			},
			features: [samplePlan().features[0]],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "final",
			status: "approved",
			summary: "Final review looks good.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "broad",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Session should complete.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe("missing_final_review_payload");
		expect(completed.recovery?.recoveryStage).toBe("retry_completion");
		expect(completed.recovery?.prerequisite).toBe(
			"completion_payload_rebuild_required",
		);
		expect(completed.recovery?.requiredArtifact).toBe("final_review_payload");
		expect(completed.recovery?.nextCommand).toBe(FLOW_STATUS_COMMAND);
		expect(completed.recovery?.nextRuntimeTool).toBeUndefined();
	});

	test("requires a recorded reviewer approval before successful completion", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const completed = completeRun(started.value.session, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(false);
		if (completed.ok) return;

		expect(completed.recovery?.errorCode).toBe(
			"missing_feature_reviewer_decision",
		);
		expect(completed.recovery?.prerequisite).toBe("reviewer_result_required");
	});

	test("lite lane completion can succeed without a separately recorded reviewer approval", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = createSession("Ship a tiny fix");
		const liteFeature = samplePlan().features[0];
		if (!liteFeature) {
			throw new Error("Missing lite feature fixture.");
		}
		const plan = {
			...samplePlan(),
			features: [liteFeature],
		};

		const applied = applyPlan(session, plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		await saveSession(worktree, started.value.session);

		const response = await tools.flow_run_complete_feature.execute(
			{
				contractVersion: "1",
				status: "ok",
				summary: "Completed tiny fix.",
				artifactsChanged: [],
				validationRun: [
					{
						command: "bun test",
						status: "passed",
						summary: "Tiny fix tests passed.",
					},
				],
				validationScope: "broad",
				reviewIterations: 1,
				decisions: [],
				nextStep: "Session should complete.",
				outcome: { kind: "completed" },
				featureResult: {
					featureId: liteFeature.id,
					verificationStatus: "passed",
				},
				featureReview: {
					status: "passed",
					summary: "Looks good.",
					blockingFindings: [],
				},
				finalReview: {
					status: "passed",
					summary: "Final review looks good.",
					blockingFindings: [],
				},
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("ok");
		expect(parsed.session.status).toBe("completed");
		expect(parsed.session.operator.lane).toBe("lite");
	});

	test("records reviewer decisions for the active feature", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const reviewed = recordReviewerDecision(started.value.session, {
			scope: "feature",
			featureId: "setup-runtime",
			status: "needs_fix",
			summary: "A follow-up fix is required.",
			blockingFindings: [{ summary: "Adjust one failing branch." }],
			suggestedValidation: ["bun test"],
		});

		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		expect(reviewed.value.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
		expect(reviewed.value.execution.lastReviewerDecision?.featureId).toBe(
			"setup-runtime",
		);
	});

	test("resets a feature and clears session files", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const resetPlan = approved.value.plan;
		const resetFeatureEntry = resetPlan?.features[0];
		if (!resetPlan || !resetFeatureEntry) {
			throw new Error("Expected approved plan with first feature");
		}
		resetFeatureEntry.status = "completed";
		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.plan?.features[0]?.status).toBe("pending");

		await saveSession(worktree, reset.value);
		const sessionId = await activeSessionId(worktree);
		await deleteSession(worktree);
		const loaded = await loadSession(worktree);
		expect(loaded).toBeNull();
		await expect(
			readFile(getIndexDocPath(worktree, sessionId), "utf8"),
		).rejects.toThrow();
	});

	test("resetting a prerequisite also resets dependent features", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const dependentPlan = approved.value.plan;
		const prerequisite = dependentPlan?.features[0];
		const dependent = dependentPlan?.features[1];
		if (!dependentPlan || !prerequisite || !dependent) {
			throw new Error("Expected approved plan with dependent features");
		}
		prerequisite.status = "completed";
		dependent.status = "completed";

		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.plan?.features[0]?.status).toBe("pending");
		expect(reset.value.plan?.features[1]?.status).toBe("pending");
		expect(reset.value.artifacts).toHaveLength(0);
		expect(reset.value.notes).toHaveLength(0);
		expect(reset.value.execution.lastValidationRun).toHaveLength(0);
	});

	test("resetting an unrelated feature preserves the last run projections", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, {
			...samplePlan(),
			features: [
				...samplePlan().features,
				{
					id: "write-docs",
					title: "Write docs",
					summary: "Document the workflow.",
					fileTargets: ["README.md"],
					verification: ["bun test"],
				},
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const unrelatedPlan = approved.value.plan;
		const setupFeature = unrelatedPlan?.features[0];
		const implementFeature = unrelatedPlan?.features[1];
		const docsFeature = unrelatedPlan?.features[2];
		if (!unrelatedPlan || !setupFeature || !implementFeature || !docsFeature) {
			throw new Error("Expected approved plan with three features");
		}
		setupFeature.status = "completed";
		implementFeature.status = "completed";
		docsFeature.status = "completed";
		approved.value.execution.lastFeatureId = "write-docs";
		approved.value.execution.lastValidationRun = [
			{ command: "bun test", status: "passed", summary: "Still valid." },
		];
		approved.value.artifacts = [{ path: "README.md" }];
		approved.value.notes = ["Docs feature completed cleanly."];

		const reset = resetFeature(approved.value, "setup-runtime");
		expect(reset.ok).toBe(true);
		if (!reset.ok) return;

		expect(reset.value.execution.lastFeatureId).toBe("write-docs");
		expect(reset.value.execution.lastValidationRun).toHaveLength(1);
		expect(reset.value.artifacts).toHaveLength(1);
		expect(reset.value.notes).toHaveLength(1);
	});

	test("every Flow tool emits non-empty metadata and still returns a string", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const metadata = mock(() => {});
		const context = {
			...toolContext(worktree),
			metadata,
			client: { app: { log: () => {} } },
		};

		const seededResponse = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			context,
		);
		const seededSession = JSON.parse(seededResponse).session as { id: string };
		const currentSessionId = seededSession.id;

		const toolArgs: Record<string, unknown> = {
			flow_status: {},
			flow_history: {},
			flow_history_show: { sessionId: currentSessionId },
			flow_session_activate: { sessionId: currentSessionId },
			flow_plan_start: { goal: "Build a workflow plugin" },
			flow_auto_prepare: { argumentString: "resume" },
			flow_session_close: { kind: "completed" },
			flow_plan_apply: { plan: samplePlan() },
			flow_plan_approve: {},
			flow_plan_select_features: { featureIds: ["setup-runtime"] },
			flow_run_start: {},
			flow_run_complete_feature: {
				contractVersion: "1",
				status: "needs_input",
				summary: "Need a follow-up plan.",
				artifactsChanged: [],
				validationRun: [],
				decisions: [],
				nextStep: "Replan the work.",
				outcome: {
					kind: "replan_required",
					replanReason: "plan_too_broad",
					failedAssumption:
						"The current feature was small enough to finish in one pass.",
					recommendedAdjustment:
						"Split the work into a smaller follow-up plan.",
				},
				featureResult: {
					featureId: "setup-runtime",
				},
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			flow_review_record_feature: {
				scope: "feature",
				featureId: "setup-runtime",
				status: "approved",
				summary: "Looks good.",
			},
			flow_review_record_final: {
				scope: "final",
				status: "approved",
				summary: "Looks good.",
			},
			flow_reset_feature: { featureId: "setup-runtime" },
		};

		for (const toolName of Object.keys(tools)) {
			const tool = tools[toolName];
			if (!tool) {
				throw new Error(`Missing tool definition for ${toolName}`);
			}
			metadata.mockClear();
			const response = await tool.execute(toolArgs[toolName], context);

			expect(typeof response).toBe("string");
			if (metadata.mock.calls.length === 0) {
				throw new Error(`Expected metadata for tool ${toolName}`);
			}
			expect(metadata).toHaveBeenCalled();

			const latestCallEntry = metadata.mock.calls.at(-1) as
				| [unknown, ...unknown[]]
				| undefined;
			const latestCall = latestCallEntry?.[0] as
				| { title?: unknown; metadata?: unknown }
				| undefined;

			expect(typeof latestCall?.title).toBe("string");
			expect((latestCall?.title as string).trim().length).toBeGreaterThan(0);
			expect(latestCall?.metadata).toBeObject();
			expect(Array.isArray(latestCall?.metadata)).toBe(false);
		}
	});

	test("experimental.chat.system.transform appends compact runtime guidance from the active session", async () => {
		const worktree = makeTempDir();
		const nestedDirectory = join(worktree, "src", "subdir");
		await mkdir(nestedDirectory, { recursive: true });
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
			directory: nestedDirectory,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.chat.system.transform"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.chat.system.transform hook");
		}

		const planned = applyPlan(createSession("demo-goal"), samplePlan());
		if (!planned.ok) {
			throw new Error(planned.message);
		}
		const approved = approvePlan(planned.value);
		if (!approved.ok) {
			throw new Error(approved.message);
		}
		const started = startRun(approved.value);
		if (!started.ok) {
			throw new Error(started.message);
		}

		const running = started.value.session;
		const activeFeatureId = running.execution.activeFeatureId;
		if (!activeFeatureId) {
			throw new Error(
				"Expected an active feature for the system-context hook test.",
			);
		}
		running.planning.packageManagerAmbiguous = true;
		running.planning.decisionLog = [
			{
				question: "Should Flow rewrite the API surface now?",
				decisionMode: "recommend_confirm",
				decisionDomain: "architecture",
				options: [
					{ label: "Rewrite now", tradeoffs: ["cleaner"] },
					{ label: "Defer", tradeoffs: ["safer"] },
				],
				recommendation: "Defer",
				rationale: ["A breaking rewrite needs confirmation."],
			},
		];
		running.execution.lastReviewerDecision = {
			scope: "feature",
			featureId: activeFeatureId,
			reviewPurpose: "execution_gate",
			status: "needs_fix",
			summary: "Need another fix pass.",
			blockingFindings: [{ summary: "Missing targeted validation evidence." }],
			followUps: [],
			suggestedValidation: ["bun test tests/config.test.ts"],
		};
		running.execution.lastOutcome = {
			kind: "contract_error",
			summary: "A recoverable runtime issue needs another iteration.",
			retryable: true,
			autoResolvable: true,
			needsHuman: false,
		};
		await saveSession(worktree, running);

		const output = { system: ["base-system"] };
		await hook(
			{
				sessionID: "demo-session",
				model: { providerID: "test", modelID: "test-model" },
			},
			output,
		);

		await hook(
			{
				sessionID: "demo-session",
				model: { providerID: "test", modelID: "test-model" },
			},
			output,
		);

		const joined = output.system.join("\n");
		expect(output.system[0]).toBe("base-system");
		expect(
			output.system.filter((entry) => entry.includes("Flow runtime context"))
				.length,
		).toBe(1);
		expect(joined).toContain("Flow runtime context");
		expect(joined).toContain('- goal: "demo-goal"');
		expect(joined).toContain("package manager evidence is ambiguous");
		expect(joined).toContain(
			"decision gate active: recommend_confirm | architecture",
		);
		expect(joined).toContain('recommendation: "Defer"');
		expect(joined).toContain("latest reviewer decision: needs_fix");
		expect(joined).toContain("latest outcome is retryable or auto-resolvable");
	});

	test("experimental.chat.system.transform is a graceful no-op when no active Flow session exists", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.chat.system.transform"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.chat.system.transform hook");
		}

		const output = { system: ["base-system"] };
		await expect(
			hook(
				{
					sessionID: "demo-session",
					model: { providerID: "test", modelID: "test-model" },
				},
				output,
			),
		).resolves.toBeUndefined();
		expect(output.system).toEqual(["base-system"]);
	});

	test("experimental.session.compacting appends goal and execution phase for an active Flow session", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.session.compacting"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.session.compacting hook");
		}

		const session = sampleSession("demo-goal");
		await mkdir(join(worktree, ".flow", "active", session.id), {
			recursive: true,
		});
		await saveSession(worktree, {
			...session,
			status: "running",
		});

		const nestedDirectory = join(worktree, "src", "subdir");
		await mkdir(nestedDirectory, { recursive: true });

		const output: { context: string[]; prompt?: string } = { context: [] };
		await hook({}, toolContext(worktree, nestedDirectory), output);

		const joined = output.context.join("\n");
		expect(joined).toContain("demo-goal");
		expect(joined).toContain("execution");
		expect(output.prompt).toBeUndefined();
	});

	test("experimental.session.compacting is a graceful no-op when no active Flow session exists", async () => {
		const worktree = makeTempDir();
		const plugin = (await (
			await import("../src/index")
		).default({
			worktree,
		} as unknown as Parameters<
			typeof import("../src/index").default
		>[0])) as FlowPluginWithHooks;
		const hook = plugin.hooks?.["experimental.session.compacting"];

		expect(typeof hook).toBe("function");
		if (!hook) {
			throw new Error("Missing experimental.session.compacting hook");
		}

		const output: { context: string[]; prompt?: string } = { context: [] };
		await expect(
			hook({}, toolContext(worktree), output),
		).resolves.toBeUndefined();
		expect(output.prompt).toBeUndefined();
		expect(output.context.length).toBeLessThanOrEqual(1);
	});
});
