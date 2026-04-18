import { describe, expect, test } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import { applyFlowConfig, createConfigHook } from "../src/config";
import FlowPlugin from "../src/index";
import {
	FLOW_AUTO_AGENT_PROMPT,
	FLOW_REVIEWER_AGENT_PROMPT,
	FLOW_WORKER_AGENT_PROMPT,
} from "../src/prompts/agents";
import {
	FLOW_AUTO_COMMAND_TEMPLATE,
	FLOW_RUN_COMMAND_TEMPLATE,
} from "../src/prompts/commands";
import {
	FLOW_REVIEWER_CONTRACT,
	FLOW_WORKER_CONTRACT,
} from "../src/prompts/contracts";
import { WorkerResultSchema } from "../src/runtime/schema";
import { createTools } from "../src/tools";

type AgentTools = {
	edit?: boolean;
	write?: boolean;
	bash?: boolean;
};

type AgentPermission = {
	edit?: string;
	bash?: string;
};

type AgentConfigShape = {
	mode?: string;
	description?: string;
	prompt?: string;
	tools?: AgentTools;
	permission?: AgentPermission;
	[key: string]: unknown;
};

type CommandConfigShape = {
	description?: string;
	agent?: string;
	template?: string;
	[key: string]: unknown;
};

type MutableConfig = {
	agent?: Record<string, AgentConfigShape>;
	command?: Record<string, CommandConfigShape>;
};

type ToolDefinition = {
	args: Record<string, unknown>;
};

type FlowPluginHooks = {
	hooks?: Record<string, unknown>;
};

type ToolSchemas = Record<
	keyof ReturnType<typeof createTools>,
	ReturnType<typeof tool.schema.object>
>;

function getToolSchemas() {
	const tools = createTools({}) as unknown as Record<string, ToolDefinition>;

	return {
		tools,
		schemas: Object.fromEntries(
			Object.entries(tools).map(([name, definition]) => [
				name,
				tool.schema.object(definition.args),
			]),
		) as ToolSchemas,
	};
}

function expectInOrder(content: string, snippets: string[]) {
	let previousIndex = -1;

	for (const snippet of snippets) {
		const index = content.indexOf(snippet);

		expect(index).toBeGreaterThan(-1);
		expect(index).toBeGreaterThan(previousIndex);
		previousIndex = index;
	}
}

function expectNoFlowManagedCompaction(content: string) {
	const normalized = content.toLowerCase();

	expect(normalized).not.toContain("compaction");
	expect(normalized).not.toContain("token accounting");
	expect(normalized).not.toContain("token measurement");
}

