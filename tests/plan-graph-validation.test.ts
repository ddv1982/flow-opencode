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

	test("review plans must declare review scope through reviewScope or fileTargets", () => {
		const firstFeature = samplePlan.features[0];
		expect(firstFeature).toBeDefined();
		if (!firstFeature) return;

		const withoutScope = applyPlan(createSampleSession(), {
			...samplePlan,
			goalMode: "review",
			features: [
				{
					...firstFeature,
					fileTargets: [],
					reviewScope: undefined,
				},
			],
		});
		expect(withoutScope.ok).toBe(false);
		if (!withoutScope.ok) {
			expect(withoutScope.message).toBe(
				"Review and review-and-fix plans must declare review scope through reviewScope or fileTargets before approval.",
			);
		}

		const withExplicitScope = applyPlan(createSampleSession(), {
			...samplePlan,
			goalMode: "review",
			features: [
				{
					...firstFeature,
					fileTargets: [],
					reviewScope: [
						{
							id: "runtime-domain",
							kind: "domain",
							target: "runtime completion gates",
						},
					],
				},
			],
		});
		expect(withExplicitScope.ok).toBe(true);
	});

	test("review plans reject effective scope id collisions across explicit and file target scope", () => {
		const [firstFeature, secondFeature] = samplePlan.features;
		expect(firstFeature).toBeDefined();
		expect(secondFeature).toBeDefined();
		if (!firstFeature || !secondFeature) return;

		const applied = applyPlan(createSampleSession(), {
			...samplePlan,
			goalMode: "review",
			features: [
				{
					...firstFeature,
					fileTargets: ["src/runtime/session.ts"],
				},
				{
					...secondFeature,
					fileTargets: [],
					reviewScope: [
						{
							id: "file_target:src/runtime/session.ts",
							kind: "domain",
							target: "runtime session lifecycle",
						},
					],
				},
			],
		});

		expect(applied.ok).toBe(false);
		if (!applied.ok) {
			expect(applied.message).toContain("file_target:src/runtime/session.ts");
			expect(applied.message).toContain("multiple distinct targets");
		}
	});
});
