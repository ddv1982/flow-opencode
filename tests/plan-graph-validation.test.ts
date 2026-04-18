import { describe, expect, test } from "bun:test";

import { applyPlan } from "../src/runtime/transitions";
import { createSampleSession, samplePlan } from "./fixtures";

describe("plan graph validation", () => {
	const cases = [
		[
			"duplicate feature id",
			{
				...samplePlan,
				features: [
					samplePlan.features[0],
					{ ...samplePlan.features[0], title: "Duplicate setup feature" },
				],
			},
			"Plan validation failed: duplicate feature id 'setup-runtime'.",
		],
		[
			"unknown dependsOn target",
			{
				...samplePlan,
				features: [
					{
						...samplePlan.features[0],
						dependsOn: ["missing-feature"],
					},
				],
			},
			"Plan validation failed: feature 'setup-runtime' depends on unknown feature 'missing-feature'.",
		],
		[
			"self dependsOn target",
			{
				...samplePlan,
				features: [
					{
						...samplePlan.features[0],
						dependsOn: ["setup-runtime"],
					},
				],
			},
			"Plan validation failed: feature 'setup-runtime' cannot depend on itself.",
		],
		[
			"unknown blockedBy target",
			{
				...samplePlan,
				features: [
					{
						...samplePlan.features[0],
						blockedBy: ["missing-feature"],
					},
				],
			},
			"Plan validation failed: feature 'setup-runtime' is blocked by unknown feature 'missing-feature'.",
		],
		[
			"self blockedBy target",
			{
				...samplePlan,
				features: [
					{
						...samplePlan.features[0],
						blockedBy: ["setup-runtime"],
					},
				],
			},
			"Plan validation failed: feature 'setup-runtime' cannot block itself.",
		],
		[
			"cycle detected via blockedBy edges alone",
			{
				...samplePlan,
				features: [
					{
						...samplePlan.features[0],
						blockedBy: ["execute-feature"],
					},
					{
						...samplePlan.features[1],
						dependsOn: undefined,
						blockedBy: ["setup-runtime"],
					},
				],
			},
			"Plan validation failed: the feature dependency graph contains a cycle.",
		],
	] as const;

	test.each(cases)("%s", (_name, plan, message) => {
		const applied = applyPlan(createSampleSession(), plan);

		expect(applied.ok).toBe(false);
		if (applied.ok) return;

		expect(applied.message).toBe(message);
	});
});
