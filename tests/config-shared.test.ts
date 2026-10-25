import { describe, expect, test } from "bun:test";
import {
	createFlowCoreConfigEntries,
	FLOW_CORE_AGENTS,
	flowReviewerStatus,
	resolveFlowReviewerConfiguration,
} from "../src/config-shared.js";

const REVIEWER_STEPS_WARNING =
	"OPENCODE_FLOW_REVIEWER_STEPS must be an integer from 1 through 1000; ignoring it.";

describe("Flow configuration", () => {
	test("preserves a native reviewer variant with plugin precedence", () => {
		const reviewer = resolveFlowReviewerConfiguration({
			env: { OPENCODE_FLOW_REVIEWER_VARIANT: "low" },
			pluginOptions: {
				reviewer: { model: "provider/reviewer", variant: " high " },
			},
		});
		expect(reviewer.variant).toEqual({
			kind: "explicit",
			source: "plugin-option",
			value: "high",
		});
		expect(
			createFlowCoreConfigEntries({ reviewerConfiguration: reviewer }).agent[
				"flow-reviewer"
			],
		).toMatchObject({
			model: "provider/reviewer",
			variant: "high",
		});
		expect(flowReviewerStatus(reviewer)).toMatchObject({
			variant: {
				kind: "explicit",
				source: "plugin-option",
				requested: "high",
				application: "host-configured",
			},
			availability: "unverified",
		});
	});

	test("uses the environment variant and labels the native model requirement", () => {
		const warnings: string[] = [];
		const reviewer = resolveFlowReviewerConfiguration({
			env: { OPENCODE_FLOW_REVIEWER_VARIANT: " high " },
			onWarning: (warning) => warnings.push(warning),
		});
		expect(reviewer.variant).toEqual({
			kind: "explicit",
			source: "environment",
			value: "high",
		});
		expect(flowReviewerStatus(reviewer)).toMatchObject({
			model: { kind: "shared-manager-model" },
			variant: { requested: "high", application: "requires-explicit-model" },
		});
		expect(warnings).toEqual([
			"Configure an explicit reviewer.model to apply reviewer.variant.",
		]);
	});

	test("rejects invalid reviewer variants without changing defaults", () => {
		const warnings: string[] = [];
		const reviewer = resolveFlowReviewerConfiguration({
			env: {},
			pluginOptions: { reviewer: { variant: 3 } },
			onWarning: (warning) => warnings.push(warning),
		});
		expect(reviewer).not.toHaveProperty("variant");
		expect(flowReviewerStatus(reviewer)).not.toHaveProperty("variant");
		expect(warnings).toEqual([
			"Flow plugin option reviewer.variant must be a non-empty string; ignoring it.",
		]);
	});

	test("applies a variant when the explicit reviewer model comes from the environment", () => {
		const warnings: string[] = [];
		const reviewer = resolveFlowReviewerConfiguration({
			env: { OPENCODE_FLOW_REVIEWER_MODEL: "provider/reviewer" },
			pluginOptions: { reviewer: { variant: "high" } },
			onWarning: (warning) => warnings.push(warning),
		});
		expect(flowReviewerStatus(reviewer).variant?.application).toBe(
			"host-configured",
		);
		expect(warnings).toEqual([]);
	});

	for (const example of [
		{
			name: "trims the reviewer model and a valid step limit",
			env: {
				OPENCODE_FLOW_REVIEWER_MODEL: "  provider/reviewer  ",
				OPENCODE_FLOW_REVIEWER_STEPS: " 42 ",
			},
			expectedModel: "provider/reviewer",
			expectedSteps: 42,
			expectedWarnings: [],
		},
		{
			name: "accepts the maximum reviewer step limit",
			env: { OPENCODE_FLOW_REVIEWER_STEPS: "1000" },
			expectedModel: undefined,
			expectedSteps: 1000,
			expectedWarnings: [],
		},
		{
			name: "ignores blank reviewer settings without warning",
			env: {
				OPENCODE_FLOW_REVIEWER_MODEL: "  ",
				OPENCODE_FLOW_REVIEWER_STEPS: "  ",
			},
			expectedModel: undefined,
			expectedSteps: undefined,
			expectedWarnings: [],
		},
		...[
			["zero", "0"],
			["above the maximum", "1001"],
			["fractional", "1.5"],
			["non-numeric", "many"],
		].map(([label, value]) => ({
			name: `warns and ignores a ${label} reviewer step limit`,
			env: { OPENCODE_FLOW_REVIEWER_STEPS: value },
			expectedModel: undefined,
			expectedSteps: undefined,
			expectedWarnings: [REVIEWER_STEPS_WARNING],
		})),
	] as const) {
		test(example.name, () => {
			const warnings: string[] = [];
			const entries = createFlowCoreConfigEntries({
				env: example.env,
				onWarning: (warning) => warnings.push(warning),
			});
			const reviewer = entries.agent["flow-reviewer"];

			if (example.expectedModel === undefined) {
				expect(reviewer).not.toHaveProperty("model");
			} else {
				expect(reviewer.model).toBe(example.expectedModel);
			}
			if (example.expectedSteps === undefined) {
				expect(reviewer).not.toHaveProperty("steps");
			} else {
				expect(reviewer.steps).toBe(example.expectedSteps);
			}
			expect(warnings).toEqual([...example.expectedWarnings]);
		});
	}

	test("prefers native plugin reviewer options over environment fallback", () => {
		const entries = createFlowCoreConfigEntries({
			env: {
				OPENCODE_FLOW_REVIEWER_MODEL: "env/reviewer",
				OPENCODE_FLOW_REVIEWER_STEPS: "20",
			},
			pluginOptions: {
				reviewer: { model: " plugin/reviewer ", steps: 80 },
			},
		});

		expect(entries.agent["flow-reviewer"]).toMatchObject({
			model: "plugin/reviewer",
			steps: 80,
		});
		expect(
			resolveFlowReviewerConfiguration({
				env: {},
				pluginOptions: {
					reviewer: { model: "plugin/reviewer", steps: 80 },
				},
			}),
		).toEqual({
			model: {
				kind: "explicit",
				source: "plugin-option",
				value: "plugin/reviewer",
			},
			steps: { kind: "explicit", source: "plugin-option", value: 80 },
		});
	});

	test("falls back to environment reviewer settings when plugin options omit them", () => {
		expect(
			resolveFlowReviewerConfiguration({
				env: {
					OPENCODE_FLOW_REVIEWER_MODEL: "env/reviewer",
					OPENCODE_FLOW_REVIEWER_STEPS: "21",
				},
				pluginOptions: { reviewer: {} },
			}),
		).toEqual({
			model: {
				kind: "explicit",
				source: "environment",
				value: "env/reviewer",
			},
			steps: { kind: "explicit", source: "environment", value: 21 },
		});
	});

	test("warns and ignores invalid native reviewer options", () => {
		const warnings: string[] = [];

		const reviewer = resolveFlowReviewerConfiguration({
			env: {},
			pluginOptions: { reviewer: { model: "", steps: 1001 } },
			onWarning: (warning) => warnings.push(warning),
		});

		expect(reviewer).toEqual({
			model: { kind: "shared-with-manager" },
			steps: { kind: "host-default" },
		});
		expect(warnings).toEqual([
			"Flow plugin option reviewer.model must be a non-empty string; ignoring it.",
			"Flow plugin option reviewer.steps must be an integer from 1 through 1000; ignoring it.",
		]);
	});

	test("does not parse overridden environment reviewer settings", () => {
		const warnings: string[] = [];
		const reviewer = resolveFlowReviewerConfiguration({
			env: {
				OPENCODE_FLOW_REVIEWER_MODEL: "environment/reviewer",
				OPENCODE_FLOW_REVIEWER_STEPS: "invalid",
			},
			pluginOptions: {
				reviewer: { model: "plugin/reviewer", steps: 64 },
			},
			onWarning: (warning) => warnings.push(warning),
		});

		expect(reviewer).toEqual({
			model: {
				kind: "explicit",
				source: "plugin-option",
				value: "plugin/reviewer",
			},
			steps: { kind: "explicit", source: "plugin-option", value: 64 },
		});
		expect(warnings).toEqual([]);
	});

	test("uses ordered native permissions with only reviewer completion authority", () => {
		const entries = createFlowCoreConfigEntries({ env: {} });
		function effect(
			role: keyof typeof entries.agent,
			action: string,
			resource = "*",
		) {
			return entries.agent[role].permissions
				.filter(
					(rule) =>
						(rule.action === "*" || rule.action === action) &&
						(rule.resource === "*" ||
							new Bun.Glob(rule.resource).match(resource)),
				)
				.at(-1)?.effect;
		}
		expect(effect("flow-reviewer", "flow_status")).toBe("allow");
		expect(effect("flow-reviewer", "flow_feature_complete")).toBe("allow");
		for (const role of [
			"flow-planner",
			"flow-reviewer",
			"flow-worker",
		] as const) {
			for (const action of ["shell", "subagent", "skill", "flow_plan_save"])
				expect(effect(role, action)).toBe("deny");
		}
		expect(effect("flow-worker", "edit", "src/main.ts")).toBe("allow");
		expect(effect("flow-worker", "edit", ".flow/session.json")).toBe("deny");
		expect(
			entries.agent["flow-worker"].permissions
				.filter((rule) => rule.effect === "deny" && rule.action === "edit")
				.map((rule) => rule.resource),
		).toEqual([
			".flow",
			".flow/**",
			"**/.flow",
			"**/.flow/**",
			".git",
			".git/**",
			"**/.git",
			"**/.git/**",
		]);
	});
	test("copies permission rules for each host registration", () => {
		const first = createFlowCoreConfigEntries({ env: {} });
		const second = createFlowCoreConfigEntries({ env: {} });
		first.agent["flow-worker"].permissions.splice(0);
		expect(second.agent["flow-worker"].permissions.length).toBe(13);
		expect(FLOW_CORE_AGENTS["flow-worker"].permissions.length).toBe(13);
	});
});
