import { describe, expect, test } from "bun:test";

import { REVIEW_AND_FIX_FINDINGS_REQUIRED_MESSAGE } from "../src/runtime/domain";
import { createSession } from "../src/runtime/lifecycle";
import { applyPlan } from "../src/runtime/transitions";
import { createSampleSession, samplePlan } from "./fixtures";

const knownReviewFinding = {
	findingRef: "review: navigation failure was swallowed",
	summary: "Existing review found swallowed navigation failures.",
	sourceRefs: ["audit#nav-001", "src/runtime/session.ts"],
};

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

	test("review_and_fix plans require concrete existing review findings", () => {
		const applied = applyPlan(createSampleSession(), {
			...samplePlan,
			goalMode: "review_and_fix",
		});

		expect(applied.ok).toBe(false);
		if (!applied.ok) {
			expect(applied.message).toBe(REVIEW_AND_FIX_FINDINGS_REQUIRED_MESSAGE);
		}
	});

	test("review_and_fix plans allow findings from existing or inline planning context", () => {
		const withExistingPlanning = applyPlan(
			createSession("Fix known review finding", {
				reviewFindings: [knownReviewFinding],
			}),
			{
				...samplePlan,
				goalMode: "review_and_fix",
			},
		);
		expect(withExistingPlanning.ok).toBe(true);

		const inlineFinding = {
			...knownReviewFinding,
			summary: "Inline context refreshes the existing finding summary.",
		};
		const withInlinePlanning = applyPlan(
			createSession("Fix known review finding", {
				reviewFindings: [knownReviewFinding],
			}),
			{
				...samplePlan,
				goalMode: "review_and_fix",
			},
			{ reviewFindings: [inlineFinding] },
		);
		expect(withInlinePlanning.ok).toBe(true);
		if (withInlinePlanning.ok) {
			expect(withInlinePlanning.value.planning.reviewFindings).toEqual([
				inlineFinding,
			]);
		}
	});

	test("review_and_fix plans allow inline-only review findings", () => {
		const applied = applyPlan(
			createSession("Fix known review finding"),
			{
				...samplePlan,
				goalMode: "review_and_fix",
			},
			{ reviewFindings: [knownReviewFinding] },
		);

		expect(applied.ok).toBe(true);
	});

	test("review plans do not require pre-existing review findings", () => {
		const applied = applyPlan(createSampleSession(), {
			...samplePlan,
			goalMode: "review",
		});

		expect(applied.ok).toBe(true);
	});
});
