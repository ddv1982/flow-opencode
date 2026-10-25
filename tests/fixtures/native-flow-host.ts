import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentInfo,
	OpenCode,
	type OpenCodeEvent,
	type SessionInboxSynthetic,
	type SessionInboxUser,
	type SessionInfo,
	type SessionMessageAssistant,
	type SessionMessageAssistantTool,
	type SessionMessageInfo,
	type SessionPromptInput,
	type SessionSyntheticInput,
} from "@opencode/client";
import type { Plugin } from "@opencode/plugin";
import { Agent, Model } from "@opencode/plugin";
import type { AgentEditor } from "@opencode/plugin/promise/agent";
import type {
	CommandDefinition,
	CommandInvocation,
} from "@opencode/plugin/promise/command";
import type { Hooks } from "@opencode/plugin/promise/registration";
import type {
	SessionContext,
	SessionHooks,
} from "@opencode/plugin/promise/session";
import type {
	Info,
	ToolContext,
	ToolEditor,
} from "@opencode/plugin/promise/tool";
import { CallID, Error as ToolError } from "@opencode/plugin/promise/tool";
import { Location } from "@opencode/schema/location";
import { Project } from "@opencode/schema/project";
import { AbsolutePath } from "@opencode/schema/schema";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Skill } from "@opencode/schema/skill";
import { z } from "zod";
import type {
	NativeToolAfter,
	NativeToolBefore,
} from "../../src/platform/opencode/sdk.js";

class HookRegistry<Spec> {
	readonly callbacks: {
		[Key in keyof Spec]?: Array<(input: Spec[Key]) => void | Promise<void>>;
	} = {};
	readonly hook: Hooks<Spec> = async (name, callback) => {
		const callbacks = this.callbacks[name] ?? [];
		this.callbacks[name] = callbacks;
		callbacks.push(callback);
		return {
			dispose: async () => {
				const index = callbacks.indexOf(callback);
				if (index >= 0) callbacks.splice(index, 1);
			},
		};
	};
	async emit<Key extends keyof Spec>(
		name: Key,
		input: Spec[Key],
	): Promise<void> {
		for (const callback of this.callbacks[name] ?? []) await callback(input);
	}
}

class NativeEvents {
	readonly subscribers = new Set<{
		push(event: OpenCodeEvent): Promise<void>;
	}>();
	readonly subscribe: Plugin.Context["event"]["subscribe"] = ({
		signal,
	} = {}) => {
		const subscribers = this.subscribers;
		return (async function* () {
			type Entry = { event: OpenCodeEvent; done(): void };
			const queue: Entry[] = [];
			let wake: (() => void) | undefined;
			const abort = () => wake?.();
			const subscriber = {
				push(event: OpenCodeEvent) {
					return new Promise<void>((done) => {
						queue.push({ event, done });
						wake?.();
					});
				},
			};
			subscribers.add(subscriber);
			signal?.addEventListener("abort", abort);
			try {
				while (!signal?.aborted) {
					if (!queue.length)
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					const next = queue.shift();
					if (!next) continue;
					try {
						yield next.event;
					} finally {
						next.done();
					}
				}
			} finally {
				subscribers.delete(subscriber);
				signal?.removeEventListener("abort", abort);
				for (const entry of queue) entry.done();
			}
		})();
	};
	async emit(event: OpenCodeEvent) {
		await Promise.all(
			[...this.subscribers].map((subscriber) => subscriber.push(event)),
		);
	}
}
const responseSchema = z.object({
	status: z.enum(["ok", "error"]),
	summary: z.string(),
	workflowData: z
		.object({
			projection: z
				.object({
					view: z.string(),
					status: z.string(),
					revision: z.number(),
					sessionId: z.string().optional(),
					goal: z.string().optional(),
				})
				.passthrough()
				.optional(),
			operation: z
				.object({
					operationId: z.string(),
					revision: z.number(),
					replayed: z.boolean(),
				})
				.passthrough()
				.optional(),
		})
		.passthrough(),
});
function parseFlowResponse(value: unknown) {
	return responseSchema.parse(value);
}
export function projectionOf(value: unknown) {
	const response = parseFlowResponse(value);
	const projection = response.workflowData.projection;
	if (!projection) throw new Error(response.summary);
	return projection;
}
export function nativeText(
	result: Awaited<ReturnType<Info["execute"]>>,
): string {
	const content = result.content;
	return typeof content === "string"
		? content
		: (content ?? [])
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
}
const unsupported = async (): Promise<never> => {
	throw new Error("Unexpected native API in this fixture.");
};
const usage = () => ({
	input: 0,
	output: 0,
	reasoning: 0,
	cache: { read: 0, write: 0 },
});

