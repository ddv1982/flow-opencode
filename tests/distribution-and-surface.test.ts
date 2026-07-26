import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import { createFlowCoreConfigEntries } from "../src/config-shared.js";
import {
	FLOW_GUIDANCE_IDS,
	FLOW_MANAGER_KERNEL,
	getFlowGuidance,
} from "../src/guidance/catalog.js";
import FlowPlugin from "../src/index.js";
import { FLOW_AUTO_METADATA_KEY } from "../src/platform/opencode/auto-drive.js";
import { createTools } from "../src/platform/opencode/tools.js";
import { plan } from "./runtime-test-support.js";

const TOOL_NAMES = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
] as const;

const COMMAND_NAMES = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
] as const;

function createRegisteredTools() {
	return createTools(
		{},
		{
			validation: {} as never,
			prepareValidation: async () => {
				throw new Error(
					"Validation execution is outside this structural test.",
				);
			},
		},
	);
}

function pluginContext(
	workspace: string,
	directory = workspace,
	promptCalls?: unknown[],
) {
	return {
		client: {
			app: { log() {} },
			session: {
				promptAsync(input: unknown) {
					promptCalls?.push(input);
					return Promise.resolve({ data: undefined });
				},
				messages() {
					return Promise.resolve({
						data: [
							{
								info: {
									id: "host-compaction-user",
									role: "user",
								},
								parts: [],
							},
						],
					});
				},
				message(input: unknown) {
					const messageID = (input as { path: { messageID: string } }).path
						.messageID;
					const parentID = messageID.startsWith("assistant:")
						? messageID.slice("assistant:".length)
						: null;
					return Promise.resolve({
						data: parentID
							? { info: { role: "assistant", parentID } }
							: undefined,
					});
				},
			},
		},
		project: {},
		directory,
		worktree: workspace,
		experimental_workspace: { register() {} },
		serverUrl: new URL("http://localhost"),
		$: {},
	} as unknown as Parameters<typeof FlowPlugin>[0];
}

function toolContext(
	workspace: string,
	sessionID = "surface-test-session",
	parentMessageID?: string,
): ToolContext {
	return {
		sessionID,
		messageID: parentMessageID
			? `assistant:${parentMessageID}`
			: "surface-test-message",
		agent: "build",
		directory: workspace,
		worktree: workspace,
		abort: new AbortController().signal,
		metadata() {},
		async ask() {},
	};
}

function expectExactlyOnce(text: string, fragment: string): void {
	expect(text.split(fragment)).toHaveLength(2);
}

type PluginHooks = Awaited<ReturnType<typeof FlowPlugin>>;
const activeHooks: PluginHooks[] = [];
const activeWorkspaces: string[] = [];

async function createTestWorkspace(prefix: string): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), prefix));
	activeWorkspaces.push(workspace);
	return workspace;
}

async function loadPlugin(
	workspace: string,
	directory = workspace,
	promptCalls?: unknown[],
): Promise<PluginHooks> {
	const hooks = await FlowPlugin(
		pluginContext(workspace, directory, promptCalls),
	);
	activeHooks.push(hooks);
	return hooks;
}
async function emitMessage(
	hooks: PluginHooks,
	info: Record<string, unknown>,
): Promise<void> {
	await hooks.event?.({
		event: { type: "message.updated", properties: { info } },
	} as Parameters<NonNullable<typeof hooks.event>>[0]);
}
async function emitAssistant(
	hooks: PluginHooks,
	sessionID: string,
	parentID: string,
	id = `assistant:${parentID}`,
): Promise<void> {
	await emitMessage(hooks, { id, sessionID, role: "assistant", parentID });
}
async function emitAutoCompaction(
	hooks: PluginHooks,
	sessionID: string,
	authority: string,
	successor: string,
): Promise<void> {
	const user = `${successor}-marker`;
	await emitAssistant(hooks, sessionID, authority, `${successor}-trigger`);
	await emitMessage(hooks, { id: user, sessionID, role: "user" });
	await hooks.event?.({
		event: {
			type: "message.part.updated",
			properties: {
				part: {
					id: `${user}-part`,
					messageID: user,
					sessionID,
					type: "compaction",
					auto: true,
				},
			},
		},
	} as Parameters<NonNullable<typeof hooks.event>>[0]);
	await emitMessage(hooks, {
		id: `${successor}-summary`,
		sessionID,
		role: "assistant",
		parentID: user,
		summary: true,
	});
	await emitMessage(hooks, { id: successor, sessionID, role: "user" });
	await hooks.event?.({
		event: { type: "session.compacted", properties: { sessionID } },
	} as Parameters<NonNullable<typeof hooks.event>>[0]);
}

