import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	cleanupManagedTempDirs,
	createToolContext,
	importBuiltPlugin,
	makeManagedTempDir,
} from "../cross-area/helpers";

type PluginFactory = typeof import("../../src/index").default;
type BuiltPlugin = Awaited<ReturnType<PluginFactory>>;
type TestTool = {
	execute: (args: unknown, context: unknown) => Promise<string>;
};
type FlowToolName =
	| "flow_audit_write_report"
	| "flow_audit_reports"
	| "flow_status"
	| "flow_doctor"
	| "flow_history"
	| "flow_history_show"
	| "flow_session_activate"
	| "flow_plan_start"
	| "flow_auto_prepare"
	| "flow_session_close"
	| "flow_plan_context_record"
	| "flow_plan_apply"
	| "flow_plan_approve"
	| "flow_plan_select_features"
	| "flow_run_start"
	| "flow_run_complete_feature"
	| "flow_review_record_feature"
	| "flow_review_record_final"
	| "flow_reset_feature";
type FlowSmokeTools = Record<FlowToolName, TestTool>;

const AUDIT_ENV_KEYS = [
	"FLOW_ENABLE_AUDIT_SURFACE",
	"FLOW_ENABLE_AUDIT_CONFIG",
	"FLOW_ENABLE_AUDIT_TOOLS",
	"FLOW_ENABLE_AUDIT_REPORTS_TOOL",
	"FLOW_ENABLE_AUDIT_WRITE_TOOL",
	"FLOW_ENABLE_AUDIT_GUIDANCE",
] as const;
const ORIGINAL_AUDIT_ENV = Object.fromEntries(
	AUDIT_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof AUDIT_ENV_KEYS)[number], string | undefined>;

afterEach(() => {
	cleanupManagedTempDirs();
	for (const key of AUDIT_ENV_KEYS) {
		const value = ORIGINAL_AUDIT_ENV[key];
		if (value === undefined) {
			delete process.env[key];
			continue;
		}
		process.env[key] = value;
	}
});

beforeEach(() => {
	for (const key of AUDIT_ENV_KEYS) {
		delete process.env[key];
	}
});