export async function createNativeFlowHost(
	directory: string,
	options: Plugin.Context["options"] = {},
) {
	const workspace = await realpath(directory);
	const path = AbsolutePath.make(workspace);
	const location = new Location.Info({
		directory: path,
		project: {
			id: Project.ID.make("project_test"),
			directory: path,
			canonical: path,
		},
	});
	const client = OpenCode.make({
		baseUrl: "http://native-fixture.invalid",
		fetch: Object.assign(unsupported, { preconnect() {} }),
	});
	const sessionHooks = new HookRegistry<SessionHooks>();
	const toolHooks = new HookRegistry<{
		"execute.before": NativeToolBefore;
		"execute.after": NativeToolAfter;
	}>();
	const events = new NativeEvents();
	const sessions = new Map<string, SessionInfo>();
	const messages = new Map<string, SessionMessageInfo[]>();
	const prompts: SessionPromptInput[] = [];
	const synthetics: SessionSyntheticInput[] = [];
	const syntheticObservers = new Set<(input: SessionSyntheticInput) => void>();
	const admissions: Array<SessionInboxUser | SessionInboxSynthetic> = [];
	const tools = new Map<string, Info>();
	const commands = new Map<string, CommandDefinition>();
	const agents = new Map<string, NonNullable<ReturnType<AgentEditor["get"]>>>();
	const transforms = new Set<(editor: AgentEditor) => void>();
	const active = new Map<string, SessionMessageAssistant>();
	const contexts = new Map<string, SessionContext>();
	const permissions: Array<
		Parameters<Plugin.Context["permission"]["assert"]>[0]
	> = [];
	let sequence = 0;
	const stamp = () => ++sequence;
	function ensureSession(
		id = "ses_manager",
		input: Partial<SessionInfo> = {},
	): SessionInfo {
		const present = sessions.get(id);
		if (present) return present;
		const session: SessionInfo = {
			id,
			projectID: "project_test",
			agent: "build",
			model: { providerID: "test", id: "coding" },
			cost: 0,
			tokens: usage(),
			time: { created: stamp(), updated: sequence },
			location: { directory: workspace },
			...input,
		};
		sessions.set(id, session);
		messages.set(id, []);
		return session;
	}
	function history(id: string) {
		ensureSession(id);
		const value = messages.get(id);
		if (!value) throw new Error("Missing native context.");
		return value;
	}
	function agentInfo(id: string): AgentInfo {
		const native = agents.get(id);
		if (!native) throw new Error(`Unknown native agent ${id}.`);
		return {
			id: native.id,
			name: native.name,
			mode: native.mode,
			hidden: native.hidden,
			permissions: native.permissions,
			request: { settings: {}, headers: {}, body: {} },
			...(native.system ? { system: native.system } : {}),
			...(native.description ? { description: native.description } : {}),
			...(native.steps ? { steps: native.steps } : {}),
			...(native.model
				? {
						model: {
							providerID: native.model.providerID,
							id: native.model.id,
							...(native.model.variant
								? { variant: native.model.variant }
								: {}),
						},
					}
				: {}),
		};
	}
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
	const toolEditor: ToolEditor = {
		list: () => [...tools].map(([id, tool]) => ({ ...tool, id })),
		get(id) {
			const tool = tools.get(id);
			return tool ? { ...tool, id } : undefined;
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
	async function prompt(input: SessionPromptInput): Promise<SessionInboxUser> {
		const session = ensureSession(input.sessionID),
			id = input.id ?? SessionMessage.ID.create();
		const hookPrompt: SessionHooks["prompt"]["prompt"] = {
			text: input.text,
			...(input.files
				? { files: input.files.map((file) => ({ ...file })) }
				: {}),
			...(input.agents
				? { agents: input.agents.map((agent) => ({ ...agent })) }
				: {}),
			...(input.skills
				? {
						skills: input.skills.map((skill) => ({
							...skill,
							id: Skill.ID.make(skill.id),
						})),
					}
				: {}),
		};
		await sessionHooks.emit("prompt", {
			sessionID: Session.ID.make(session.id),
			messageID: SessionMessage.ID.make(id),
			prompt: hookPrompt,
			delivery: input.delivery ?? "queue",
			...(input.metadata ? { metadata: input.metadata } : {}),
		});
		const payload: SessionInboxUser["payload"] = {
			text: input.text,
			...(input.files
				? {
						files: input.files.map((file) => ({
							data: file.uri.split(";base64,")[1] ?? "",
							mime: /^data:([^;]+)/.exec(file.uri)?.[1] ?? "text/plain",
							source: { type: "uri" as const, uri: file.uri },
							...(file.name ? { name: file.name } : {}),
							...(file.description ? { description: file.description } : {}),
							...(file.mention ? { mention: file.mention } : {}),
						})),
					}
				: {}),
			...(input.agents
				? { agents: input.agents.map((agent) => ({ ...agent })) }
				: {}),
			...(input.skills
				? {
						skills: input.skills.map((skill) => ({ ...skill, name: skill.id })),
					}
				: {}),
			...(input.metadata ? { metadata: input.metadata } : {}),
		};
		const receipt: SessionInboxUser = {
			id,
			sessionID: session.id,
			type: "user",
			payload,
			time: { created: stamp() },
			delivery: input.delivery ?? "queue",
		};
		prompts.push(structuredClone(input));
		admissions.push(structuredClone(receipt));
		history(session.id).push(
			structuredClone({
				id,
				type: "user" as const,
				time: receipt.time,
				...payload,
			}),
		);
		active.delete(session.id);
		return receipt;
	}
	async function synthetic(
		input: SessionSyntheticInput,
	): Promise<SessionInboxSynthetic> {
		const id = input.id ?? SessionMessage.ID.create();
		const payload = {
			text: input.text,
			...(input.description ? { description: input.description } : {}),
			...(input.metadata ? { metadata: input.metadata } : {}),
		};
		const receipt: SessionInboxSynthetic = {
			id,
			sessionID: input.sessionID,
			type: "synthetic",
			payload,
			time: { created: stamp() },
			delivery: input.delivery ?? "queue",
		};
		synthetics.push(structuredClone(input));
		for (const observe of syntheticObservers) observe(input);
		admissions.push(structuredClone(receipt));
		history(input.sessionID).push(
			structuredClone({
				id,
				type: "synthetic" as const,
				time: receipt.time,
				...payload,
			}),
		);
		active.delete(input.sessionID);
		return receipt;
	}
	const context: Plugin.Context = {
		app: { name: "opencode", version: "2.1.4", channel: "test" },
		location,
		options,
		session: {
			...client.session,
			get: async (input) => ensureSession(input.sessionID),
			context: async (input) => history(input.sessionID),
			list: async () => ({ data: [...sessions.values()], cursor: {} }),
			prompt,
			synthetic,
			hook: sessionHooks.hook,
			create: async (input) =>
				ensureSession(`ses_child_${stamp()}`, {
					...(input?.parentID ? { parentID: input.parentID } : {}),
					...(input?.agent ? { agent: input.agent } : {}),
					...(input?.model ? { model: input.model } : {}),
				}),
		},
		agent: {
			...client.agent,
			get: async (input) => ({
				location: { directory: workspace },
				data: agentInfo(input.agentID),
			}),
			list: async () => ({
				location: { directory: workspace },
				data: [...agents.keys()].map(agentInfo),
			}),
			transform: async (apply) => {
				transforms.add(apply);
				apply(editor);
				return {
					dispose: async () => {
						transforms.delete(apply);
					},
				};
			},
			reload: async () => {
				for (const apply of transforms) apply(editor);
			},
		},
		tool: {
			transform: async (apply) => {
				apply(toolEditor);
				return {
					dispose: async () => {
						tools.clear();
					},
				};
			},
			reload: async () => {},
			list: async () => toolEditor.list(),
			hook: toolHooks.hook,
		},
		command: {
			...client.command,
			transform: async (apply) => {
				const names: string[] = [];
				apply({
					add(definition) {
						commands.set(definition.name, definition);
						names.push(definition.name);
					},
				});
				return {
					dispose: async () => {
						for (const name of names) commands.delete(name);
					},
				};
			},
			reload: async () => {},
		},
		event: events,
		rpc: Object.assign(client.rpc, {
			register: async () => ({
				dispose: async () => {},
				events: { emit: async () => {} },
			}),
		}),
		permission: {
			...client.permission,
			hook: unsupported,
			assert: async (input) => {
				permissions.push(input);
			},
		},
		model: {
			...client.model,
			list: async () => ({ location: { directory: workspace }, data: [] }),
			transform: unsupported,
			reload: unsupported,
		},
		provider: {
			...client.provider,
			transform: async (apply) => {
				apply({
					list: () => [],
					get: () => undefined,
					add() {},
					update() {},
					remove() {},
					models: { set() {}, update() {}, remove() {} },
				});
				return { dispose: async () => {} };
			},
			reload: unsupported,
		},
		aisdk: { hook: unsupported },
		credential: { activate: unsupported },
		experimental: { terminal: { read: unsupported } },
		integration: {
			...client.integration,
			transform: unsupported,
			reload: unsupported,
			connection: {
				active: unsupported,
				resolve: unsupported,
				status: unsupported,
			},
		},
		mcp: { ...client.mcp, transform: unsupported, reload: unsupported },
		reference: {
			...client.reference,
			transform: unsupported,
			reload: unsupported,
		},
		shell: { hook: unsupported },
		skill: { ...client.skill, transform: unsupported, reload: unsupported },
		storage: {
			get: unsupported,
			set: unsupported,
			remove: unsupported,
			scan: unsupported,
		},
		vcs: { ...client.vcs, transform: unsupported, reload: unsupported },
		websearch: {
			...client.websearch,
			transform: unsupported,
			reload: unsupported,
		},
		worktree: {
			...client.worktree,
			transform: unsupported,
			reload: unsupported,
		},
		generate: client.generate,
		plugin: client.plugin,
	};
	const cleanups: Array<() => void | Promise<void>> = [];
	async function beginTurn(host = "ses_manager") {
		const session = ensureSession(host);
		if (
			!history(host).some(
				(message) =>
					message.type === "user" ||
					message.type === "synthetic" ||
					(message.type === "compaction" && message.status === "completed"),
			)
		)
			await prompt({ sessionID: host, text: "Inspect current Flow state." });
		if (!session.agent || !session.model)
			throw new Error("Unselected native session.");
		const native = history(host);
		const requestContext: SessionContext = {
			sessionID: Session.ID.make(host),
			agent: Agent.ID.make(session.agent),
			model: Model.Ref.make({
				providerID: Model.Ref.parse(
					`${session.model.providerID}/${session.model.id}`,
				).providerID,
				id: Model.ID.make(session.model.id),
				...(session.model.variant
					? { variant: Model.VariantID.make(session.model.variant) }
					: {}),
			}),
			system: [],
			messages: native.flatMap((message) =>
				message.type === "user" ||
				message.type === "synthetic" ||
				(message.type === "compaction" && message.status === "completed")
					? [
							{
								role: "user" as const,
								id: message.id,
								content: [
									{
										type: "text" as const,
										text:
											message.type === "compaction"
												? message.summary
												: message.text,
									},
								],
							},
						]
					: [],
			),
			tools: {},
			options: {},
		};
		await sessionHooks.emit("context", requestContext);
		contexts.set(host, requestContext);
		const request = new Request("http://native-fixture.invalid/primary");
		await sessionHooks.emit("http.request", {
			...requestContext,
			kind: "primary",
			request,
		});
		const response = {
			...requestContext,
			kind: "primary" as const,
			request,
			response: new Response("fixture-complete"),
		};
		await sessionHooks.emit("http.response", response);
		await response.response.text();
		const assistant: SessionMessageAssistant = {
			id: SessionMessage.ID.create(),
			type: "assistant",
			agent: session.agent,
			model: session.model,
			content: [],
			time: { created: stamp() },
		};
		native.push(assistant);
		active.set(host, assistant);
		return assistant;
	}
	async function toolContext(
		name: string,
		input: unknown,
		host = "ses_manager",
	): Promise<ToolContext> {
		const assistant = active.get(host) ?? (await beginTurn(host));
		const id = CallID.make(`call_${stamp()}`);
		const call: SessionMessageAssistantTool = {
			type: "tool",
			id,
			name,
			state: {
				status: "running",
				input: z.record(z.string(), z.json()).parse(input),
				metadata: {},
			},
			time: { created: stamp() },
		};
		assistant.content.push(call);
		return {
			sessionID: Session.ID.make(host),
			messageID: SessionMessage.ID.make(assistant.id),
			agent: Agent.ID.make(assistant.agent),
			id,
			signal: new AbortController().signal,
			progress: async () => {},
		};
	}
	async function invoke(name: string, input: unknown, native: ToolContext) {
		const definition = tools.get(name);
		if (!definition) throw new Error(`Missing native tool ${name}.`);
		const before: NativeToolBefore = {
			tool: name,
			input,
			sessionID: native.sessionID,
			messageID: native.messageID,
			agent: native.agent,
			id: native.id,
		};
		await toolHooks.emit("execute.before", before);
		try {
			const result = await definition.execute(input, native);
			await toolHooks.emit("execute.after", {
				...before,
				status: "completed",
				result,
			});
			return result;
		} catch (error) {
			await toolHooks.emit("execute.after", {
				...before,
				status: "error",
				error: new ToolError({ message: String(error) }),
			});
			throw error;
		}
	}
	return {
		context,
		tools,
		commands,
		agents,
		sessions,
		messages,
		prompts,
		synthetics,
		nextSynthetic(
			host: string,
			matches: (input: SessionSyntheticInput) => boolean = () => true,
		) {
			return new Promise<SessionSyntheticInput>((resolve) => {
				const observe = (input: SessionSyntheticInput) => {
					if (input.sessionID !== host || !matches(input)) return;
					syntheticObservers.delete(observe);
					resolve(structuredClone(input));
				};
				syntheticObservers.add(observe);
			});
		},
		admissions,
		permissions,
		events,
		sessionHooks,
		toolHooks,
		ensureSession,
		history,
		beginTurn,
		toolContext,
		invoke,
		async load(plugin: Plugin.Plugin) {
			const prior = process.env.XDG_STATE_HOME;
			process.env.XDG_STATE_HOME = join(workspace, ".native-fixture-data");
			try {
				const cleanup = await plugin.setup(context);
				if (cleanup) cleanups.push(cleanup);
			} finally {
				if (prior === undefined) delete process.env.XDG_STATE_HOME;
				else process.env.XDG_STATE_HOME = prior;
			}
		},
		async dispose() {
			syntheticObservers.clear();
			for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
		},
		async command(
			name: string,
			args = "",
			host = "ses_manager",
			extra: Partial<CommandInvocation["prompt"]> = {},
		) {
			ensureSession(host);
			const command = commands.get(name);
			if (!command) throw new Error(`Missing command ${name}.`);
			await command.execute({
				sessionID: Session.ID.make(host),
				prompt: { text: args, ...extra },
				delivery: "queue",
			});
			return prompts.at(-1);
		},
		async admit(
			text: string,
			host = "ses_manager",
			extra: Omit<SessionPromptInput, "sessionID" | "text"> = {},
		) {
			return prompt({ sessionID: host, text, ...extra });
		},
		async call(name: string, input: unknown, host = "ses_manager") {
			return invoke(name, input, await toolContext(name, input, host));
		},
		async response(name: string, input: unknown, host = "ses_manager") {
			const result = await this.call(name, input, host);
			const parsed: unknown = JSON.parse(nativeText(result));
			return parseFlowResponse(parsed);
		},
		async compact(host = "ses_manager", reason: "auto" | "manual" = "auto") {
			if (!active.has(host)) await beginTurn(host);
			const prior = contexts.get(host);
			if (!prior) throw new Error("Missing primary context.");
			const control = {
				id: SessionMessage.ID.create(),
				type: "compaction" as const,
				status: "running" as const,
				reason,
				summary: "Fixture native summary.",
				time: { created: stamp() },
			};
			history(host).push(control);
			const input: SessionHooks["compaction"] = { ...prior, system: [] };
			await sessionHooks.emit("compaction", input);
			messages.set(host, [{ ...control, status: "completed" }]);
			active.delete(host);
			return input.system;
		},
		async idle(
			host = "ses_manager",
			outcome: "succeeded" | "failed" | "interrupted" = "succeeded",
		) {
			const session = ensureSession(host);
			const completedAt = stamp();
			const eventID = `evt_${stamp()}`;
			session.time.idle = completedAt;
			session.outcome = outcome;
			history(host).push({
				id: SessionMessage.ID.fromEvent(eventID),
				type: "idle",
				outcome,
				time: { created: completedAt },
			});
			await events.emit({
				id: eventID,
				created: completedAt,
				durable: { aggregateID: host, seq: stamp(), version: 1 },
				...(outcome === "succeeded"
					? {
							type: "session.execution.succeeded" as const,
							data: { sessionID: host },
						}
					: outcome === "failed"
						? {
								type: "session.execution.failed" as const,
								data: {
									sessionID: host,
									error: {
										type: "fixture",
										message: "Fixture execution failed.",
									},
								},
							}
						: {
								type: "session.execution.interrupted" as const,
								data: { sessionID: host, reason: "user" as const },
							}),
			});
		},
	};
}
export type NativeFlowHost = Awaited<ReturnType<typeof createNativeFlowHost>>;
