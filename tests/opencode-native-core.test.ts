import { afterAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEditor } from "@opencode/plugin/promise/agent";
import type { ToolEditor } from "@opencode/plugin/promise/tool";
import { z } from "zod";
import {
	type FlowReviewerConfiguration,
	resolveFlowReviewerConfiguration,
} from "../src/config-shared.js";
import { registerFlowAgents } from "../src/platform/opencode/config.js";
import { defineFlowTool } from "../src/platform/opencode/flow-tool.js";
import {
	AbsolutePath,
	Agent,
	CallID,
	type NativeToolDefinition,
	Session,
	SessionMessage,
	type ToolContext,
} from "../src/platform/opencode/sdk.js";
import {
	createTools,
	registerFlowTools,
} from "../src/platform/opencode/tools.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";

const directory = await realpath(
	await mkdtemp(join(tmpdir(), "flow-native-core-")),
);
afterAll(() => rm(directory, { recursive: true, force: true }));
const context: ToolContext = {
	sessionID: Session.ID.make("ses_test"),
	messageID: SessionMessage.ID.make("msg_test"),
	agent: Agent.ID.make("build"),
	id: CallID.make("call_test"),
	signal: new AbortController().signal,
	progress: async () => {},
};
function registry() {
	const tools = new Map<string, NativeToolDefinition>();
	const editor: ToolEditor = {
		list: () => [...tools].map(([id, tool]) => ({ id, ...tool })),
		get: (id) => {
			const tool = tools.get(id);
			return tool ? { id, ...tool } : undefined;
		},
		namespace() {},
		add(tool) {
			tools.set(tool.name, tool);
		},
		update(id, update) {
			const tool = tools.get(id);
			if (tool) update(tool);
		},
		remove(id) {
			tools.delete(id);
		},
	};
	return {
		tools,
		require(name: string) {
			const definition = tools.get(name);
			if (!definition) throw new Error(`Missing native tool ${name}.`);
			return definition;
		},
		tool: {
			transform: async (apply: (editor: ToolEditor) => void) => {
				apply(editor);
				return {
					dispose: async () => {
						tools.clear();
					},
				};
			},
		},
	};
}
test("native registration preserves the response envelope, explicit permission resource, and native call identity", async () => {
	const host = registry(),
		steps: unknown[] = [];
	const envelope = {
		status: "ok",
		summary: "Applied.",
		workflowData: { revision: 3 },
	} as const;
	const registration = await registerFlowTools(
		{
			...host,
			location: { directory: AbsolutePath.make(directory) },
			permission: {
				assert: async (input) => {
					steps.push({
						action: input.action,
						resources: input.resources,
						source: input.source,
					});
				},
			},
		},
		{
			flow_run_start: defineFlowTool({
				description: "Start",
				schema: z.object({ request: z.object({ featureId: z.string() }) }),
				execute: async (_input, internal) => {
					steps.push({
						callID: internal.callID,
						directory: internal.directory,
					});
					return envelope;
				},
			}),
		},
		async (native) => {
			steps.push({ nativeID: native.id });
		},
	);
	const result = await host
		.require("flow_run_start")
		.execute({ request: { featureId: "feature" } }, context);
	expect(result).toEqual({
		content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
	});
	expect(steps).toEqual([
		{
			action: "flow_run_start",
			resources: ["feature"],
			source: { type: "tool", messageID: "msg_test", id: "call_test" },
		},
		{ nativeID: "call_test" },
		{ callID: "call_test", directory },
	]);
	expect(host.tools.get("flow_run_start")?.options).toEqual({
		codemode: false,
		permission: "flow_run_start",
	});
	await registration.dispose();
	expect(host.tools.size).toBe(0);
});
test.each(["permission", "causality", "abort"])(
	"%s refusal prevents the Flow effect",
	async (refusal) => {
		const host = registry();
		let effects = 0;
		await registerFlowTools(
			{
				...host,
				location: { directory: AbsolutePath.make(directory) },
				permission: {
					assert: async () => {
						if (refusal === "permission")
							throw new Error("permission rejected");
					},
				},
			},
			{
				flow_run_start: {
					description: "Start",
					input: { type: "object" },
					execute: async () => {
						effects++;
						return "effect";
					},
				},
			},
			async () => {
				if (refusal === "causality") throw new Error("unproven request");
			},
		);
		const controller = new AbortController();
		controller.abort();
		await expect(
			host
				.require("flow_run_start")
				.execute(
					{},
					refusal === "abort"
						? { ...context, signal: controller.signal }
						: context,
				),
		).rejects.toThrow();
		expect(effects).toBe(0);
	},
);
test("guidance remains Markdown inside structured native content", async () => {
	const host = registry();
	const tools = createTools({
		validation: new ValidationCaptureCoordinator({
			readSession: async () => undefined,
			persistObservation: async () => {
				throw new Error("unused");
			},
		}),
		prepareValidation: async () => {
			throw new Error("unused");
		},
	});
	await registerFlowTools(
		{
			...host,
			location: { directory: AbsolutePath.make(directory) },
			permission: { assert: async () => {} },
		},
		tools,
		async () => {},
	);
	const value = await host
		.require("flow_guidance")
		.execute({ id: "flow" }, context);
	const content = value.content;
	expect(
		Array.isArray(content) && content[0]?.type === "text" && content[0].text,
	).toContain("#");
	expect(
		Array.isArray(content) &&
			content[0]?.type === "text" &&
			content[0].text.startsWith("{"),
	).toBe(false);
});
test("native execution parses application refinements before any workspace effect", async () => {
	const host = registry();
	const tools = createTools({
		validation: new ValidationCaptureCoordinator({
			readSession: async () => undefined,
			persistObservation: async () => {
				throw new Error("unused");
			},
		}),
		prepareValidation: async () => {
			throw new Error("unused");
		},
	});
	await registerFlowTools(
		{
			...host,
			location: { directory: AbsolutePath.make(directory) },
			permission: { assert: async () => {} },
		},
		tools,
		async () => {},
	);
	await expect(
		host.require("flow_plan_save").execute(
			{
				request: {
					goal: "🧪".repeat(8193),
					operationId: "op",
					expectedRevision: 0,
					plan: { summary: "Plan", features: [] },
				},
			},
			context,
		),
	).rejects.toThrow();
});
test("replayed native agent transforms create missing roles and read the latest preference state", async () => {
	const agents = new Map<string, NonNullable<ReturnType<AgentEditor["get"]>>>();
	const editor: AgentEditor = {
		list: () => [...agents.values()],
		get: (id) => agents.get(id),
		default() {},
		remove(id) {
			agents.delete(id);
		},
		update(id, update) {
			const value = agents.get(id) ?? Agent.Info.default(Agent.ID.make(id));
			update(value);
			agents.set(id, value);
		},
	};
	let replay = (_editor: AgentEditor): void => {
		throw new Error("unregistered");
	};
	let planning: string | undefined;
	let reviewer: FlowReviewerConfiguration = resolveFlowReviewerConfiguration({
		env: {},
		pluginOptions: {
			reviewer: { model: "provider/original", variant: "high", steps: 42 },
		},
	});
	await registerFlowAgents(
		{
			agent: {
				transform: async (apply) => {
					replay = apply;
					apply(editor);
					return { dispose: async () => {} };
				},
			},
		},
		{
			assertOperational() {},
			readPlanningModel: () => planning,
			readReviewerConfiguration: () => reviewer,
		},
	);
	expect([...agents.keys()]).toEqual(["flow-reviewer", "flow-worker"]);
	expect(agents.get("flow-reviewer")).toMatchObject({
		mode: "subagent",
		hidden: true,
		model: { providerID: "provider", id: "original", variant: "high" },
		steps: 42,
	});
	planning = "provider/planning";
	reviewer = {
		...reviewer,
		model: { kind: "explicit", source: "picker", value: "provider/picked" },
		variant: undefined,
	};
	replay(editor);
	expect<unknown>(agents.get("flow-planner")?.model).toEqual({
		providerID: "provider",
		id: "planning",
	});
	expect<unknown>(agents.get("flow-reviewer")?.model).toEqual({
		providerID: "provider",
		id: "picked",
	});
	reviewer = resolveFlowReviewerConfiguration({
		env: {},
		pluginOptions: {
			reviewer: { model: "provider/original", variant: "high", steps: 42 },
		},
	});
	planning = undefined;
	replay(editor);
	expect(agents.get("flow-planner")).toBeUndefined();
	expect<unknown>(agents.get("flow-reviewer")?.model).toEqual({
		providerID: "provider",
		id: "original",
		variant: "high",
	});
	expect(agents.get("flow-reviewer")?.steps).toBe(42);
});

test("unsupported continuation describes native request attribution", async () => {
	const tools = createTools({
		validation: new ValidationCaptureCoordinator({
			readSession: async () => undefined,
			persistObservation: async () => {
				throw new Error("unused");
			},
		}),
		prepareValidation: async () => {
			throw new Error("unused");
		},
		autoContinuationSupport: () => "unsupported",
	});
	const value = await tools.flow_status?.execute(
		{ request: { view: "compact" } },
		{
			sessionID: "ses_test",
			messageID: "msg_test",
			callID: "call_test",
			agent: "build",
			directory,
			abort: context.signal,
		},
	);
	expect(value).toMatchObject({
		workflowData: {
			autoContinuation: {
				scope: "current-plugin-process",
				support: "unsupported",
				reason: "host-request-attribution-unavailable",
				recovery: "Drive each feature with /flow-run.",
			},
		},
	});
});
