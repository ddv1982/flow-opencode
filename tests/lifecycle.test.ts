import { expect, spyOn, test } from "bun:test";
import type {
	OpenCodeEvent,
	SessionInboxUser,
	SessionInfo,
	SessionMessageInfo,
} from "@opencode/client";
import { Agent, Model, Provider } from "@opencode/plugin";
import type { CommandDefinition } from "@opencode/plugin/promise/command";
import type { Context } from "@opencode/plugin/promise/plugin";
import type {
	SessionContext,
	SessionHooks,
} from "@opencode/plugin/promise/session";
import { CallID } from "@opencode/plugin/promise/tool";
import { AbsolutePath } from "@opencode/schema/schema";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { createFlowService } from "../src/application/flow-service.js";
import { RecoveryController } from "../src/application/recovery-policy.js";
import type { FlowCodingModel } from "../src/config-shared.js";
import {
	AutoDriveCoordinator,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";
import { ExecutionAttribution } from "../src/platform/opencode/execution-attribution.js";
import { registerFlowLifecycle } from "../src/platform/opencode/lifecycle.js";
import type { NativeToolDefinition } from "../src/platform/opencode/sdk.js";
import { registerFlowTools } from "../src/platform/opencode/tools.js";
import {
	deterministicEnvironment,
	MemorySessionRepository,
} from "./runtime-test-support.js";

type Callback<T> = (input: T) => Promise<void> | void;
type HookSets<Spec> = { [Name in keyof Spec]: Set<Callback<Spec[Name]>> };
const sessionID = Session.ID.make("session-lifecycle");
const agent = Agent.ID.make("build");
const model = {
	providerID: Provider.ID.make("local"),
	id: Model.ID.make("scripted"),
};
const directory = AbsolutePath.make(process.cwd());
const delivery = {
	agent,
	model: { providerID: model.providerID, modelID: model.id },
};
function hookSets(): HookSets<SessionHooks> {
	return {
		prompt: new Set(),
		context: new Set(),
		compaction: new Set(),
		generate: new Set(),
		title: new Set(),
		"model.request": new Set(),
		"http.request": new Set(),
		"http.response": new Set(),
		"experimental.ws.handshake": new Set(),
		"experimental.ws.send": new Set(),
		"experimental.ws.receive": new Set(),
		retry: new Set(),
	};
}
async function fixture(selectedAgent = agent) {
	const hooks = hookSets();
	const commands = new Map<string, CommandDefinition>();
	const registrations: string[] = [];
	const native: SessionMessageInfo[] = [];
	const children: SessionInfo[] = [];
	const session: SessionInfo = {
		id: sessionID,
		agent: selectedAgent,
		model,
		projectID: "project",
		location: { directory },
		time: { created: 0, updated: 0 },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
	};
	let projection: AutoDriveProjection = {
		sessionId: "flow-1",
		revision: 4,
		status: "planning",
		nextAction: "flow_plan_approve",
	};
	const logs: string[] = [];
	const codingModels = new Map<string, FlowCodingModel>();
	const repository = new MemorySessionRepository();
	const flow = createFlowService(repository, deterministicEnvironment());
	const recovery = new RecoveryController({
		assess: async () => ({ kind: "unavailable", reason: "test" }),
	});
	let admissionBlocked: (() => void) | null = null;
	let admissionGate: Promise<void> | null = null;
	let corruptReceipt = false;
	let corruptMarker = false;
	let sessionReadFailure = false;
	let rejectContextRead = false;
	let rejectSessionRead = false;
	let sessionReadGate: Promise<void> | null = null;
	let releaseSessionRead: (() => void) | null = null;
	let sessionEntered = Promise.withResolvers<void>();
	let contextReadGate: Promise<void> | null = null;
	let releaseContextRead: (() => void) | null = null;
	let contextEntered = Promise.withResolvers<void>();
	let lost = false;
	let pushEvent: ((event: OpenCodeEvent | null) => void) | null = null;
	const queuedEvents: OpenCodeEvent[] = [];
	const eventHandled = new Map<string, () => void>();
	async function waitAdmission(signal?: AbortSignal) {
		if (!admissionGate) return;
		if (!signal) return admissionGate;
		const cancelled = Promise.withResolvers<never>();
		const abort = () =>
			cancelled.reject(new Error("Native admission aborted."));
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		try {
			await Promise.race([admissionGate, cancelled.promise]);
		} finally {
			signal.removeEventListener("abort", abort);
		}
	}
	async function emit<Name extends keyof SessionHooks>(
		name: Name,
		input: SessionHooks[Name],
	): Promise<void> {
		for (const callback of hooks[name]) await callback(input);
	}
	type NativeHook = Parameters<Parameters<Context["tool"]["hook"]>[1]>[0];
	const toolCallbacks: HookSets<{
		"execute.before": Exclude<NativeHook, { status: string }>;
		"execute.after": Extract<NativeHook, { status: string }>;
	}> = { "execute.before": new Set(), "execute.after": new Set() };
	const ctx: Parameters<typeof registerFlowLifecycle>[0]["ctx"] = {
		location: { directory },
		session: {
			hook: async (name, callback) => {
				hooks[name].add(callback);
				return {
					dispose: async () => {
						hooks[name].delete(callback);
						registrations.push(name);
					},
				};
			},
			get: async (input) => {
				if (sessionReadFailure) {
					sessionReadFailure = false;
					throw new Error("Native session read failed.");
				}
				const shouldReject = rejectSessionRead;
				rejectSessionRead = false;
				const snapshot = structuredClone(
					children.find((child) => child.id === input.sessionID) ?? session,
				);
				const gate = sessionReadGate;
				sessionReadGate = null;
				if (gate) {
					sessionEntered.resolve();
					await gate;
				}
				if (shouldReject) throw new Error("Native session snapshot failed.");
				return snapshot;
			},
			context: async () => {
				const shouldReject = rejectContextRead;
				rejectContextRead = false;
				const snapshot = structuredClone(native);
				const gate = contextReadGate;
				contextReadGate = null;
				if (gate) {
					contextEntered.resolve();
					await gate;
				}
				if (shouldReject) throw new Error("Native context snapshot failed.");
				return snapshot;
			},
			create: async (input) => {
				const child = {
					...session,
					id: "session-child",
					parentID: input?.parentID ?? sessionID,
					agent: input?.agent ?? agent,
				};
				children.push(child);
				return child;
			},
			prompt: async (input, request) => {
				const id = SessionMessage.ID.make(input.id ?? "msg_external");
				await emit("prompt", {
					sessionID: Session.ID.make(input.sessionID),
					messageID: id,
					prompt: { text: input.text },
					...(input.metadata === undefined
						? {}
						: { metadata: structuredClone(input.metadata) }),
					delivery: input.delivery ?? "queue",
				});
				const receipt: SessionInboxUser = {
					id,
					sessionID: input.sessionID,
					type: "user",
					payload: {
						text: input.text,
						...(input.metadata === undefined
							? {}
							: { metadata: structuredClone(input.metadata) }),
					},
					time: { created: 0 },
					delivery: input.delivery ?? "queue",
				};
				native.push({
					type: "user",
					id,
					text: input.text,
					...(input.metadata === undefined
						? {}
						: { metadata: structuredClone(input.metadata) }),
					time: { created: 0 },
				});
				await waitAdmission(request?.signal);
				return corruptMarker
					? {
							...receipt,
							payload: {
								...receipt.payload,
								metadata: { [FLOW_AUTO_METADATA_KEY]: "forged-marker" },
							},
						}
					: corruptReceipt
						? { ...receipt, id: "msg_wrong" }
						: receipt;
			},
			synthetic: async (input, request) => {
				const id = input.id ?? "msg_synthetic";
				native.push({
					type: "synthetic",
					id,
					text: input.text,
					...(input.metadata === undefined
						? {}
						: { metadata: { ...input.metadata } }),
					time: { created: 0 },
				});
				await waitAdmission(request?.signal);
				return {
					id,
					sessionID: input.sessionID,
					type: "synthetic",
					payload: {
						text: input.text,
						...(input.metadata === undefined
							? {}
							: { metadata: { ...input.metadata } }),
					},
					time: { created: 0 },
					delivery: input.delivery ?? "queue",
				};
			},
		},
		command: {
			transform: async (callback) => {
				callback({
					add: (definition) => {
						commands.set(definition.name, definition);
					},
				});
				return {
					dispose: async () => {
						commands.clear();
						registrations.push("command");
					},
				};
			},
		},
		tool: {
			hook: async (name, callback) => {
				toolCallbacks[name].add(callback);
				return {
					dispose: async () => {
						toolCallbacks[name].delete(callback);
						registrations.push("tool");
					},
				};
			},
		},
		agent: {
			get: async () => ({
				location: { directory },
				data: {
					id: "flow-reviewer",
					name: "flow-reviewer",
					mode: "subagent",
					hidden: true,
					permissions: [],
					request: { settings: {}, headers: {}, body: {} },
				},
			}),
		},
		event: {
			subscribe: async function* (request) {
				while (!request?.signal?.aborted && !lost) {
					const event =
						queuedEvents.shift() ??
						(await new Promise<OpenCodeEvent | null>((resolve) => {
							pushEvent = resolve;
							request?.signal?.addEventListener("abort", () => resolve(null), {
								once: true,
							});
						}));
					if (event) {
						yield event;
						eventHandled.get(event.id)?.();
						eventHandled.delete(event.id);
					}
					if (event === null) break;
				}
			},
		},
	};
	let lifecycle: Awaited<ReturnType<typeof registerFlowLifecycle>>;
	const autoDrive = new AutoDriveCoordinator({
		recovery,
		readProjection: async () => projection,
		prompt: (...args) => lifecycle.prompt(...args),
		createToken: () => "local-token",
	});
	lifecycle = await registerFlowLifecycle({
		ctx,
		autoDrive,
		recovery,
		flow,
		codingModels,
		runtimeGuard: {
			query: () => ({
				operational: true,
				reason: "sole-instance",
				message: "active",
			}),
			assertOperational: () => {},
			release: () => true,
		},
		log: (_level, message) => {
			logs.push(message);
		},
	});
	const context = (): SessionContext => ({
		sessionID,
		agent: selectedAgent,
		model,
		system: [],
		options: {},
		tools: {},
		messages: native
			.filter(
				(message) =>
					message.type === "user" ||
					message.type === "synthetic" ||
					(message.type === "compaction" && message.status === "completed"),
			)
			.map((message) => ({
				role: "user",
				id: message.id,
				content: [
					{
						type: "text",
						text: "text" in message ? message.text : "checkpoint",
					},
				],
			})),
	});
	return {
		lifecycle,
		autoDrive,
		recovery,
		repository,
		hooks,
		commands,
		logs,
		native,
		session,
		children,
		registrations,
		codingModels,
		emit,
		context,
		toolCallbacks,
		setProjection(value: AutoDriveProjection) {
			projection = value;
		},
		rejectNextContextRead() {
			rejectContextRead = true;
		},
		rejectNextSessionRead() {
			rejectSessionRead = true;
		},
		allowNewAdmissions() {
			admissionGate = null;
		},
		blockAdmission() {
			admissionGate = new Promise<void>((resolve) => {
				admissionBlocked = resolve;
			});
		},
		releaseAdmission() {
			admissionBlocked?.();
			admissionGate = null;
		},
		corruptReceipt() {
			corruptReceipt = true;
		},
		corruptMarkerReceipt() {
			corruptMarker = true;
		},
		waitSessionRead() {
			return sessionEntered.promise;
		},
		blockNextSessionRead() {
			sessionEntered = Promise.withResolvers<void>();
			sessionReadGate = new Promise<void>((resolve) => {
				releaseSessionRead = resolve;
			});
		},
		releaseSessionRead() {
			releaseSessionRead?.();
		},
		waitContextRead() {
			return contextEntered.promise;
		},
		blockNextContextRead() {
			contextEntered = Promise.withResolvers<void>();
			const gate = Promise.withResolvers<void>();
			contextReadGate = gate.promise;
			releaseContextRead = gate.resolve;
			return gate.resolve;
		},
		releaseContextRead() {
			releaseContextRead?.();
		},
		failNextSessionRead() {
			sessionReadFailure = true;
		},
		loseStream() {
			lost = true;
			pushEvent?.(null);
		},
		async sendEventAndWait(event: OpenCodeEvent) {
			const handled = Promise.withResolvers<void>();
			eventHandled.set(event.id, handled.resolve);
			if (pushEvent) {
				const push = pushEvent;
				pushEvent = null;
				push(event);
			} else queuedEvents.push(event);
			await handled.promise;
		},
		sendEvent(event: OpenCodeEvent) {
			if (pushEvent) {
				const push = pushEvent;
				pushEvent = null;
				push(event);
			} else queuedEvents.push(event);
		},
		async command(name: string, text: string) {
			const command = commands.get(name);
			if (!command) throw new Error("missing command");
			await command.execute({ sessionID, prompt: { text }, delivery: "queue" });
		},
		async flush() {
			for (let i = 0; i < 20; i++) await Promise.resolve();
		},
	};
}

test("all five native commands register and stop grants no new automatic authority", async () => {
	const f = await fixture();
	try {
		expect([...f.commands.keys()]).toEqual([
			"flow-auto",
			"flow-plan",
			"flow-run",
			"flow-review",
			"flow-status",
		]);
		await f.command("flow-auto", "Inspect this project and create a plan");
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
		await f.command("flow-auto", "stop");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("pre-admission command hooks grant no lease or Flow write and join after acceptance", async () => {
	const f = await fixture();
	try {
		f.blockAdmission();
		const command = f.command(
			"flow-auto",
			"Inspect this project and create a plan",
		);
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
		expect(f.native[0]?.metadata).toEqual({
			[FLOW_AUTO_METADATA_KEY]: "local-token",
		});
		let ready = false;
		const context = f.emit("context", f.context()).then(() => {
			ready = true;
		});
		await f.flush();
		expect(ready).toBe(false);
		f.releaseAdmission();
		await Promise.all([command, context]);
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
		await f.lifecycle.prompt(
			sessionID,
			"Continue the accepted goal",
			delivery,
			{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
		);
		expect(f.native.map((message) => message.metadata)).toEqual([
			{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
			{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
		]);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("a mismatched command receipt cannot activate automatic execution", async () => {
	const f = await fixture();
	try {
		f.corruptReceipt();
		await expect(
			f.command("flow-auto", "Inspect this project and create a plan"),
		).rejects.toThrow("receipt");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("new real input vetoes an old automatic context and a stale native shell", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/primary"),
		});
		const assistantID = SessionMessage.ID.make("msg_manager");
		const callID = CallID.make("call_shell");
		f.native.push({
			type: "assistant",
			id: assistantID,
			agent,
			model,
			time: { created: 1 },
			content: [
				{
					type: "tool",
					id: callID,
					name: "shell",
					time: { created: 1 },
					state: {
						status: "running",
						input: { command: "touch forbidden" },
						metadata: {},
					},
				},
			],
		});
		const execution = {
			sessionID,
			agent,
			messageID: assistantID,
			id: callID,
			signal: new AbortController().signal,
			progress: async () => {},
		};
		await f.lifecycle.beforeTool(execution);
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_stop"),
			prompt: { text: "Stop and change direction" },
			delivery: "steer",
		});
		await expect(f.lifecycle.beforeTool(execution)).rejects.toThrow("epoch");
		await expect(f.emit("context", f.context())).rejects.toThrow();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("synthetic delivery preserves selected agent and model and refuses stale tokens", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		await expect(
			f.lifecycle.prompt(
				sessionID,
				"next",
				{ ...delivery, agent: "plan" },
				{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
			),
		).rejects.toThrow("selected agent or model");
		await expect(
			f.lifecycle.prompt(sessionID, "next", delivery, {
				[FLOW_AUTO_METADATA_KEY]: "forged-token",
			}),
		).rejects.toThrow("authenticated token");
	} finally {
		await f.lifecycle.dispose();
	}
});
test("stream loss clears authority and unload aborts and disposes native registrations", async () => {
	const f = await fixture();
	await f.command("flow-auto", "Inspect this project and create a plan");
	f.loseStream();
	await f.flush();
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.logs).toEqual(["Flow event stream failed closed."]);
	await f.lifecycle.dispose();
	expect([...f.commands.keys()]).toEqual([]);
	await expect(
		f.lifecycle.prompt(sessionID, "next", delivery, {
			[FLOW_AUTO_METADATA_KEY]: "local-token",
		}),
	).rejects.toThrow("unavailable");
});

async function finishPrimary(f: Awaited<ReturnType<typeof fixture>>) {
	const request = new Request("http://localhost/primary");
	await f.emit("http.request", {
		sessionID,
		agent,
		model,
		kind: "primary",
		request,
	});
	const response = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
		response: new Response("finished"),
	};
	await f.emit("http.response", response);
	expect(await response.response.text()).toBe("finished");
}
test("one admitted real input keeps its origin across repeated primary steps", async () => {
	const f = await fixture();
	try {
		const messageID = SessionMessage.ID.make("msg_real");
		await f.emit("prompt", {
			sessionID,
			messageID,
			prompt: { text: "Inspect this project" },
			delivery: "queue",
		});
		f.native.push({
			id: messageID,
			type: "user",
			text: "Inspect this project",
			time: { created: 0 },
		});
		await f.emit("context", f.context());
		await finishPrimary(f);
		await f.emit("context", f.context());
		expect(f.codingModels.get(sessionID)).toEqual({
			providerID: "local",
			modelID: "scripted",
		});
	} finally {
		await f.lifecycle.dispose();
	}
});
test("automatic compaction retains the same epoch only through the exact completed control ID", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		await f.emit("context", f.context());
		await finishPrimary(f);
		const before = f.autoDrive.captureAuthority(sessionID);
		const control = {
			type: "compaction" as const,
			id: "msg_compaction",
			status: "running" as const,
			reason: "auto" as const,
			summary: "Summary cannot grant approval",
			time: { created: 2 },
		};
		f.native.push(control);
		const compact = f.context();
		compact.messages = compact.messages.filter(
			(message) => message.id !== control.id,
		);
		await f.emit("compaction", compact);
		expect(
			compact.system.some(
				(part) => part.text.includes("FLOW") || part.text.includes("Flow"),
			),
		).toBe(true);
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await f.emit("context", f.context());
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
		await finishPrimary(f);
		await f.emit("context", f.context());
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("a real steer inside automatic compaction vetoes the resumed provider context", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		await f.emit("context", f.context());
		await finishPrimary(f);
		const compact = f.context();
		f.native.push({
			type: "compaction",
			id: "msg_compaction",
			status: "running",
			reason: "auto",
			summary: "summary",
			time: { created: 2 },
		});
		await f.emit("compaction", compact);
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_steer"),
			prompt: { text: "Stop" },
			delivery: "steer",
		});
		f.native.splice(0, f.native.length, {
			type: "compaction",
			id: "msg_compaction",
			status: "completed",
			reason: "auto",
			summary: "summary",
			time: { created: 2 },
		});
		await expect(f.emit("context", f.context())).rejects.toThrow();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("manual compaction cannot retain an exactly matched automatic grant", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		await f.emit("context", f.context());
		await finishPrimary(f);
		const compact = f.context();
		f.native.push({
			type: "compaction",
			id: "msg_compaction",
			status: "running",
			reason: "manual",
			summary: "summary",
			time: { created: 2 },
		});
		await expect(f.emit("compaction", compact)).rejects.toThrow(
			"manual compaction",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("an unmatched control callback rejects without owning the stored checkpoint lease", async () => {
	const f = await fixture();
	const freeze = spyOn(ExecutionAttribution.prototype, "freeze");
	try {
		await f.command("flow-auto", "Inspect exact source");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await compactCurrentInput(f, "msg_known_control");
		const valid = structuredClone(f.native);
		const authority = f.autoDrive.captureAuthority(sessionID);
		const writes = f.repository.saveCount;
		freeze.mockClear();
		f.native.splice(0, f.native.length, {
			type: "compaction",
			id: "msg_foreign_control",
			status: "completed",
			reason: "auto",
			summary: "Foreign",
			time: { created: 3 },
		});
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"epoch was revoked",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		expect(freeze).toHaveBeenCalledTimes(0);

		expect(f.repository.saveCount).toBe(writes);
		f.native.splice(0, f.native.length, ...valid);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(freeze).toHaveBeenCalledTimes(1);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		freeze.mockRestore();
		await f.lifecycle.dispose();
	}
});

test("review dispatch creates the reserved native child after the parent admission", async () => {
	const f = await fixture();
	try {
		await f.command("flow-review", "Review assignment review-1");
		expect(
			f.children.map((child) => ({
				id: child.id,
				parentID: child.parentID,
				agent: child.agent,
			})),
		).toEqual([
			{
				id: "session-child",
				parentID: "session-lifecycle",
				agent: "flow-reviewer",
			},
		]);
		const childInput = f.native.at(-1);
		expect(
			childInput?.type === "user" ? childInput.text.split("\n")[0] : "missing",
		).toBe("Flow flow-review: Review assignment review-1");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("real-input revocation invalidates an already acquired recovery guard without resetting its budget", async () => {
	const f = await fixture();
	try {
		await f.command(
			"flow-auto",
			'--recovery=shadow --recovery-calls=2 --recovery-usd=0.1 Implement the test named "must pass"',
		);
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/primary"),
		});
		const messageID = SessionMessage.ID.make("msg_recovery_manager");
		const id = CallID.make("call_close");
		f.native.push({
			type: "assistant",
			id: messageID,
			agent,
			model,
			time: { created: 1 },
			content: [
				{
					type: "tool",
					id,
					name: "flow_session_close",
					time: { created: 1 },
					state: { status: "running", input: {}, metadata: {} },
				},
			],
		});
		await f.lifecycle.beforeTool({
			sessionID,
			agent,
			messageID,
			id,
			signal: new AbortController().signal,
			progress: async () => {},
		});
		const guard = f.recovery.guard({
			hostSessionId: sessionID,
			messageId: messageID,
			agent,
		});
		const session = f.repository.session;
		if (!session)
			throw new Error("Command did not anchor its declared assertion.");
		const close = {
			operationId: "close",
			expectedRevision: session.revision,
			sessionId: session.id,
			kind: "completed" as const,
			summary: "done",
		};
		guard.checkClose(session, close);
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_new_direction"),
			prompt: { text: "Stop" },
			delivery: "steer",
		});
		expect(() => guard.checkClose(session, close)).toThrow("lineage expired");
		expect(f.recovery.snapshot(sessionID)).toMatchObject({
			mode: "shadow",
			remainingCalls: 2,
			maxUsd: 0.1,
		});
	} finally {
		await f.lifecycle.dispose();
	}
});
test("duplicate succeeded idle notifications dispatch only one continuation", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Implement the approved change");
		await f.emit("context", f.context());
		await finishPrimary(f);
		const input = f.native.at(-1);
		if (!input) throw new Error("Missing accepted input.");
		f.autoDrive.observeAssistant(sessionID, "msg_manager", input.id);
		f.autoDrive.observeMutation(sessionID, 5, undefined, "msg_manager", false);
		f.setProjection({
			sessionId: "flow-1",
			revision: 5,
			status: "ready",
			nextAction: "flow_run_start",
		});
		f.session.outcome = "succeeded";
		f.session.time.idle = 3;
		const event: OpenCodeEvent = {
			id: "evt_idle",
			created: 3,
			type: "session.idle",
			data: { sessionID },
		};
		f.sendEvent(event);
		await f.flush();
		f.sendEvent(event);
		await f.flush();
		expect(
			f.native
				.filter((message) => message.type === "synthetic")
				.map((message) => message.type),
		).toEqual(["synthetic"]);
	} finally {
		await f.lifecycle.dispose();
	}
});

test.each(["failed", "interrupted"] as const)(
	"duplicate native %s outcomes cannot revoke a later accepted invocation",
	async (outcome) => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Inspect this project and create a plan");
			await f.emit("context", f.context());
			f.native.push({
				id: "msg_terminal",
				type: "idle",
				time: { created: 1 },
				outcome,
			});
			const durable = { aggregateID: sessionID, seq: 1, version: 1 as const };
			const event: OpenCodeEvent =
				outcome === "failed"
					? {
							id: "evt_failed",
							type: "session.execution.failed",
							created: 1,
							durable,
							data: {
								sessionID,
								error: { type: "provider", message: "failed" },
							},
						}
					: {
							id: "evt_interrupted",
							type: "session.execution.interrupted",
							created: 1,
							durable,
							data: { sessionID, reason: "user" },
						};
			f.sendEvent(event);
			await f.flush();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			await f.command("flow-auto", "Inspect the new approved direction");
			const accepted = f.autoDrive.captureAuthority(sessionID);
			f.sendEvent(event);
			await f.flush();
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(accepted);
			expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe(
				"local-token",
			);
		} finally {
			await f.lifecycle.dispose();
		}
	},
);

test("unload aborts an idle-triggered native admission and waits for subscription return", async () => {
	const f = await fixture();
	await f.command("flow-auto", "Implement the approved change");
	await f.emit("context", f.context());
	await finishPrimary(f);
	const input = f.native.at(-1);
	if (!input) throw new Error("Missing accepted input.");
	f.autoDrive.observeAssistant(sessionID, "msg_manager", input.id);
	f.autoDrive.observeMutation(sessionID, 5, undefined, "msg_manager", false);
	f.setProjection({
		sessionId: "flow-1",
		revision: 5,
		status: "ready",
		nextAction: "flow_run_start",
	});
	f.blockAdmission();
	f.session.outcome = "succeeded";
	f.session.time.idle = 3;
	f.sendEvent({
		id: "evt_idle",
		created: 3,
		type: "session.idle",
		data: { sessionID },
	});
	await f.flush();
	expect(
		f.native.filter((message) => message.type === "synthetic").length,
	).toBe(1);
	await f.lifecycle.dispose();
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect([...f.commands.keys()]).toEqual([]);
	f.releaseAdmission();
});

test("native execution success dispatches from the session watermark without an idle context record", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Implement the approved change");
		await f.emit("context", f.context());
		await finishPrimary(f);
		const input = f.native.at(-1);
		if (!input) throw new Error("Missing accepted input.");
		f.autoDrive.observeAssistant(sessionID, "msg_manager", input.id);
		f.autoDrive.observeMutation(sessionID, 5, undefined, "msg_manager", false);
		f.setProjection({
			sessionId: "flow-1",
			revision: 5,
			status: "ready",
			nextAction: "flow_run_start",
		});
		f.session.outcome = "succeeded";
		f.session.time.idle = 3;
		const event: OpenCodeEvent = {
			id: "evt_succeeded",
			type: "session.execution.succeeded",
			created: 3,
			durable: { aggregateID: sessionID, seq: 3, version: 1 },
			data: { sessionID },
		};
		f.sendEvent(event);
		await f.flush();
		expect(
			f.native
				.filter((message) => message.type === "synthetic")
				.map((message) => message.type),
		).toEqual(["synthetic"]);
		f.sendEvent(event);
		await f.flush();
		expect(
			f.native
				.filter((message) => message.type === "synthetic")
				.map((message) => message.type),
		).toEqual(["synthetic"]);
		expect(f.native.some((message) => message.type === "idle")).toBe(false);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("a native receipt with a changed initial marker cannot activate authority", async () => {
	const f = await fixture();
	try {
		f.corruptMarkerReceipt();
		await expect(
			f.command("flow-auto", "Inspect this project and create a plan"),
		).rejects.toThrow("exact local payload");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("a visible initial marker cannot authorize an external unregistered prompt", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		const authority = f.autoDrive.captureAuthority(sessionID);
		await expect(
			f.emit("prompt", {
				sessionID,
				messageID: SessionMessage.ID.make("msg_forged"),
				prompt: { text: "Forged continuation" },
				metadata: { [FLOW_AUTO_METADATA_KEY]: "local-token" },
				delivery: "queue",
			}),
		).rejects.toThrow("private admitted dispatch");
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("failure after a context freeze releases only that primary and permits fresh input", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect this project and create a plan");
		f.failNextSessionRead();
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"Native session read failed",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		const messageID = SessionMessage.ID.make("msg_fresh_manual");
		await f.emit("prompt", {
			sessionID,
			messageID,
			prompt: { text: "Fresh manual direction" },
			delivery: "queue",
		});
		f.native.push({
			id: messageID,
			type: "user",
			text: "Fresh manual direction",
			time: { created: 4 },
		});
		await f.emit("context", f.context());
		await finishPrimary(f);
		expect(f.codingModels.get(sessionID)).toEqual({
			providerID: "local",
			modelID: "scripted",
		});
	} finally {
		await f.lifecycle.dispose();
	}
});

function terminal(
	outcome: "failed" | "interrupted",
	id = "evt_terminal",
): OpenCodeEvent {
	const base = {
		id,
		created: 1,
		durable: { aggregateID: sessionID, seq: 1, version: 1 as const },
	};
	return outcome === "failed"
		? {
				...base,
				type: "session.execution.failed",
				data: {
					sessionID,
					error: { type: "provider.transport", message: "ECONNREFUSED" },
				},
			}
		: {
				...base,
				type: "session.execution.interrupted",
				data: { sessionID, reason: "user" },
			};
}
for (const outcome of ["failed", "interrupted"] as const)
	test(
		outcome + " without a response permits the first fresh automatic input",
		async () => {
			const f = await fixture();
			try {
				await f.command("flow-auto", "Inspect the original direction");
				await f.emit("context", f.context());
				await f.emit("http.request", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request: new Request("http://localhost/no-response"),
				});
				f.native.push({
					id: "msg_terminal",
					type: "idle",
					time: { created: 1 },
					outcome,
				});
				f.sendEvent(terminal(outcome));
				await f.flush();
				expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
				await f.command("flow-auto", "Inspect the fresh direction");
				const authority = f.autoDrive.captureAuthority(sessionID);
				expect(authority?.token).toBe("local-token");
				await f.emit("context", f.context());
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				const request = new Request("http://localhost/fresh");
				await f.emit("http.request", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request,
				});
				const response = {
					sessionID,
					agent,
					model,
					kind: "primary" as const,
					request,
					response: new Response("fresh provider response"),
				};
				await f.emit("http.response", response);
				expect(await response.response.text()).toBe("fresh provider response");
				f.sendEvent(terminal(outcome, "evt_delayed_old"));
				await f.flush();
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			} finally {
				await f.lifecycle.dispose();
			}
		},
	);
test("fresh input retires old request even before its terminal event arrives", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/old"),
		});
		await f.command("flow-auto", "Inspect new");
		await f.emit("context", f.context());
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
	} finally {
		await f.lifecycle.dispose();
	}
});
test("fresh native primary retry state ends its response-less attempt and preserves the lease", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/refused"),
		});
		const authority = f.autoDrive.captureAuthority(sessionID);
		f.native.push({
			type: "assistant",
			id: "msg_retrying_primary",
			agent,
			model,
			time: { created: 1 },
			content: [],
			retry: {
				attempt: 2,
				at: 2000,
				error: { type: "provider.transport", message: "ECONNREFUSED" },
			},
		});
		await f.emit("retry", {
			sessionID,
			agent,
			model,
			error: { type: "provider.transport", message: "ECONNREFUSED" },
			attempt: 2,
			decision: { retry: true, delay: 2000 },
		});
		await f.emit("context", f.context());
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("an overlapping live epoch still fails closed", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect");
		await f.emit("context", f.context());
		await expect(f.emit("context", f.context())).rejects.toThrow("overlap");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const outcome of ["failed", "interrupted"] as const)
	test(
		"a delayed old " + outcome + " read cannot retire a replacement primary",
		async () => {
			const f = await fixture();
			try {
				await f.command("flow-auto", "Inspect original");
				await f.emit("context", f.context());
				await f.emit("http.request", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request: new Request("http://localhost/old"),
				});
				f.native.push({
					id: "msg_old_terminal",
					type: "idle",
					time: { created: 1 },
					outcome,
				});
				f.blockNextContextRead();
				f.sendEvent(terminal(outcome));
				await f.flush();
				await f.command("flow-auto", "Inspect replacement");
				const authority = f.autoDrive.captureAuthority(sessionID);
				await f.emit("context", f.context());
				const request = new Request("http://localhost/replacement");
				await f.emit("http.request", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request,
				});
				f.releaseContextRead();
				await f.flush();
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				const response = {
					sessionID,
					agent,
					model,
					kind: "primary" as const,
					request,
					response: new Response("replacement survived"),
				};
				await f.emit("http.response", response);
				expect(await response.response.text()).toBe("replacement survived");
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		},
	);

