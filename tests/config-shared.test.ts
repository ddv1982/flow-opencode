import { describe, expect, test } from "bun:test";
import {
	applyFlowConfig,
	createFlowCoreConfigEntries,
	FLOW_CORE_AGENTS,
	resolveFlowReviewerConfiguration,
} from "../src/config-shared.js";
import { createConfigHook } from "../src/platform/opencode/config.js";

const REVIEWER_STEPS_WARNING =
	"OPENCODE_FLOW_REVIEWER_STEPS must be an integer from 1 through 1000; ignoring it.";

describe("Flow configuration", () => {
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

	test("denies edit, bash, skill, and delegation for both hidden agents", () => {
		const entries = createFlowCoreConfigEntries({ env: {} });

		expect(entries.agent["flow-reviewer"].permission).toEqual({
			edit: "deny",
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
			flow_feature_complete: "allow",
		});
		expect(entries.agent["flow-worker"].permission).toEqual({
			edit: {
				"*": "allow",
				".flow": "deny",
				".flow/**": "deny",
				".git": "deny",
				".git/**": "deny",
			},
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
		});
	});

	test("gives every call its own deep copy of the deny lists", () => {
		// The host owns the object it receives and may mutate it. Sharing any part
		// of a deny list with the module constant would let one session's edit
		// loosen a later session's permissions.
		const first = createFlowCoreConfigEntries({ env: {} });
		const second = createFlowCoreConfigEntries({ env: {} });

		for (const name of ["flow-reviewer", "flow-worker"] as const) {
			const permission = first.agent[name].permission;
			const constant = FLOW_CORE_AGENTS[name].permission;
			expect(permission, name).not.toBe(constant);
			expect(permission, name).not.toBe(second.agent[name].permission);
			expect(permission.task, name).not.toBe(constant.task);
			expect(permission.task, name).not.toBe(
				second.agent[name].permission.task,
			);
		}

		const worker = first.agent["flow-worker"].permission.edit;
		expect(worker).not.toBe(FLOW_CORE_AGENTS["flow-worker"].permission.edit);
		expect(worker).not.toBe(second.agent["flow-worker"].permission.edit);
	});

	test("replaces Flow collisions while preserving unrelated entries", () => {
		const unrelatedAgent = { description: "keep this agent" };
		const unrelatedCommand = { description: "keep this command" };
		const config = {
			agent: {
				"flow-reviewer": { description: "replace this agent" },
				"local-agent": unrelatedAgent,
			},
			command: {
				"flow-auto": { description: "replace this command" },
				"local-command": unrelatedCommand,
			},
		};
		const collisions: Array<["agent" | "command", string]> = [];

		applyFlowConfig(config, {
			onCollision: (kind, name) => collisions.push([kind, name]),
		});

		expect(collisions).toEqual([
			["agent", "flow-reviewer"],
			["command", "flow-auto"],
		]);
		expect(config.agent["flow-reviewer"]).toMatchObject({
			mode: "subagent",
			hidden: true,
		});
		expect(config.command["flow-auto"]).toMatchObject({ subtask: false });
		expect(config.agent["local-agent"]).toBe(unrelatedAgent);
		expect(config.command["local-command"]).toBe(unrelatedCommand);
	});

	test("leaves configuration untouched and logs when the runtime guard fails", async () => {
		const logs: unknown[] = [];
		const localAgent = { description: "local agent" };
		const localCommand = { description: "local command" };
		const config = {
			agent: { "local-agent": localAgent },
			command: { "local-command": localCommand },
		};
		const hook = createConfigHook(
			{
				client: {
					app: {
						log(input: unknown) {
							logs.push(input);
						},
					},
				},
			},
			{
				assertOperational(action) {
					expect(action).toBe("apply its OpenCode configuration");
					throw new Error("Flow test guard is closed.");
				},
			},
		);

		await hook(config);

		expect(config).toEqual({
			agent: { "local-agent": localAgent },
			command: { "local-command": localCommand },
		});
		expect(config.agent["local-agent"]).toBe(localAgent);
		expect(config.command["local-command"]).toBe(localCommand);
		expect(logs).toEqual([
			{
				body: {
					service: "opencode-plugin-flow",
					level: "error",
					message: "Flow test guard is closed.",
				},
			},
		]);
	});
});
