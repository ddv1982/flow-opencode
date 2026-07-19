import { describe, expect, test } from "bun:test";
import { FlowPlanSaveSchema } from "../src/application/flow-service.js";
import {
	OrchestrationPassCollectionSchema,
	OrchestrationPassRecordSchema,
	PlanInputSchema,
	RawOrchestrationTelemetrySchema,
} from "../src/application/schema.js";
import { MAX_ORCHESTRATION_PASSES } from "../src/domain/limits.js";
import {
	MAX_EXECUTION_PROJECTION_BYTES,
	MAX_PLAN_FEATURES,
} from "../src/domain/transitions.js";

describe("application schema bounds", () => {
	test("bounds plan identifiers, prose, and feature cardinality", () => {
		const feature = {
			id: "bounded-feature",
			title: "Bounded feature",
			summary: "Keep the plan inside its execution envelope.",
		};
		expect(
			PlanInputSchema.safeParse({
				summary: "Bounded plan",
				overview: "Use the existing execution-context budget.",
				features: [feature],
			}).success,
		).toBe(true);
		expect(
			PlanInputSchema.safeParse({
				summary: "x".repeat(MAX_EXECUTION_PROJECTION_BYTES + 1),
				overview: "Oversized prose",
				features: [feature],
			}).success,
		).toBe(false);
		expect(
			PlanInputSchema.safeParse({
				summary: "Oversized identifiers",
				overview: "Keep portable identities bounded.",
				features: [{ ...feature, id: "x".repeat(129) }],
			}).success,
		).toBe(false);
		expect(
			PlanInputSchema.safeParse({
				summary: "Too many features",
				overview: "Keep graph validation bounded.",
				features: Array.from({ length: MAX_PLAN_FEATURES + 1 }, (_, index) => ({
					...feature,
					id: `feature-${index}`,
				})),
			}).success,
		).toBe(false);
		expect(
			PlanInputSchema.safeParse({
				summary: "Too many requirements",
				overview: "Bound collection traversal before projection admission.",
				requirements: Array.from(
					{ length: MAX_PLAN_FEATURES + 1 },
					() => "requirement",
				),
				features: [feature],
			}).success,
		).toBe(false);
		expect(
			PlanInputSchema.safeParse({
				summary: "Too many targets",
				overview: "Bound feature collection traversal.",
				features: [
					{
						...feature,
						targets: Array.from(
							{ length: MAX_PLAN_FEATURES + 1 },
							() => "src/target.ts",
						),
					},
				],
			}).success,
		).toBe(false);
		expect(
			FlowPlanSaveSchema.safeParse({
				goal: "🚀".repeat(MAX_EXECUTION_PROJECTION_BYTES),
			}).success,
		).toBe(false);
		expect(
			FlowPlanSaveSchema.safeParse({
				goal: "x".repeat(MAX_EXECUTION_PROJECTION_BYTES),
			}).success,
		).toBe(false);
		expect(
			FlowPlanSaveSchema.safeParse({
				goal: "x".repeat(10_000),
			}).success,
		).toBe(true);
	});

	test("rejects oversized plan collections before validating their entries", () => {
		const result = PlanInputSchema.safeParse({
			summary: "Preflight collection bounds",
			overview: "Reject oversized input without walking invalid entries.",
			features: Array.from({ length: MAX_PLAN_FEATURES + 1 }, () => null),
		});

		expect(result.success).toBe(false);
		if (result.success) throw new Error("Expected oversized plan rejection.");
		expect(result.error.issues).toEqual([
			expect.objectContaining({
				path: ["features"],
				message: `A plan cannot contain more than ${MAX_PLAN_FEATURES} features.`,
			}),
		]);
	});

	test("bounds optional orchestration records by existing lifecycle budgets", () => {
		const pass = { id: "discovery-1", kind: "discovery" as const };
		expect(OrchestrationPassRecordSchema.safeParse(pass).success).toBe(true);
		expect(
			OrchestrationPassRecordSchema.safeParse({
				...pass,
				id: "x".repeat(129),
			}).success,
		).toBe(false);
		expect(
			OrchestrationPassRecordSchema.safeParse({
				...pass,
				dependsOn: Array.from(
					{ length: MAX_ORCHESTRATION_PASSES + 1 },
					(_, index) => `pass-${index}`,
				),
			}).success,
		).toBe(false);
		expect(
			OrchestrationPassCollectionSchema.safeParse([
				{
					...pass,
					decisionReason: "x".repeat(65 * 1024),
				},
			]).success,
		).toBe(false);
	});

	test("hard-rejects only raw orchestration resource violations", () => {
		expect(
			RawOrchestrationTelemetrySchema.safeParse({ malformed: true }).success,
		).toBe(true);
		expect(
			RawOrchestrationTelemetrySchema.safeParse([{ malformed: true }]).success,
		).toBe(true);
		expect(
			RawOrchestrationTelemetrySchema.safeParse(
				Array.from({ length: MAX_ORCHESTRATION_PASSES + 1 }, () => ({
					malformed: true,
				})),
			).success,
		).toBe(true);
		expect(
			RawOrchestrationTelemetrySchema.safeParse({
				malformed: "x".repeat(65 * 1024),
			}).success,
		).toBe(false);
	});
});