test("a delayed terminal session read cannot revoke a replacement primary", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		await finishPrimary(f);
		f.session.outcome = "failed";
		f.session.time.idle = 1;
		f.blockNextSessionRead();
		f.sendEvent({
			id: "evt_old_success_notification",
			type: "session.execution.succeeded",
			created: 1,
			durable: { aggregateID: sessionID, seq: 1, version: 1 },
			data: { sessionID },
		});
		await f.flush();
		await f.command("flow-auto", "Inspect replacement");
		const authority = f.autoDrive.captureAuthority(sessionID);
		await f.emit("context", f.context());
		const request = new Request("http://localhost/replacement");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		f.releaseSessionRead();
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		const response = {
			sessionID,
			agent,
			model,
			kind: "primary" as const,
			request,
			response: new Response("replacement survived"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe("replacement survived");
	} finally {
		f.releaseSessionRead();
		await f.lifecycle.dispose();
	}
});

test("native retry keeps its unfinished assistant and late old responses cannot revoke it", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		const oldRequest = new Request("http://localhost/refused");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: oldRequest,
		});
		const assistantID = SessionMessage.ID.make("msg_retry_assistant");
		const callID = CallID.make("call_retry_status");
		const assistant: Extract<SessionMessageInfo, { type: "assistant" }> = {
			type: "assistant",
			id: assistantID,
			agent,
			model,
			time: { created: 1 },
			content: [],
		};
		f.native.push(assistant);
		const authority = f.autoDrive.captureAuthority(sessionID);
		assistant.retry = {
			attempt: 2,
			at: 2000,
			error: { type: "provider.transport", message: "ECONNREFUSED" },
		};
		await f.emit("retry", {
			sessionID,
			agent,
			model,
			error: { type: "provider.transport", message: "ECONNREFUSED" },
			attempt: 2,
			decision: { retry: true, delay: 2000 },
		});
		await f.emit("context", f.context());
		const request = new Request("http://localhost/retry");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		await expect(
			f.emit("http.response", {
				sessionID,
				agent,
				model,
				kind: "primary",
				request: oldRequest,
				response: new Response("late old response"),
			}),
		).rejects.toThrow("Request identity");
		assistant.content.push({
			type: "tool",
			id: callID,
			name: "flow_status",
			time: { created: 2 },
			state: {
				status: "running",
				input: { request: { view: "compact" } },
				metadata: {},
			},
		});
		const response = {
			sessionID,
			agent,
			model,
			kind: "primary" as const,
			request,
			response: new Response("retried tool call"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe("retried tool call");
		await f.lifecycle.beforeTool({
			sessionID,
			agent,
			messageID: assistantID,
			id: callID,
			signal: new AbortController().signal,
			progress: async () => {},
		});
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("same-session same-model auxiliary retry cannot retire a healthy primary", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		const request = new Request("http://localhost/healthy-primary");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		const authority = f.autoDrive.captureAuthority(sessionID);
		await f.emit("retry", {
			sessionID,
			agent,
			model,
			error: {
				type: "provider.transport",
				message: "Auxiliary generate refused",
			},
			attempt: 2,
			decision: { retry: true, delay: 2000 },
		});
		const response = {
			sessionID,
			agent,
			model,
			kind: "primary" as const,
			request,
			response: new Response("healthy primary survived auxiliary retry"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe(
			"healthy primary survived auxiliary retry",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("an already consumed primary retry record cannot permit another overlapping context", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect original");
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/refused"),
		});
		f.native.push({
			type: "assistant",
			id: "msg_retrying_primary",
			agent,
			model,
			time: { created: 1 },
			content: [],
			retry: {
				attempt: 2,
				at: 2000,
				error: { type: "provider.transport", message: "ECONNREFUSED" },
			},
		});
		await f.emit("context", f.context());
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: new Request("http://localhost/retry"),
		});
		await expect(f.emit("context", f.context())).rejects.toThrow("overlap");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});

type ContinuationInputKind = "real" | "synthetic" | "compaction";
async function finishContinuationContext(
	f: Awaited<ReturnType<typeof fixture>>,
) {
	const request = new Request("http://localhost/complete");
	await f.emit("http.request", {
		sessionID,
		agent,
		model,
		kind: "primary",
		request,
	});
	const response = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
		response: new Response("completed first turn"),
	};
	await f.emit("http.response", response);
	expect(await response.response.text()).toBe("completed first turn");
}
async function nativeContinuationFixture(kind: ContinuationInputKind) {
	const f = await fixture();
	await f.command("flow-auto", "Inspect original");
	if (kind !== "real") {
		await f.emit("context", f.context());
		await finishContinuationContext(f);
		if (kind === "synthetic")
			await f.lifecycle.prompt(
				sessionID,
				"Continue the admitted direction",
				delivery,
				{ "opencode-plugin-flow/auto": "local-token" },
			);
		else {
			const control = {
				type: "compaction" as const,
				id: "msg_checked_checkpoint",
				status: "running" as const,
				reason: "auto" as const,
				summary: "summary",
				time: { created: 2 },
			};
			f.native.push(control);
			const context = f.context();
			context.messages = context.messages.filter(
				(message) => message.id !== control.id,
			);
			await f.emit("compaction", context);
			f.native.splice(0, f.native.length, { ...control, status: "completed" });
		}
	}
	return f;
}
for (const kind of ["real", "synthetic", "compaction"] as const)
	for (const attempt of ["first", "retry"] as const)
		for (const state of ["live", "revoked"] as const)
			test(
				kind + " " + attempt + " " + state + " exact native continuation",
				async () => {
					const f = await nativeContinuationFixture(kind);
					try {
						const authority = f.autoDrive.captureAuthority(sessionID);
						expect(authority?.token).toBe("local-token");
						let oldRequest: Request | undefined;
						const assistantID = SessionMessage.ID.make("msg_matrix_assistant");
						const callID = CallID.make("call_matrix_status");
						const assistant: Extract<
							SessionMessageInfo,
							{ type: "assistant" }
						> = {
							type: "assistant",
							id: assistantID,
							agent,
							model,
							time: { created: 3 },
							content: [],
						};
						if (attempt === "retry") {
							await f.emit("context", f.context());
							oldRequest = new Request("http://localhost/refused");
							await f.emit("http.request", {
								sessionID,
								agent,
								model,
								kind: "primary",
								request: oldRequest,
							});
							assistant.retry = {
								attempt: 2,
								at: 2000,
								error: { type: "provider.transport", message: "ECONNREFUSED" },
							};
							f.native.push(assistant);
						}
						if (state === "revoked")
							await f.emit("prompt", {
								sessionID,
								messageID: SessionMessage.ID.make("msg_new_direction"),
								prompt: { text: "Change direction" },
								delivery: "steer",
							});
						if (state === "revoked") {
							await expect(f.emit("context", f.context())).rejects.toThrow(
								"Flow execution epoch was revoked.",
							);
							expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
							return;
						}
						await f.emit("context", f.context());
						const request = new Request("http://localhost/success");
						await f.emit("http.request", {
							sessionID,
							agent,
							model,
							kind: "primary",
							request,
						});
						if (oldRequest)
							await expect(
								f.emit("http.response", {
									sessionID,
									agent,
									model,
									kind: "primary",
									request: oldRequest,
									response: new Response("late old response"),
								}),
							).rejects.toThrow("Request identity");
						const response = {
							sessionID,
							agent,
							model,
							kind: "primary" as const,
							request,
							response: new Response("verified native tool call"),
						};
						await f.emit("http.response", response);
						expect(await response.response.text()).toBe(
							"verified native tool call",
						);
						if (attempt === "first") f.native.push(assistant);
						delete assistant.retry;
						assistant.content.push({
							type: "tool",
							id: callID,
							name: "flow_status",
							time: { created: 4 },
							state: {
								status: "running",
								input: { request: { view: "compact" } },
								metadata: {},
							},
						});
						await f.lifecycle.beforeTool({
							sessionID,
							agent,
							messageID: assistantID,
							id: callID,
							signal: new AbortController().signal,
							progress: async () => {},
						});
						expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
					} finally {
						await f.lifecycle.dispose();
					}
				},
			);

