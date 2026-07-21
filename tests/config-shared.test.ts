import { describe, expect, test } from "bun:test";
import {
	applyFlowConfig,
	createFlowCoreConfigEntries,
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
