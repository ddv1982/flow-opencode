// Owns plugin config injection and registered command/agent/tool surface coverage
// previously grouped in tests/config.test.ts.
import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	applyFlowConfig,
	createConfigHook,
} from "../../src/adapters/opencode/config";
import { OPENCODE_TOOL_NAMES } from "../../src/adapters/opencode/tool-projections.generated";
import { createTools } from "../../src/adapters/opencode/tools";
import FlowPlugin from "../../src/index";
import type { FlowPluginHooks, MutableConfig } from "./helpers";

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				return collectTypeScriptFiles(path);
			}
			return entry.isFile() && path.endsWith(".ts") ? [path] : [];
		}),
	);
	return nested.flat();
}

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

	test("core modules stay independent of OpenCode adapter packages", async () => {
		const coreRoot = join(import.meta.dir, "..", "..", "src", "core");
		const files = await collectTypeScriptFiles(coreRoot);

		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const source = await readFile(file, "utf8");
			expect(source).not.toContain("@opencode-ai/plugin");
			expect(source).not.toContain("adapters/opencode");
		}
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

	test("createTools preserves the projected ordered OpenCode tool surface", () => {
		expect(Object.keys(createTools({}))).toEqual(OPENCODE_TOOL_NAMES);
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

	test("keeps planner, reviewer, and control agents read-only", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.agent?.["flow-planner"]?.mode).toBe("all");
		expect(config.agent?.["flow-planner"]?.tools).toBeUndefined();
		expect(config.agent?.["flow-planner"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-planner"]?.permission?.bash).toBe("deny");
		expect(config.agent?.["flow-planner"]?.permission?.task).toEqual({
			"*": "deny",
		});

		expect(config.agent?.["flow-reviewer"]?.mode).toBe("all");
		expect(config.agent?.["flow-reviewer"]?.tools).toBeUndefined();
		expect(config.agent?.["flow-reviewer"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-reviewer"]?.permission?.bash).toBe("deny");
		expect(config.agent?.["flow-reviewer"]?.permission?.task).toEqual({
			"*": "deny",
		});

		expect(config.agent?.["flow-control"]?.mode).toBe("primary");
		expect(config.agent?.["flow-control"]?.tools).toBeUndefined();
		expect(config.agent?.["flow-control"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-control"]?.permission?.bash).toBe("deny");
		expect(config.agent?.["flow-control"]?.permission?.task).toEqual({
			"*": "deny",
		});

		expect(
			config.agent?.["flow-worker"]?.permission?.external_directory,
		).toBeUndefined();
		expect(config.agent?.["flow-worker"]?.permission?.edit).toBeUndefined();
		expect(config.agent?.["flow-worker"]?.permission?.bash).toBeUndefined();
		expect(
			config.agent?.["flow-auto"]?.permission?.external_directory,
		).toBeUndefined();
		expect(config.agent?.["flow-auto"]?.permission?.edit).toBeUndefined();
		expect(config.agent?.["flow-auto"]?.permission?.bash).toBeUndefined();
	});

	test("configures task permissions for fresh-context Flow role handoffs", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.agent?.["flow-planner"]?.mode).toBe("all");
		expect(config.agent?.["flow-worker"]?.mode).toBe("all");
		expect(config.agent?.["flow-reviewer"]?.mode).toBe("all");
		expect(config.agent?.["flow-auto"]?.mode).toBe("primary");
		expect(config.agent?.["flow-worker"]?.permission?.task).toEqual({
			"*": "deny",
			"flow-reviewer": "allow",
		});
		expect(config.agent?.["flow-auto"]?.permission?.task).toEqual({
			"*": "deny",
			"flow-planner": "allow",
			"flow-worker": "allow",
			"flow-reviewer": "allow",
		});
		expect(config.agent?.["flow-reviewer"]?.permission?.edit).toBe("deny");
		expect(config.agent?.["flow-reviewer"]?.permission?.bash).toBe("deny");
		expect(config.agent?.["flow-planner"]?.permission?.task).toEqual({
			"*": "deny",
		});
		expect(config.agent?.["flow-reviewer"]?.permission?.task).toEqual({
			"*": "deny",
		});
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
		expect(first.agent?.["flow-planner"]?.tools).toBeUndefined();
		expect(first.agent?.["flow-reviewer"]?.tools).toBeUndefined();
		expect(first.agent?.["flow-planner"]?.permission).not.toBe(
			second.agent?.["flow-planner"]?.permission,
		);
		expect(first.agent?.["flow-worker"]?.permission?.task).not.toBe(
			second.agent?.["flow-worker"]?.permission?.task,
		);
		expect(first.agent?.["flow-auto"]?.permission?.task).not.toBe(
			second.agent?.["flow-auto"]?.permission?.task,
		);
		expect(first.command?.["flow-plan"]).not.toBe(
			second.command?.["flow-plan"],
		);

		const firstPlanner = first.agent?.["flow-planner"];
		if (!firstPlanner?.permission) {
			throw new Error("Missing flow-planner config in test setup.");
		}

		const firstWorker = first.agent?.["flow-worker"];
		if (!firstWorker?.permission?.task) {
			throw new Error("Missing flow-worker task permissions in test setup.");
		}

		const firstAuto = first.agent?.["flow-auto"];
		if (!firstAuto?.permission?.task) {
			throw new Error("Missing flow-auto task permissions in test setup.");
		}

		firstPlanner.permission.edit = "allow";
		firstWorker.permission.task["flow-reviewer"] = "deny";
		firstAuto.permission.task["flow-worker"] = "deny";
		expect(second.agent?.["flow-planner"]?.tools).toBeUndefined();
		expect(first.agent?.["flow-reviewer"]?.tools).toBeUndefined();
		expect(second.agent?.["flow-planner"]?.permission?.edit).toBe("deny");
		expect(
			second.agent?.["flow-worker"]?.permission?.task?.["flow-reviewer"],
		).toBe("allow");
		expect(second.agent?.["flow-auto"]?.permission?.task?.["flow-worker"]).toBe(
			"allow",
		);
	});
});