async function prepareContinuationRetry(
	f: Awaited<ReturnType<typeof fixture>>,
	attempt: "first" | "retry",
) {
	if (attempt === "first") return;
	await f.emit("context", f.context());
	await f.emit("http.request", {
		sessionID,
		agent,
		model,
		kind: "primary",
		request: new Request("http://localhost/refused"),
	});
	f.native.push({
		type: "assistant",
		id: "msg_negative_retry_assistant",
		agent,
		model,
		time: { created: 3 },
		content: [],
		retry: {
			attempt: 2,
			at: 2000,
			error: { type: "provider.transport", message: "ECONNREFUSED" },
		},
	});
}
for (const kind of ["real", "synthetic", "compaction"] as const)
	for (const attempt of ["first", "retry"] as const) {
		test(
			kind + " " + attempt + " cannot change the admitted model",
			async () => {
				const f = await nativeContinuationFixture(kind);
				try {
					await prepareContinuationRetry(f, attempt);
					const original = f.context();
					const context = {
						...original,
						model: { ...original.model, id: Model.ID.make("other") },
					};
					await expect(f.emit("context", context)).rejects.toThrow(
						"Flow admitted agent or model differs from its primary request.",
					);
					expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
				} finally {
					await f.lifecycle.dispose();
				}
			},
		);
		test(
			kind + " " + attempt + " rejects an unmatched native input prefix",
			async () => {
				const f = await nativeContinuationFixture(kind);
				try {
					await prepareContinuationRetry(f, attempt);
					const context = f.context();
					context.messages.unshift({
						role: "user",
						id: "msg_unconsumed",
						content: [{ type: "text", text: "unconsumed" }],
					});
					await expect(f.emit("context", context)).rejects.toThrow(
						"Flow native inputs differ from the model-visible prefix.",
					);
					expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
				} finally {
					await f.lifecycle.dispose();
				}
			},
		);
	}
