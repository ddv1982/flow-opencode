import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	getActiveSessionPath,
	getFeatureDocPath,
	getIndexDocPath,
	getLegacySessionPath,
	getSessionPath,
} from "../src/runtime/paths";
import {
	createSession,
	deleteSessionArtifacts,
	deleteSessionState,
	loadSession,
	saveSession,
	saveSessionState,
	syncSessionArtifacts,
} from "../src/runtime/session";
import { summarizeSession } from "../src/runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	selectPlanFeatures,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

function toolContext(worktree: string, directory?: string) {
	return (directory ? { worktree, directory } : { worktree }) as Parameters<
		ReturnType<typeof createTestTools>["flow_status"]["execute"]
	>[1];
}

async function activeSessionPath(worktree: string): Promise<string> {
	return getSessionPath(worktree, await activeSessionId(worktree));
}

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

async function activeFeatureDocPath(
	worktree: string,
	featureId: string,
): Promise<string> {
	return getFeatureDocPath(
		worktree,
		await activeSessionId(worktree),
		featureId,
	);
}

describe("runtime transitions", () => {
	test("creates, saves, and loads a session", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		await saveSession(worktree, created);

		const loaded = await loadSession(worktree);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(loaded?.goal).toBe("Build a workflow plugin");
		expect(loaded?.status).toBe("planning");
		expect(indexDoc).toContain("# Flow Session");
		expect(indexDoc).toContain("goal: Build a workflow plugin");
	});

	test("stores active and historical sessions under .flow/sessions", async () => {
		const worktree = makeTempDir();
		const first = await saveSession(worktree, createSession("First goal"));

		expect(await activeSessionId(worktree)).toBe(first.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getIndexDocPath(worktree, first.id), "utf8"),
		).resolves.toContain("goal: First goal");

		const second = await saveSession(worktree, createSession("Second goal"));

		expect(await activeSessionId(worktree)).toBe(second.id);
		await expect(
			readFile(getSessionPath(worktree, first.id), "utf8"),
		).resolves.toContain('"goal": "First goal"');
		await expect(
			readFile(getSessionPath(worktree, second.id), "utf8"),
		).resolves.toContain('"goal": "Second goal"');
		await expect(
			readFile(getIndexDocPath(worktree, second.id), "utf8"),
		).resolves.toContain("goal: Second goal");
	});

	test("migrates a legacy .flow/session.json into the session-history layout", async () => {
		const worktree = makeTempDir();
		const legacy = createSession("Legacy goal");

		mkdirSync(join(worktree, ".flow"), { recursive: true });
		await writeFile(
			getLegacySessionPath(worktree),
			`${JSON.stringify(legacy, null, 2)}\n`,
			"utf8",
		);

		const loaded = await loadSession(worktree);

		expect(loaded?.id).toBe(legacy.id);
		expect(await activeSessionId(worktree)).toBe(legacy.id);
		await expect(
			readFile(getLegacySessionPath(worktree), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(getSessionPath(worktree, legacy.id), "utf8"),
		).resolves.toContain('"goal": "Legacy goal"');
		await expect(
			readFile(getIndexDocPath(worktree, legacy.id), "utf8"),
		).resolves.toContain("goal: Legacy goal");
	});

	test("rejects malformed persisted session data", async () => {
		const worktree = makeTempDir();
		const sessionId = "malformed-session";
		mkdirSync(join(worktree, ".flow", "sessions", sessionId), {
			recursive: true,
		});
		await writeFile(getActiveSessionPath(worktree), `${sessionId}\n`, "utf8");
		await writeFile(
			getSessionPath(worktree, sessionId),
			"{not valid json",
			"utf8",
		);

		await expect(loadSession(worktree)).rejects.toThrow();
	});

	test("rejects persisted session data with duplicate keys", async () => {
		const worktree = makeTempDir();
		const sessionId = "duplicate-session";
		mkdirSync(join(worktree, ".flow", "sessions", sessionId), {
			recursive: true,
		});
		await writeFile(getActiveSessionPath(worktree), `${sessionId}\n`, "utf8");
		await writeFile(
			getSessionPath(worktree, sessionId),
			'{"id":"a","id":"b"}',
			"utf8",
		);

		await expect(loadSession(worktree)).rejects.toThrow("Duplicate JSON key");
	});

	test("saveSession refreshes updatedAt while preserving createdAt", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const firstSave = await saveSession(worktree, created);

		await new Promise((resolve) => setTimeout(resolve, 10));

		const secondSave = await saveSession(worktree, firstSave);

		expect(secondSave.timestamps.createdAt).toBe(
			firstSave.timestamps.createdAt,
		);
		expect(new Date(secondSave.timestamps.updatedAt).getTime()).toBeGreaterThan(
			new Date(firstSave.timestamps.updatedAt).getTime(),
		);
	});

	test("saveSessionState persists source-of-truth session state without rendering docs", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");

		const saved = await saveSessionState(worktree, created);

		await expect(
			readFile(await activeSessionPath(worktree), "utf8"),
		).resolves.toContain('"goal": "Build a workflow plugin"');
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).rejects.toThrow();
		expect(saved.goal).toBe("Build a workflow plugin");
	});

	test("syncSessionArtifacts renders docs from persisted session state", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const saved = await saveSessionState(worktree, created);

		await syncSessionArtifacts(worktree, saved);

		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).resolves.toContain("# Flow Session");
	});

	test("deleteSessionState and deleteSessionArtifacts can clean persistence and docs independently", async () => {
		const worktree = makeTempDir();
		const created = createSession("Build a workflow plugin");
		const saved = await saveSession(worktree, created);
		expect(saved.goal).toBe("Build a workflow plugin");

		await deleteSessionState(worktree);
		await expect(
			readFile(await activeSessionPath(worktree), "utf8"),
		).rejects.toThrow();
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).resolves.toContain("# Flow Session");

		await deleteSessionArtifacts(worktree);
		await expect(
			readFile(await activeIndexDocPath(worktree), "utf8"),
		).rejects.toThrow();
	});

	test("renders feature docs for planned work", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(featureDoc).toContain("# Feature setup-runtime");
		expect(featureDoc).toContain("Create runtime helpers");
		expect(featureDoc).toContain("src/runtime/session.ts");
	});

	test("prunes stale feature docs when a plan is narrowed", async () => {
		const worktree = makeTempDir();
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		await expect(
			readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8"),
		).resolves.toContain("# Feature execute-feature");

		const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		await saveSession(worktree, selected.value);

		await expect(
			readFile(await activeFeatureDocPath(worktree, "setup-runtime"), "utf8"),
		).resolves.toContain("# Feature setup-runtime");
		await expect(
			readFile(await activeFeatureDocPath(worktree, "execute-feature"), "utf8"),
		).rejects.toThrow();
	});

	test("renders multiline content without breaking markdown structure", async () => {
		const worktree = makeTempDir();
		const session = createSession(
			"Build a workflow plugin\nwith multiline context",
		);
		const applied = applyPlan(session, {
			...samplePlan(),
			summary: "Implement docs\nwithout malformed markdown",
			features: [
				{
					id: "setup-runtime",
					title: "Create runtime helpers\ncarefully",
					summary: "Line one\n## not a real heading\nLine three",
					fileTargets: ["src/runtime/session.ts"],
					verification: ["bun test\nwith extra notes"],
				},
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		await saveSession(worktree, applied.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(indexDoc).toContain(
			"goal: Build a workflow plugin / with multiline context",
		);
		expect(indexDoc).toContain(
			"summary: Implement docs / without malformed markdown",
		);
		expect(featureDoc).toContain("> ## not a real heading");
		expect(featureDoc).toContain("- bun test / with extra notes");
	});

	test("applies and approves a plan", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		expect(approved.value.approval).toBe("approved");
		expect(approved.value.status).toBe("ready");
	});

	test("selects a dependency-consistent subset of features", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const selected = selectPlanFeatures(applied.value, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		expect(selected.value.plan?.features).toHaveLength(1);
		expect(selected.value.plan?.features[0]?.id).toBe("setup-runtime");
	});

	test("selectPlanFeatures preserves completed statuses while narrowing draft plans", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const draftWithCompleted = {
			...applied.value,
			plan: applied.value.plan
				? {
						...applied.value.plan,
						features: applied.value.plan.features.map((feature) =>
							feature.id === "setup-runtime"
								? { ...feature, status: "completed" as const }
								: feature,
						),
					}
				: null,
		};

		const selected = selectPlanFeatures(draftWithCompleted, ["setup-runtime"]);
		expect(selected.ok).toBe(true);
		if (!selected.ok) return;

		expect(selected.value.plan?.features).toHaveLength(1);
		expect(selected.value.plan?.features[0]?.id).toBe("setup-runtime");
		expect(selected.value.plan?.features[0]?.status).toBe("completed");
	});

	test("approvePlan resets selected features to pending", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const draftWithCompleted = {
			...applied.value,
			plan: applied.value.plan
				? {
						...applied.value.plan,
						features: applied.value.plan.features.map((feature) =>
							feature.id === "setup-runtime"
								? { ...feature, status: "completed" as const }
								: feature,
						),
					}
				: null,
		};

		const approved = approvePlan(draftWithCompleted, ["setup-runtime"]);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		expect(approved.value.plan?.features).toHaveLength(1);
		expect(approved.value.plan?.features[0]?.id).toBe("setup-runtime");
		expect(approved.value.plan?.features[0]?.status).toBe("pending");
	});

	test("rejects mixed valid and invalid requested feature ids", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const selected = selectPlanFeatures(applied.value, [
			"setup-runtime",
			"missing-feature",
		]);
		expect(selected.ok).toBe(false);
		if (selected.ok) return;

		expect(selected.message).toContain("Unknown feature ids");
	});

	test("starts the next runnable feature", () => {
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

		expect(started.value.feature?.id).toBe("setup-runtime");
		expect(started.value.session.status).toBe("running");
	});

	test("rejects starting a second run while one feature is active", () => {
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

		const restarted = startRun(started.value.session);
		expect(restarted.ok).toBe(false);
		if (restarted.ok) return;

		expect(restarted.message).toContain("already in progress");
	});

	test("rejects plan approval after execution has started", () => {
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

		const reapproved = approvePlan(started.value.session);
		expect(reapproved.ok).toBe(false);
		if (reapproved.ok) return;

		expect(reapproved.message).toContain("already executing work");
	});

	test("does not block the session on an invalid requested feature id", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "missing-feature");
		expect(started.ok).toBe(false);
		if (started.ok) return;

		expect(started.message).toContain("was not found");
		expect(approved.value.status).toBe("ready");
	});

	test("completes a feature and advances the session", () => {
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
			summary: "Looks correct.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
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
			decisions: [{ summary: "Kept a single session artifact." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		});

		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		expect(completed.value.status).toBe("ready");
		expect(completed.value.plan?.features[0]?.status).toBe("completed");
	});

	test("renders per-feature execution history and review evidence", async () => {
		const worktree = makeTempDir();
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
			summary: "Looks correct.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [{ path: "src/runtime/session.ts", kind: "updated" }],
			validationRun: [
				{
					command: "bun test",
					status: "passed",
					summary: "Runtime tests passed.",
				},
			],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [{ summary: "Kept a single session artifact." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		await saveSession(worktree, completed.value);
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(featureDoc).toContain("## Execution History");
		expect(featureDoc).toContain("Completed runtime setup.");
		expect(featureDoc).toContain("#### Changed Artifacts");
		expect(featureDoc).toContain("src/runtime/session.ts (updated)");
		expect(featureDoc).toContain("#### Validation");
		expect(featureDoc).toContain("passed | bun test | Runtime tests passed.");
		expect(featureDoc).toContain("#### Feature Review");
		expect(featureDoc).toContain("Looks correct.");
	});

	test("preserves execution history when replanning the same session", async () => {
		const worktree = makeTempDir();
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
			summary: "Looks correct.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
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
			decisions: [{ summary: "Kept a single session artifact." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		await saveSession(worktree, completed.value);

		const replanned = applyPlan(completed.value, {
			...samplePlan(),
			summary: "Refined the workflow plan.",
			features: [
				...samplePlan().features,
				{
					id: "write-docs",
					title: "Write docs",
					summary: "Document the refined workflow.",
					fileTargets: ["README.md"],
					verification: ["bun test"],
				},
			],
		});
		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		await saveSession(worktree, replanned.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(replanned.value.execution.history).toHaveLength(1);
		expect(indexDoc).toContain("Completed runtime setup.");
		expect(featureDoc).toContain("## Execution History");
		expect(featureDoc).toContain("Completed runtime setup.");
	});

	test("clears execution history when starting a new goal", async () => {
		const worktree = makeTempDir();
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
			summary: "Looks correct.",
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(reviewed.value, {
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
			decisions: [{ summary: "Kept a single session artifact." }],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks correct.",
				blockingFindings: [],
			},
		});
		expect(completed.ok).toBe(true);
		if (!completed.ok) return;

		await saveSession(worktree, completed.value);

		const tools = createTestTools();
		const response = await tools.flow_plan_start.execute(
			{ goal: "Different goal" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const nextSession = await loadSession(worktree);

		expect(parsed.status).toBe("ok");
		expect(nextSession?.goal).toBe("Different goal");
		expect(nextSession?.execution.history).toHaveLength(0);

		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(indexDoc).not.toContain("Completed runtime setup.");
	});

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
			readFile(join(directory, ".flow", "active"), "utf8"),
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
			readFile(join(directory, ".flow", "active"), "utf8"),
		).resolves.toContain(parsed.session.id);
	});

	test("runtime tool transitions persist session state and refresh docs", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const before = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(before).toContain("summary: No plan yet.");

		await tools.flow_plan_apply.execute(
			{ plan: samplePlan(), planning: undefined },
			toolContext(worktree),
		);
		const afterApply = await readFile(
			await activeIndexDocPath(worktree),
			"utf8",
		);
		const session = await loadSession(worktree);
		expect(session?.plan?.summary).toBe(samplePlan().summary);
		expect(afterApply).toContain(
			"summary: Implement a small workflow feature set.",
		);
	});

	test("returns to planning when the worker requires replanning", () => {
		const session = createSession("Build a workflow plugin");
		const applied = applyPlan(session, samplePlan());
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;

		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const started = startRun(approved.value, "execute-feature");
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.message).toContain("not runnable");

		const firstStarted = startRun(approved.value);
		expect(firstStarted.ok).toBe(true);
		if (!firstStarted.ok) return;

		const replanned = completeRun(firstStarted.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "The feature needs to be split further.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "Feature is too broad after inspection." }],
			nextStep: "Create a refined plan.",
			outcome: { kind: "replan_required", needsHuman: false },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "No code changed.",
				blockingFindings: [],
			},
		});

		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		expect(replanned.value.status).toBe("planning");
		expect(replanned.value.approval).toBe("pending");
		expect(replanned.value.plan).toBeNull();
		expect(summarizeSession(replanned.value).session?.nextCommand).toBe(
			"/flow-plan <goal>",
		);
	});

	test("renders replanned sessions with a new planning command", async () => {
		const worktree = makeTempDir();
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

		const replanned = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "The feature needs to be split further.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "Feature is too broad after inspection." }],
			nextStep: "Create a refined plan.",
			outcome: { kind: "replan_required", needsHuman: false },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "No code changed.",
				blockingFindings: [],
			},
		});
		expect(replanned.ok).toBe(true);
		if (!replanned.ok) return;

		await saveSession(worktree, replanned.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		expect(indexDoc).toContain("next command: /flow-plan <goal>");
	});

	test("persists and renders actionable needs_input metadata", async () => {
		const worktree = makeTempDir();
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

		const blocked = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on an operator decision.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "External API credentials are missing." }],
			nextStep: "Ask the operator to provide API credentials.",
			outcome: {
				kind: "needs_operator_input",
				summary: "Credentials are required before work can continue.",
				resolutionHint: "Set the API token and rerun the feature.",
				retryable: true,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
				notes: [{ note: "No code changes were made." }],
				followUps: [
					{ summary: "Provide the missing API token.", severity: "high" },
				],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked by missing credentials.",
				blockingFindings: [],
			},
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;

		expect(blocked.value.execution.lastNextStep).toBe(
			"Ask the operator to provide API credentials.",
		);
		expect(blocked.value.execution.lastOutcome?.resolutionHint).toBe(
			"Set the API token and rerun the feature.",
		);
		expect(blocked.value.execution.lastFeatureResult?.notes?.[0]?.note).toBe(
			"No code changes were made.",
		);

		const summary = summarizeSession(blocked.value);
		expect(summary.session?.lastNextStep).toBe(
			"Ask the operator to provide API credentials.",
		);
		expect(summary.session?.lastOutcome?.kind).toBe("needs_operator_input");
		expect(summary.session?.nextCommand).toBe("/flow-status");

		await saveSession(worktree, blocked.value);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");
		const featureDoc = await readFile(
			await activeFeatureDocPath(worktree, "setup-runtime"),
			"utf8",
		);

		expect(indexDoc).toContain(
			"next step: Ask the operator to provide API credentials.",
		);
		expect(indexDoc).toContain(
			"resolution hint: Set the API token and rerun the feature.",
		);
		expect(featureDoc).toContain("#### Outcome");
		expect(featureDoc).toContain("needs human: yes");
		expect(featureDoc).toContain("#### Follow Ups");
		expect(featureDoc).toContain("Provide the missing API token. (high)");
	});

	test("same-goal planning refresh clears last actionable metadata", async () => {
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

		const blocked = completeRun(started.value.session, {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on an operator decision.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 0,
			decisions: [{ summary: "External API credentials are missing." }],
			nextStep: "Ask the operator to provide API credentials.",
			outcome: {
				kind: "needs_operator_input",
				summary: "Credentials are required before work can continue.",
				resolutionHint: "Set the API token and rerun the feature.",
				retryable: true,
				needsHuman: true,
			},
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
				notes: [{ note: "No code changes were made." }],
				followUps: [
					{ summary: "Provide the missing API token.", severity: "high" },
				],
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked by missing credentials.",
				blockingFindings: [],
			},
		});
		expect(blocked.ok).toBe(true);
		if (!blocked.ok) return;

		await saveSession(worktree, blocked.value);
		const response = await tools.flow_plan_start.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const parsed = JSON.parse(response);
		const refreshed = await loadSession(worktree);
		const indexDoc = await readFile(await activeIndexDocPath(worktree), "utf8");

		expect(parsed.status).toBe("ok");
		expect(refreshed?.execution.lastOutcome).toEqual(
			blocked.value.execution.lastOutcome,
		);
		expect(refreshed?.execution.lastNextStep).toBe(
			blocked.value.execution.lastNextStep,
		);
		expect(refreshed?.execution.lastFeatureResult).toEqual(
			blocked.value.execution.lastFeatureResult,
		);
		expect(indexDoc).toContain(
			"resolution hint: Set the API token and rerun the feature.",
		);
		expect(indexDoc).toContain(
			"next step: Ask the operator to provide API credentials.",
		);
	});
});