afterEach(async () => {
	const cleanupErrors: unknown[] = [];
	for (const hooks of activeHooks.splice(0).reverse()) {
		try {
			await hooks.dispose?.();
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	for (const workspace of activeWorkspaces.splice(0).reverse()) {
		try {
			await rm(workspace, { recursive: true, force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, "Flow surface cleanup failed.");
	}
});

describe("Flow v6 distribution surface", () => {
	test("ships ten tools, five commands, two hidden agents, and four guides", async () => {
		expect(new Set(Object.keys(createRegisteredTools()))).toEqual(
			new Set(TOOL_NAMES),
		);

		const config = createFlowCoreConfigEntries();
		expect(Object.keys(config.command).sort()).toEqual([...COMMAND_NAMES]);
		expect(Object.keys(config.agent)).toEqual(["flow-reviewer", "flow-worker"]);
		for (const agent of Object.values(config.agent)) {
			expect(agent.hidden).toBe(true);
		}

		expect(FLOW_GUIDANCE_IDS).toEqual([
			"flow",
			"flow-plan",
			"flow-run",
			"flow-review",
		]);

		const workspace = await createTestWorkspace("flow-surface-");
		const hooks = await loadPlugin(workspace);
		expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...TOOL_NAMES]);
	});

	test("isolates worker permissions while keeping manager and reviewer dispatch separate", () => {
		const { agent, command } = createFlowCoreConfigEntries();
		const reviewer = agent["flow-reviewer"];
		const worker = agent["flow-worker"];
		expect(reviewer).toBeDefined();
		expect(reviewer?.hidden).toBe(true);
		expect(reviewer?.permission).toEqual({
			edit: "deny",
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
			flow_status: "allow",
			flow_feature_complete: "allow",
		});
		expect(worker).toBeDefined();
		expect(worker?.hidden).toBe(true);
		expect(worker?.mode).toBe("subagent");
		expect(worker?.permission).toEqual({
			edit: {
				"*": "allow",
				".flow": "deny",
				".flow/**": "deny",
				".git": "deny",
				".git/**": "deny",
			},
			bash: "deny",
			external_directory: "deny",
			skill: "deny",
			task: { "*": "deny" },
			"flow_*": "deny",
		});
		expect(worker).not.toHaveProperty("model");
		expect(worker).not.toHaveProperty("steps");

		for (const name of [
			"flow-auto",
			"flow-plan",
			"flow-run",
			"flow-status",
		] as const) {
			expect(command[name]?.subtask).toBe(false);
			expect("agent" in (command[name] ?? {})).toBe(false);
		}
		expect(command["flow-review"]).toMatchObject({
			subtask: true,
			agent: "flow-reviewer",
		});
		expect(
			Object.values(command).some(
				(entry) => "agent" in entry && entry.agent === "flow-worker",
			),
		).toBe(false);
	});
});

describe("command preflight", () => {
	test("rewrites manager text and the exact reviewer subtask", async () => {
		const workspace = await createTestWorkspace("flow-command-");
		const hooks = await loadPlugin(workspace);
		const before = hooks["command.execute.before"];
		if (!before) throw new Error("Missing command preflight hook.");

		const rawArguments = "\t  simplify it\n  exactly \t\n";
		const managerOutput = {
			parts: [{ type: "text", text: "stale prompt" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "/flow-plan", sessionID: "s", arguments: rawArguments },
			managerOutput,
		);
		expect(managerOutput.parts).toHaveLength(2);
		expect(managerOutput.parts[0]).toMatchObject({
			type: "text",
			text: `Flow flow-plan: ${rawArguments}`,
		});
		expect(managerOutput.parts[1]).toMatchObject({
			type: "text",
			synthetic: true,
		});
		expect((managerOutput.parts[1] as { text?: string }).text).toContain(
			"# Flow Plan",
		);
		expect((managerOutput.parts[1] as { text?: string }).text).toContain(
			"the preceding non-synthetic Flow request",
		);
		expectExactlyOnce(
			managerOutput.parts
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("\n"),
			rawArguments,
		);

		const emptyOutput = {
			parts: [{ type: "text", text: "stale prompt" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "/flow-status", sessionID: "s", arguments: " \t\n" },
			emptyOutput,
		);
		expect(emptyOutput.parts[0]).toMatchObject({
			type: "text",
			text: "Flow flow-status",
		});

		const reviewerOutput = {
			parts: [
				{
					type: "subtask",
					agent: "flow-reviewer",
					command: "flow-review",
					prompt: "stale prompt",
					description: "review",
				},
			],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-review", sessionID: "s", arguments: "assignment-1" },
			reviewerOutput,
		);
		expect((reviewerOutput.parts[0] as { prompt?: string }).prompt).toContain(
			"Assignment: assignment-1",
		);
	});

	test("fails closed for mixed manager or malformed reviewer dispatch", async () => {
		const workspace = await createTestWorkspace("flow-command-fail-");
		const hooks = await loadPlugin(workspace);
		const before = hooks["command.execute.before"];
		if (!before) throw new Error("Missing command preflight hook.");

		await expect(
			before({ command: "flow-run", sessionID: "s", arguments: "" }, {
				parts: [
					{
						type: "subtask",
						agent: "flow-reviewer",
						command: "flow-run",
						prompt: "",
						description: "invalid",
					},
				],
			} as unknown as Parameters<typeof before>[1]),
		).rejects.toThrow("manager commands cannot contain subtask parts");

		for (const parts of [
			[],
			[{ type: "text", text: "not a subtask" }],
			[
				{
					type: "subtask",
					agent: "other-reviewer",
					command: "flow-review",
					prompt: "",
					description: "invalid",
				},
			],
		] as const) {
			await expect(
				before({ command: "flow-review", sessionID: "s", arguments: "" }, {
					parts: [...parts],
				} as unknown as Parameters<typeof before>[1]),
			).rejects.toThrow();
		}
	});
});

describe("flow-auto host continuation", () => {
	test("keeps malformed mutation output out of validation-capture errors", async () => {
		const workspace = await createTestWorkspace("flow-auto-output-");
		const hooks = await loadPlugin(workspace);
		const toolAfter = hooks["tool.execute.after"];
		if (!toolAfter) throw new Error("Missing tool after-hook.");
		const output = { title: "", output: "not-json", metadata: {} };

		await toolAfter(
			{
				tool: "flow_plan_approve",
				sessionID: "auto-host",
				callID: "malformed-mutation-output",
				args: {},
			},
			output,
		);

		expect(output.output).toBe("not-json");
		expect(output.output).not.toContain("[flow-validation-error]");
	});

	test("reports local stop or cancel without durable mutation or cross-host revocation", async () => {
		const workspace = await createTestWorkspace("flow-auto-stop-");
		const hooks = await loadPlugin(workspace);
		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		const compacting = hooks["experimental.session.compacting"];
		const planSave = hooks.tool?.flow_plan_save;
		const status = hooks.tool?.flow_status;
		if (!before || !chat || !compacting || !planSave || !status) {
			throw new Error("Missing auto-drive hooks.");
		}
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "stop-plan-save",
							expectedRevision: 0,
							goal: "Keep durable state unchanged while stopping auto-drive.",
							plan,
						},
					},
					toolContext(workspace),
				),
			),
		);
		const durableBefore = {
			sessionId: saved.workflowData.projection.sessionId,
			status: saved.workflowData.projection.status,
			revision: saved.workflowData.projection.revision,
		};
		expect(durableBefore).toMatchObject({
			sessionId: expect.any(String),
			status: "planning",
			revision: 1,
		});

		for (const directive of ["stop", "cancel"]) {
			const activation = {
				parts: [{ type: "text", text: "stale" }],
			} as unknown as Parameters<typeof before>[1];
			await before(
				{ command: "flow-auto", sessionID: "auto-stop", arguments: "" },
				activation,
			);
			const activeContext = { context: [] as string[] };
			await compacting({ sessionID: "auto-stop" }, activeContext);
			expect(activeContext.context).not.toEqual([]);

			const stopped = {
				parts: [{ type: "text", text: "stale" }],
			} as unknown as Parameters<typeof before>[1];
			const retainedParts = stopped.parts;
			await before(
				{
					command: "flow-auto",
					sessionID: "auto-stop",
					arguments: directive,
				},
				stopped,
			);
			expect(stopped.parts).toBe(retainedParts);
			expect(stopped.parts).toHaveLength(1);
			const stoppedText = stopped.parts[0];
			expect(stoppedText?.type).toBe("text");
			if (stoppedText?.type !== "text") {
				throw new Error("Expected a plain stop confirmation.");
			}
			expect(stoppedText.text).toBe("Flow auto stopped.");
			expect(stoppedText.synthetic).not.toBe(true);
			const stoppedContext = { context: [] as string[] };
			await compacting({ sessionID: "auto-stop" }, stoppedContext);
			expect(stoppedContext.context).toEqual([]);
		}

		const alreadyStopped = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-stop", arguments: "stop" },
			alreadyStopped,
		);
		expect(alreadyStopped.parts[0]).toMatchObject({
			type: "text",
			text: "No Flow auto lease was active in this OpenCode session.",
		});

		const response = JSON.parse(
			String(
				await status.execute(
					{ request: { view: "compact" } },
					toolContext(workspace),
				),
			),
		);
		expect(response.workflowData.projection).toMatchObject(durableBefore);

		const ownerActivation = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-owner", arguments: "" },
			ownerActivation,
		);
		const otherHostStop = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		const otherHostParts = otherHostStop.parts;
		await before(
			{ command: "flow-auto", sessionID: "other-host", arguments: "stop" },
			otherHostStop,
		);
		expect(otherHostStop.parts).toBe(otherHostParts);
		expect(otherHostStop.parts[0]).toMatchObject({
			type: "text",
			text: "No Flow auto lease was active in this OpenCode session.",
		});
		const afterOtherHost = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterOtherHost);
		expect(afterOtherHost.context).not.toEqual([]);
		await chat({ sessionID: "other-host" }, {
			message: {
				id: "other-host-natural-stop",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: [{ type: "text", text: "stop /flow-auto" }],
		} as unknown as Parameters<typeof chat>[1]);
		const afterOtherHostMessage = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterOtherHostMessage);
		expect(afterOtherHostMessage.context).not.toEqual([]);

		await mkdir(join(workspace, ".flow"), { recursive: true });
		await writeFile(join(workspace, ".flow", "session.json"), "{broken");
		const unreadableStop = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await expect(
			before(
				{ command: "flow-auto", sessionID: "auto-owner", arguments: "stop" },
				unreadableStop,
			),
		).resolves.toBeUndefined();
		const afterUnreadableStop = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterUnreadableStop);
		expect(afterUnreadableStop.context).toEqual([]);
	});

	test("adopts an idle-created session only from its same-host plan save", async () => {
		for (const [creatorHost, expectedPrompts] of [
			["auto-owner", 1],
			["other-host", 0],
		] as const) {
			const workspace = await createTestWorkspace("flow-auto-idle-owner-");
			const promptCalls: unknown[] = [];
			const hooks = await loadPlugin(workspace, workspace, promptCalls);
			const planSave = hooks.tool?.flow_plan_save;
			const planApprove = hooks.tool?.flow_plan_approve;
			const before = hooks["command.execute.before"];
			const chat = hooks["chat.message"];
			const compacting = hooks["experimental.session.compacting"];
			if (
				!planSave ||
				!planApprove ||
				!before ||
				!chat ||
				!compacting ||
				!hooks.event
			)
				throw new Error("Missing auto-drive hooks or plan tools.");
			const creatorContext = toolContext(
				workspace,
				creatorHost,
				"idle-owner-command",
			);
			const ownerContext = toolContext(
				workspace,
				"auto-owner",
				"idle-owner-command",
			);
			const commandOutput = {
				parts: [{ type: "text", text: "stale" }],
			} as unknown as Parameters<typeof before>[1];
			await before(
				{ command: "flow-auto", sessionID: "auto-owner", arguments: "" },
				commandOutput,
			);
			await chat({ sessionID: "auto-owner" }, {
				message: {
					id: "idle-owner-command",
					agent: "build",
					model: { providerID: "provider", modelID: "model" },
				},
				parts: commandOutput.parts,
			} as unknown as Parameters<typeof chat>[1]);
			await emitAssistant(hooks, creatorHost, "idle-owner-command");
			const saveArgs = {
				request: {
					operationId: "idle-owner-plan-save",
					expectedRevision: 0,
					goal: "Bind idle continuation ownership.",
					plan,
				},
			};
			const savedOutput = String(
				await planSave.execute(saveArgs, creatorContext),
			);
			const saved = JSON.parse(savedOutput);
			const approveArgs = {
				request: {
					operationId: "idle-owner-plan-approve",
					expectedRevision: saved.workflowData.projection.revision,
				},
			};
			const approvedOutput = String(
				await planApprove.execute(approveArgs, ownerContext),
			);
			expect(JSON.parse(approvedOutput).status).toBe("ok");
			await hooks.event({
				event: {
					type: "session.idle",
					properties: { sessionID: "auto-owner" },
				},
			} as Parameters<NonNullable<typeof hooks.event>>[0]);

			expect(promptCalls).toHaveLength(expectedPrompts);
			const compacted = { context: [] as string[] };
			await compacting({ sessionID: "auto-owner" }, compacted);
			expect(compacted.context.length > 0).toBe(expectedPrompts === 1);
		}
	});

	test("does not treat another host's accepted mutation as continuation authority", async () => {
		const workspace = await createTestWorkspace("flow-auto-other-host-");
		const promptCalls: unknown[] = [];
		const hooks = await loadPlugin(workspace, workspace, promptCalls);
		const planSave = hooks.tool?.flow_plan_save;
		const planApprove = hooks.tool?.flow_plan_approve;
		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		const compacting = hooks["experimental.session.compacting"];
		if (
			!planSave ||
			!planApprove ||
			!before ||
			!chat ||
			!compacting ||
			!hooks.event
		) {
			throw new Error("Missing auto-drive hooks or plan tools.");
		}
		const context = toolContext(workspace);
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "other-host-plan-save",
							expectedRevision: 0,
							goal: "Reject cross-host continuation authority.",
							plan,
						},
					},
					context,
				),
			),
		);
		const commandOutput = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-owner", arguments: "" },
			commandOutput,
		);
		await chat({ sessionID: "auto-owner" }, {
			message: {
				id: "auto-close-command",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: commandOutput.parts,
		} as unknown as Parameters<typeof chat>[1]);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-owner" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		await chat({ sessionID: "auto-owner" }, {
			message: {
				id: "auto-owner-reply",
				agent: "build-approved",
				model: { providerID: "provider", modelID: "approved-model" },
			},
			parts: [{ type: "text", text: "Approve the plan." }],
		} as unknown as Parameters<typeof chat>[1]);

		const approveArgs = {
			request: {
				operationId: "other-host-plan-approve",
				expectedRevision: saved.workflowData.projection.revision,
			},
		};
		const approvedOutput = String(
			await planApprove.execute(
				approveArgs,
				toolContext(workspace, "other-host"),
			),
		);
		expect(JSON.parse(approvedOutput).status).toBe("ok");
		const afterCrossHostMutation = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterCrossHostMutation);
		expect(afterCrossHostMutation.context).not.toEqual([]);
		await emitAssistant(hooks, "auto-owner", "auto-owner-reply");
		const replayedOutput = String(
			await planApprove.execute(
				approveArgs,
				toolContext(workspace, "auto-owner", "auto-owner-reply"),
			),
		);
		expect(JSON.parse(replayedOutput).workflowData.operation.replayed).toBe(
			true,
		);
		const afterReplay = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterReplay);
		expect(afterReplay.context).not.toEqual([]);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-owner" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);

		expect(promptCalls).toHaveLength(0);
		const afterOtherHostMutation = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, afterOtherHostMutation);
		expect(afterOtherHostMutation.context).toEqual([]);
	});

	test("preserves an accepted mutation but fails closed without its assistant origin", async () => {
		const workspace = await createTestWorkspace("flow-auto-missing-origin-");
		const promptCalls: unknown[] = [];
		const hooks = await loadPlugin(workspace, workspace, promptCalls);
		const planSave = hooks.tool?.flow_plan_save;
		const planApprove = hooks.tool?.flow_plan_approve;
		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		const compacting = hooks["experimental.session.compacting"];
		if (
			!planSave ||
			!planApprove ||
			!before ||
			!chat ||
			!compacting ||
			!hooks.event
		) {
			throw new Error("Missing auto-drive hooks or plan tools.");
		}
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "missing-origin-plan-save",
							expectedRevision: 0,
							goal: "Fail closed when mutation provenance is unavailable.",
							plan,
						},
					},
					toolContext(workspace),
				),
			),
		);
		const commandOutput = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-host", arguments: "" },
			commandOutput,
		);
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "missing-origin-command",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: commandOutput.parts,
		} as unknown as Parameters<typeof chat>[1]);
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "missing-origin-reply",
				agent: "build-approved",
				model: { providerID: "provider", modelID: "approved-model" },
			},
			parts: [{ type: "text", text: "Approve the plan." }],
		} as unknown as Parameters<typeof chat>[1]);

		const approvedOutput = String(
			await planApprove.execute(
				{
					request: {
						operationId: "missing-origin-plan-approve",
						expectedRevision: saved.workflowData.projection.revision,
					},
				},
				toolContext(workspace, "auto-host", "missing-origin-reply"),
			),
		);
		expect(JSON.parse(approvedOutput)).toMatchObject({
			status: "ok",
			workflowData: {
				operation: { replayed: false },
				projection: { status: "ready" },
			},
		});
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);

		expect(promptCalls).toHaveLength(0);
		const afterMissingOrigin = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, afterMissingOrigin);
		expect(afterMissingOrigin.context).toEqual([]);
	});

	test("does not credit a same-host assistant from an older user turn", async () => {
		const workspace = await createTestWorkspace("flow-auto-stale-origin-");
		const promptCalls: unknown[] = [];
		const hooks = await loadPlugin(workspace, workspace, promptCalls);
		const planSave = hooks.tool?.flow_plan_save;
		const planApprove = hooks.tool?.flow_plan_approve;
		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		const compacting = hooks["experimental.session.compacting"];
		if (
			!planSave ||
			!planApprove ||
			!before ||
			!chat ||
			!compacting ||
			!hooks.event
		) {
			throw new Error("Missing auto-drive hooks or plan tools.");
		}
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "stale-origin-plan-save",
							expectedRevision: 0,
							goal: "Reject stale same-host mutation provenance.",
							plan,
						},
					},
					toolContext(workspace),
				),
			),
		);
		const commandOutput = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-host", arguments: "" },
			commandOutput,
		);
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "stale-origin-command",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: commandOutput.parts,
		} as unknown as Parameters<typeof chat>[1]);
		await emitAssistant(
			hooks,
			"auto-host",
			"stale-origin-command",
			"assistant:stale-origin-command",
		);
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "stale-origin-current-reply",
				agent: "build-approved",
				model: { providerID: "provider", modelID: "approved-model" },
			},
			parts: [{ type: "text", text: "Approve the plan." }],
		} as unknown as Parameters<typeof chat>[1]);

		const approvedOutput = String(
			await planApprove.execute(
				{
					request: {
						operationId: "stale-origin-plan-approve",
						expectedRevision: saved.workflowData.projection.revision,
					},
				},
				toolContext(workspace, "auto-host", "stale-origin-command"),
			),
		);
		expect(JSON.parse(approvedOutput)).toMatchObject({
			status: "ok",
			workflowData: {
				operation: { replayed: false },
				projection: { status: "ready" },
			},
		});
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);

		expect(promptCalls).toHaveLength(0);
		const afterStaleOrigin = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, afterStaleOrigin);
		expect(afterStaleOrigin.context).toEqual([]);
	});

	test("retains authority when close commits before archive publication fails", async () => {
		const workspace = await createTestWorkspace("flow-auto-close-pending-");
		const promptCalls: unknown[] = [];
		const hooks = await loadPlugin(workspace, workspace, promptCalls);
		const planSave = hooks.tool?.flow_plan_save;
		const sessionClose = hooks.tool?.flow_session_close;
		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		if (!planSave || !sessionClose || !before || !chat || !hooks.event) {
			throw new Error("Missing auto-drive hooks or close tools.");
		}
		const context = toolContext(workspace);
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "pending-close-plan",
							expectedRevision: 0,
							goal: "Recover a durably accepted close.",
							plan,
						},
					},
					context,
				),
			),
		);
		const commandOutput = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-close", arguments: "" },
			commandOutput,
		);
		await chat({ sessionID: "auto-close" }, {
			message: {
				id: "auto-close-command",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: commandOutput.parts,
		} as unknown as Parameters<typeof chat>[1]);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-close" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		await chat({ sessionID: "auto-close" }, {
			message: {
				id: "auto-close-reply",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: [{ type: "text", text: "Defer this session." }],
		} as unknown as Parameters<typeof chat>[1]);
		await emitAssistant(hooks, "auto-close", "auto-close-reply");

		await writeFile(join(workspace, ".flow", "history"), "unsafe\n");
		const closeArgs = {
			request: {
				operationId: "pending-close",
				expectedRevision: saved.workflowData.projection.revision,
				sessionId: saved.workflowData.projection.sessionId,
				kind: "deferred" as const,
				summary: "Deferred by user.",
			},
		};
		const closeOutput = String(
			await sessionClose.execute(
				closeArgs,
				toolContext(workspace, "auto-close", "auto-close-reply"),
			),
		);
		const close = JSON.parse(closeOutput);
		expect(close).toMatchObject({
			status: "error",
			workflowData: {
				operation: { replayed: false },
				closeState: { durableAccepted: true },
			},
		});
		await unlink(join(workspace, ".flow", "history"));
		await mkdir(join(workspace, ".flow", "history"));
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-close" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);

		expect(promptCalls).toHaveLength(1);
		expect(promptCalls[0]).toMatchObject({
			path: { id: "auto-close" },
			body: {
				parts: [
					{
						text: expect.stringContaining("flow_session_close"),
					},
				],
			},
		});
	});

	test("retains auto authority before decorated after-hooks, then delivers promptAsync", async () => {
		const workspace = await createTestWorkspace("flow-auto-");
		const promptCalls: unknown[] = [];
		const hooks = await loadPlugin(workspace, workspace, promptCalls);
		const context = toolContext(workspace);
		const planSave = hooks.tool?.flow_plan_save;
		const planApprove = hooks.tool?.flow_plan_approve;
		if (!planSave || !planApprove) throw new Error("Missing plan tools.");
		const saved = JSON.parse(
			String(
				await planSave.execute(
					{
						request: {
							operationId: "auto-plan-save",
							expectedRevision: 0,
							goal: "Exercise durable auto continuation.",
							plan,
						},
					},
					context,
				),
			),
		);
		expect(saved.status).toBe("ok");

		const before = hooks["command.execute.before"];
		const chat = hooks["chat.message"];
		const compacting = hooks["experimental.session.compacting"];
		const toolAfter = hooks["tool.execute.after"];
		if (!before || !chat || !compacting || !toolAfter || !hooks.event) {
			throw new Error("Missing auto-drive hooks.");
		}
		const commandOutput = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof before>[1];
		await before(
			{ command: "flow-auto", sessionID: "auto-host", arguments: "" },
			commandOutput,
		);
		const activationToken = (
			commandOutput.parts.find(
				(part) => part.type === "text" && part.synthetic === true,
			) as { metadata?: Record<string, unknown> }
		).metadata?.[FLOW_AUTO_METADATA_KEY];
		expect(activationToken).toEqual(expect.any(String));
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "auto-command",
				agent: "build",
				model: { providerID: "provider", modelID: "model" },
			},
			parts: commandOutput.parts,
		} as unknown as Parameters<typeof chat>[1]);

		const compactingOutput = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, compactingOutput);
		expect(compactingOutput.context.join(" ")).toContain(
			"/flow-auto continuation",
		);
		expectExactlyOnce(compactingOutput.context.join("\n"), FLOW_MANAGER_KERNEL);
		expect(compactingOutput.context.join("\n")).toContain(
			"Load flow-run guidance before any feature or closure route",
		);
		expect(compactingOutput.context.join("\n")).toContain(
			"replay archiveRetry exactly",
		);
		await emitAutoCompaction(
			hooks,
			"auto-host",
			"auto-command",
			"auto-compaction",
		);
		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "auto-compaction",
				agent: "build-compacted",
				model: { providerID: "provider", modelID: "compaction-model" },
			},
			parts: [
				{
					type: "text",
					text: "Continue if you have next steps.",
					synthetic: true,
				},
			],
		} as unknown as Parameters<typeof chat>[1]);
		expect(promptCalls).toHaveLength(0);
		const afterCompacted = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, afterCompacted);
		expectExactlyOnce(afterCompacted.context.join("\n"), FLOW_MANAGER_KERNEL);

		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		expect(promptCalls).toHaveLength(0);

		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "auto-clarification",
				agent: "build-clarification",
				model: { providerID: "provider", modelID: "clarification-model" },
			},
			parts: [{ type: "text", text: "What do you recommend?" }],
		} as unknown as Parameters<typeof chat>[1]);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		expect(promptCalls).toHaveLength(0);
		const afterClarification = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, afterClarification);
		expect(afterClarification.context.join(" ")).toContain(
			"/flow-auto continuation",
		);
		expectExactlyOnce(
			afterClarification.context.join("\n"),
			FLOW_MANAGER_KERNEL,
		);

		await chat({ sessionID: "auto-host" }, {
			message: {
				id: "auto-approval",
				agent: "build-approved",
				model: { providerID: "provider", modelID: "approved-model" },
			},
			parts: [{ type: "text", text: "Approve the plan." }],
		} as unknown as Parameters<typeof chat>[1]);
		const approveArgs = {
			request: {
				operationId: "auto-plan-approve",
				expectedRevision: saved.workflowData.projection.revision,
			},
		};
		await emitAssistant(hooks, "auto-host", "auto-approval");
		const approvedOutput = String(
			await planApprove.execute(
				approveArgs,
				toolContext(workspace, "auto-host", "auto-approval"),
			),
		);
		const approved = JSON.parse(approvedOutput);
		expect(approved.workflowData.projection.status).toBe("ready");
		const decorated = {
			title: "",
			output: `${approvedOutput}\n\n[audit-footer]`,
			metadata: {},
		};
		await toolAfter(
			{
				tool: "flow_plan_approve",
				sessionID: "auto-host",
				callID: "auto-plan-approve-call",
				args: approveArgs,
			},
			decorated,
		);
		expect(decorated.output).toEndWith("[audit-footer]");
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		expect(promptCalls).toHaveLength(1);
		const continuationText = String(
			(promptCalls[0] as { body: { parts: Array<{ text: string }> } }).body
				.parts[0]?.text,
		);
		expectExactlyOnce(continuationText, FLOW_MANAGER_KERNEL);
		expect(continuationText).toContain(
			"Load flow-run guidance before any feature or closure route",
		);
		expect(continuationText).toContain("replay archiveRetry exactly");
		expect(promptCalls[0]).toMatchObject({
			path: { id: "auto-host" },
			query: { directory: workspace },
			body: {
				agent: "build-approved",
				model: { providerID: "provider", modelID: "approved-model" },
				parts: [
					{
						type: "text",
						synthetic: true,
						text: expect.stringContaining("flow_run_start"),
						metadata: {
							[FLOW_AUTO_METADATA_KEY]: activationToken,
						},
					},
				],
			},
			throwOnError: true,
		});
		const status = hooks.tool?.flow_status;
		if (!status) throw new Error("Missing status tool.");
		const statusResponse = JSON.parse(
			String(await status.execute({ request: { view: "compact" } }, context)),
		);
		expect(statusResponse.workflowData.autoTiming).toMatchObject({
			scope: "latest-flow-auto-in-current-plugin-process",
			authoritative: false,
			state: "active",
		});
		expect(statusResponse.workflowData.projection).not.toHaveProperty(
			"autoTiming",
		);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		expect(promptCalls).toHaveLength(1);

		await hooks.event({
			event: {
				type: "session.error",
				properties: {
					sessionID: "auto-host",
					error: { name: "MessageAbortedError" },
				},
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		const afterOldError = { context: [] as string[] };
		await compacting({ sessionID: "auto-host" }, afterOldError);
		expect(afterOldError.context).toEqual([]);
		await hooks.event({
			event: {
				type: "session.idle",
				properties: { sessionID: "auto-host" },
			},
		} as Parameters<NonNullable<typeof hooks.event>>[0]);
		expect(promptCalls).toHaveLength(1);

		for (const terminalEvent of [
			{
				type: "session.deleted",
				properties: { info: { id: "auto-host" } },
			},
			{ type: "session.error", properties: {} },
		]) {
			await before(
				{ command: "flow-auto", sessionID: "auto-host", arguments: "" },
				commandOutput,
			);
			await chat({ sessionID: "auto-host" }, {
				message: {
					id: `terminal-${terminalEvent.type}`,
					agent: "build",
					model: { providerID: "provider", modelID: "model" },
				},
				parts: commandOutput.parts,
			} as unknown as Parameters<typeof chat>[1]);
			await hooks.event({
				event: terminalEvent,
			} as Parameters<NonNullable<typeof hooks.event>>[0]);
			const afterTerminal = { context: [] as string[] };
			await compacting({ sessionID: "auto-host" }, afterTerminal);
			expect(afterTerminal.context).toEqual([]);
		}
	});
});

