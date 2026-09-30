import { expect, test } from "bun:test";
import { AutoDriveCoordinator } from "../src/platform/opencode/auto-drive.js";
import {
	FLOW_LEADERSHIP_PROTOCOL_VERSION,
	registerFlowPluginInstance,
} from "../src/platform/opencode/leadership.js";
import { type ToolContext, tool } from "../src/platform/opencode/sdk.js";
import { guardTools } from "../src/platform/opencode/tool-guard.js";

const nativeChild = {
	id: "ses_f0e0474aaffeL2LJokocWs5MFT",
	parentID: "ses_f0e048715ffezsym7a0HCdd9dE",
	directory: "/fixture",
};
const context: ToolContext = {
	sessionID: nativeChild.id,
	messageID: "child-assistant",
	agent: "general",
	directory: "/fixture",
	worktree: "/fixture",
	abort: new AbortController().signal,
	metadata() {},
	async ask() {},
};

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
	let calls = 0;
	const leadership = registerFlowPluginInstance("/parentage-fixture-" + name, {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: name,
	});
	try {
		const auto = new AutoDriveCoordinator({
			readProjection: async () => ({
				status: "idle",
				revision: 0,
				nextAction: "flow_plan_save",
			}),
			prompt: async () => {},
		});
		const tools = guardTools(
			{
				[name]: tool({
					description: "Native child mutation control",
					args: {},
					execute: async () => {
						calls++;
						return JSON.stringify({ status: "ok" });
					},
				}),
			},
			leadership,
			auto,
			async () => nativeChild,
		);
		const result = JSON.parse(String(await tools[name]!.execute({}, context)));
		expect(result.status).toBe("error");
		expect(calls).toBe(0);
	} finally {
		leadership.release();
	}
});

test.each([
	["missing", async (): Promise<unknown> => undefined],
	[
		"wrong-id",
		async () => ({ id: "different-host", directory: context.directory }),
	],
	[
		"wrong-directory",
		async () => ({ id: context.sessionID, directory: "/another-project" }),
	],
	[
		"failed",
		async () => {
			throw new Error("Native session lookup failed");
		},
	],
] as const)(
	"%s native parentage fails closed before mutation",
	async (_name, readSession) => {
		const leadership = registerFlowPluginInstance(
			"/parentage-unknown-" + _name,
			{
				packageName: "opencode-plugin-flow",
				version: "test",
				protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
				instanceId: _name,
			},
		);
		try {
			let writes = 0;
			const auto = new AutoDriveCoordinator({
				readProjection: async () => ({
					status: "idle",
					revision: 0,
					nextAction: "flow_plan_save",
				}),
				prompt: async () => {},
			});
			const tools = guardTools(
				{
					flow_run_start: tool({
						description: "Mutation",
						args: {},
						execute: async () => {
							writes++;
							return "ok";
						},
					}),
				},
				leadership,
				auto,
				readSession,
			);
			expect(
				JSON.parse(String(await tools.flow_run_start!.execute({}, context)))
					.status,
			).toBe("error");
			expect(writes).toBe(0);
		} finally {
			leadership.release();
		}
	},
);

test("native children retain readonly status but cannot request recovery advice", async () => {
	const leadership = registerFlowPluginInstance("/parentage-readonly", {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "readonly",
	});
	try {
		let calls = 0,
			lookups = 0;
		const auto = new AutoDriveCoordinator({
			readProjection: async () => ({
				status: "idle",
				revision: 0,
				nextAction: "flow_plan_save",
			}),
			prompt: async () => {},
		});
		const tools = guardTools(
			{
				flow_status: tool({
					description: "Status",
					args: {},
					execute: async () => {
						calls++;
						return JSON.stringify({ status: "ok" });
					},
				}),
			},
			leadership,
			auto,
			async () => {
				lookups++;
				return nativeChild;
			},
		);
		expect(
			JSON.parse(
				String(
					await tools.flow_status!.execute(
						{ request: { view: "reviewer-evidence" } },
						context,
					),
				),
			).status,
		).toBe("ok");
		expect(lookups).toBe(0);
		expect(
			JSON.parse(
				String(
					await tools.flow_status!.execute({ recoveryProposal: {} }, context),
				),
			).status,
		).toBe("error");
		expect(calls).toBe(1);
	} finally {
		leadership.release();
	}
});

test("another verified primary native host can reach existing manual recovery policy", async () => {
	const leadership = registerFlowPluginInstance("/parentage-primary", {
		packageName: "opencode-plugin-flow",
		version: "test",
		protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
		instanceId: "primary",
	});
	try {
		let calls = 0;
		const auto = new AutoDriveCoordinator({
			readProjection: async () => ({
				status: "idle",
				revision: 0,
				nextAction: "flow_plan_save",
			}),
			prompt: async () => {},
		});
		const tools = guardTools(
			{
				flow_feature_reset: tool({
					description: "Reset",
					args: {},
					execute: async () => {
						calls++;
						return JSON.stringify({ status: "ok" });
					},
				}),
			},
			leadership,
			auto,
			async (id) => ({ id, directory: context.directory }),
		);
		expect(
			JSON.parse(
				String(
					await tools.flow_feature_reset!.execute(
						{},
						{ ...context, sessionID: "other-primary" },
					),
				),
			).status,
		).toBe("ok");
		expect(calls).toBe(1);
	} finally {
		leadership.release();
	}
});

test.each([
	["generic-child", { ...nativeChild }, "general", 0],
	["reviewer-child", { ...nativeChild }, "flow-reviewer", 1],
	[
		"primary-replay",
		{ id: context.sessionID, directory: context.directory },
		"build",
		1,
	],
	[
		"primary-reviewer",
		{ id: context.sessionID, directory: context.directory },
		"flow-reviewer",
		0,
	],
	["unknown", undefined, "flow-reviewer", 0],
	[
		"invalid-directory",
		{ ...nativeChild, directory: "/another-project" },
		"flow-reviewer",
		0,
	],
] as const)(
	"completion origin %s preserves only reviewer submission or primary replay",
	async (name, identity, agent, expected) => {
		const leadership = registerFlowPluginInstance(
			"/completion-origin-" + name,
			{
				packageName: "opencode-plugin-flow",
				version: "test",
				protocolVersion: FLOW_LEADERSHIP_PROTOCOL_VERSION,
				instanceId: name,
			},
		);
		try {
			let calls = 0;
			const auto = new AutoDriveCoordinator({
				readProjection: async () => ({
					status: "idle",
					revision: 0,
					nextAction: "flow_plan_save",
				}),
				prompt: async () => {},
			});
			const tools = guardTools(
				{
					flow_feature_complete: tool({
						description: "Existing application submission/replay boundary",
						args: {},
						execute: async () => {
							calls++;
							return JSON.stringify({ status: "ok" });
						},
					}),
				},
				leadership,
				auto,
				async () => identity,
			);
			const result = JSON.parse(
				String(
					await tools.flow_feature_complete!.execute({}, { ...context, agent }),
				),
			);
			expect(calls).toBe(expected);
			expect(result.status).toBe(expected === 1 ? "ok" : "error");
		} finally {
			leadership.release();
		}
	},
);
