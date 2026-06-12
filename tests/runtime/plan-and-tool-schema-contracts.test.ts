// Owns plan graph, feature-id, reviewer-tool, and response-shape coverage
// previously grouped in tests/runtime-completion-contracts.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { createSession, saveSession } from "../../src/runtime/lifecycle";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../../src/runtime/transitions";
import {
	createTempDirRegistry,
	createTestTools,
	samplePlan,
	toolContext,
} from "../runtime-test-helpers";

const { makeTempDir, cleanupTempDirs } = createTempDirRegistry();

afterEach(() => {
	cleanupTempDirs();
});

describe("runtime plan and tool schema contracts", () => {
	test("rejects malformed dependency graphs during plan apply", () => {
		const session = createSession("Build a workflow plugin");
		const invalidPlan = {
			...samplePlan(),
			features: [
				{
					id: "setup-runtime",
					title: "Create runtime helpers",
					summary: "Add runtime helper files and state persistence.",
					fileTargets: ["src/runtime/session.ts"],
					verification: ["bun test"],
					dependsOn: ["missing-feature"],
				},
			],
		};

		const applied = applyPlan(session, invalidPlan);
		expect(applied.ok).toBe(false);
		if (applied.ok) return;

		expect(applied.message).toContain("unknown feature");
	});

	test("rejects unsafe feature ids during plan apply", () => {
		const runtimeTools = createTestTools();

		return expect(
			runtimeTools.flow_plan_save.execute(
				{
					plan: {
						...samplePlan(),
						features: [
							{
								id: "../escape",
								title: "Bad feature id",
								summary: "Should be rejected.",
								status: "pending",
								fileTargets: [],
								verification: [],
							},
						],
					},
				},
				toolContext(makeTempDir()),
			),
		).resolves.toContain("Feature ids must be lowercase kebab-case");
	});

	test("recordReviewerDecision preserves optional reviewer payload fields without adapters", () => {
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

		const input = {
			scope: "feature",
			featureId: "setup-runtime",
			status: "needs_fix",
			summary: "Needs another pass.",
			blockingFindings: [{ summary: "Validation evidence is incomplete." }],
			followUps: [{ summary: "Rerun targeted tests", severity: "medium" }],
			suggestedValidation: ["bun test tests/runtime.test.ts"],
		};

		const result = recordReviewerDecision(started.value.session, input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.execution.lastReviewerDecision?.scope).toBe("feature");
		expect(result.value.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
		expect(
			result.value.execution.lastReviewerDecision?.followUps[0]?.summary,
		).toBe("Rerun targeted tests");
	});

	test("reviewer decision tool accepts the top-level payload for final review", async () => {
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

		const response = await tools.flow_review_record.execute(
			{
				scope: "final",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				remainingGaps: [],
				status: "approved",
				summary: "Final state looks good.",
				blockingFindings: [],
				followUps: [],
				suggestedValidation: ["bun run check"],
			},
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.session.lastReviewerDecision.scope).toBe("final");
		expect(parsed.session.lastReviewerDecision.suggestedValidation).toEqual([
			"bun run check",
		]);
	});

	test("reviewer decision tool strips featureId from final review payloads for v2 compatibility", async () => {
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

		const response = await tools.flow_review_record.execute(
			{
				scope: "final",
				featureId: "some-feature",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				remainingGaps: [],
				status: "approved",
				summary: "Final state looks good.",
				blockingFindings: [],
				followUps: [],
				suggestedValidation: ["bun run check"],
			} as never,
			toolContext(worktree),
		);

		const parsed = JSON.parse(response);
		expect(parsed.status).toBe("ok");
		expect(parsed.session.lastReviewerDecision.scope).toBe("final");
		expect(parsed.session.lastReviewerDecision.featureId).toBeUndefined();
	});

	test("tools keep representative top-level response shapes across the split helpers", async () => {
		const worktree = makeTempDir();
		const tools = createTestTools();

		const planStartResponse = await tools.flow_plan_save.execute(
			{ goal: "Build a workflow plugin" },
			toolContext(worktree),
		);
		const planStartParsed = JSON.parse(planStartResponse);
		expect(Object.keys(planStartParsed)).toEqual([
			"status",
			"summary",
			"session",
		]);
		expect(planStartParsed.status).toBe("ok");
		expect(planStartParsed.session.goal).toBe("Build a workflow plugin");

		const planApplyResponse = await tools.flow_plan_save.execute(
			{ plan: samplePlan() },
			toolContext(worktree),
		);
		const planApplyParsed = JSON.parse(planApplyResponse);
		expect(Object.keys(planApplyParsed)).toEqual([
			"status",
			"summary",
			"autoApproved",
			"session",
		]);
		expect(planApplyParsed.status).toBe("ok");
		expect(planApplyParsed.summary).toBe("Draft plan saved.");
		expect(planApplyParsed.autoApproved).toBe(false);
		expect(planApplyParsed.session.goal).toBe("Build a workflow plugin");
	});
});