describe("duplicate runtime guard", () => {
	test("preserves an owner stop confirmation across a no-lease duplicate hook", async () => {
		const workspace = await createTestWorkspace("flow-duplicate-stop-");
		const firstDirectory = join(workspace, "first-directory");
		const secondDirectory = join(workspace, "second-directory");
		await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
		const owner = await loadPlugin(workspace, firstDirectory);
		const ownerBefore = owner["command.execute.before"];
		const compacting = owner["experimental.session.compacting"];
		if (!ownerBefore || !compacting) {
			throw new Error("Missing owner auto-drive hooks.");
		}
		const activation = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof ownerBefore>[1];
		await ownerBefore(
			{ command: "flow-auto", sessionID: "auto-owner", arguments: "" },
			activation,
		);
		const active = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, active);
		expect(active.context).not.toEqual([]);

		const duplicate = await loadPlugin(workspace, secondDirectory);
		const duplicateBefore = duplicate["command.execute.before"];
		if (!duplicateBefore) throw new Error("Missing duplicate command hook.");
		const stopped = {
			parts: [{ type: "text", text: "stale" }],
		} as unknown as Parameters<typeof ownerBefore>[1];
		await ownerBefore(
			{ command: "flow-auto", sessionID: "auto-owner", arguments: "stop" },
			stopped,
		);
		expect(stopped.parts).toHaveLength(1);
		expect(stopped.parts[0]).toMatchObject({
			type: "text",
			text: "Flow auto stopped.",
		});
		await duplicateBefore(
			{ command: "flow-auto", sessionID: "auto-owner", arguments: "stop" },
			stopped,
		);
		expect(stopped.parts).toHaveLength(1);
		expect(stopped.parts[0]).toMatchObject({
			type: "text",
			text: "Flow auto stopped.",
		});
		const inactive = { context: [] as string[] };
		await compacting({ sessionID: "auto-owner" }, inactive);
		expect(inactive.context).toEqual([]);
	});

	test("disables every copy dynamically until one project runtime remains", async () => {
		const workspace = await createTestWorkspace("flow-duplicate-");
		const firstDirectory = join(workspace, "first-directory");
		const secondDirectory = join(workspace, "second-directory");
		await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
		const first = await loadPlugin(workspace, firstDirectory);
		const second = await loadPlugin(workspace, secondDirectory);
		const context = toolContext(workspace);

		for (const hooks of [first, second]) {
			const status = hooks.tool?.flow_status;
			if (!status) throw new Error("Missing guarded status tool.");
			const parsed = JSON.parse(
				String(await status.execute({ request: { view: "compact" } }, context)),
			);
			expect(parsed).toMatchObject({
				status: "error",
				summary: expect.stringContaining("duplicate-instances"),
				workflowData: {
					runtimeGuard: {
						operational: false,
						reason: "duplicate-instances",
					},
				},
			});
			expect(parsed.workflowData.runtimeGuard).toEqual({
				operational: false,
				reason: "duplicate-instances",
				message: "Flow is not operational (duplicate-instances).",
			});
			// A guard rejection carries the same `failure` envelope every other Flow
			// error uses, because the prompts tell the model to read exactly that.
			expect(parsed.workflowData.dataNote).toEqual(expect.any(String));
			expect(parsed.workflowData.failure).toEqual({
				summary: "Flow is not operational (duplicate-instances).",
				recovery: expect.stringContaining("Remove the duplicate installation"),
			});

			// `flow_guidance` answers in markdown, so its rejection must be markdown
			// too rather than a JSON blob the caller is not parsing.
			const guidance = hooks.tool?.flow_guidance;
			if (!guidance) throw new Error("Missing guarded guidance tool.");
			const rejected = String(await guidance.execute({ id: "flow" }, context));
			expect(rejected).not.toContain("{");
			expect(rejected).toContain(
				"Flow is not operational (duplicate-instances).",
			);
			expect(rejected).toContain("Recovery: ");
		}

		await second.dispose?.();
		const guidance = first.tool?.flow_guidance;
		if (!guidance) throw new Error("Missing guarded guidance tool.");
		for (const id of ["flow", "flow-run"] as const) {
			const output = String(await guidance.execute({ id }, context));
			expect(output).toBe(getFlowGuidance(id).content);
			expect(output.split(FLOW_MANAGER_KERNEL)).toHaveLength(2);
		}
	});
});