describe("built dist smoke load", () => {
	test("dist bundle exposes five agents, eight commands, seventeen tools by default", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(plugin.config).toBeFunction();
		expect(plugin.tool).toBeDefined();
		const tools = plugin.tool as unknown as FlowSmokeTools;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(5);
		expect(Object.keys(config.command ?? {})).toHaveLength(8);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(17);

		const context = createToolContext(worktree);
		const planStartResponse = JSON.parse(
			await tools.flow_plan_start.execute(
				{ goal: "Optimize the Flow bundle" },
				context,
			),
		);
		expect(planStartResponse.status).toBe("ok");
		expect(planStartResponse.session.goal).toBe("Optimize the Flow bundle");
		const sessionId = planStartResponse.session.id as string;

		const toolArgs: Record<string, unknown> = {
			flow_status: {},
			flow_doctor: {},
			flow_history: {},
			flow_history_show: { sessionId },
			flow_session_activate: { sessionId },
			flow_plan_start: { goal: "Optimize the Flow bundle" },
			flow_auto_prepare: { argumentString: "resume" },
			flow_session_close: { kind: "completed" },
			flow_plan_context_record: { repoProfile: ["TypeScript"] },
			flow_plan_apply: {
				plan: {
					summary: "Build the smoke path.",
					overview: "Exercise the dist bundle end to end.",
					features: [
						{
							id: "dist-smoke",
							title: "Dist smoke feature",
							summary: "Drive the bundled plugin through its surface.",
							fileTargets: ["dist/index.js"],
							verification: ["bun test tests/smoke/dist-load.test.ts"],
						},
					],
				},
			},
			flow_plan_approve: {},
			flow_plan_select_features: { featureIds: ["dist-smoke"] },
			flow_run_start: {},
			flow_run_complete_feature: {
				contractVersion: "1",
				status: "needs_input",
				summary: "Need to replan smoke coverage.",
				artifactsChanged: [],
				validationRun: [],
				decisions: [],
				nextStep: "Replan before completion.",
				outcome: {
					kind: "replan_required",
					replanReason: "plan_too_broad",
					failedAssumption:
						"The current feature was small enough to finish in one pass.",
					recommendedAdjustment:
						"Split the work into a smaller follow-up plan.",
				},
				featureResult: { featureId: "dist-smoke" },
				featureReview: {
					status: "passed",
					summary: "No blocking review findings.",
					blockingFindings: [],
				},
			},
			flow_review_record_feature: {
				scope: "feature",
				featureId: "dist-smoke",
				status: "approved",
				summary: "Looks good.",
			},
			flow_review_record_final: {
				scope: "final",
				status: "approved",
				summary: "Looks good.",
			},
			flow_reset_feature: { featureId: "dist-smoke" },
		} satisfies Record<string, unknown>;

		for (const [toolName, toolImpl] of Object.entries(tools)) {
			const response = await toolImpl.execute(
				toolArgs[toolName] ?? {},
				context,
			);
			expect(typeof response).toBe("string");
			expect(() => JSON.parse(response)).not.toThrow();
		}

		const statusResponse = JSON.parse(
			await tools.flow_status.execute({}, context),
		);
		expect(typeof statusResponse.status).toBe("string");
		if (statusResponse.session) {
			expect(statusResponse.session.goal).toBe("Optimize the Flow bundle");
		}

		const historyResponse = JSON.parse(
			await tools.flow_history.execute({}, context),
		);
		expect(typeof historyResponse.status).toBe("string");
		if (
			(historyResponse.status === "ok" && historyResponse.history.active) ||
			historyResponse.history.stored.length > 0
		) {
			expect(
				historyResponse.history.active?.id ??
					historyResponse.history.stored[0]?.id,
			).toBe(planStartResponse.session.id);
		}
	});

	test("dist bundle exposes config-only audit diagnostics when FLOW_ENABLE_AUDIT_CONFIG is enabled", async () => {
		process.env.FLOW_ENABLE_AUDIT_CONFIG = "1";
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-audit-config-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(6);
		expect(Object.keys(config.command ?? {})).toHaveLength(10);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(17);
		expect(plugin.tool?.flow_audit_write_report).toBeUndefined();
	});

	test("dist bundle exposes tools-only audit diagnostics when FLOW_ENABLE_AUDIT_TOOLS is enabled", async () => {
		process.env.FLOW_ENABLE_AUDIT_TOOLS = "1";
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-audit-tools-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(5);
		expect(Object.keys(config.command ?? {})).toHaveLength(8);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(19);
		expect(plugin.tool?.flow_audit_write_report).toBeDefined();
		expect(plugin.tool?.flow_audit_reports).toBeDefined();
	});

	test("dist bundle exposes reports-only audit diagnostics when FLOW_ENABLE_AUDIT_REPORTS_TOOL is enabled", async () => {
		process.env.FLOW_ENABLE_AUDIT_REPORTS_TOOL = "1";
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-audit-reports-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(Object.keys(plugin.tool ?? {})).toHaveLength(18);
		expect(plugin.tool?.flow_audit_reports).toBeDefined();
		expect(plugin.tool?.flow_audit_write_report).toBeUndefined();
	});

	test("dist bundle exposes write-only audit diagnostics when FLOW_ENABLE_AUDIT_WRITE_TOOL is enabled", async () => {
		process.env.FLOW_ENABLE_AUDIT_WRITE_TOOL = "1";
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-audit-write-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(Object.keys(plugin.tool ?? {})).toHaveLength(18);
		expect(plugin.tool?.flow_audit_write_report).toBeDefined();
		expect(plugin.tool?.flow_audit_reports).toBeUndefined();
	});

	test("dist bundle exposes audit surface when FLOW_ENABLE_AUDIT_SURFACE is enabled", async () => {
		process.env.FLOW_ENABLE_AUDIT_SURFACE = "1";
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-audit-");
		const plugin = (await pluginFactory({
			worktree,
		} as Parameters<PluginFactory>[0])) as BuiltPlugin;

		const config = {
			agent: {},
			command: {},
		} as Record<string, Record<string, unknown>>;
		await plugin.config?.(
			config as Parameters<NonNullable<typeof plugin.config>>[0],
		);

		expect(Object.keys(config.agent ?? {})).toHaveLength(6);
		expect(Object.keys(config.command ?? {})).toHaveLength(10);
		expect(Object.keys(plugin.tool ?? {})).toHaveLength(19);
		expect(plugin.tool?.flow_audit_write_report).toBeDefined();
		expect(plugin.tool?.flow_audit_reports).toBeDefined();
	});
});