for (const mismatch of ["control", "reason"] as const)
	for (const attempt of ["first", "retry"] as const)
		test(
			"checked compaction " + attempt + " rejects " + mismatch + " mismatch",
			async () => {
				const f = await nativeContinuationFixture("compaction");
				try {
					await prepareContinuationRetry(f, attempt);
					const context = f.context();
					const control = f.native[0];
					if (control?.type !== "compaction" || control.status !== "completed")
						throw new Error("Expected completed control");
					f.native[0] =
						mismatch === "control"
							? { ...control, id: "msg_other_control" }
							: { ...control, reason: "manual" };
					const expected =
						mismatch === "reason"
							? "Flow automatic compaction control identity changed."
							: attempt === "retry"
								? "Flow primary contexts or streams overlap."
								: "Flow native inputs differ from the model-visible prefix.";
					await expect(f.emit("context", context)).rejects.toThrow(expected);
					expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
				} finally {
					await f.lifecycle.dispose();
				}
			},
		);

type OwnershipFixture = Awaited<ReturnType<typeof fixture>>;
function ownershipNativeCall(f: OwnershipFixture, tool = "flow_status") {
	const messageID = SessionMessage.ID.create();
	const id = CallID.make("call_owned");
	const frame: Extract<SessionMessageInfo, { type: "assistant" }> = {
		type: "assistant",
		id: messageID,
		agent,
		model,
		time: { created: 4 },
		content: [
			{
				type: "tool",
				id,
				name: tool,
				time: { created: 4 },
				state: {
					status: "running",
					input:
						tool === "shell"
							? { command: "printf not-run" }
							: { request: { view: "compact" } },
					metadata: {},
				},
			},
		],
	};
	f.native.push(frame);
	return {
		sessionID,
		agent,
		messageID,
		id,
		signal: new AbortController().signal,
		progress: async () => {},
	};
}
async function finishOwnedResponse(f: OwnershipFixture, request: Request) {
	const input = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
		response: new Response("native provider completed"),
	};
	await f.emit("http.response", input);
	expect(await input.response.text()).toBe("native provider completed");
}
async function startOwnedRequest(f: OwnershipFixture) {
	await f.emit("context", f.context());
	const request = new Request("http://localhost/owned");
	await f.emit("http.request", {
		sessionID,
		agent,
		model,
		kind: "primary",
		request,
	});
	return request;
}
async function initialOwnershipWork(f: OwnershipFixture) {
	await f.command("flow-auto", "Inspect original");
	await finishOwnedResponse(f, await startOwnedRequest(f));
}
async function freshOwnershipWork(f: OwnershipFixture) {
	await f.command("flow-auto", "Inspect fresh direction");
	const authority = f.autoDrive.captureAuthority(sessionID);
	expect(authority?.token).toBe("local-token");
	return {
		authority,
		async verify() {
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const call = ownershipNativeCall(f);
			await f.lifecycle.beforeTool(call);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		},
	};
}
for (const actor of ["context", "compaction"] as const)
	for (const reject of [false, true])
		for (const replacement of ["admitted", "context-started"] as const)
			test(
				actor +
					" old read " +
					(reject ? "rejects" : "resumes") +
					" after fresh " +
					replacement,
				async () => {
					const f = await fixture();
					try {
						await initialOwnershipWork(f);
						let old = f.context();
						let control:
							| Extract<SessionMessageInfo, { type: "compaction" }>
							| undefined;
						if (actor === "compaction") {
							control = {
								type: "compaction",
								id: "msg_old_control",
								status: "running",
								reason: "auto",
								summary: "old",
								time: { created: 2 },
							};
							f.native.push(control);
							old = f.context();
						}
						f.blockNextContextRead();
						if (reject) f.rejectNextContextRead();
						const pending = f.emit(actor, old);
						const caught = pending.then(
							() => null,
							(error) => String(error),
						);
						await f.waitContextRead();
						const next = await freshOwnershipWork(f);
						let request: Request | undefined;
						if (replacement === "context-started")
							request = await startOwnedRequest(f);
						f.releaseContextRead();
						expect(await caught).toBe(
							"Error: Flow execution epoch was revoked.",
						);
						expect(f.autoDrive.captureAuthority(sessionID)).toEqual(
							next.authority,
						);
						if (control) f.native.splice(f.native.indexOf(control), 1);
						if (request) {
							await finishOwnedResponse(f, request);
							await f.lifecycle.beforeTool(ownershipNativeCall(f));
							expect(f.autoDrive.captureAuthority(sessionID)).toEqual(
								next.authority,
							);
						} else await next.verify();
					} finally {
						f.releaseContextRead();
						await f.lifecycle.dispose();
					}
				},
			);
for (const boundary of ["flow-wrapper", "global-shell"] as const)
	for (const reject of [false, true])
		for (const replacement of ["admitted", "context-started"] as const)
			test(
				boundary +
					" old verification read " +
					String(reject) +
					" preserves fresh " +
					replacement,
				async () => {
					const f = await fixture();
					try {
						await initialOwnershipWork(f);
						const call = ownershipNativeCall(
							f,
							boundary === "global-shell" ? "shell" : "flow_status",
						);
						f.blockNextContextRead();
						if (reject) f.rejectNextContextRead();
						const pending =
							boundary === "flow-wrapper"
								? f.lifecycle.beforeTool(call)
								: (async () => {
										for (const callback of f.toolCallbacks["execute.before"])
											await callback({
												...call,
												tool: "shell",
												input: { command: "printf not-run" },
											});
									})();
						const caught = pending.then(
							() => null,
							(error) => String(error),
						);
						const next = await freshOwnershipWork(f);
						const request =
							replacement === "context-started"
								? await startOwnedRequest(f)
								: undefined;
						f.releaseContextRead();
						expect(await caught).toBe(
							reject
								? "Error: Native context snapshot failed."
								: "Error: Flow execution epoch was revoked.",
						);
						if (request) {
							await finishOwnedResponse(f, request);
							await f.lifecycle.beforeTool(ownershipNativeCall(f));
							expect(f.autoDrive.captureAuthority(sessionID)).toEqual(
								next.authority,
							);
						} else await next.verify();
					} finally {
						f.releaseContextRead();
						await f.lifecycle.dispose();
					}
				},
			);