describe("applyFlowConfig", () => {
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
			"flow_history",
			"flow_history_show",
			"flow_session_activate",
			"flow_plan_start",
			"flow_auto_prepare",
			"flow_reset_session",
			"flow_plan_apply",
			"flow_plan_approve",
			"flow_plan_select_features",
			"flow_run_start",
			"flow_run_complete_feature",
			"flow_review_record_feature",
			"flow_review_record_final",
			"flow_reset_feature",
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
		expect(config.command?.["flow-status"]).toBeDefined();
		expect(config.command?.["flow-history"]).toBeDefined();
		expect(config.command?.["flow-session"]).toBeDefined();
		expect(config.command?.["flow-reset"]).toBeDefined();
	});

	test("routes status, history, session activation, and reset through the control agent", () => {
		const config: MutableConfig = {};
		applyFlowConfig(config);

		expect(config.command?.["flow-status"]?.agent).toBe("flow-control");
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
		expect(config.command?.["flow-history"]).toBeDefined();
		expect(config.command?.["flow-session"]).toBeDefined();
		expect(config.command?.["flow-reset"]).toBeDefined();
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

	test("exports sdk-compatible raw arg shapes for every tool", () => {
		const { tools, schemas } = getToolSchemas();

		for (const [name, definition] of Object.entries(tools)) {
			expect(definition).toBeDefined();
			expect(typeof definition.args).toBe("object");
			expect(definition.args).not.toBeNull();

			for (const [field, value] of Object.entries(definition.args)) {
				expect(field.length).toBeGreaterThan(0);
				expect(typeof value).toBe("object");
				expect(value).not.toBeNull();
			}

			expect(schemas[name as keyof typeof schemas]).toBeDefined();

			expect(name.length).toBeGreaterThan(0);
		}
	});

	test("non-worker tool schemas accept representative valid payloads and reject invalid ones", () => {
		const { schemas } = getToolSchemas();

		expect(schemas.flow_status.safeParse({}).success).toBe(true);
		expect(schemas.flow_status.safeParse({ extra: true }).success).toBe(true);
		expect(schemas.flow_history.safeParse({}).success).toBe(true);
		expect(schemas.flow_history.safeParse({ extra: true }).success).toBe(true);
		expect(
			schemas.flow_history_show.safeParse({ sessionId: "abc123" }).success,
		).toBe(true);
		expect(schemas.flow_history_show.safeParse({}).success).toBe(false);
		expect(
			schemas.flow_session_activate.safeParse({ sessionId: "abc123" }).success,
		).toBe(true);
		expect(schemas.flow_session_activate.safeParse({}).success).toBe(false);

		expect(
			schemas.flow_plan_start.safeParse({ goal: "Build a workflow plugin" })
				.success,
		).toBe(true);
		expect(schemas.flow_plan_start.safeParse({ goal: 123 }).success).toBe(
			false,
		);

		expect(
			schemas.flow_plan_apply.safeParse({
				plan: {
					summary: "Implement a workflow.",
					overview: "Create one feature.",
					features: [
						{
							id: "setup-runtime",
							title: "Create runtime helpers",
							summary: "Add runtime helpers.",
							fileTargets: ["src/runtime/session.ts"],
							verification: ["bun test"],
						},
					],
				},
			}).success,
		).toBe(true);
		expect(
			schemas.flow_plan_apply.safeParse({ plan: { summary: "Missing fields" } })
				.success,
		).toBe(false);

		expect(
			schemas.flow_plan_approve.safeParse({ featureIds: ["setup-runtime"] })
				.success,
		).toBe(true);
		expect(
			schemas.flow_plan_approve.safeParse({ featureIds: [1] }).success,
		).toBe(false);

		expect(
			schemas.flow_plan_select_features.safeParse({
				featureIds: ["setup-runtime"],
			}).success,
		).toBe(true);
		expect(schemas.flow_plan_select_features.safeParse({}).success).toBe(false);

		expect(
			schemas.flow_run_start.safeParse({ featureId: "setup-runtime" }).success,
		).toBe(true);
		expect(schemas.flow_run_start.safeParse({ featureId: 1 }).success).toBe(
			false,
		);

		expect(
			schemas.flow_review_record_feature.safeParse({
				scope: "feature",
				featureId: "setup-runtime",
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(true);
		expect(
			schemas.flow_review_record_feature.safeParse({
				scope: "feature",
				status: "approved",
				summary: "Missing id.",
			}).success,
		).toBe(false);
		expect(
			schemas.flow_review_record_final.safeParse({
				scope: "final",
				status: "approved",
				summary: "Looks good.",
			}).success,
		).toBe(true);
		expect(
			schemas.flow_review_record_final.safeParse({
				scope: "bad",
				summary: "Nope.",
				status: "approved",
			}).success,
		).toBe(false);

		expect(schemas.flow_reset_session.safeParse({}).success).toBe(true);
		expect(
			schemas.flow_reset_session.safeParse({ anything: true }).success,
		).toBe(true);
		expect(
			schemas.flow_reset_feature.safeParse({ featureId: "setup-runtime" })
				.success,
		).toBe(true);
		expect(schemas.flow_reset_feature.safeParse({}).success).toBe(false);
		expect(
			schemas.flow_reset_feature.safeParse({ featureId: "Bad Id" }).success,
		).toBe(false);
	});

	test("worker tool raw args accept the documented top-level payload and reject the old nested shape", () => {
		const { schemas } = getToolSchemas();
		const schema = schemas.flow_run_complete_feature;

		const validPayload = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		const invalidNestedPayload = {
			contractVersion: "1",
			result: validPayload,
		};

		expect(schema.safeParse(validPayload).success).toBe(true);
		expect(schema.safeParse(invalidNestedPayload).success).toBe(false);
	});

	test("worker tool raw schema stays structurally aligned while runtime schema enforces stricter cross-field rules", () => {
		const { schemas } = getToolSchemas();
		const rawSchema = schemas.flow_run_complete_feature;

		const validCompletion = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "passed",
			},
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		const invalidCrossField = {
			contractVersion: "1",
			status: "needs_input",
			summary: "Waiting on input.",
			artifactsChanged: [],
			validationRun: [],
			decisions: [],
			nextStep: "Ask the operator.",
			outcome: { kind: "completed" },
			featureResult: {
				featureId: "setup-runtime",
				verificationStatus: "not_recorded",
			},
			featureReview: {
				status: "needs_followup",
				summary: "Blocked.",
				blockingFindings: [],
			},
		};

		expect(rawSchema.safeParse(validCompletion).success).toBe(true);
		expect(WorkerResultSchema.safeParse(validCompletion).success).toBe(true);

		expect(rawSchema.safeParse(invalidCrossField).success).toBe(true);
		expect(WorkerResultSchema.safeParse(invalidCrossField).success).toBe(false);
	});

	test("worker tool raw schema rejects invalid feature ids in featureResult", () => {
		const { schemas } = getToolSchemas();
		const rawSchema = schemas.flow_run_complete_feature;

		const invalidFeatureId = {
			contractVersion: "1",
			status: "ok",
			summary: "Completed runtime setup.",
			artifactsChanged: [],
			validationRun: [],
			validationScope: "targeted",
			reviewIterations: 1,
			decisions: [],
			nextStep: "Run the next feature.",
			outcome: { kind: "completed" },
			featureResult: { featureId: "Bad Id", verificationStatus: "passed" },
			featureReview: {
				status: "passed",
				summary: "Looks good.",
				blockingFindings: [],
			},
		};

		expect(rawSchema.safeParse(invalidFeatureId).success).toBe(false);
		expect(WorkerResultSchema.safeParse(invalidFeatureId).success).toBe(false);
	});

	test("planning tool schema matches runtime feature id format constraints", () => {
		const { schemas } = getToolSchemas();

		const validPlan = {
			plan: {
				summary: "Implement a workflow.",
				overview: "Create one feature.",
				features: [
					{
						id: "setup-runtime",
						title: "Create runtime helpers",
						summary: "Add runtime helpers.",
						fileTargets: ["src/runtime/session.ts"],
						verification: ["bun test"],
					},
				],
			},
		};

		const invalidPlan = {
			plan: {
				...validPlan.plan,
				features: [
					{
						...validPlan.plan.features[0],
						id: "Bad Id",
					},
				],
			},
		};

		expect(schemas.flow_plan_apply.safeParse(validPlan).success).toBe(true);
		expect(schemas.flow_plan_apply.safeParse(invalidPlan).success).toBe(false);
	});

	test("worker contract requires clean review before ok completion", () => {
		expect(FLOW_WORKER_CONTRACT).toContain(
			"never return status: ok until targeted validation is complete and featureReview has no blocking findings",
		);
		expect(FLOW_WORKER_CONTRACT).toContain("validationScope: broad");
		expect(FLOW_WORKER_CONTRACT).toContain("reviewIterations");
		expect(FLOW_WORKER_CONTRACT).toContain(
			"final completion path for the session",
		);
	});

	test("worker prompt requires iterative review and fix loops", () => {
		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"Do not complete a feature while review findings remain",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"fix them, rerun targeted validation, and review again",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain(
			"how many review/fix iterations were needed",
		);
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_feature");
		expect(FLOW_WORKER_AGENT_PROMPT).toContain("flow_review_record_final");
	});

	test("reviewer contract and prompt require explicit approval gating", () => {
		expect(FLOW_REVIEWER_CONTRACT).toContain(
			"status: approved | needs_fix | blocked",
		);
		expect(FLOW_REVIEWER_CONTRACT).toContain("scope: feature | final");
		expect(FLOW_REVIEWER_CONTRACT).toContain(
			"return approved only when the current feature is clean enough to advance",
		);
		expect(FLOW_REVIEWER_AGENT_PROMPT).toContain("Do not write code");
		expect(FLOW_REVIEWER_AGENT_PROMPT).toContain(
			"Return needs_fix when the current feature should continue",
		);
	});

	test("auto prompt requires broad final validation before session completion", () => {
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"Never advance to the next feature while the current feature still has review findings",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"treat the command as resume-only",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"stop and request a goal instead of creating one",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"Call flow_auto_prepare with the raw command argument string before planning or repo inspection",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"If flow_auto_prepare returns missing_goal, render that result clearly and stop",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("run broad repo validation");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain("rerun broad validation");
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"Use the flow-reviewer stage as the approval gate",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"Persist every reviewer decision through flow_review_record_feature or flow_review_record_final",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"If the reviewer returns needs_fix",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"If flow_run_complete_feature fails, inspect the runtime error and any structured recovery metadata",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"If a feature lands in a blocked state with a retryable or auto-resolvable outcome",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"satisfy `recovery.prerequisite` first",
		);
		expect(FLOW_AUTO_AGENT_PROMPT).toContain(
			"Only call `recovery.nextRuntimeTool` when it is present",
		);
	});

	test("auto command template requires final cross-feature review before completion", () => {
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain(
			"resume the active session only",
		);
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain(
			"If no active session exists, stop and request a goal",
		);
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain(
			"Do not derive, infer, or invent a new goal from repository inspection",
		);
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain(
			"Call `flow_auto_prepare` first",
		);
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("final cross-feature review");
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("passing `finalReview`");
		expect(FLOW_AUTO_COMMAND_TEMPLATE).toContain("completion gating failures");
	});

	test("auto command template keeps classification guardrails ahead of iterative execution guidance", () => {
		expectInOrder(FLOW_AUTO_COMMAND_TEMPLATE, [
			"Treat this command as a coordinator entrypoint",
			"Call `flow_auto_prepare` first",
			"If the argument string is non-empty and not `resume`",
			"If the argument string is empty or `resume`",
			"Do not derive, infer, or invent a new goal from repository inspection",
			"Plan or refresh only when the runtime says planning is needed",
			"Treat runtime contract errors, completion gating failures, and failing validation as work to resolve, not stop conditions.",
		]);
	});

	test("auto command template keeps stable coordinator guidance ahead of volatile arguments", () => {
		expectInOrder(FLOW_AUTO_COMMAND_TEMPLATE, [
			"Behavior:",
			"Treat this command as a coordinator entrypoint",
			"End with the latest runtime summary.",
			"Arguments: $ARGUMENTS",
		]);
	});

	test("run command template requires final completion gating for the last feature", () => {
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("flow_review_record_final");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("passing `finalReview`");
		expect(FLOW_RUN_COMMAND_TEMPLATE).toContain("broad validation");
	});

	test("run command template keeps final completion gating after feature review approval", () => {
		expectInOrder(FLOW_RUN_COMMAND_TEMPLATE, [
			"run targeted validation",
			"obtain reviewer approval through `flow_review_record_feature`",
			"On the final completion path, run broad validation",
			"obtain final approval through `flow_review_record_final`",
			"persist the result through `flow_run_complete_feature`",
		]);
	});

	test("flow prompts and command templates avoid Flow-managed compaction guidance", () => {
		expectNoFlowManagedCompaction(FLOW_AUTO_AGENT_PROMPT);
		expectNoFlowManagedCompaction(FLOW_WORKER_AGENT_PROMPT);
		expectNoFlowManagedCompaction(FLOW_AUTO_COMMAND_TEMPLATE);
		expectNoFlowManagedCompaction(FLOW_RUN_COMMAND_TEMPLATE);
	});
});
