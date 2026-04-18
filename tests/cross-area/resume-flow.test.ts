import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
	test("re-importing dist preserves resumable state and completed sessions return missing_goal", async () => {
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
		const flowPlanStart = requireTool(tools, "flow_plan_start");
		const flowPlanApply = requireTool(tools, "flow_plan_apply");
		const flowPlanApprove = requireTool(tools, "flow_plan_approve");
		const flowRunStart = requireTool(tools, "flow_run_start");
		const flowStatus = requireTool(tools, "flow_status");

		const planStart = JSON.parse(
			await flowPlanStart.execute(
				{ goal: "Resume the dist workflow" },
				context,
			),
		);
		await flowPlanApply.execute(
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
		const reloadedAutoPrepare = requireTool(reloadedTools, "flow_auto_prepare");
		const reloadedStatus = requireTool(reloadedTools, "flow_status");

		const resumed = JSON.parse(
			await reloadedAutoPrepare.execute({ argumentString: "" }, context),
		);
		const afterReload = JSON.parse(await reloadedStatus.execute({}, context));

		expect(resumed).toMatchObject({
			status: "ok",
			mode: "resume",
			goal: "Resume the dist workflow",
			nextCommand: "/flow-auto resume",
		});
		expect(afterReload.session.features).toEqual(beforeReload.session.features);
		expect(afterReload.session.nextCommand).toBe(
			beforeReload.session.nextCommand,
		);

		const sessionPath = join(
			worktree,
			".flow",
			"sessions",
			planStart.session.id,
			"session.json",
		);
		const session = JSON.parse(await readFile(sessionPath, "utf8"));
		session.status = "completed";
		session.timestamps.completedAt = "2026-01-01T00:00:00.000Z";
		await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");

		const completedResume = JSON.parse(
			await reloadedAutoPrepare.execute({ argumentString: "" }, context),
		);
		expect(completedResume).toMatchObject({
			status: "missing_goal",
			nextCommand: "/flow-auto <goal>",
		});
	});
});