for (const actor of ["command", "synthetic"] as const)
	test(
		actor + " old initial session read rejection preserves fresh work",
		async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				f.blockNextSessionRead();
				f.rejectNextSessionRead();
				const pending =
					actor === "command"
						? f.command("flow-auto", "Inspect old dispatch")
						: f.lifecycle.prompt(
								sessionID,
								"Old synthetic",
								{
									agent,
									model: { providerID: model.providerID, modelID: model.id },
								},
								{ "opencode-plugin-flow/auto": "local-token" },
							);
				const caught = pending.then(
					() => null,
					(error) => String(error),
				);
				await f.flush();
				const next = await freshOwnershipWork(f);
				f.releaseSessionRead();
				expect(await caught).toBe("Error: Native session snapshot failed.");
				await next.verify();
			} finally {
				f.releaseSessionRead();
				await f.lifecycle.dispose();
			}
		},
	);
for (const actor of ["command", "synthetic"] as const)
	test(actor + " old pending admission cannot cancel replacement", async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			f.blockAdmission();
			const pending =
				actor === "command"
					? f.command("flow-auto", "Inspect old dispatch")
					: f.lifecycle.prompt(
							sessionID,
							"Old synthetic",
							{
								agent,
								model: { providerID: model.providerID, modelID: model.id },
							},
							{ "opencode-plugin-flow/auto": "local-token" },
						);
			const caught = pending.then(
				() => null,
				(error) => String(error),
			);
			await f.flush();
			f.allowNewAdmissions();
			const next = await freshOwnershipWork(f);
			f.releaseAdmission();
			expect(await caught).toBe(
				actor === "command"
					? "Error: Flow execution epoch was revoked."
					: "Error: Flow execution epoch was revoked.",
			);
			await next.verify();
		} finally {
			f.releaseAdmission();
			await f.lifecycle.dispose();
		}
	});
for (const outcome of ["failed", "succeeded"] as const)
	test(
		"old " +
			outcome +
			" event read rejection does not become global stream loss",
		async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				f.session.outcome = outcome;
				f.session.time.idle = 4;
				if (outcome === "failed") {
					f.native.push({
						type: "idle",
						id: "msg_failed",
						outcome,
						time: { created: 4 },
					});
					f.blockNextContextRead();
					f.rejectNextContextRead();
				} else {
					f.blockNextSessionRead();
					f.rejectNextSessionRead();
				}
				const event: OpenCodeEvent =
					outcome === "failed"
						? {
								id: "evt_failed",
								created: 4,
								type: "session.execution.failed",
								durable: { aggregateID: sessionID, seq: 1, version: 1 },
								data: {
									sessionID,
									error: { type: "provider.transport", message: "refused" },
								},
							}
						: {
								id: "evt_succeeded",
								created: 4,
								type: "session.execution.succeeded",
								durable: { aggregateID: sessionID, seq: 1, version: 1 },
								data: { sessionID },
							};
				f.sendEvent(event);
				await f.flush();
				const next = await freshOwnershipWork(f);
				f.releaseContextRead();
				f.releaseSessionRead();
				await f.flush();
				await next.verify();
				expect(f.logs.includes("Flow event stream failed closed.")).toBe(false);
			} finally {
				f.releaseContextRead();
				f.releaseSessionRead();
				await f.lifecycle.dispose();
			}
		},
	);
test("stale accepted-message observation cannot overwrite replacement recovery direction", async () => {
	const f = await fixture();
	const entered = Promise.withResolvers<void>();
	const gate = Promise.withResolvers<void>();
	try {
		const observe = f.autoDrive.observeMessage.bind(f.autoDrive);
		let first = true;
		f.autoDrive.observeMessage = async (...args) => {
			const result = await observe(...args);
			if (first) {
				first = false;
				entered.resolve();
				await gate.promise;
			}
			return result;
		};
		const pending = f.command("flow-auto", "Inspect original");
		const caught = pending.then(
			() => null,
			(error) => String(error),
		);
		await entered.promise;
		const next = await freshOwnershipWork(f);
		const request = await startOwnedRequest(f);
		gate.resolve();
		expect(await caught).toBe("Error: Flow execution epoch was revoked.");
		await finishOwnedResponse(f, request);
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(next.authority);
	} finally {
		gate.resolve();
		await f.lifecycle.dispose();
	}
});

test("old bound call cannot revoke a later request in the same epoch", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const call = ownershipNativeCall(f);
		await f.lifecycle.beforeTool(call);
		const authority = f.autoDrive.captureAuthority(sessionID);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await expect(f.lifecycle.beforeTool(call)).rejects.toThrow(
			"Flow assistant cannot be rebound to another request.",
		);
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("late duplicate request hook cannot end its replacement", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const old = await startOwnedRequest(f);
		await finishOwnedResponse(f, old);
		const next = await freshOwnershipWork(f);
		await f.emit("context", f.context());
		await expect(
			f.emit("http.request", {
				sessionID,
				agent,
				model,
				kind: "primary",
				request: old,
			}),
		).rejects.toThrow("unique frozen context");
		const request = new Request("http://localhost/new");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		await finishOwnedResponse(f, request);
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(next.authority);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("old WebSocket veto cannot revoke freshly admitted HTTP work", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const next = await freshOwnershipWork(f);
		await expect(
			f.emit("experimental.ws.handshake", {
				sessionID,
				agent,
				model,
				kind: "primary",
				url: "ws://localhost/unused",
				headers: {},
			}),
		).rejects.toThrow("not been proved for WebSocket");
		await next.verify();
	} finally {
		await f.lifecycle.dispose();
	}
});
test("stale automatic shell remains vetoed after a manual replacement context", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const old = ownershipNativeCall(f, "shell");
		for (const callback of f.toolCallbacks["execute.before"])
			await callback({
				...old,
				tool: "shell",
				input: { command: "printf not-run" },
			});
		await f.command("flow-auto", "stop");
		const messageID = SessionMessage.ID.create();
		const text = "Inspect manual direction";
		await f.emit("prompt", {
			sessionID,
			messageID,
			prompt: { text },
			delivery: "steer",
		});
		f.native.push({ type: "user", id: messageID, text, time: { created: 5 } });
		await finishOwnedResponse(f, await startOwnedRequest(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		let effects = 0;
		const pending = (async () => {
			for (const callback of f.toolCallbacks["execute.before"])
				await callback({
					...old,
					tool: "shell",
					input: { command: "printf not-run" },
				});
			effects++;
		})();
		await expect(pending).rejects.toThrow("epoch was revoked");
		expect(effects).toBe(0);
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
	} finally {
		await f.lifecycle.dispose();
	}
});

test("an old success notification cannot advance a newly admitted command before its first primary", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect fresh direction");
		const authority = f.autoDrive.captureAuthority(sessionID);
		f.session.outcome = "succeeded";
		f.session.time.idle = 1;
		f.sendEvent({
			id: "evt_before_primary",
			type: "session.execution.succeeded",
			created: 1,
			durable: { aggregateID: sessionID, seq: 1, version: 1 },
			data: { sessionID },
		});
		await f.flush();
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
		expect(f.repository.saveCount).toBe(0);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const prior of ["none", "manual", "automatic"] as const)
	for (const admitted of ["command", "synthetic"] as const)
		test(
			"pre-primary automatic compaction from " + admitted + " after " + prior,
			async () => {
				const f = await fixture();
				try {
					f.native.push({
						type: "user",
						id: "msg_historical_input",
						text: "Historical input grants no authority",
						time: { created: 0 },
					});
					if (prior === "automatic") await initialOwnershipWork(f);
					if (prior === "manual") {
						await f.command("flow-plan", "Inspect earlier manual direction");
						await finishOwnedResponse(f, await startOwnedRequest(f));
					}
					await f.command("flow-auto", "Inspect fresh first direction");
					if (admitted === "synthetic")
						await f.lifecycle.prompt(
							sessionID,
							"Continue exact fresh direction",
							delivery,
							{
								[FLOW_AUTO_METADATA_KEY]: "local-token",
							},
						);
					const authority = f.autoDrive.captureAuthority(sessionID);
					const compact = f.context();
					const control = {
						type: "compaction" as const,
						id: "msg_before_first_primary",
						status: "running" as const,
						reason: "auto" as const,
						summary: "Summary grants no authority",
						time: { created: 10 },
					};
					f.native.push(control);
					await f.emit("compaction", compact);
					f.native.splice(0, f.native.length, {
						...control,
						status: "completed",
					});
					await finishOwnedResponse(f, await startOwnedRequest(f));
					await f.lifecycle.beforeTool(ownershipNativeCall(f));
					expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
					expect(f.repository.saveCount).toBe(0);
				} finally {
					await f.lifecycle.dispose();
				}
			},
		);

for (const successor of ["command", "synthetic"] as const)
	for (const delayed of [
		"before-entry",
		"read-resumes",
		"read-rejects",
	] as const)
		test(`old compaction ${delayed} cannot own fresh ${successor}`, async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				const compact = f.context();
				const control = {
					type: "compaction" as const,
					id: "msg_stale_before_context",
					status: "running" as const,
					reason: "auto" as const,
					summary: "Old summary cannot borrow a fresh admission",
					time: { created: 10 },
				};
				f.native.push(control);
				if (delayed !== "before-entry") {
					f.blockNextContextRead();
					if (delayed === "read-rejects") f.rejectNextContextRead();
				}
				const pending =
					delayed === "before-entry" ? null : f.emit("compaction", compact);
				const caught = pending?.then(
					() => null,
					(error) => String(error),
				);
				if (successor === "command")
					await f.command("flow-auto", "Inspect fresh direction");
				else
					await f.lifecycle.prompt(
						sessionID,
						"Fresh exact continuation",
						delivery,
						{
							[FLOW_AUTO_METADATA_KEY]: "local-token",
						},
					);
				const authority = f.autoDrive.captureAuthority(sessionID);
				const request = await startOwnedRequest(f);
				if (delayed === "before-entry")
					await expect(f.emit("compaction", compact)).rejects.toThrow(
						"epoch was revoked",
					);
				else {
					f.releaseContextRead();
					expect(await caught).toBe("Error: Flow execution epoch was revoked.");
				}
				f.native.splice(f.native.indexOf(control), 1);
				await finishOwnedResponse(f, request);
				await f.lifecycle.beforeTool(ownershipNativeCall(f));
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				expect(f.repository.saveCount).toBe(0);
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		});

