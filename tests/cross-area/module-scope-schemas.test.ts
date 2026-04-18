import { describe, expect, test } from "bun:test";
import * as runtimeSchema from "../../src/runtime/schema";

describe("cross-area module-scope schemas", () => {
	test("exports stable top-level schema identities across imports", async () => {
		const reimported = await import("../../src/runtime/schema");

		expect(reimported.SessionSchema).toBe(runtimeSchema.SessionSchema);
		expect(reimported.PlanSchema).toBe(runtimeSchema.PlanSchema);
		expect(reimported.WorkerResultSchema).toBe(
			runtimeSchema.WorkerResultSchema,
		);
		expect(reimported.ReviewerDecisionSchema).toBe(
			runtimeSchema.ReviewerDecisionSchema,
		);
	});

	test("parses canonical fixtures without recreating schemas per call", () => {
		const parsedPlan = runtimeSchema.PlanSchema.safeParse({
			summary: "Module-scope schema fixture.",
			overview: "Validate the shared runtime schema objects.",
			features: [
				{
					id: "module-scope-schema",
					title: "Schema fixture",
					summary: "Keep schemas stable across imports.",
					fileTargets: ["src/runtime/schema.ts"],
					verification: [
						"bun test tests/cross-area/module-scope-schemas.test.ts",
					],
				},
			],
		});
		const parsedSession = runtimeSchema.SessionSchema.safeParse({
			version: 1,
			id: "schema-session",
			goal: "Keep schemas stable",
			status: "planning",
			approval: "pending",
			planning: {
				repoProfile: [],
				research: [],
			},
			plan: parsedPlan.success ? parsedPlan.data : null,
			execution: {
				activeFeatureId: null,
				lastFeatureId: null,
				lastSummary: null,
				lastOutcomeKind: null,
				lastOutcome: null,
				lastNextStep: null,
				lastFeatureResult: null,
				lastReviewerDecision: null,
				lastValidationRun: [],
				history: [],
			},
			notes: [],
			artifacts: [],
			timestamps: {
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				approvedAt: null,
				completedAt: null,
			},
		});

		expect(parsedPlan.success).toBe(true);
		expect(parsedSession.success).toBe(true);
	});
});
