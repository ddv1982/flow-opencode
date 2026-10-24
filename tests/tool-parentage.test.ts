import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	FlowToolContext,
	FlowToolValue,
} from "../src/platform/opencode/flow-tool.js";
import {
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	registerFlowPluginInstance,
} from "../src/platform/opencode/leadership.js";
import { guardTools } from "../src/platform/opencode/tool-guard.js";

const workspace = await mkdtemp(join(tmpdir(), "flow-native-parentage-"));
afterAll(() => rm(workspace, { recursive: true, force: true }));
const context: FlowToolContext = {
	sessionID: "child",
	messageID: "assistant",
	callID: "call",
	agent: "general",
	directory: workspace,
	abort: new AbortController().signal,
};
const child = {
	id: "child",
	parentID: "parent",
	agent: "general",
	location: { directory: workspace },
};
const parent = {
	id: "parent",
	agent: "build",
	location: { directory: workspace },
};
const ok = { status: "ok", summary: "Executed.", workflowData: {} } as const;
function status(result: FlowToolValue) {
	return typeof result === "string" ? result : result.status;
}
async function run(
	name: string,
	agent: string,
	identity: unknown,
	input: unknown = {},
	readParent: unknown = parent,
) {
	let writes = 0;
	const runtime = registerFlowPluginInstance(workspace, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: name,
	});
	try {
		const tools = guardTools(
			{
				[name]: {
					description: "Guarded operation",
					input: { type: "object" },
					execute: async () => {
						writes++;
						return ok;
					},
				},
			},
			runtime,
			{ clear() {}, observeMutation() {} },
			async (id) => (id === "parent" ? readParent : identity),
		);
		const definition = tools[name];
		if (!definition) throw new Error("Missing guarded tool.");
		const output = await definition.execute(input, { ...context, agent });
		return { writes, status: status(output) };
	} finally {
		runtime.release();
	}
}

test.each([
	"flow_plan_save",
	"flow_plan_approve",
	"flow_plan_amend",
	"flow_run_start",
	"flow_review_start",
	"flow_feature_reset",
	"flow_session_close",
	"flow_validation_start",
])("native child cannot execute manager mutation %s", async (name) => {
	expect(await run(name, "general", child)).toEqual({
		writes: 0,
		status: "error",
	});
});
test.each([
	["missing", undefined],
	["wrong-id", { ...child, id: "other" }],
	["wrong-role", { ...parent, id: "child" }],
	["wrong-location", { ...child, location: { directory: tmpdir() } }],
	["v1-location", { id: "child", agent: "general", directory: workspace }],
] as const)("%s native identity fails closed", async (_name, identity) => {
	expect(await run("flow_run_start", "general", identity)).toEqual({
		writes: 0,
		status: "error",
	});
});
test("verified child may inspect status but may not request recovery authority", async () => {
	expect(
		await run("flow_status", "general", child, {
			request: { view: "reviewer-evidence" },
		}),
	).toEqual({ writes: 1, status: "ok" });
	expect(
		await run("flow_status", "general", child, { recoveryProposal: {} }),
	).toEqual({ writes: 0, status: "error" });
});
test.each(["flow-planner", "flow-worker"])(
	"%s cannot use Flow tools",
	async (agent) => {
		expect(await run("flow_status", agent, { ...child, agent })).toEqual({
			writes: 0,
			status: "error",
		});
	},
);
test.each([
	["generic-child", "general", child, parent, 0],
	[
		"reviewer-child",
		"flow-reviewer",
		{ ...child, agent: "flow-reviewer" },
		parent,
		1,
	],
	["primary-replay", "build", { ...parent, id: "child" }, parent, 1],
	[
		"primary-reviewer",
		"flow-reviewer",
		{ ...parent, id: "child", agent: "flow-reviewer" },
		parent,
		0,
	],
	[
		"nested-reviewer",
		"flow-reviewer",
		{ ...child, agent: "flow-reviewer" },
		{ ...parent, parentID: "grandparent" },
		1,
	],
	[
		"worker-parent",
		"flow-reviewer",
		{ ...child, agent: "flow-reviewer" },
		{ ...parent, agent: "flow-worker" },
		1,
	],
	[
		"wrong-parent-location",
		"flow-reviewer",
		{ ...child, agent: "flow-reviewer" },
		{ ...parent, location: { directory: tmpdir() } },
		1,
	],
] as const)(
	"completion origin %s permits verified reviewer children or primary replay",
	async (_name, agent, identity, root, writes) => {
		expect(
			await run("flow_feature_complete", agent, identity, {}, root),
		).toEqual({ writes, status: writes ? "ok" : "error" });
	},
);
test("canonical workspace aliases retain native authority", async () => {
	if (process.platform === "win32") return;
	const actual = join(workspace, "project"),
		alias = join(workspace, "alias");
	await mkdir(actual);
	await symlink(actual, alias, "dir");
	const runtime = registerFlowPluginInstance(actual, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "alias",
	});
	try {
		const tools = guardTools(
			{
				flow_run_start: {
					description: "Start",
					input: {},
					execute: async () => ok,
				},
			},
			runtime,
			{ clear() {}, observeMutation() {} },
			async () => ({
				id: "child",
				agent: "build",
				location: { directory: alias },
			}),
		);
		expect(
			await tools.flow_run_start?.execute(
				{},
				{ ...context, agent: "build", directory: actual },
			),
		).toEqual(ok);
	} finally {
		runtime.release();
	}
});
test("accepted mutation values notify continuation before host serialization", async () => {
	const runtime = registerFlowPluginInstance(workspace, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "mutation",
	});
	const mutations: unknown[][] = [];
	const value = {
		status: "ok",
		summary: "Started.",
		workflowData: {
			operation: { replayed: false },
			projection: { revision: 7, sessionId: "flow" },
		},
	} as const;
	try {
		const tools = guardTools(
			{
				flow_run_start: {
					description: "Start",
					input: {},
					execute: async () => value,
				},
			},
			runtime,
			{
				clear() {},
				observeMutation(...args) {
					mutations.push(args);
				},
			},
			async () => ({ ...parent, id: "child" }),
		);
		expect(
			await tools.flow_run_start?.execute({}, { ...context, agent: "build" }),
		).toEqual(value);
		expect(mutations).toEqual([
			["child", 7, undefined, "assistant", false, undefined],
		]);
	} finally {
		runtime.release();
	}
});