for (const mismatch of [
	"prefix",
	"model",
	"payload",
	"control-position",
	"manual",
	"revoked",
] as const)
	test(`pre-primary compaction rejects ${mismatch}`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Inspect exact direction");
			let compact = f.context();
			const control = {
				type: "compaction" as const,
				id: "msg_untrusted_control",
				status: "running" as const,
				reason: mismatch === "manual" ? ("manual" as const) : ("auto" as const),
				summary: "Summary grants no token",
				time: { created: 10 },
			};
			f.native.push(control);
			if (mismatch === "prefix")
				compact.messages.unshift({
					role: "user",
					id: SessionMessage.ID.make("msg_not_consumed"),
					content: [],
				});
			if (mismatch === "model")
				compact = {
					...compact,
					model: { ...model, id: Model.ID.make("other") },
				};
			if (mismatch === "payload") {
				const input = f.native[0];
				if (input?.type !== "user") throw new Error("Expected native user");
				input.text = "Changed after admission";
			}
			if (mismatch === "control-position") {
				f.native.pop();
				f.native.unshift(control);
			}
			if (mismatch === "revoked") await f.command("flow-auto", "stop");
			await expect(f.emit("compaction", compact)).rejects.toThrow();
			f.native.splice(0, f.native.length, {
				...control,
				reason: "auto",
				status: "completed",
			});
			await expect(f.emit("context", f.context())).rejects.toThrow();
			expect(f.repository.saveCount).toBe(0);
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("pre-primary compaction joins pending receipt without granting early authority", async () => {
	const f = await fixture();
	try {
		f.blockAdmission();
		const command = f.command("flow-auto", "Inspect exact first direction");
		await f.flush();
		const compact = f.context();
		const control = {
			type: "compaction" as const,
			id: "msg_pending_control",
			summary: "Pending summary grants no authority",
			status: "running" as const,
			reason: "auto" as const,
			time: { created: 10 },
		};
		f.native.push(control);
		let completed = false;
		const pending = f.emit("compaction", compact).then(() => {
			completed = true;
		});
		await f.flush();
		expect(completed).toBe(false);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
		f.releaseAdmission();
		await command;
		await pending;
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
	} finally {
		f.releaseAdmission();
		await f.lifecycle.dispose();
	}
});

test("automatic compaction owns the accepted input during its existing primary", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect existing primary");
		const request = await startOwnedRequest(f);
		const compact = f.context();
		const control = {
			type: "compaction" as const,
			id: "msg_during_primary",
			status: "running" as const,
			reason: "auto" as const,
			summary: "summary",
			time: { created: 5 },
		};
		f.native.push(control);
		await f.emit("compaction", compact);
		await finishOwnedResponse(f, request);
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("another automatic control can precede the first checkpoint primary", async () => {
	const f = await nativeContinuationFixture("compaction");
	try {
		const compact = f.context();
		const control = {
			type: "compaction" as const,
			id: "msg_second_pre_primary",
			status: "running" as const,
			reason: "auto" as const,
			summary: "summary",
			time: { created: 5 },
		};
		f.native.push(control);
		await f.emit("compaction", compact);
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
	} finally {
		await f.lifecycle.dispose();
	}
});

test("real steer before compaction applies existing cancellation policy", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const messageID = SessionMessage.ID.make(
			"msg_real_steer_before_compaction",
		);
		await f.emit("prompt", {
			sessionID,
			messageID,
			prompt: { text: "/flow-auto stop" },
			delivery: "steer",
		});
		f.native.push({
			type: "user",
			id: messageID,
			text: "/flow-auto stop",
			time: { created: 5 },
		});
		const compact = f.context();
		const control = {
			type: "compaction" as const,
			id: "msg_after_real_steer",
			status: "running" as const,
			reason: "auto" as const,
			summary: "summary",
			time: { created: 6 },
		};
		f.native.push(control);
		await f.emit("compaction", compact);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("unknown synthetic callbacks cannot borrow or deactivate the exact accepted source", async () => {
	const f = await fixture();
	try {
		await f.command("flow-auto", "Inspect exact direction");
		const authority = f.autoDrive.captureAuthority(sessionID);
		f.native.push({
			type: "synthetic",
			id: "msg_unadmitted",
			text: "Not a private admission",
			metadata: { [FLOW_AUTO_METADATA_KEY]: "local-token" },
			time: { created: 2 },
		});
		const compact = f.context();
		f.native.push({
			type: "compaction",
			id: "msg_unadmitted_control",
			status: "running",
			reason: "auto",
			summary: "summary",
			time: { created: 3 },
		});
		await expect(f.emit("compaction", compact)).rejects.toThrow(
			"epoch was revoked",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		await expect(f.emit("context", compact)).rejects.toThrow(
			"unknown, synthetic, or stale real input",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		const foreignCall = ownershipNativeCall(f);
		await expect(f.lifecycle.beforeTool(foreignCall)).rejects.toThrow();
		expect(f.repository.saveCount).toBe(0);
		await f.command("flow-auto", "Inspect separately accepted fresh source");
		const fresh = await startOwnedRequest(f);
		await finishOwnedResponse(f, fresh);
		await expect(f.lifecycle.beforeTool(foreignCall)).rejects.toThrow(
			"primary request",
		);
		const call = ownershipNativeCall(f);
		await f.lifecycle.beforeTool(call);
		expect(f.autoDrive.captureAuthority(sessionID)?.token).toBe("local-token");
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const successor of ["command", "synthetic"] as const)
	test(`old context entering after fresh ${successor} cannot revoke its request`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const old = f.context();
			if (successor === "command")
				await f.command("flow-auto", "Inspect fresh context");
			else
				await f.lifecycle.prompt(
					sessionID,
					"Fresh context continuation",
					delivery,
					{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
				);
			const authority = f.autoDrive.captureAuthority(sessionID);
			const request = await startOwnedRequest(f);
			await expect(f.emit("context", old)).rejects.toThrow();
			await finishOwnedResponse(f, request);
			await f.lifecycle.beforeTool(ownershipNativeCall(f));
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		} finally {
			await f.lifecycle.dispose();
		}
	});

async function admitOrdinaryInput(
	f: OwnershipFixture,
	id: string,
	text: string,
) {
	await f.emit("prompt", {
		sessionID,
		messageID: SessionMessage.ID.make(id),
		prompt: { text },
		delivery: "queue",
	});
	f.native.push({ type: "user", id, text, time: { created: 10 } });
}
function automaticControl(id: string) {
	return {
		type: "compaction" as const,
		id,
		status: "running" as const,
		reason: "auto" as const,
		summary: "Summary is neither a user nor an automatic grant",
		time: { created: 11 },
	};
}
async function compactCurrentInput(
	f: OwnershipFixture,
	id: string,
	reason: "auto" | "manual" = "auto",
) {
	const compact = f.context();
	const control = { ...automaticControl(id), reason };
	f.native.push(control);
	await f.emit("compaction", compact);
	f.native.splice(0, f.native.length, { ...control, status: "completed" });
}
for (const prior of ["none", "ended-manual"] as const)
	for (const attempt of ["first", "retry"] as const)
		test(`ordinary ${prior} ${attempt} retains provenance without automatic authority through compaction`, async () => {
			const f = await fixture();
			try {
				if (prior === "ended-manual") {
					await f.command("flow-plan", "Earlier ordinary manual plan");
					await finishOwnedResponse(f, await startOwnedRequest(f));
				}
				await admitOrdinaryInput(
					f,
					"msg_grantless_real",
					"Ordinary coding without Flow auto",
				);
				await compactCurrentInput(f, "msg_grantless_checkpoint");
				await prepareContinuationRetry(f, attempt);
				await finishOwnedResponse(f, await startOwnedRequest(f));
				await f.lifecycle.beforeTool(ownershipNativeCall(f));
				expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
				expect(f.repository.saveCount).toBe(0);
				expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
			} finally {
				await f.lifecycle.dispose();
			}
		});

test("grantless Flow plan input retains protected execution after compaction", async () => {
	const f = await fixture();
	try {
		await f.command("flow-plan", "Ordinary manual plan");
		await compactCurrentInput(f, "msg_plan_checkpoint");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("grantless reviewer input keeps its exact selected role through compaction", async () => {
	const reviewer = Agent.ID.make("flow-reviewer");
	const f = await fixture(reviewer);
	try {
		f.session.parentID = "session-manager";
		await admitOrdinaryInput(
			f,
			"msg_reviewer_input",
			"Review the assigned existing artifact",
		);
		await compactCurrentInput(f, "msg_reviewer_checkpoint");
		await f.emit("context", f.context());
		const request = new Request("http://localhost/reviewer");
		await f.emit("http.request", {
			sessionID,
			agent: reviewer,
			model,
			kind: "primary",
			request,
		});
		const response = {
			sessionID,
			agent: reviewer,
			model,
			kind: "primary" as const,
			request,
			response: new Response("reviewer response"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe("reviewer response");
		const call = ownershipNativeCall(f);
		const message = f.native.find((m) => m.id === call.messageID);
		if (message?.type !== "assistant")
			throw new Error("Missing native reviewer assistant");
		message.agent = reviewer;
		await f.lifecycle.beforeTool({ ...call, agent: reviewer });
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const reject of [false, true])
	for (const oldSettlesFirst of [false, true])
		test(`same-epoch private source replaces stale pending context, reject ${reject}, old first ${oldSettlesFirst}`, async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				const old = f.context();
				const releaseOld = f.blockNextContextRead();
				if (reject) f.rejectNextContextRead();
				const pending = f.emit("context", old).then(
					() => null,
					(error) => String(error),
				);
				await f.flush();
				await f.lifecycle.prompt(
					sessionID,
					"Fresh private continuation",
					delivery,
					{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
				);
				const authority = f.autoDrive.captureAuthority(sessionID);
				if (oldSettlesFirst) {
					releaseOld();
					expect(await pending).toBe(
						"Error: Flow execution epoch was revoked.",
					);
				}
				await finishOwnedResponse(f, await startOwnedRequest(f));
				await f.lifecycle.beforeTool(ownershipNativeCall(f));
				if (!oldSettlesFirst) {
					releaseOld();
					expect(await pending).toBe(
						"Error: Flow execution epoch was revoked.",
					);
				}
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				expect(f.repository.saveCount).toBe(0);
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		});

for (const reject of [false, true])
	test(`stale pending context finally cannot remove the fresh source slot, reject ${reject}`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const releaseOld = f.blockNextContextRead();
			if (reject) f.rejectNextContextRead();
			const old = f.emit("context", f.context()).then(
				() => null,
				(error) => String(error),
			);
			await f.flush();
			await f.lifecycle.prompt(
				sessionID,
				"Fresh private continuation",
				delivery,
				{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
			);
			const releaseFresh = f.blockNextContextRead();
			const fresh = f.emit("context", f.context()).then(
				() => null,
				(error) => String(error),
			);
			await f.flush();
			releaseOld();
			expect(await old).toBe("Error: Flow execution epoch was revoked.");
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"context callbacks overlap",
			);
			releaseFresh();
			expect(await fresh).toBe("Error: Flow execution epoch was revoked.");
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		} finally {
			f.releaseContextRead();
			await f.lifecycle.dispose();
		}
	});

for (const kind of [
	"unknown-marked",
	"revoked-marked",
	"manual-marked",
] as const)
	test(`compaction cannot declassify ${kind} input into grantless provenance`, async () => {
		const f = await fixture();
		try {
			if (kind === "unknown-marked") {
				const messageID = SessionMessage.ID.make("msg_unknown_marked_real");
				await expect(
					f.emit("prompt", {
						sessionID,
						messageID,
						prompt: { text: "Unknown token" },
						metadata: { [FLOW_AUTO_METADATA_KEY]: "unknown-token" },
						delivery: "queue",
					}),
				).rejects.toThrow("private admitted dispatch");
				f.native.push({
					type: "user",
					id: messageID,
					text: "Unknown token",
					metadata: { [FLOW_AUTO_METADATA_KEY]: "unknown-token" },
					time: { created: 10 },
				});
			} else await f.command("flow-auto", "Inspect the exact marked direction");
			const compact = f.context();
			if (kind === "revoked-marked") await f.command("flow-auto", "stop");
			const control = {
				...automaticControl("msg_not_declassified"),
				reason:
					kind === "manual-marked" ? ("manual" as const) : ("auto" as const),
			};
			f.native.push(control);
			await expect(f.emit("compaction", compact)).rejects.toThrow();
			f.native.splice(0, f.native.length, { ...control, status: "completed" });
			await expect(f.emit("context", f.context())).rejects.toThrow();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const mismatch of [
	"prefix",
	"completed-control",
	"completed-reason",
	"resumed-model",
] as const)
	test(`grantless automatic compaction rejects ${mismatch} mismatch`, async () => {
		const f = await fixture();
		try {
			await admitOrdinaryInput(
				f,
				"msg_exact_ordinary_source",
				"Ordinary selected coding",
			);
			if (mismatch === "prefix") {
				const compact = f.context();
				compact.messages.unshift({
					role: "user",
					id: SessionMessage.ID.make("msg_not_consumed"),
					content: [],
				});
				f.native.push(automaticControl("msg_rejected_prefix_control"));
				await expect(f.emit("compaction", compact)).rejects.toThrow(
					"native control prefix",
				);
			} else {
				await compactCurrentInput(f, "msg_exact_ordinary_control");
				const control = f.native[0];
				if (control?.type !== "compaction" || control.status !== "completed")
					throw new Error("Missing completed native control");
				if (mismatch === "completed-control")
					control.id = "msg_replaced_control";
				if (mismatch === "completed-reason") control.reason = "manual";
				const context = f.context();
				await expect(
					f.emit(
						"context",
						mismatch === "resumed-model"
							? {
									...context,
									model: { ...model, id: Model.ID.make("changed") },
								}
							: context,
					),
				).rejects.toThrow();
			}
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const reason of ["auto", "manual"] as const)
	test(`grantless ${reason} checkpoint retains an existing recovery origin without activating advice`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-plan", 'Implement the test named "must pass"');
			const session = f.repository.session;
			if (!session)
				throw new Error("Explicit planning command did not anchor its test");
			const writes = f.repository.saveCount;
			f.recovery.activate(sessionID);
			await admitOrdinaryInput(
				f,
				"msg_manual_recovery_direction",
				"Ordinary real user direction",
			);
			await compactCurrentInput(f, "msg_manual_recovery_checkpoint", reason);
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const call = ownershipNativeCall(f);
			await f.lifecycle.beforeTool(call);
			const guard = f.recovery.guard({
				hostSessionId: sessionID,
				messageId: call.messageID,
				agent,
			});
			expect(() =>
				guard.checkClose(session, {
					operationId: "ordinary-close-check",
					expectedRevision: session.revision,
					sessionId: session.id,
					kind: "completed",
					summary: "Completed original real-user direction",
				}),
			).not.toThrow();
			expect(() =>
				guard.checkClose(session, {
					operationId: "ordinary-close-disposition",
					expectedRevision: session.revision,
					sessionId: session.id,
					kind: "abandoned",
					summary: "A checkpoint cannot authorize a new disposition",
				}),
			).toThrow("fresh real user direction");
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.recovery.snapshot(sessionID).mode).toBe("off");
			expect(f.repository.saveCount).toBe(writes);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const attempt of ["first", "retry"] as const)
	test(`known grantless manual checkpoint keeps exact ${attempt} provenance`, async () => {
		const f = await fixture();
		try {
			await admitOrdinaryInput(
				f,
				"msg_manual_known_user",
				"Ordinary coding direction",
			);
			await compactCurrentInput(f, "msg_manual_known_control", "manual");
			await prepareContinuationRetry(f, attempt);
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.beforeTool(ownershipNativeCall(f));
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("unattributed manual summary creates no checkpoint grant and permits a later real input", async () => {
	const f = await fixture();
	try {
		f.native.push({
			type: "user",
			id: "msg_historical_unregistered_user",
			text: "Historical ordinary input",
			time: { created: 1 },
		});
		await compactCurrentInput(f, "msg_summary_only_manual_control", "manual");
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"unknown, synthetic, or stale real input",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		await admitOrdinaryInput(
			f,
			"msg_new_real_after_manual_summary",
			"Fresh ordinary input",
		);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const stale of ["marked", "synthetic", "prefix"] as const)
	test(`unattributed manual summary never grants from ${stale} history`, async () => {
		const f = await fixture();
		try {
			f.native.push(
				stale === "synthetic"
					? {
							type: "synthetic",
							id: "msg_unregistered_synthetic",
							text: "Unregistered",
							time: { created: 1 },
						}
					: {
							type: "user",
							id: "msg_unregistered_manual_source",
							text: "Historical",
							...(stale === "marked"
								? { metadata: { [FLOW_AUTO_METADATA_KEY]: "stale-token" } }
								: {}),
							time: { created: 1 },
						},
			);
			const compact = f.context();
			if (stale === "prefix")
				compact.messages.unshift({
					role: "user",
					id: SessionMessage.ID.make("msg_missing_native_input"),
					content: [],
				});
			f.native.push({
				...automaticControl("msg_rejected_manual_control"),
				reason: "manual",
			});
			if (stale === "prefix")
				await expect(f.emit("compaction", compact)).rejects.toThrow();
			else {
				await f.emit("compaction", compact);
				const control = f.native.at(-1);
				if (control?.type !== "compaction" || control.status !== "running")
					throw new Error("Missing summary-only manual control");
				f.native.splice(0, f.native.length, {
					...control,
					status: "completed",
				});
				await expect(f.emit("context", f.context())).rejects.toThrow(
					"unknown, synthetic, or stale real input",
				);
				await expect(
					f.lifecycle.beforeTool(ownershipNativeCall(f)),
				).rejects.toThrow("primary request");
			}
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const fresh of ["automatic", "ordinary"] as const)
	for (const reject of [false, true])
		test(`unattributed manual read ${reject} cannot revoke fresh ${fresh} work`, async () => {
			const f = await fixture();
			try {
				f.native.push({
					type: "user",
					id: "msg_old_history_for_manual",
					text: "Historical input",
					time: { created: 1 },
				});
				const compact = f.context();
				const control = {
					...automaticControl("msg_old_unattributed_manual"),
					reason: "manual" as const,
				};
				f.native.push(control);
				const release = f.blockNextContextRead();
				if (reject) f.rejectNextContextRead();
				const old = f.emit("compaction", compact).then(
					() => null,
					(error) => String(error),
				);
				await f.flush();
				if (fresh === "automatic")
					await f.command("flow-auto", "Inspect fresh exact direction");
				else
					await admitOrdinaryInput(
						f,
						"msg_new_ordinary_source",
						"Fresh real ordinary input",
					);
				const authority = f.autoDrive.captureAuthority(sessionID);
				const request = await startOwnedRequest(f);
				release();
				expect(await old).toBe("Error: Flow execution epoch was revoked.");
				f.native.splice(f.native.indexOf(control), 1);
				await finishOwnedResponse(f, request);
				await f.lifecycle.beforeTool(ownershipNativeCall(f));
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				expect(f.repository.saveCount).toBe(0);
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		});

test("known manual checkpoint completion cannot change its reason", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(
			f,
			"msg_reason_bound_manual_user",
			"Ordinary input",
		);
		await compactCurrentInput(f, "msg_reason_bound_manual_control", "manual");
		const control = f.native[0];
		if (control?.type !== "compaction" || control.status !== "completed")
			throw new Error("Missing manual checkpoint");
		control.reason = "auto";
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"control identity changed",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("actual manager model observations remain bounded and refresh insertion order", async () => {
	const f = await fixture();
	try {
		for (let i = 0; i < 128; i++)
			f.codingModels.set(`host-${i}`, {
				providerID: "local",
				modelID: "scripted",
			});
		await admitOrdinaryInput(
			f,
			"msg_model_observation_source",
			"Ordinary coding",
		);
		await f.emit("context", f.context());
		expect(f.codingModels.size).toBe(128);
		expect(f.codingModels.has("host-0")).toBe(false);
		expect(f.codingModels.get(sessionID)).toEqual({
			providerID: "local",
			modelID: "scripted",
		});
		await finishContinuationContext(f);
		f.codingModels.clear();
		f.codingModels.set(sessionID, { providerID: "local", modelID: "scripted" });
		for (let i = 1; i < 128; i++)
			f.codingModels.set(`host-${i}`, {
				providerID: "local",
				modelID: "scripted",
			});
		await f.emit("context", f.context());
		expect(f.codingModels.size).toBe(128);
		expect(f.codingModels.keys().next().value).toBe("host-1");
		expect([...f.codingModels.keys()].at(-1)).toBe(sessionID);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("unattributed manual summary cannot continue after lifecycle unload", async () => {
	const f = await fixture();
	f.native.push({
		type: "user",
		id: "msg_unloaded_manual_history",
		text: "Historical input",
		time: { created: 1 },
	});
	const compact = f.context();
	f.native.push({
		...automaticControl("msg_unloaded_manual_control"),
		reason: "manual",
	});
	const release = f.blockNextContextRead();
	const old = f.emit("compaction", compact).then(
		() => null,
		(error) => String(error),
	);
	await f.flush();
	await f.lifecycle.dispose();
	release();
	expect(await old).toBe("Error: Flow execution epoch was revoked.");
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.repository.saveCount).toBe(0);
});

for (const fresh of ["automatic", "ordinary"] as const)
	test(`old unattributed manual callback entering after fresh ${fresh} cannot cancel it`, async () => {
		const f = await fixture();
		try {
			f.native.push({
				type: "user",
				id: "msg_history_before_delayed_manual",
				text: "Historical input",
				time: { created: 1 },
			});
			const old = f.context();
			const control = {
				...automaticControl("msg_late_unattributed_manual"),
				reason: "manual" as const,
			};
			f.native.push(control);
			if (fresh === "automatic")
				await f.command("flow-auto", "Inspect fresh callback source");
			else
				await admitOrdinaryInput(
					f,
					"msg_fresh_delayed_manual_source",
					"Fresh ordinary source",
				);
			const authority = f.autoDrive.captureAuthority(sessionID);
			const request = await startOwnedRequest(f);
			await expect(f.emit("compaction", old)).rejects.toThrow();
			f.native.splice(f.native.indexOf(control), 1);
			await finishOwnedResponse(f, request);
			await f.lifecycle.beforeTool(ownershipNativeCall(f));
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const actor of ["command", "synthetic"] as const)
	test(`reservation before ${actor} session read vetoes old callbacks without taking new authority`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const old = f.context();
			f.blockNextSessionRead();
			const pending =
				actor === "command"
					? f.command("flow-auto", "Inspect fresh pre-get command")
					: f.lifecycle.prompt(
							sessionID,
							"Fresh private pre-get source",
							delivery,
							{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
						);
			await f.flush();
			const before = f.autoDrive.captureAuthority(sessionID);
			await expect(f.emit("context", old)).rejects.toThrow("epoch was revoked");
			const control = automaticControl("msg_pre_get_old");
			f.native.push(control);
			await expect(f.emit("compaction", old)).rejects.toThrow(
				"epoch was revoked",
			);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			expect(f.repository.saveCount).toBe(0);
			f.native.splice(f.native.indexOf(control), 1);
			f.releaseSessionRead();
			await pending;
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.beforeTool(ownershipNativeCall(f));
			expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
		} finally {
			f.releaseSessionRead();
			await f.lifecycle.dispose();
		}
	});
test("accepted activation readiness blocks freeze and tools until exact source binding", async () => {
	const f = await fixture();
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const activate = f.autoDrive.activate.bind(f.autoDrive);
	f.autoDrive.activate = async (...args) => {
		const result = await activate(...args);
		entered.resolve();
		await release.promise;
		return result;
	};
	const freeze = spyOn(ExecutionAttribution.prototype, "freeze");
	try {
		const command = f.command(
			"flow-auto",
			"Inspect accepted pending activation",
		);
		await entered.promise;
		let settled = false;
		const context = f.emit("context", f.context()).then(
			() => {
				settled = true;
				return null;
			},
			(error) => {
				settled = true;
				return error;
			},
		);
		await f.flush();
		expect(settled).toBe(false);
		expect(freeze).toHaveBeenCalledTimes(0);
		expect(f.repository.saveCount).toBe(0);
		await expect(
			f.lifecycle.beforeTool(ownershipNativeCall(f)),
		).rejects.toThrow("primary request");
		expect(freeze).toHaveBeenCalledTimes(0);
		release.resolve();
		await command;
		expect(await context).toBeNull();
		expect(freeze).toHaveBeenCalledTimes(1);
		const request = new Request("http://localhost/accepted-ready");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		await finishOwnedResponse(f, request);
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
	} finally {
		release.resolve();
		freeze.mockRestore();
		await f.lifecycle.dispose();
	}
});
test("interrupted ordinary manual summaries retain lineage without an execution grant", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(
			f,
			"msg_interrupted_ordinary",
			"Ordinary coding direction",
		);
		const request = await startOwnedRequest(f);
		const frame = {
			sessionID,
			agent,
			model,
			kind: "primary" as const,
			request,
			response: new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(new Uint8Array([1]));
					},
				}),
			),
		};
		await f.emit("http.response", frame);
		if (!frame.response.body) throw new Error("Missing response body");
		const reader = frame.response.body.getReader();
		await reader.read();
		await reader.cancel("consumer cleanup");
		f.native.push(
			{
				type: "assistant",
				id: "msg_interrupted_stream",
				agent,
				model,
				content: [],
				finish: "error",
				error: { type: "aborted", message: "Step interrupted" },
				time: { created: 2, streamed: 3, completed: 4 },
			},
			{
				type: "idle",
				id: "msg_interrupted_idle",
				outcome: "interrupted",
				time: { created: 4 },
			},
		);
		f.sendEvent(terminal("interrupted"));
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		for (const id of ["msg_interrupted_summary", "msg_repeated_summary"]) {
			const input = f.context();
			const control = { ...automaticControl(id), reason: "manual" as const };
			f.native.push(control);
			await f.emit("compaction", input);
			expect(input.system).toEqual([]);
			f.native.splice(0, f.native.length, { ...control, status: "completed" });
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"unknown, synthetic, or stale real input",
			);
			await expect(
				f.lifecycle.beforeTool(ownershipNativeCall(f)),
			).rejects.toThrow();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		}
		await admitOrdinaryInput(f, "msg_separate_fresh", "Fresh ordinary request");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("stream loss wakes an exact pending context without granting or settling its private receipt", async () => {
	const f = await fixture();
	const freeze = spyOn(ExecutionAttribution.prototype, "freeze");
	try {
		f.blockAdmission();
		const command = f
			.command("flow-auto", "Held receipt during stream loss")
			.catch((error) => String(error));
		await f.flush();
		let settled = false;
		const context = f.emit("context", f.context()).then(
			() => {
				settled = true;
				return null;
			},
			(error) => {
				settled = true;
				return String(error);
			},
		);
		await f.flush();
		expect(settled).toBe(false);
		f.loseStream();
		await f.flush();
		expect(await context).toBe("Error: Flow execution epoch was revoked.");
		expect(freeze).toHaveBeenCalledTimes(0);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
		f.releaseAdmission();
		expect(await command).toContain(
			"unavailable after unload or event-stream loss",
		);
	} finally {
		f.releaseAdmission();
		freeze.mockRestore();
		await f.lifecycle.dispose();
	}
});

test("a cancelled same-epoch context releases only its own pre-dispatch frozen primary", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		f.blockNextSessionRead();
		const old = f.emit("context", f.context()).then(
			() => null,
			(error) => String(error),
		);
		await f.waitSessionRead();
		await f.lifecycle.prompt(
			sessionID,
			"Fresh private source after old freeze",
			delivery,
			{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
		);
		expect(await old).toBe("Error: Flow execution epoch was revoked.");
		const authority = f.autoDrive.captureAuthority(sessionID);
		expect(authority).not.toBeNull();
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const call = ownershipNativeCall(f);
		await f.lifecycle.beforeTool(call);
		f.releaseSessionRead();
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		await f.lifecycle.beforeTool(call);
	} finally {
		f.releaseSessionRead();
		await f.lifecycle.dispose();
	}
});

test("a source accepted while context waits owns a later native-read failure", async () => {
	const f = await fixture();
	try {
		f.blockAdmission();
		const command = f.command(
			"flow-auto",
			"Exact pending source before read failure",
		);
		await f.flush();
		f.rejectNextContextRead();
		const context = f.emit("context", f.context()).then(
			() => null,
			(error) => String(error),
		);
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		f.releaseAdmission();
		await command;
		expect(await context).toBe("Error: Native context snapshot failed.");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		await f.command("flow-auto", "Fresh source after matched read failure");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.beforeTool(ownershipNativeCall(f));
		expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
	} finally {
		f.releaseAdmission();
		await f.lifecycle.dispose();
	}
});

for (const outcome of ["failed", "interrupted"] as const)
	test(`observed owned ${outcome} idle revokes after resource-only cancellation and preserves fresh work`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Inspect the original exact source");
			const request = await startOwnedRequest(f);
			const call = ownershipNativeCall(f);
			const before = f.autoDrive.captureAuthority(sessionID);
			expect(before).not.toBeNull();
			const response = {
				sessionID,
				agent,
				model,
				kind: "primary" as const,
				request,
				response: new Response(new ReadableStream()),
			};
			await f.emit("http.response", response);
			if (!response.response.body) throw new Error("Missing body");
			await response.response.body.cancel("consumer end");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			const message = f.native.find((message) => message.id === call.messageID);
			if (message?.type !== "assistant")
				throw new Error("Missing captured assistant");
			message.content = [];
			message.finish = "error";
			message.error = {
				type: outcome === "interrupted" ? "aborted" : "provider.transport",
				message:
					outcome === "interrupted" ? "Step interrupted" : "ECONNREFUSED",
			};
			message.time.completed = 5;
			f.native.push({
				type: "idle",
				id: "msg_owned_terminal",
				outcome,
				time: { created: 6 },
			});
			const event = terminal(outcome);
			f.sendEvent(event);
			await f.flush();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			let oldEffects = 0;
			await expect(
				(async () => {
					await f.lifecycle.beforeTool(call);
					oldEffects++;
				})(),
			).rejects.toThrow("epoch was revoked");
			expect(oldEffects).toBe(0);
			expect(f.repository.saveCount).toBe(0);
			await f.command("flow-auto", "Inspect separately accepted fresh source");
			const fresh = f.autoDrive.captureAuthority(sessionID);
			expect(fresh).not.toBeNull();
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const freshCall = ownershipNativeCall(f);
			await f.lifecycle.beforeTool(freshCall);
			f.sendEvent(event);
			await f.flush();
			await expect(f.lifecycle.beforeTool(call)).rejects.toThrow();
			await f.lifecycle.beforeTool(freshCall);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(fresh);
			expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
			expect(oldEffects).toBe(0);
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

async function effectTool(f: OwnershipFixture, effects: string[]) {
	const registered = new Map<string, NativeToolDefinition>();
	await registerFlowTools(
		{
			location: { directory },
			permission: { assert: async () => {} },
			tool: {
				transform: async (apply) => {
					apply({
						list: () => [...registered].map(([id, tool]) => ({ id, ...tool })),
						get: (id) => {
							const tool = registered.get(id);
							return tool ? { id, ...tool } : undefined;
						},
						namespace() {},
						add: (tool) => {
							registered.set(tool.name, tool);
						},
						update: (id, update) => {
							const tool = registered.get(id);
							if (tool) update(tool);
						},
						remove: (id) => {
							registered.delete(id);
						},
					});
					return {
						dispose: async () => {
							registered.clear();
						},
					};
				},
			},
		},
		{
			flow_status: {
				description: "Observe execution effect",
				input: { type: "object" },
				execute: async () => {
					effects.push("effect");
					return "applied";
				},
			},
		},
		f.lifecycle.beforeTool,
	);
	const tool = registered.get("flow_status");
	if (!tool) throw new Error("Missing registered effect tool.");
	return tool;
}

for (const reject of [false, true])
	for (const successor of ["same-epoch", "new-epoch"] as const)
		test(`captured tool read ${reject} preserves ${successor} successor effects`, async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				const old = ownershipNativeCall(f);
				f.blockNextContextRead();
				if (reject) f.rejectNextContextRead();
				const effects: string[] = [];
				const tool = await effectTool(f, effects);
				const pending = tool.execute({}, old);
				const caught = pending.then(
					() => null,
					(error) => String(error),
				);
				await f.waitContextRead();
				if (successor === "new-epoch") await freshOwnershipWork(f);
				await finishOwnedResponse(f, await startOwnedRequest(f));
				const fresh = ownershipNativeCall(f);
				const authority = f.autoDrive.captureAuthority(sessionID);
				expect(authority).not.toBeNull();
				f.releaseContextRead();
				expect(await caught).toBe(
					reject
						? "Error: Native context snapshot failed."
						: "Error: Flow execution epoch was revoked.",
				);
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				await tool.execute({}, fresh);
				expect(effects).toEqual(["effect"]);
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		});

for (const known of ["bound", "historical"] as const)
	for (const boundary of ["flow", "shell"] as const)
		test(`${known} ${boundary} identity stays stale through compaction-truncated history`, async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				const old = ownershipNativeCall(
					f,
					boundary === "shell" ? "shell" : "flow_status",
				);
				if (known === "bound") await f.lifecycle.beforeTool(old);
				await finishOwnedResponse(f, await startOwnedRequest(f));
				const control = automaticControl("msg_retention_compaction");
				f.native.push(control);
				await f.emit("compaction", f.context());
				f.native.splice(0, f.native.length, {
					...control,
					status: "completed",
				});
				await finishOwnedResponse(f, await startOwnedRequest(f));
				const authority = f.autoDrive.captureAuthority(sessionID);
				expect(authority).not.toBeNull();
				const effects: string[] = [];
				const tool = await effectTool(f, effects);
				for (const id of [old.id, CallID.make("new-call-on-old-assistant")]) {
					const replay = async () => {
						if (boundary === "flow")
							await f.lifecycle.beforeTool({ ...old, id });
						else
							for (const callback of f.toolCallbacks["execute.before"])
								await callback({
									sessionID,
									agent,
									messageID: old.messageID,
									id,
									tool: "shell",
									input: {},
								});
						effects.push("old");
					};
					await expect(replay()).rejects.toThrow();
					expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				}
				await tool.execute({}, ownershipNativeCall(f));
				expect(effects).toEqual(["effect"]);
			} finally {
				await f.lifecycle.dispose();
			}
		});

test("session.deleted public barrier retires held owners and isolates another session", async () => {
	const f = await fixture();
	const freeze = spyOn(ExecutionAttribution.prototype, "freeze");
	try {
		await f.command("flow-auto", "Inspect original");
		const oldRequest = await startOwnedRequest(f);
		await finishOwnedResponse(f, oldRequest);
		const oldCall = ownershipNativeCall(f);
		await f.lifecycle.beforeTool(oldCall);
		const oldOwner = freeze.mock.results.at(-1)?.value;
		if (!oldOwner) throw new Error("Missing captured primary.");
		const otherID = Session.ID.make("session-retention-other");
		f.children.push({ ...f.session, id: otherID });
		f.native.splice(0);
		const command = f.commands.get("flow-auto");
		if (!command) throw new Error("Missing automatic command.");
		await command.execute({
			sessionID: otherID,
			prompt: { text: "Inspect other session" },
			delivery: "queue",
		});
		await f.emit("context", { ...f.context(), sessionID: otherID });
		const otherRequest = new Request("http://localhost/other-session");
		await f.emit("http.request", {
			sessionID: otherID,
			agent,
			model,
			kind: "primary",
			request: otherRequest,
		});
		const response = {
			sessionID: otherID,
			agent,
			model,
			kind: "primary" as const,
			request: otherRequest,
			response: new Response("other"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe("other");
		const otherCall = { ...ownershipNativeCall(f), sessionID: otherID };
		const authority = f.autoDrive.captureAuthority(otherID);
		expect(authority).not.toBeNull();
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		for (let repeat = 0; repeat < 2; repeat++) {
			await f.sendEventAndWait({
				id: `evt_retention_deleted_${repeat}`,
				created: 5,
				type: "session.deleted",
				durable: { aggregateID: sessionID, seq: repeat + 1, version: 2 },
				data: { sessionID },
			});
			expect(f.codingModels.has(sessionID)).toBe(false);
			expect(Reflect.get(oldOwner, "lifetime")?.kind ?? "current").toBe(
				"retired",
			);
			await expect(tool.execute({}, oldCall)).rejects.toThrow(
				"session was deleted",
			);
			for (const callback of f.toolCallbacks["execute.before"])
				await expect(
					Promise.resolve().then(() =>
						callback({
							sessionID,
							agent,
							messageID: oldCall.messageID,
							id: oldCall.id,
							tool: "shell",
							input: {},
						}),
					),
				).rejects.toThrow("session was deleted");
			await expect(
				f.emit("http.request", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request: oldRequest,
				}),
			).rejects.toThrow();
			await expect(
				f.emit("http.response", {
					sessionID,
					agent,
					model,
					kind: "primary",
					request: oldRequest,
					response: new Response("late"),
				}),
			).rejects.toThrow();
			await tool.execute({}, otherCall);
			expect(f.autoDrive.captureAuthority(otherID)).toEqual(authority);
		}
		expect(effects).toEqual(["effect", "effect"]);
	} finally {
		freeze.mockRestore();
		await f.lifecycle.dispose();
	}
});

for (const when of ["before", "during-read"] as const)
	test(`native ToolContext abort ${when} blocks the registered tool effect`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const effects: string[] = [];
			const tool = await effectTool(f, effects);
			const controller = new AbortController();
			const call = { ...ownershipNativeCall(f), signal: controller.signal };
			if (when === "before") controller.abort();
			else f.blockNextContextRead();
			const pending = tool.execute({}, call);
			const caught = pending.then(
				() => null,
				(error) => String(error),
			);
			if (when === "during-read") {
				await f.waitContextRead();
				controller.abort();
				f.releaseContextRead();
			}
			expect(await caught).toBe("Error: Flow tool execution was cancelled.");
			expect(effects).toEqual([]);
			expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
		} finally {
			f.releaseContextRead();
			await f.lifecycle.dispose();
		}
	});
