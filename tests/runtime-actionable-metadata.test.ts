import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getFeatureDocPath, getIndexDocPath } from "../src/runtime/paths";
import {
	createSession,
	loadSession,
	saveSession,
} from "../src/runtime/session";
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

describe("runtime actionable metadata", () => {
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
