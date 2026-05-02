import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveInstallTarget } from "../src/installer";
import {
	FLOW_PLAN_WITH_GOAL_COMMAND,
	FLOW_RUN_COMMAND,
} from "../src/runtime/constants";
import { getIndexDocPath } from "../src/runtime/paths";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
import { applyPlan, approvePlan } from "../src/runtime/transitions";
import {
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
});
