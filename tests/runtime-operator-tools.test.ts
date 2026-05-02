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
import {
	getIndexDocPath,
	getSessionPath,
	getStoredSessionDir,
} from "../src/runtime/paths";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
import { applyPlan, approvePlan } from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	sampleSession,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

function assertOk<T>(
	result: { ok: true; value: T } | { ok: false; message: string },
): T {
	if (!result.ok) {
		throw new Error(result.message);
	}

	return result.value;
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

describe("runtime operator tools", () => {
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

	test("flow_status exposes the runtime-owned final review policy for active sessions", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();
		const session = assertOk(
			approvePlan(
				assertOk(
					applyPlan(createSession("Build a workflow plugin"), samplePlan()),
				),
			),
		);
		await saveSession(worktree, session);

		const detailed = JSON.parse(
			await tools.flow_status.execute({}, toolContext(worktree)),
		);
		expect(detailed.finalReviewPolicy).toBe("detailed");
		expect(detailed.session.finalReviewPolicy).toBe("detailed");
		expect(detailed.operatorSummary).toContain("Final review policy: detailed");

		const compact = JSON.parse(
			await tools.flow_status.execute(
				{ view: "compact" },
				toolContext(worktree),
			),
		);
		expect(compact.finalReviewPolicy).toBe("detailed");
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
				planJson: JSON.stringify({
					plan: {
						...samplePlan(),
						features: [liteFeature],
					},
				}),
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
			{ planJson: JSON.stringify({ plan: samplePlan() }) },
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

	test("flow_plan_apply rejects completion thresholds above feature count", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Reject impossible completion threshold" },
			toolContext(worktree),
		);
		const response = await tools.flow_plan_apply.execute(
			{
				planJson: JSON.stringify({
					plan: {
						...samplePlan(),
						completionPolicy: { minCompletedFeatures: 99 },
					},
				}),
			},
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain(
			"completionPolicy.minCompletedFeatures (99) cannot exceed the plan feature count (2)",
		);
	});

	test("flow_plan_select_features rejects subsets that make completion thresholds impossible", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Reject impossible narrowed threshold" },
			toolContext(worktree),
		);
		await tools.flow_plan_apply.execute(
			{
				planJson: JSON.stringify({
					plan: {
						...samplePlan(),
						completionPolicy: { minCompletedFeatures: 2 },
					},
				}),
			},
			toolContext(worktree),
		);

		const response = await tools.flow_plan_select_features.execute(
			{ featureIds: ["setup-runtime"] },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain(
			"completionPolicy.minCompletedFeatures (2) cannot exceed the plan feature count (1)",
		);
	});

	test("flow_plan_approve rejects selected subsets that make completion thresholds impossible", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Reject impossible approval threshold" },
			toolContext(worktree),
		);
		await tools.flow_plan_apply.execute(
			{
				planJson: JSON.stringify({
					plan: {
						...samplePlan(),
						completionPolicy: { minCompletedFeatures: 2 },
					},
				}),
			},
			toolContext(worktree),
		);

		const response = await tools.flow_plan_approve.execute(
			{ featureIds: ["setup-runtime"] },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);

		expect(parsed.status).toBe("error");
		expect(parsed.summary).toContain(
			"completionPolicy.minCompletedFeatures (2) cannot exceed the plan feature count (1)",
		);
	});

	test("flow_plan_start asks permission before mutating a hidden workspace root", async () => {
		const fakeHome = makeTempDir();
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");
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
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");
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
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
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
		const hiddenWorkspace = join(fakeHome, ".hidden-workspace");
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
		const hiddenChild = join(worktree, ".hidden-workspace");
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
});
