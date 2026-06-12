import { afterEach, describe, expect, test } from "bun:test";
import {
	cleanupManagedTempDirs,
	createToolContext,
	importBuiltPlugin,
	makeManagedTempDir,
	requireTool,
} from "./helpers";

afterEach(() => {
	cleanupManagedTempDirs();
});

describe("cross-area resume flow", () => {
	test("re-importing dist preserves resumable state and closed sessions return missing_goal", async () => {
		const pluginFactory = await importBuiltPlugin();
		const worktree = makeManagedTempDir("flow-resume-cross-area-");
		const context = createToolContext(worktree);
		const plugin = await pluginFactory({ worktree } as Parameters<
			typeof pluginFactory
		>[0]);
		const tools = plugin.tool as Record<
			string,
			{ execute: (args: unknown, context: unknown) => Promise<string> }
		>;
		const flowPlanSave = requireTool(tools, "flow_plan_save");
		const flowPlanApprove = requireTool(tools, "flow_plan_approve");
		const flowRunStart = requireTool(tools, "flow_run_start");
		const flowStatus = requireTool(tools, "flow_status");

		const planStart = JSON.parse(
			await flowPlanSave.execute({ goal: "Resume the dist workflow" }, context),
		);
		await flowPlanSave.execute(
			{
				plan: {
					summary: "Resume after a reload.",
					overview: "Keep the built plugin state intact after re-import.",
					features: [
						{
							id: "resume-dist",
							title: "Resume dist session",
							summary: "Reload the bundle and keep state intact.",
							fileTargets: ["dist/index.js"],
							verification: ["bun test tests/cross-area/resume-flow.test.ts"],
						},
					],
				},
			},
			context,
		);
		await flowPlanApprove.execute({}, context);
		await flowRunStart.execute({}, context);

		const beforeReload = JSON.parse(await flowStatus.execute({}, context));
		const reloadedPluginFactory = await importBuiltPlugin();
		const reloadedPlugin = await reloadedPluginFactory({
			worktree,
		} as Parameters<typeof reloadedPluginFactory>[0]);
		const reloadedTools = reloadedPlugin.tool as Record<
			string,
			{ execute: (args: unknown, context: unknown) => Promise<string> }
		>;
		const reloadedStatus = requireTool(reloadedTools, "flow_status");
		const reloadedSession = requireTool(reloadedTools, "flow_session");
		const reloadedPlanSave = requireTool(reloadedTools, "flow_plan_save");

		const afterReload = JSON.parse(await reloadedStatus.execute({}, context));

		expect(reloadedPlugin).not.toBe(plugin);
		expect(reloadedTools).not.toBe(tools);
		expect(afterReload.session.id).toBe(planStart.session.id);
		expect(afterReload.session.goal).toBe("Resume the dist workflow");
		expect(afterReload.session.features).toEqual(beforeReload.session.features);
		expect(afterReload.session.nextCommand).toBe(
			beforeReload.session.nextCommand,
		);

		const closed = JSON.parse(
			await reloadedSession.execute(
				{ action: "close", kind: "abandoned" },
				context,
			),
		);
		expect(closed.status).toBe("ok");
		expect(closed.completedSessionId).toBe(planStart.session.id);

		const statusAfterClose = JSON.parse(
			await reloadedStatus.execute({}, context),
		);
		expect(statusAfterClose.status).toBe("missing");

		const missingGoal = JSON.parse(await reloadedPlanSave.execute({}, context));
		expect(missingGoal).toMatchObject({
			status: "missing_goal",
			nextCommand: "/flow-plan <goal>",
		});
	});
});
