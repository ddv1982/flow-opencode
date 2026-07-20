import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import { createFlowCoreConfigEntries } from "../src/config-shared.js";
import { FLOW_GUIDANCE_IDS, getFlowGuidance } from "../src/guidance/catalog.js";
import FlowPlugin from "../src/index.js";
import { createTools } from "../src/platform/opencode/tools.js";

const TOOL_NAMES = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
] as const;

const COMMAND_NAMES = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
] as const;

function createRegisteredTools() {
	return createTools(
		{},
		{
			validation: {} as never,
			prepareValidation: async () => {
				throw new Error(
					"Validation execution is outside this structural test.",
				);
			},
		},
	);
}

function pluginContext(workspace: string, directory = workspace) {
	return {
		client: { app: { log() {} } },
		project: {},
		directory,
		worktree: workspace,
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://localhost"),
		$: {},
	} as unknown as Parameters<typeof FlowPlugin>[0];
}

function toolContext(workspace: string): ToolContext {
	return {
		sessionID: "surface-test-session",
		messageID: "surface-test-message",
		agent: "build",
		directory: workspace,
		worktree: workspace,
		abort: new AbortController().signal,
		metadata() {},
		async ask() {},
	};
}

type PluginHooks = Awaited<ReturnType<typeof FlowPlugin>>;
const activeHooks: PluginHooks[] = [];

async function loadPlugin(
	workspace: string,
	directory = workspace,
): Promise<PluginHooks> {
	const hooks = await FlowPlugin(pluginContext(workspace, directory));
	activeHooks.push(hooks);
	return hooks;
}

afterEach(async () => {
	for (const hooks of activeHooks.splice(0).reverse()) await hooks.dispose?.();
});

describe("Flow v6 distribution surface", () => {
	test("ships ten tools, five commands, two hidden agents, and four guides", async () => {
		expect(new Set(Object.keys(createRegisteredTools()))).toEqual(
			new Set(TOOL_NAMES),
		);

		const config = createFlowCoreConfigEntries();
		expect(Object.keys(config.command).sort()).toEqual([...COMMAND_NAMES]);
		expect(Object.keys(config.agent)).toEqual(["flow-reviewer", "flow-worker"]);
		for (const agent of Object.values(config.agent)) {
			expect(agent.hidden).toBe(true);
		}

		expect(FLOW_GUIDANCE_IDS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);

		const workspace = await mkdtemp(join(tmpdir(), "flow-surface-"));
		const hooks = await loadPlugin(workspace);
		expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...TOOL_NAMES]);
	});

	test("isolates worker permissions while keeping manager and reviewer dispatch separate", () => {
		const { agent, command } = createFlowCoreConfigEntries();
		const reviewer = agent["flow-reviewer"];
		const worker = agent["flow-worker"];
		expect(reviewer).toBeDefined();
		expect(reviewer?.hidden).toBe(true);
		expect(reviewer?.permission).toMatchObject({
			edit: "deny",
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
		});
		expect(worker).toBeDefined();
		expect(worker?.hidden).toBe(true);
		expect(worker?.mode).toBe("subagent");
		expect(worker?.permission).toEqual({
			edit: "ask",
			bash: "ask",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
		});
		expect(worker).not.toHaveProperty("model");
		expect(worker).not.toHaveProperty("steps");

		for (const name of [
			"flow-auto",
			"flow-plan",
			"flow-run",
			"flow-status",
		] as const) {
			expect(command[name]?.subtask).toBe(false);
			expect("agent" in (command[name] ?? {})).toBe(false);
		}
		expect(command["flow-review"]).toMatchObject({
			subtask: true,
			agent: "flow-reviewer",
		});
		expect(
			Object.values(command).some(
				(entry) => "agent" in entry && entry.agent === "flow-worker",
			),
		).toBe(false);
	});
});

describe("command preflight", () => {
	test("rewrites manager text and the exact reviewer subtask", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-command-"));
		const hooks = await loadPlugin(workspace);
		const before = hooks["command.execute.before"];
		if (!before) throw new Error("Missing command preflight hook.");

		const managerOutput = {
			parts: [{ type: "text", text: "stale prompt" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "/flow-plan", sessionID: "s", arguments: "simplify it" },
			managerOutput,
		);
		expect(managerOutput.parts).toHaveLength(2);
		expect(managerOutput.parts[0]).toMatchObject({
			type: "text",
			text: "Flow flow-plan: simplify it",
		});
		expect(managerOutput.parts[1]).toMatchObject({
			type: "text",
			synthetic: true,
		});
		expect((managerOutput.parts[1] as { text?: string }).text).toContain(
			"# Flow Plan",
		);

		const reviewerOutput = {
			parts: [
				{
					type: "subtask",
					agent: "flow-reviewer",
					command: "flow-review",
					prompt: "stale prompt",
					description: "review",
				},
			],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-review", sessionID: "s", arguments: "assignment-1" },
			reviewerOutput,
		);
		expect((reviewerOutput.parts[0] as { prompt?: string }).prompt).toContain(
			"Assignment: assignment-1",
		);
	});

	test("fails closed for mixed manager or malformed reviewer dispatch", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-command-fail-"));
		const hooks = await loadPlugin(workspace);
		const before = hooks["command.execute.before"];
		if (!before) throw new Error("Missing command preflight hook.");

		await expect(
			before({ command: "flow-run", sessionID: "s", arguments: "" }, {
				parts: [
					{
						type: "subtask",
						agent: "flow-reviewer",
						command: "flow-run",
						prompt: "",
						description: "invalid",
					},
				],
			} as unknown as Parameters<typeof before>[1]),
		).rejects.toThrow("manager commands cannot contain subtask parts");

		for (const parts of [
			[],
			[{ type: "text", text: "not a subtask" }],
			[
				{
					type: "subtask",
					agent: "other-reviewer",
					command: "flow-review",
					prompt: "",
					description: "invalid",
				},
			],
		] as const) {
			await expect(
				before({ command: "flow-review", sessionID: "s", arguments: "" }, {
					parts: [...parts],
				} as unknown as Parameters<typeof before>[1]),
			).rejects.toThrow();
		}
	});
});

describe("duplicate runtime guard", () => {
	test("disables every copy dynamically until one project runtime remains", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-duplicate-"));
		const firstDirectory = join(workspace, "first-directory");
		const secondDirectory = join(workspace, "second-directory");
		await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
		const first = await loadPlugin(workspace, firstDirectory);
		const second = await loadPlugin(workspace, secondDirectory);
		const context = toolContext(workspace);

		for (const hooks of [first, second]) {
			const guidance = hooks.tool?.flow_guidance;
			if (!guidance) throw new Error("Missing guarded guidance tool.");
			const output = await guidance.execute({ id: "flow" }, context);
			expect(JSON.parse(String(output))).toMatchObject({
				status: "error",
				summary: expect.stringContaining("more than one runtime"),
				workflowData: {
					runtimeGuard: {
						operational: false,
						reason: "duplicate-instances",
					},
				},
			});
		}

		await second.dispose?.();
		const guidance = first.tool?.flow_guidance;
		if (!guidance) throw new Error("Missing guarded guidance tool.");
		expect(await guidance.execute({ id: "flow" }, context)).toBe(
			getFlowGuidance("flow").content,
		);
	});
});