test("revocation during native identity lookup prevents the application mutation", async () => {
	const runtime = registerFlowPluginInstance(workspace, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "revoked",
	});
	let revoked = false,
		writes = 0;
	try {
		const tools = guardTools(
			{
				flow_run_start: {
					description: "Start",
					input: {},
					execute: async () => {
						writes++;
						return ok;
					},
				},
			},
			runtime,
			{ clear() {}, observeMutation() {} },
			async () => {
				revoked = true;
				return { ...parent, id: "child" };
			},
		);
		await expect(
			tools.flow_run_start?.execute(
				{},
				{
					...context,
					agent: "build",
					assertCurrent: async () => {
						if (revoked) throw new Error("revoked turn");
					},
				},
			),
		).rejects.toThrow("revoked turn");
		expect(writes).toBe(0);
	} finally {
		runtime.release();
	}
});

test.each([true, false])(
	"accepted mutation replay=%s only notifies on a new durable effect",
	async (replayed) => {
		const runtime = registerFlowPluginInstance(workspace, {
			packageName: "opencode-plugin-flow",
			version: "test",
			protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
			instanceId: "replay",
		});
		let mutations = 0;
		try {
			const tools = guardTools(
				{
					flow_session_close: {
						description: "Close",
						input: {},
						execute: async () => ({
							status: "error",
							summary: "Archive pending.",
							workflowData: {
								operation: { replayed },
								closeState: { durableAccepted: true },
								projection: { revision: 8 },
							},
						}),
					},
				},
				runtime,
				{
					clear() {},
					observeMutation() {
						mutations++;
					},
				},
				async () => ({ ...parent, id: "child" }),
			);
			const value = await tools.flow_session_close?.execute(
				{},
				{ ...context, agent: "build" },
			);
			expect(value).toMatchObject({
				status: "error",
				workflowData: { closeState: { durableAccepted: true } },
			});
			expect(mutations).toBe(replayed ? 0 : 1);
		} finally {
			runtime.release();
		}
	},
);

test("duplicate runtimes reject effects with the application envelope and guidance Markdown", async () => {
	const identity = {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
	};
	const first = registerFlowPluginInstance(workspace, {
		...identity,
		instanceId: "one",
	});
	const second = registerFlowPluginInstance(workspace, {
		...identity,
		instanceId: "two",
	});
	let effects = 0;
	const definition = {
		description: "Operation",
		input: {},
		execute: async () => {
			effects++;
			return ok;
		},
	};
	try {
		const tools = guardTools(
			{ flow_run_start: definition, flow_guidance: definition },
			first,
			{ clear() {}, observeMutation() {} },
			async () => parent,
		);
		expect(await tools.flow_run_start?.execute({}, context)).toMatchObject({
			status: "error",
			workflowData: { runtimeGuard: { reason: "duplicate-instances" } },
		});
		const guidance = await tools.flow_guidance?.execute({}, context);
		expect(typeof guidance === "string" && guidance).toContain("Recovery:");
		expect(effects).toBe(0);
	} finally {
		first.release();
		second.release();
	}
});

test("a verified reviewer child of a nonroot parent needs no parent lookup", async () => {
	const runtime = registerFlowPluginInstance(workspace, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "nested-reviewer",
	});
	const lookups: string[] = [];
	try {
		const tools = guardTools(
			{
				flow_feature_complete: {
					description: "Complete",
					input: {},
					execute: async () => ok,
				},
			},
			runtime,
			{ clear() {}, observeMutation() {} },
			async (id) => {
				lookups.push(id);
				if (id !== child.id)
					throw new Error(
						"Parent lookup is outside the reviewer-child contract.",
					);
				return { ...child, agent: "flow-reviewer", parentID: "nonroot-parent" };
			},
		);
		expect(
			await tools.flow_feature_complete?.execute(
				{},
				{ ...context, agent: "flow-reviewer" },
			),
		).toEqual(ok);
		expect(lookups).toEqual([child.id]);
	} finally {
		runtime.release();
	}
});
