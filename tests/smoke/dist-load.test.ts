import { afterEach, describe, expect, test } from "bun:test";
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
	| "flow_status"
	| "flow_plan_save"
	| "flow_plan_approve"
	| "flow_run_start"
	| "flow_feature_complete"
	| "flow_review_record"
	| "flow_session";
type FlowSmokeTools = Record<FlowToolName, TestTool>;

const originalHome = process.env.HOME;

afterEach(() => {
	process.env.HOME = originalHome;
	cleanupManagedTempDirs();
});

// Mirrors the generated OpenCode SDK: app.log is a prototype method that
// reads this._client and carries the entry in options.body. A plain-function
// fake hides both the unbound-call crash and a wrong payload shape.
type FlowLogBody = { service: string; level: string; message: string };
type FakePoster = {
	post: (options: { body: FlowLogBody } & Record<string, unknown>) => unknown;
};

class FakeSdkApp {
	entries: FlowLogBody[] = [];
	_client: FakePoster = {
		post: (options) => {
			this.entries.push(options.body);
			return Promise.resolve({});
		},
	};
	log(options: { client?: FakePoster; body: FlowLogBody }) {
		return (options?.client ?? this._client).post({
			url: "/log",
			...options,
		});
	}
}

describe("built dist smoke load", () => {
	test("dist bundle exposes one agent, five commands, and seven tools by default", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-");
		// Startup sync writes global skills/commands: keep it off the real HOME.
		process.env.HOME = makeManagedTempDir("flow-dist-home-");
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

		expect(Object.keys(config.agent ?? {})).toHaveLength(1);
		expect(Object.keys(config.command ?? {})).toHaveLength(5);
		const canonicalToolNames = [
			"flow_feature_complete",
			"flow_plan_approve",
			"flow_plan_save",
			"flow_review_record",
			"flow_run_start",
			"flow_session",
			"flow_status",
		];
		const registeredToolNames = Object.keys(plugin.tool ?? {}).sort();
		// The registered surface is exactly the canonical seven (the v2 compat
		// redirect stubs were removed in v3.1).
		expect(registeredToolNames).toEqual(canonicalToolNames);
		expect(registeredToolNames).toHaveLength(7);

		const context = createToolContext(worktree);
		const planSaveResponse = JSON.parse(
			await tools.flow_plan_save.execute(
				{ goal: "Optimize the Flow bundle" },
				context,
			),
		);
		expect(planSaveResponse.status).toBe("ok");
		expect(planSaveResponse.session.goal).toBe("Optimize the Flow bundle");
		const sessionId = planSaveResponse.session.id as string;

		const toolArgs: Record<FlowToolName, unknown> = {
			flow_status: {},
			flow_plan_save: {
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
			flow_run_start: {},
			flow_feature_complete: {
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
			flow_review_record: {
				scope: "feature",
				featureId: "dist-smoke",
				status: "approved",
				summary: "Looks good.",
			},
			flow_session: { action: "show", sessionId },
		};

		for (const [toolName, toolImpl] of Object.entries(tools)) {
			const response = await toolImpl.execute(
				toolArgs[toolName as FlowToolName] ?? {},
				context,
			);
			expect(typeof response).toBe("string");
			expect(() => JSON.parse(response)).not.toThrow();
		}
	});

	test("plugin init survives an SDK-shaped host client and logs through it", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-dist-worktree-");
		process.env.HOME = makeManagedTempDir("flow-dist-home-");
		const app = new FakeSdkApp();

		// Regression: detaching app.log (an unbound class method) crashed init
		// with "Cannot read properties of undefined (reading '_client')" and
		// OpenCode dropped the whole plugin — no tools, no config, no sync.
		const plugin = (await pluginFactory({
			worktree,
			client: { app },
		} as unknown as Parameters<PluginFactory>[0])) as BuiltPlugin;

		expect(Object.keys(plugin.tool ?? {})).toHaveLength(7);
		expect(app.entries.length).toBeGreaterThanOrEqual(1);
		expect(app.entries[0]).toEqual({
			service: "opencode-plugin-flow",
			level: "info",
			message: "Flow plugin initialized.",
		});
		expect(app.entries).toContainEqual({
			service: "opencode-plugin-flow",
			level: "info",
			message: "Creating Flow tool surface.",
		});
		expect(app.entries).not.toContain(undefined);
	});
});
