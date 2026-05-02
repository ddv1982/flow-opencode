// Owns plugin config injection and registered command/agent/tool surface coverage
// previously grouped in tests/config.test.ts.
import { describe, expect, test } from "bun:test";
import { applyFlowConfig, createConfigHook } from "../../src/config";
import FlowPlugin from "../../src/index";
import { createTools } from "../../src/tools";
import type { FlowPluginHooks, MutableConfig } from "./helpers";

describe("plugin config surface", () => {
	test("plugin entrypoint returns Flow config and tool hooks", async () => {
		const appLog = {
			log: () => undefined,
		};
		const ctx = {
			worktree: "/tmp/flow-plugin-test",
			client: { app: appLog },
		} as unknown as Parameters<typeof FlowPlugin>[0];
		const plugin = await FlowPlugin(ctx);
		const pluginWithHooks = plugin as typeof plugin & FlowPluginHooks;

		expect(typeof plugin.config).toBe("function");
		expect(plugin.tool).toBeDefined();
		expect(Object.keys(plugin.tool ?? {})).toEqual(
			Object.keys(createTools(ctx)),
		);

		const config: MutableConfig = {
			command: { existing: { description: "keep me" } },
		};
		const pluginConfigArg = config as unknown as Parameters<
			NonNullable<typeof plugin.config>
		>[0];
		await plugin.config?.(pluginConfigArg);

		expect(config.command?.existing).toEqual({ description: "keep me" });
		expect(config.command?.["flow-plan"]).toBeDefined();
		expect(
			typeof pluginWithHooks.hooks?.["experimental.session.compacting"],
		).toBe("function");
		expect(
			typeof pluginWithHooks.hooks?.["experimental.chat.system.transform"],
		).toBe("function");
		expect(typeof pluginWithHooks.hooks?.["tool.definition"]).toBe("function");
	});

	test("plugin entrypoint logs through ctx.client.app.log", async () => {
		const logCalls: Array<Record<string, unknown>> = [];
		const ctx = {
			worktree: "/tmp/flow-plugin-test",
			client: {
				app: {
					log(entry: Record<string, unknown>) {
						logCalls.push(entry);
					},
				},
			},
		} as unknown as Parameters<typeof FlowPlugin>[0];

		await FlowPlugin(ctx);

		expect(logCalls).toContainEqual({
			level: "info",
			message: "Flow plugin initialized.",
		});
	});

	test("createTools preserves the expected ordered tool surface", () => {
		expect(Object.keys(createTools({}))).toEqual([
			"flow_status",
			"flow_doctor",
			"flow_history",
			"flow_history_show",
			"flow_session_activate",
			"flow_plan_start",
			"flow_auto_prepare",
			"flow_session_close",
			"flow_plan_context_record",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_plan_select_features",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_reset_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_review_render",
		]);
	});
	test("injects commands and agents", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.agent).toBeDefined();
		expect(config.command).toBeDefined();
		expect(config.agent?.["flow-planner"]).toBeDefined();
		expect(config.agent?.["flow-worker"]).toBeDefined();
		expect(config.agent?.["flow-auto"]).toBeDefined();
		expect(config.agent?.["flow-reviewer"]).toBeDefined();
		expect(config.agent?.["flow-control"]).toBeDefined();
		expect(config.command?.["flow-plan"]).toBeDefined();
		expect(config.command?.["flow-run"]).toBeDefined();
		expect(config.command?.["flow-auto"]).toBeDefined();
		expect(config.command?.["flow-review"]).toBeDefined();
		expect(config.command?.["flow-status"]).toBeDefined();
		expect(config.command?.["flow-doctor"]).toBeDefined();
		expect(config.command?.["flow-history"]).toBeDefined();
		expect(config.command?.["flow-session"]).toBeDefined();
		expect(config.command?.["flow-reset"]).toBeDefined();
	});

	test("review command is enabled by default", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);
		expect(config.command?.["flow-review"]).toBeDefined();
		expect(Object.keys(createTools({}))).not.toContain("flow_audit_reports");
		expect(Object.keys(createTools({}))).not.toContain(
			"flow_audit_write_report",
		);
	});
	test("marks canonical persistence tools as explicit action descriptions", () => {
		const tools = createTools({});

		expect(tools.flow_run_complete_feature.description).toContain("Persist");
		expect(tools.flow_review_record_feature.description).toContain("Record");
		expect(tools.flow_review_record_final.description).toContain("Record");
	});

	test("routes status, doctor, history, session activation, and reset through the control agent", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.command?.["flow-review"]?.agent).toBe("flow-control");
		expect(config.command?.["flow-status"]?.agent).toBe("flow-control");
		expect(config.command?.["flow-doctor"]?.agent).toBe("flow-control");
		expect(config.command?.["flow-history"]?.agent).toBe("flow-control");
		expect(config.command?.["flow-session"]?.agent).toBe("flow-control");
		expect(config.command?.["flow-reset"]?.agent).toBe("flow-control");
	});

	test("configures flow-reviewer as read-only", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.agent?.["flow-reviewer"]?.tools?.edit).toBe(false);
		expect(config.agent?.["flow-reviewer"]?.tools?.write).toBe(false);
		expect(config.agent?.["flow-reviewer"]?.tools?.bash).toBe(false);
		expect(config.agent?.["flow-reviewer"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-reviewer"]?.permission?.bash).toBe("deny");
		expect(config.agent?.["flow-planner"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-control"]?.permission?.bash).toBe("deny");
		expect(
			config.agent?.["flow-worker"]?.permission?.external_directory,
		).toBeUndefined();
		expect(config.agent?.["flow-worker"]?.permission).toBeUndefined();
		expect(
			config.agent?.["flow-auto"]?.permission?.external_directory,
		).toBeUndefined();
		expect(config.agent?.["flow-auto"]?.permission).toBeUndefined();
	});

	test("createConfigHook is async and preserves unrelated config entries", async () => {
		const hook = createConfigHook({});
		const config: MutableConfig = {
			agent: { existing: { mode: "primary", description: "already here" } },
			command: { existing: { description: "already here", agent: "existing" } },
		};

		await expect(
			hook(config as unknown as Parameters<typeof hook>[0]),
		).resolves.toBeUndefined();

		expect(config.agent?.existing).toEqual({
			mode: "primary",
			description: "already here",
		});
		expect(config.command?.existing).toEqual({
			description: "already here",
			agent: "existing",
		});
		expect(config.agent?.["flow-control"]).toBeDefined();
		expect(config.command?.["flow-doctor"]).toBeDefined();
		expect(config.command?.["flow-history"]).toBeDefined();
		expect(config.command?.["flow-session"]).toBeDefined();
		expect(config.command?.["flow-reset"]).toBeDefined();
		expect(config.command?.["flow-review"]).toBeDefined();
	});

	test("injects fresh config objects instead of sharing mutable references across calls", () => {
		const first: MutableConfig = {};
		const second: MutableConfig = {};

		applyFlowConfig(first);
		applyFlowConfig(second);

		expect(first.agent?.["flow-planner"]).not.toBe(
			second.agent?.["flow-planner"],
		);
		expect(first.agent?.["flow-reviewer"]).not.toBe(
			second.agent?.["flow-reviewer"],
		);
		expect(first.agent?.["flow-planner"]?.tools).not.toBe(
			second.agent?.["flow-planner"]?.tools,
		);
		expect(first.agent?.["flow-planner"]?.tools).not.toBe(
			first.agent?.["flow-reviewer"]?.tools,
		);
		expect(first.agent?.["flow-planner"]?.permission).not.toBe(
			second.agent?.["flow-planner"]?.permission,
		);
		expect(first.command?.["flow-plan"]).not.toBe(
			second.command?.["flow-plan"],
		);

		const firstPlanner = first.agent?.["flow-planner"];
		if (!firstPlanner?.tools || !firstPlanner.permission) {
			throw new Error("Missing flow-planner config in test setup.");
		}

		firstPlanner.tools.edit = true;
		firstPlanner.permission.edit = "allow";
		expect(second.agent?.["flow-planner"]?.tools?.edit).toBe(false);
		expect(first.agent?.["flow-reviewer"]?.tools?.edit).toBe(false);
		expect(second.agent?.["flow-planner"]?.permission?.edit).toBe("deny");
	});
});
