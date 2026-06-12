import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/lifecycle";
import { getFeatureDocPath, getIndexDocPath } from "../src/runtime/paths";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

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

describe("runtime execution history rendering", () => {
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
		const response = await tools.flow_plan_save.execute(
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
});
