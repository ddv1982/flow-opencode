import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createSession, saveSession } from "../src/runtime/lifecycle";
import { getIndexDocPath } from "../src/runtime/paths";
import { summarizeSession } from "../src/runtime/summary";
import {
	applyPlan,
	approvePlan,
	completeRun,
	startRun,
} from "../src/runtime/transitions";
import {
	activeSessionId,
	createTempDirRegistry,
	samplePlan,
} from "./runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

async function activeIndexDocPath(worktree: string): Promise<string> {
	return getIndexDocPath(worktree, await activeSessionId(worktree));
}

describe("runtime replanning behavior", () => {
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
			outcome: {
				kind: "replan_required",
				needsHuman: false,
				replanReason: "plan_too_broad",
				failedAssumption:
					"The current feature was small enough to finish in one pass.",
				recommendedAdjustment: "Split the work into a smaller follow-up plan.",
			},
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
			outcome: {
				kind: "replan_required",
				needsHuman: false,
				replanReason: "plan_too_broad",
				failedAssumption:
					"The current feature was small enough to finish in one pass.",
				recommendedAdjustment: "Split the work into a smaller follow-up plan.",
			},
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
});
