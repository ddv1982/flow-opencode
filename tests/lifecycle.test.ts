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
import type {
	ObservedValidation,
	PreparedValidation,
} from "../src/application/prepare-validation.js";
import { RecoveryController } from "../src/application/recovery-policy.js";
import type { FlowCodingModel } from "../src/config-shared.js";
import {
	AutoDriveCoordinator,
	type AutoDriveProjection,
	FLOW_AUTO_METADATA_KEY,
} from "../src/platform/opencode/auto-drive.js";
import { ExecutionAttribution } from "../src/platform/opencode/execution-attribution.js";
import { registerFlowLifecycle } from "../src/platform/opencode/lifecycle.js";
import type {
	NativeToolAfter,
	NativeToolBefore,
	NativeToolDefinition,
} from "../src/platform/opencode/sdk.js";
import { registerFlowTools } from "../src/platform/opencode/tools.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";
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
async function fixture(
	selectedAgent = agent,
	onFlowTerminal?: (host: string) => void,
) {
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
	const flowTerminals: string[] = [];
	const codingModels = new Map<string, FlowCodingModel>();
	const repository = new MemorySessionRepository();
	const flow = createFlowService(repository, deterministicEnvironment());
	const recovery = new RecoveryController({
		assess: async () => ({ kind: "unavailable", reason: "test" }),
	});
	let dispatchReturnGate: {
		entered: () => void;
		promise: Promise<void>;
	} | null = null;
	const automaticAccepted = Promise.withResolvers<string>();
	let projectionReads = 0;
	let projectionGate: { entered: () => void; promise: Promise<void> } | null =
		null;
	let digestGate: { entered: () => void; promise: Promise<void> } | null = null;
	const sourceDigest = `sha256:${"a".repeat(64)}` as const;
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
					delivery: input.delivery ?? "steer",
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
					delivery: input.delivery ?? "steer",
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
					delivery: input.delivery ?? "steer",
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
		readProjection: async () => {
			projectionReads++;
			const snapshot = structuredClone(projection),
				gate = projectionGate;
			projectionGate = null;
			if (gate) {
				gate.entered();
				await gate.promise;
			}
			return snapshot;
		},
		readSourceDigest: async () => {
			const gate = digestGate;
			digestGate = null;
			if (gate) {
				gate.entered();
				await gate.promise;
			}
			return sourceDigest;
		},
		prompt: async (...args) => {
			const result = await lifecycle.prompt(...args),
				gate = dispatchReturnGate;
			dispatchReturnGate = null;
			if (gate) {
				gate.entered();
				await gate.promise;
			}
			if (result.kind === "sent") automaticAccepted.resolve(result.source);
			return result;
		},
		createToken: () => "local-token",
	});
	lifecycle = await registerFlowLifecycle({
		ctx,
		autoDrive,
		recovery,
		flow,
		codingModels,
		onFlowTerminal: (host) => {
			flowTerminals.push(host);
			onFlowTerminal?.(host);
		},
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
		ctxSession: ctx.session,
		ctxSessionContext: ctx.session.context.bind(ctx.session),
		autoDrive,
		recovery,
		repository,
		hooks,
		commands,
		logs,
		flowTerminals,
		native,
		session,
		children,
		registrations,
		codingModels,
		emit,
		context,
		toolCallbacks,
		waitAutomaticSource: () => automaticAccepted.promise,
		projectionReadCount: () => projectionReads,
		blockNextDispatchReturn() {
			const entered = Promise.withResolvers<void>(),
				release = Promise.withResolvers<void>();
			dispatchReturnGate = {
				entered: entered.resolve,
				promise: release.promise,
			};
			return {
				entered: entered.promise,
				release: release.resolve,
			};
		},
		sourceDigest,
		blockPolicyRead(stage: "projection" | "digest") {
			const entered = Promise.withResolvers<void>(),
				release = Promise.withResolvers<void>();
			const gate = { entered: entered.resolve, promise: release.promise };
			if (stage === "projection") projectionGate = gate;
			else digestGate = gate;
			return {
				entered: entered.promise,
				release: release.resolve,
				reject: release.reject,
			};
		},
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
			for (let i = 0; i < 20; i++) await Promise.resolve();
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
		await f.lifecycle.verifyTool(execution, "flow");
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_stop"),
			prompt: { text: "Stop and change direction" },
			delivery: "steer",
		});
		await expect(f.lifecycle.verifyTool(execution, "flow")).rejects.toThrow(
			"epoch",
		);
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(
			{
				sessionID,
				agent,
				messageID,
				id,
				signal: new AbortController().signal,
				progress: async () => {},
			},
			"flow",
		);
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
		f.native.push({
			type: "idle",
			id: "msg_idle",
			outcome: "succeeded",
			time: { created: 3 },
		});
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
				id: SessionMessage.ID.fromEvent(`evt_${outcome}`),
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
	f.native.push({
		type: "idle",
		id: "msg_idle",
		outcome: "succeeded",
		time: { created: 3 },
	});
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

test("native execution success waits for exact terminal proof before dispatching once", async () => {
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
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
		expect(f.native.some((message) => message.type === "idle")).toBe(false);
		f.native.push({
			type: "idle",
			id: SessionMessage.ID.fromEvent(event.id),
			outcome: "succeeded",
			time: { created: 3 },
		});
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
		f.native.push({
			type: "idle",
			id: SessionMessage.ID.fromEvent("evt_old_success_notification"),
			outcome: "succeeded",
			time: { created: 1 },
		});
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

test("HTTP retry keeps its unfinished assistant and late old responses cannot revoke it", async () => {
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
		await f.emit("http.response", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request: oldRequest,
			response: new Response("transient", { status: 503 }),
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
		await f.lifecycle.verifyTool(
			{
				sessionID,
				agent,
				messageID: assistantID,
				id: callID,
				signal: new AbortController().signal,
				progress: async () => {},
			},
			"flow",
		);
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
						await f.lifecycle.verifyTool(
							{
								sessionID,
								agent,
								messageID: assistantID,
								id: callID,
								signal: new AbortController().signal,
								progress: async () => {},
							},
							"flow",
						);
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
			await f.lifecycle.verifyTool(call, "flow");
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
							await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
								? f.lifecycle.verifyTool(call, "flow")
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
							await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
					f.native.push({
						type: "idle",
						id: SessionMessage.ID.fromEvent("evt_succeeded"),
						outcome,
						time: { created: 4 },
					});
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(call, "flow");
		const authority = f.autoDrive.captureAuthority(sessionID);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await expect(f.lifecycle.verifyTool(call, "flow")).rejects.toThrow(
			"Flow assistant cannot be rebound to another request.",
		);
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
					await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.emit("context", compact);
		const request = new Request("http://localhost/foreign-native");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		await finishOwnedResponse(f, request);
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		const foreignCall = ownershipNativeCall(f);
		await expect(f.lifecycle.verifyTool(foreignCall, "flow")).rejects.toThrow(
			"live admitted input origin",
		);
		expect(f.repository.saveCount).toBe(0);
		await f.command("flow-auto", "Inspect separately accepted fresh source");
		const fresh = await startOwnedRequest(f);
		await finishOwnedResponse(f, fresh);
		await expect(f.lifecycle.verifyTool(foreignCall, "flow")).rejects.toThrow(
			"cannot be rebound",
		);
		const call = ownershipNativeCall(f);
		await f.lifecycle.verifyTool(call, "flow");
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
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool({ ...call, agent: reviewer }, "flow");
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
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
			await f.lifecycle.verifyTool(call, "flow");
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
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
					f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
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
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const actor of ["command", "synthetic"] as const)
	test(`${actor} selected read respects its input reservation boundary`, async () => {
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
			if (actor === "command")
				await expect(f.emit("context", old)).rejects.toThrow(
					"epoch was revoked",
				);
			else await finishOwnedResponse(f, await startOwnedRequest(f));
			const control = automaticControl("msg_pre_get_old");
			f.native.push(control);
			if (actor === "command")
				await expect(f.emit("compaction", old)).rejects.toThrow(
					"epoch was revoked",
				);
			else await f.emit("compaction", old);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			expect(f.repository.saveCount).toBe(0);
			f.native.splice(f.native.indexOf(control), 1);
			f.releaseSessionRead();
			await pending;
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
			f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
				id: SessionMessage.ID.fromEvent(terminal("interrupted").id),
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
				f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
			).rejects.toThrow();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.repository.saveCount).toBe(0);
		}
		await admitOrdinaryInput(f, "msg_separate_fresh", "Fresh ordinary request");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
		await f.lifecycle.verifyTool(call, "flow");
		f.releaseSessionRead();
		await f.flush();
		expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		await f.lifecycle.verifyTool(call, "flow");
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
		await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
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
				id: SessionMessage.ID.fromEvent(terminal(outcome).id),
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
					await f.lifecycle.verifyTool(call, "flow");
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
			await f.lifecycle.verifyTool(freshCall, "flow");
			f.sendEvent(event);
			await f.flush();
			await expect(f.lifecycle.verifyTool(call, "flow")).rejects.toThrow();
			await f.lifecycle.verifyTool(freshCall, "flow");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(fresh);
			expect(f.autoDrive.captureAuthority(sessionID)).not.toBeNull();
			expect(oldEffects).toBe(0);
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

async function effectTool(
	f: OwnershipFixture,
	effects: string[],
	onEffect?: () => void,
) {
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
					onEffect?.();
					return "applied";
				},
			},
		},
		async (context) => {
			await f.lifecycle.verifyTool(context, "flow");
		},
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
				if (known === "bound") await f.lifecycle.verifyTool(old, "flow");
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
							await f.lifecycle.verifyTool({ ...old, id }, "flow");
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
		await f.lifecycle.verifyTool(oldCall, "flow");
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

async function exerciseUnregisteredNativeExecution(
	f: OwnershipFixture,
	expectedMessages: SessionContext["messages"],
) {
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
	expect(f.repository.saveCount).toBe(0);
	const context = f.context();
	await f.emit("context", context);
	expect(context.messages).toEqual(expectedMessages);
	const request = new Request("http://localhost/unregistered-native", {
		method: "POST",
		body: "ordinary native request body",
	});
	const outbound = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
	};
	await f.emit("http.request", outbound);
	expect(await outbound.request.clone().text()).toBe(
		"ordinary native request body",
	);
	const inbound = {
		...outbound,
		response: new Response("ordinary native response body"),
	};
	await f.emit("http.response", inbound);
	expect(await inbound.response.text()).toBe("ordinary native response body");
	const shell = ownershipNativeCall(f, "shell");
	let shellEffects = 0;
	for (const callback of f.toolCallbacks["execute.before"])
		await callback({
			...shell,
			tool: "shell",
			input: { command: "printf not-run" },
		});
	shellEffects++;
	expect(shellEffects).toBe(1);
	const assistant = f.native.find((message) => message.id === shell.messageID);
	if (assistant?.type !== "assistant")
		throw new Error("Missing native tool assistant.");
	const flowCall = { ...shell, id: CallID.make("call_unregistered_flow") };
	assistant.content.push({
		type: "tool",
		id: flowCall.id,
		name: "flow_status",
		time: { created: 4 },
		state: {
			status: "running",
			input: { request: { view: "compact" } },
			metadata: {},
		},
	});
	const effects: string[] = [];
	const tool = await effectTool(f, effects);
	await expect(tool.execute({}, flowCall)).rejects.toThrow();
	expect(effects).toEqual([]);
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
	expect(f.repository.saveCount).toBe(0);
	expect(f.repository.session).toBeNull();
}

test("unregistered native regression: reloaded user runs ordinary execution without Flow authority", async () => {
	const f = await fixture();
	try {
		f.native.push({
			type: "user",
			id: "msg_reloaded_user",
			text: "Ordinary queued user before reload",
			time: { created: 0 },
		});
		await exerciseUnregisteredNativeExecution(f, [
			{
				role: "user",
				id: "msg_reloaded_user",
				content: [{ type: "text", text: "Ordinary queued user before reload" }],
			},
		]);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("unregistered native regression: external synthetic in empty ledger runs ordinary execution without Flow authority", async () => {
	const f = await fixture();
	try {
		f.native.push({
			type: "synthetic",
			id: "msg_external_synthetic",
			text: "Ordinary external synthetic request",
			time: { created: 0 },
		});
		await exerciseUnregisteredNativeExecution(f, [
			{
				role: "user",
				id: "msg_external_synthetic",
				content: [
					{ type: "text", text: "Ordinary external synthetic request" },
				],
			},
		]);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("unregistered native regression: external synthetic after ordinary prompt in same session runs without Flow authority", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(
			f,
			"msg_prior_ordinary",
			"Ordinary prompt before external notification",
		);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		f.native.push(
			{
				type: "assistant",
				id: "msg_prior_ordinary_assistant",
				agent,
				model,
				time: { created: 11, completed: 12 },
				content: [{ type: "text", text: "Fixture finished" }],
			},
			{
				type: "idle",
				id: "msg_prior_ordinary_idle",
				outcome: "succeeded",
				time: { created: 13 },
			},
			{
				type: "synthetic",
				id: "msg_external_after_ordinary",
				text: "External ordinary notification after prior prompt",
				time: { created: 14 },
			},
		);
		await exerciseUnregisteredNativeExecution(f, [
			{
				role: "user",
				id: "msg_prior_ordinary",
				content: [
					{
						type: "text",
						text: "Ordinary prompt before external notification",
					},
				],
			},
			{
				role: "user",
				id: "msg_external_after_ordinary",
				content: [
					{
						type: "text",
						text: "External ordinary notification after prior prompt",
					},
				],
			},
		]);
	} finally {
		await f.lifecycle.dispose();
	}
});

async function unregisteredFixture() {
	const f = await fixture();
	f.native.push({
		type: "synthetic",
		id: "msg_foreign",
		text: "External request",
		time: { created: 0 },
	});
	return f;
}

for (const replacement of ["new-epoch", "same-epoch"] as const)
	for (const boundary of ["request", "response", "shell"] as const)
		test(`native-only ${boundary} rejects ${replacement} clock replacement before successor freeze`, async () => {
			const f = await unregisteredFixture();
			try {
				if (replacement === "same-epoch") {
					await f.command("flow-auto", "Establish the same-epoch lease");
					f.native.push({
						type: "synthetic",
						id: "msg_foreign_same_epoch",
						text: "Foreign above Flow",
						time: { created: 1 },
					});
				}
				await f.emit("context", f.context());
				const request = new Request("http://localhost/old-native");
				const http = {
					sessionID,
					agent,
					model,
					kind: "primary" as const,
					request,
				};
				if (boundary !== "request") await f.emit("http.request", http);
				const call =
					boundary === "shell" ? ownershipNativeCall(f, "shell") : undefined;
				if (replacement === "new-epoch")
					await f.command("flow-auto", "Fresh observed authority");
				else
					await f.lifecycle.prompt(
						sessionID,
						"Private frontier replacement",
						delivery,
						{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
					);
				const authority = f.autoDrive.captureAuthority(sessionID);
				if (boundary === "request")
					await expect(f.emit("http.request", http)).rejects.toThrow();
				if (boundary === "response")
					await expect(
						f.emit("http.response", {
							...http,
							response: new Response("obsolete"),
						}),
					).rejects.toThrow();
				if (call)
					await expect(
						f.lifecycle.verifyTool(call, "native", "shell"),
					).rejects.toThrow();
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				expect(f.repository.saveCount).toBe(0);
				await finishOwnedResponse(f, await startOwnedRequest(f));
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			} finally {
				await f.lifecycle.dispose();
			}
		});

test("native-only protected denial during streaming keeps the HTTP overlap barrier", async () => {
	const f = await unregisteredFixture();
	try {
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
						controller.enqueue(new TextEncoder().encode("healthy"));
					},
				}),
			),
		};
		await f.emit("http.response", frame);
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		await expect(tool.execute({}, ownershipNativeCall(f))).rejects.toThrow(
			"live admitted input origin",
		);
		expect(effects).toEqual([]);
		await expect(f.emit("context", f.context())).rejects.toThrow("overlap");
		if (!frame.response.body) throw new Error("Expected stream.");
		const reader = frame.response.body.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe(
			"healthy",
		);
		await reader.cancel();
		await finishOwnedResponse(f, await startOwnedRequest(f));
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const outcome of ["failed", "succeeded", "interrupted"] as const)
	test(`native-only ${outcome} terminal cannot invoke Flow terminal effects`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Unrelated exact lease");
			const authority = f.autoDrive.captureAuthority(sessionID);
			f.native.push({
				type: "synthetic",
				id: "msg_foreign_terminal",
				text: "Foreign request",
				time: { created: 1 },
			});
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const event: OpenCodeEvent =
				outcome === "succeeded"
					? {
							id: "evt_foreign_terminal",
							type: "session.execution.succeeded",
							created: 3,
							durable: { aggregateID: sessionID, seq: 3, version: 1 },
							data: { sessionID },
						}
					: terminal(outcome, "evt_foreign_terminal");
			f.native.push({
				type: "idle",
				id: SessionMessage.ID.fromEvent(event.id),
				outcome,
				time: { created: 3 },
			});
			f.session.outcome = outcome;
			f.session.time.idle = 3;
			await f.sendEventAndWait(event);
			expect(f.flowTerminals).toEqual([]);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.repository.saveCount).toBe(0);
			expect(
				f.native
					.filter((message) => message.type === "synthetic")
					.map((message) => message.id),
			).toEqual(["msg_foreign_terminal"]);
			await f.command("flow-auto", "Fresh Flow after foreign terminal");
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const read of ["context", "status"] as const)
	test(`old terminal entering after fresh freeze cannot revoke on ${read} failure`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const old = terminal("failed", "evt_before_new_freeze");
			f.native.push({
				type: "idle",
				id: SessionMessage.ID.fromEvent(old.id),
				outcome: "failed",
				time: { created: 1 },
			});
			await f.command("flow-auto", "Fresh source and primary");
			const authority = f.autoDrive.captureAuthority(sessionID);
			const request = await startOwnedRequest(f);
			if (read === "context") f.rejectNextContextRead();
			else f.rejectNextSessionRead();
			await f.sendEventAndWait(old);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.flowTerminals).toEqual([]);
			await finishOwnedResponse(f, request);
			if (read === "status") {
				await expect(
					f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
				).rejects.toThrow("Native session snapshot failed");
				await f.command(
					"flow-auto",
					"Fresh after exact tool observation failure",
				);
				await finishOwnedResponse(f, await startOwnedRequest(f));
			}
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
			expect(f.logs.includes("Flow event stream failed closed.")).toBe(false);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const command of ["bun test", "printf foreign"])
	test(`foreign shell ${command} preserves armed Flow capture over a populated frontier`, async () => {
		let capture: ValidationCaptureCoordinator;
		const f = await fixture(agent, (host) => {
			capture.cancel(host);
		});
		const observations: ObservedValidation[] = [];
		const prepared: PreparedValidation = {
			featureId: "feature",
			runId: "run",
			command: "bun test",
			scope: "focused",
			sourceDigest: `sha256:${"a".repeat(64)}`,
			hostPlatform: "linux",
			intent: "pass",
			assertions: [],
			resultsPath: undefined,
		};
		let serial = 0;
		capture = new ValidationCaptureCoordinator({
			readSession: async () => f.session,
			randomId: () => `capture-${++serial}`,
			persistObservation: async (_workspace, value, assertAuthorized) => {
				assertAuthorized();
				observations.push(value);
				return { ...value, id: value.captureId, recordedRevision: 4 };
			},
		});
		try {
			await admitOrdinaryInput(
				f,
				"msg_capture_flow",
				"Observed ordinary Flow direction",
			);
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const effects: string[] = [];
			const tool = await effectTool(f, effects, () => {
				capture.arm(sessionID, directory, prepared);
			});
			await tool.execute({}, ownershipNativeCall(f));
			expect(capture.pendingCount()).toBe(1);
			f.native.push({
				type: "synthetic",
				id: "msg_foreign_capture",
				text: "External native shell",
				time: { created: 1 },
			});
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const foreign = ownershipNativeCall(f, "shell");
			const before: NativeToolBefore = {
				sessionID,
				agent,
				id: foreign.id,
				messageID: foreign.messageID,
				tool: "shell",
				input: { command },
			};
			for (const callback of f.toolCallbacks["execute.before"])
				await callback(before);
			const access = await f.lifecycle.verifyTool(before, "native", "shell");
			if (access.kind === "flow")
				await capture.observeToolBefore(before, access.assertCurrent);
			const after: NativeToolAfter = {
				...before,
				status: "completed",
				result: {
					content: "literal native shell result",
					output: {
						exit: 0,
						truncated: false,
						output: "literal native shell result",
					},
				},
			};
			const original = structuredClone(after);
			expect(await capture.observeToolAfter(after)).toBeNull();
			expect(after).toEqual(original);
			expect(observations).toEqual([]);
			expect(capture.pendingCount()).toBe(1);
			const event: OpenCodeEvent = {
				id: "evt_foreign_capture_idle",
				type: "session.execution.succeeded",
				created: 2,
				durable: { aggregateID: sessionID, seq: 2, version: 1 },
				data: { sessionID },
			};
			f.native.push({
				type: "idle",
				id: SessionMessage.ID.fromEvent(event.id),
				outcome: "succeeded",
				time: { created: 2 },
			});
			f.session.time.idle = 2;
			f.session.outcome = "succeeded";
			await f.sendEventAndWait(event);
			expect(capture.pendingCount()).toBe(1);
			expect(f.flowTerminals).toEqual([]);
			expect(f.repository.saveCount).toBe(0);
			expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
			capture.cancel(sessionID);
			await admitOrdinaryInput(
				f,
				"msg_fresh_capture",
				"Fresh observed validation",
			);
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await tool.execute({}, ownershipNativeCall(f));
			const fresh: NativeToolBefore = {
				...ownershipNativeCall(f, "shell"),
				tool: "shell",
				input: { command: "bun test" },
			};
			const authorized = await f.lifecycle.verifyTool(fresh, "native", "shell");
			if (authorized.kind !== "flow")
				throw new Error("Expected exact Flow observation.");
			await capture.observeToolBefore(fresh, authorized.assertCurrent);
			const result: NativeToolAfter = {
				...fresh,
				status: "completed",
				result: {
					content: "fresh passed",
					output: { exit: 0, truncated: false, output: "fresh passed" },
				},
			};
			expect((await capture.observeToolAfter(result))?.id).toBe("capture-2");
			expect(await capture.observeToolAfter(result)).toBeNull();
			expect(observations.map((value) => value.captureId)).toEqual([
				"capture-2",
			]);
			expect(JSON.stringify(result)).toContain("[flow-validation]");
			expect(capture.pendingCount()).toBe(0);
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		} finally {
			capture.clear();
			await f.lifecycle.dispose();
		}
	});

for (const proof of ["before", "after"] as const)
	test(`owned terminal read failure ${proof} prefix proof has bounded cleanup`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const authority = f.autoDrive.captureAuthority(sessionID);
			const event: OpenCodeEvent = {
				id: "evt_owned_proof",
				type: "session.execution.succeeded",
				created: 4,
				durable: { aggregateID: sessionID, seq: 4, version: 1 },
				data: { sessionID },
			};
			f.native.push({
				type: "idle",
				id: SessionMessage.ID.fromEvent(event.id),
				outcome: "succeeded",
				time: { created: 4 },
			});
			f.session.outcome = "succeeded";
			f.session.time.idle = 4;
			if (proof === "before") f.rejectNextContextRead();
			else f.rejectNextSessionRead();
			await f.sendEventAndWait(event);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(
				proof === "before" ? authority : null,
			);
			expect(f.flowTerminals).toEqual([]);
			expect(f.logs.includes("Flow event stream failed closed.")).toBe(false);
			await f.command("flow-auto", "Fresh source after terminal read error");
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("pending private receipt still refuses a distinct raw native suffix", async () => {
	const f = await fixture();
	try {
		f.blockAdmission();
		const command = f.command("flow-plan", "Pending plan source").catch(String);
		await f.flush();
		f.native.push({
			type: "synthetic",
			id: "msg_missing_above_unaccepted",
			text: "External native",
			time: { created: 1 },
		});
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"unknown, synthetic, or stale real input",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
		f.releaseAdmission();
		await command;
	} finally {
		f.releaseAdmission();
		await f.lifecycle.dispose();
	}
});

for (const type of ["user", "synthetic"] as const)
	test(`distinct ${type} after mismatched private receipt runs ordinary execution without summary authority`, async () => {
		const f = await fixture();
		try {
			f.corruptReceipt();
			await expect(
				f.command("flow-plan", "Pending plan source"),
			).rejects.toThrow(
				"Flow admission receipt did not match its exact local payload.",
			);
			const failed = f.native.find((message) => message.type === "user");
			if (failed?.type !== "user")
				throw new Error("Missing rejected private prefix.");
			expect(failed.text).toContain("Pending plan source");
			expect(f.native).toEqual([
				{
					type: "user",
					id: failed.id,
					text: failed.text,
					time: { created: 0 },
				},
			]);
			const id = "msg_receipt_distinct",
				text = "External native";
			expect(failed.id).not.toBe(id);
			f.native.push({ type, id, text, time: { created: 20 } });
			await exerciseUnregisteredNativeExecution(f, f.context().messages);
			await refuseUnownedSummaries(f, "msg_receipt_summary");
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const replacement of ["same-epoch", "new-epoch"] as const)
	for (const reject of [false, true])
		test(`native-only delayed shell read ${reject} cannot affect ${replacement} successor`, async () => {
			const f = await fixture();
			try {
				await f.command("flow-auto", "Establish current Flow lineage");
				f.native.push({
					type: "synthetic",
					id: "msg_delayed_native",
					text: "Ordinary external request",
					time: { created: 1 },
				});
				await finishOwnedResponse(f, await startOwnedRequest(f));
				const call = ownershipNativeCall(f, "shell");
				f.blockNextContextRead();
				if (reject) f.rejectNextContextRead();
				const pending = f.lifecycle
					.verifyTool(call, "native", "shell")
					.catch(String);
				await f.waitContextRead();
				if (replacement === "same-epoch")
					await f.lifecycle.prompt(sessionID, "Private successor", delivery, {
						[FLOW_AUTO_METADATA_KEY]: "local-token",
					});
				else await f.command("flow-auto", "Fresh successor command");
				const authority = f.autoDrive.captureAuthority(sessionID);
				const request = await startOwnedRequest(f);
				f.releaseContextRead();
				expect(await pending).toBe(
					reject
						? "Error: Native context snapshot failed."
						: "Error: Flow execution epoch was revoked.",
				);
				expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
				await finishOwnedResponse(f, request);
				await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
				expect(f.repository.saveCount).toBe(0);
			} finally {
				f.releaseContextRead();
				await f.lifecycle.dispose();
			}
		});

test("native-only unfinished retry preserves exact call identity and isolates the old Request", async () => {
	const f = await unregisteredFixture();
	try {
		const oldRequest = await startOwnedRequest(f);
		const messageID = SessionMessage.ID.make("msg_native_retry");
		const retry: Extract<SessionMessageInfo, { type: "assistant" }> = {
			type: "assistant",
			id: messageID,
			agent,
			model,
			time: { created: 1 },
			content: [],
			retry: {
				attempt: 1,
				at: 100,
				error: { type: "provider.transport", message: "retry" },
			},
		};
		f.native.push(retry);
		const next = await startOwnedRequest(f);
		await expect(
			f.emit("http.response", {
				sessionID,
				agent,
				model,
				kind: "primary",
				request: oldRequest,
				response: new Response("old retry response"),
			}),
		).rejects.toThrow("Request identity");
		await finishOwnedResponse(f, next);
		const id = CallID.make("call_native_retry");
		retry.content.push({
			type: "tool",
			id,
			name: "shell",
			time: { created: 2 },
			state: {
				status: "running",
				input: { command: "printf native" },
				metadata: {},
			},
		});
		expect(
			await f.lifecycle.verifyTool(
				{ sessionID, agent, messageID, id },
				"native",
				"shell",
			),
		).toEqual({ kind: "native-only" });
		await expect(
			f.lifecycle.verifyTool(
				{ sessionID, agent, messageID, id },
				"flow",
				"shell",
			),
		).rejects.toThrow("live admitted input origin");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const callback of ["http.request", "http.response"] as const)
	test(`unbound mismatched ${callback} cannot fail a healthy Flow owner`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Exact healthy Flow source");
			const authority = f.autoDrive.captureAuthority(sessionID);
			const request = await startOwnedRequest(f);
			const unbound = {
				sessionID,
				agent,
				model: { ...model, id: Model.ID.make("foreign") },
				kind: "primary" as const,
				request: new Request("http://localhost/unbound"),
			};
			if (callback === "http.request")
				await expect(f.emit(callback, unbound)).rejects.toThrow(
					"unique frozen context",
				);
			else
				await expect(
					f.emit(callback, { ...unbound, response: new Response("unbound") }),
				).rejects.toThrow("Request identity");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			await finishOwnedResponse(f, request);
			const effects: string[] = [];
			const tool = await effectTool(f, effects);
			await tool.execute({}, ownershipNativeCall(f));
			expect(effects).toEqual(["effect"]);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("a bound native-only shell cannot use the grantless Flow ordinary-tool bypass after replacement", async () => {
	const f = await unregisteredFixture();
	try {
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const old = ownershipNativeCall(f, "shell");
		await f.lifecycle.verifyTool(old, "native", "shell");
		await admitOrdinaryInput(
			f,
			"msg_grantless_replacement",
			"Fresh observed ordinary",
		);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		let staleEffects = 0;
		await expect(
			(async () => {
				for (const callback of f.toolCallbacks["execute.before"])
					await callback({
						sessionID,
						agent,
						messageID: old.messageID,
						id: old.id,
						tool: "shell",
						input: { command: "printf stale" },
					});
				staleEffects++;
			})(),
		).rejects.toThrow();
		expect(staleEffects).toBe(0);
		const current = ownershipNativeCall(f, "shell");
		let ordinaryEffects = 0;
		for (const callback of f.toolCallbacks["execute.before"])
			await callback({
				sessionID,
				agent,
				messageID: current.messageID,
				id: current.id,
				tool: "shell",
				input: { command: "printf current" },
			});
		ordinaryEffects++;
		expect(ordinaryEffects).toBe(1);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const identity of ["agent", "model", "session"] as const)
	test(`native-only context rejects changed selected ${identity} without revoking Flow lineage`, async () => {
		const f = await fixture();
		try {
			await f.command("flow-auto", "Unrelated exact Flow authority");
			const authority = f.autoDrive.captureAuthority(sessionID);
			f.native.push({
				type: "synthetic",
				id: "msg_native_selection",
				text: "Foreign ordinary request",
				time: { created: 1 },
			});
			if (identity === "agent") f.session.agent = Agent.ID.make("other");
			if (identity === "model")
				f.session.model = { ...model, id: Model.ID.make("other") };
			if (identity === "session")
				f.session.id = Session.ID.make("session-other");
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"native selected session",
			);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.repository.saveCount).toBe(0);
			f.session.agent = agent;
			f.session.model = model;
			f.session.id = sessionID;
			await f.command("flow-auto", "Fresh exact selected source");
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const rejectedAt of ["model", "agent", "session", "session-read"] as const)
	test(`rejected native ${rejectedAt} preserves the previous usable primary`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const call = ownershipNativeCall(f);
			const access = await f.lifecycle.verifyTool(call, "flow");
			if (access.kind !== "flow") throw new Error("Expected admitted owner.");
			access.assertCurrent();
			const effects: string[] = [];
			const tool = await effectTool(f, effects);
			const authority = f.autoDrive.captureAuthority(sessionID);
			f.native.push({
				type: "synthetic",
				id: "msg_invalid_replacement",
				text: "External candidate",
				time: { created: 5 },
			});
			await tool.execute({}, call);
			expect(effects).toEqual(["effect"]);
			if (rejectedAt === "model")
				f.session.model = {
					...model,
					id: Model.ID.make("unselected-other-model"),
				};
			if (rejectedAt === "agent")
				f.session.agent = Agent.ID.make("unselected-agent");
			if (rejectedAt === "session")
				f.session.id = Session.ID.make("session-foreign");
			if (rejectedAt === "session-read") f.rejectNextSessionRead();
			await expect(f.emit("context", f.context())).rejects.toThrow(
				rejectedAt === "session-read"
					? "Native session snapshot failed"
					: "native selected session",
			);
			f.session.model = model;
			f.session.agent = agent;
			f.session.id = sessionID;
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			access.assertCurrent();
			await tool.execute({}, call);
			expect(effects).toEqual(["effect", "effect"]);
			await finishOwnedResponse(f, await startOwnedRequest(f));
			expect(
				await f.lifecycle.verifyTool(
					ownershipNativeCall(f, "shell"),
					"native",
					"shell",
				),
			).toEqual({ kind: "native-only" });
			expect(() => access.assertCurrent()).toThrow("superseded");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			expect(f.repository.saveCount).toBe(0);
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("queued public input preserves O until exact A consumption", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_queue_O", "Original O");
		const request = await startOwnedRequest(f);
		const originalCall = ownershipNativeCall(f);
		const original = await f.lifecycle.verifyTool(originalCall, "flow");
		if (original.kind !== "flow") throw new Error("Expected O Flow access.");
		original.assertCurrent();
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		expect(await tool.execute({}, originalCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect"]);
		const response = {
			sessionID,
			agent,
			model,
			kind: "primary" as const,
			request,
			response: new Response(new Uint8Array([0, 65, 10, 255, 13, 10])),
		};
		await f.emit("http.response", response);
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_queue_A"),
			prompt: { text: "Queued A" },
			delivery: "queue",
		});
		expect(
			f.native.filter((item) => item.type === "user").map((item) => item.id),
		).toEqual(["msg_queue_O"]);
		expect(f.context().messages.map((item) => item.id)).toEqual([
			"msg_queue_O",
		]);
		expect(() => original.assertCurrent()).not.toThrow();
		expect(await tool.execute({}, originalCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect", "effect"]);
		expect([...new Uint8Array(await response.response.arrayBuffer())]).toEqual([
			0, 65, 10, 255, 13, 10,
		]);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		expect(() => original.assertCurrent()).toThrow("superseded");
		const nextOCall = ownershipNativeCall(f);
		const nextO = await f.lifecycle.verifyTool(nextOCall, "flow");
		if (nextO.kind !== "flow") throw new Error("Expected next O Flow access.");
		nextO.assertCurrent();
		expect(await tool.execute({}, nextOCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect", "effect", "effect"]);
		f.native.push({
			type: "user",
			id: "msg_queue_A",
			text: "Queued A",
			time: { created: 10 },
		});
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const aCall = ownershipNativeCall(f);
		const a = await f.lifecycle.verifyTool(aCall, "flow");
		if (a.kind !== "flow") throw new Error("Expected consumed A Flow access.");
		a.assertCurrent();
		expect(await tool.execute({}, aCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(() => nextO.assertCurrent()).toThrow();
		await expect(tool.execute({}, nextOCall)).rejects.toThrow();
		a.assertCurrent();
		expect(effects).toEqual(["effect", "effect", "effect", "effect"]);
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("queued public inputs consume A before pending B without idle", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_order_O", "Original O");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const oCall = ownershipNativeCall(f);
		const o = await f.lifecycle.verifyTool(oCall, "flow");
		if (o.kind !== "flow") throw new Error("Expected O Flow access.");
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		expect(await tool.execute({}, oCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect"]);
		for (const [id, text] of [
			["msg_order_A", "Queued A"],
			["msg_order_B", "Queued B"],
		] as const) {
			await f.emit("prompt", {
				sessionID,
				messageID: SessionMessage.ID.make(id),
				prompt: { text },
				delivery: "queue",
			});
			expect(f.context().messages.map((item) => item.id)).toEqual([
				"msg_order_O",
			]);
			expect(() => o.assertCurrent()).not.toThrow();
			expect(await tool.execute({}, oCall)).toEqual({
				content: [{ type: "text", text: "applied" }],
			});
		}
		expect(effects).toEqual(["effect", "effect", "effect"]);
		f.native.push({
			type: "user",
			id: "msg_order_A",
			text: "Queued A",
			time: { created: 10 },
		});
		expect(f.context().messages.map((item) => item.id)).toEqual([
			"msg_order_O",
			"msg_order_A",
		]);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const aCall = ownershipNativeCall(f);
		const a = await f.lifecycle.verifyTool(aCall, "flow");
		if (a.kind !== "flow") throw new Error("Expected consumed A Flow access.");
		a.assertCurrent();
		expect(await tool.execute({}, aCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(() => o.assertCurrent()).toThrow();
		await expect(tool.execute({}, oCall)).rejects.toThrow();
		a.assertCurrent();
		expect(effects).toEqual(["effect", "effect", "effect", "effect"]);
		f.native.push({
			type: "user",
			id: "msg_order_B",
			text: "Queued B",
			time: { created: 11 },
		});
		expect(f.native.filter((item) => item.type === "idle")).toEqual([]);
		expect(f.context().messages.map((item) => item.id)).toEqual([
			"msg_order_O",
			"msg_order_A",
			"msg_order_B",
		]);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const bCall = ownershipNativeCall(f);
		const b = await f.lifecycle.verifyTool(bCall, "flow");
		if (b.kind !== "flow") throw new Error("Expected consumed B Flow access.");
		b.assertCurrent();
		expect(await tool.execute({}, bCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(() => a.assertCurrent()).toThrow();
		expect(() => o.assertCurrent()).toThrow();
		await expect(tool.execute({}, aCall)).rejects.toThrow();
		b.assertCurrent();
		expect(effects).toEqual(["effect", "effect", "effect", "effect", "effect"]);
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

function inboxEvent(
	type: "session.inbox.enqueued" | "session.inbox.cancelled",
	id: string,
	seq: number,
): Extract<
	OpenCodeEvent,
	{ type: "session.inbox.enqueued" | "session.inbox.cancelled" }
> {
	const base = {
		id: `evt_queue_${seq}`,
		created: seq,
		durable: { aggregateID: sessionID, seq, version: 1 as const },
	};
	return type === "session.inbox.enqueued"
		? {
				...base,
				type,
				data: {
					sessionID,
					inboxID: id,
					item: { type: "user", payload: { text: id }, delivery: "queue" },
				},
			}
		: { ...base, type, data: { sessionID, inboxID: id } };
}
async function queuePublic(f: OwnershipFixture, id: string, seq?: number) {
	await f.emit("prompt", {
		sessionID,
		messageID: SessionMessage.ID.make(id),
		prompt: { text: id },
		delivery: "queue",
	});
	if (seq !== undefined)
		await f.sendEventAndWait(inboxEvent("session.inbox.enqueued", id, seq));
}
function continuationProjection(f: OwnershipFixture) {
	const source = f.context().messages.at(-1)?.id;
	if (!source) throw new Error("Missing original input.");
	f.autoDrive.observeAssistant(sessionID, "msg_validation_boundary", source);
	const origin = f.autoDrive.validationOrigin(
		sessionID,
		"msg_validation_boundary",
		{
			featureId: "feature",
			runId: "run",
			sourceDigest: f.sourceDigest,
			command: "bun test",
			scope: "focused",
			hostPlatform: "linux",
			intent: "pass",
			assertions: [],
		},
	);
	if (!origin) throw new Error("Missing exact validation origin.");
	f.autoDrive.observeValidation({
		origin,
		captureId: "validation",
		observation: {
			id: "validation",
			featureId: "feature",
			runId: "run",
			sourceDigest: f.sourceDigest,
			outputDigest: f.sourceDigest,
			command: "bun test",
			scope: "focused",
			intent: "pass",
			hostPlatform: "linux",
			outputComplete: true,
			exitCode: 0,
			recordedRevision: 5,
		},
	});
	f.setProjection({
		sessionId: "flow-1",
		status: "running",
		revision: 5,
		nextAction: "flow_review_start",
	});
	return source;
}
for (const stage of ["projection", "digest", "selected"] as const)
	test(`confirmed pending queue during ${stage} withholds synthetic admission without consuming the continuation`, async () => {
		const f = await fixture();
		let release = () => {};
		try {
			await initialOwnershipWork(f);
			const guard = await f.lifecycle.verifyTool(
				ownershipNativeCall(f),
				"flow",
			);
			if (guard.kind !== "flow") throw new Error("Missing original guard.");
			const source = continuationProjection(f);
			let entered: Promise<void>;
			if (stage === "selected") {
				f.blockNextSessionRead();
				entered = f.waitSessionRead();
				release = f.releaseSessionRead;
			} else {
				const gate = f.blockPolicyRead(stage);
				entered = gate.entered;
				release = gate.release;
			}
			const idle = f.autoDrive.onIdle(sessionID);
			await entered;
			await queuePublic(f, "msg_queued_A", 100);
			release();
			await idle;
			expect(
				f.native.filter((message) => message.type === "synthetic"),
			).toEqual([]);
			expect(() => guard.assertCurrent()).not.toThrow();
			const authority = f.autoDrive.captureAuthority(sessionID);
			if (!authority)
				throw new Error("Withholding consumed the automatic lease.");
			expect(
				f.autoDrive.captureDispatch(sessionID, authority.token)?.source,
			).toBe(source);
			await f.sendEventAndWait(
				inboxEvent("session.inbox.cancelled", "msg_queued_A", 101),
			);
			await f.autoDrive.onIdle(sessionID);
			const synthetic = f.native.filter(
				(message) => message.type === "synthetic",
			);
			expect(synthetic).toHaveLength(1);
			expect(
				f.autoDrive.captureDispatch(sessionID, authority.token)?.source,
			).toBe(synthetic[0]?.id);
		} finally {
			release();
			f.releaseSessionRead();
			await f.lifecycle.dispose();
		}
	});
test("hook-only preparation still permits an authenticated automatic continuation", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		await queuePublic(f, "msg_failed_prepare");
		await f.autoDrive.onIdle(sessionID);
		const synthetic = f.native.filter(
			(message) => message.type === "synthetic",
		);
		expect(synthetic).toHaveLength(1);
		const authority = f.autoDrive.captureAuthority(sessionID);
		expect(
			authority &&
				f.autoDrive.captureDispatch(sessionID, authority.token)?.source,
		).toBe(synthetic[0]?.id);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("a real activation keeps its busy token after handoff and late cleanup cannot touch steer", async () => {
	const f = await fixture(),
		entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>();
	try {
		await initialOwnershipWork(f);
		const observe = f.autoDrive.observeMessage.bind(f.autoDrive);
		f.autoDrive.observeMessage = async (...args) => {
			const result = await observe(...args);
			if (args[3] === "msg_A") {
				entered.resolve();
				await release.promise;
			}
			return result;
		};
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 20 },
		});
		const pending = f.emit("context", f.context()).catch(String);
		await entered.promise;
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"callbacks overlap",
		);
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make("msg_steer"),
			prompt: { text: "msg_steer" },
			delivery: "steer",
		});
		f.native.push({
			type: "user",
			id: "msg_steer",
			text: "msg_steer",
			time: { created: 21 },
		});
		expect(await pending).toContain("epoch was revoked");
		const request = await startOwnedRequest(f);
		const guard = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		release.resolve();
		await f.flush();
		if (guard.kind !== "flow") throw new Error("Missing fresh steer guard.");
		expect(() => guard.assertCurrent()).not.toThrow();
		await finishOwnedResponse(f, request);
	} finally {
		release.resolve();
		await f.lifecycle.dispose();
	}
});
test("nested idle during first real settlement withholds promptly and finishes the new origin", async () => {
	const f = await fixture();
	try {
		f.setProjection({
			status: "idle",
			revision: 0,
			nextAction: "flow_plan_save",
		});
		const metadata = await f.autoDrive.activate(sessionID);
		await f.autoDrive.observeMessage(
			sessionID,
			delivery,
			[{ synthetic: true, metadata }],
			"msg_O",
		);
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 1 },
		});
		const request = await startOwnedRequest(f);
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
		expect(
			f.autoDrive.captureDispatch(
				sessionID,
				f.autoDrive.captureAuthority(sessionID)?.token ?? "",
			)?.source,
		).toBe("msg_A");
		const guard = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		expect(guard.kind).toBe("flow");
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("registered queue compacts before its first primary and resumes with Flow provenance", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		if (old.kind !== "flow") throw new Error("Missing predecessor.");
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 20 },
		});
		await compactCurrentInput(f, "queued_checkpoint");
		expect(() => old.assertCurrent()).toThrow();
		const request = await startOwnedRequest(f);
		expect(
			(await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow")).kind,
		).toBe("flow");
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});

function succeededIdle(f: OwnershipFixture, id = "evt_queue_terminal") {
	const time = 30;
	f.native.push({
		type: "idle",
		id: SessionMessage.ID.fromEvent(id),
		outcome: "succeeded",
		time: { created: time },
	});
	f.session.outcome = "succeeded";
	f.session.time.idle = time;
	const event: OpenCodeEvent = {
		id,
		type: "session.execution.succeeded",
		created: time,
		durable: { aggregateID: sessionID, seq: 30, version: 1 },
		data: { sessionID },
	};
	return event;
}
test("inbox cancellation is reduced during blocked terminal work and wakes one exact deferred ticket", async () => {
	const f = await fixture();
	let release = () => {};
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		await queuePublic(f, "msg_A", 100);
		const gate = f.blockNextDispatchReturn();
		release = gate.release;
		f.sendEvent(succeededIdle(f));
		await gate.entered;
		await f.sendEventAndWait(
			inboxEvent("session.inbox.cancelled", "msg_A", 101),
		);
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
		release();
		const source = await f.waitAutomaticSource();
		expect(
			f.native
				.filter((message) => message.type === "synthetic")
				.map((message) => message.id),
		).toEqual([source]);
		await f.sendEventAndWait(
			inboxEvent("session.inbox.cancelled", "msg_A", 101),
		);
		expect(
			f.native
				.filter((message) => message.type === "synthetic")
				.map((message) => message.id),
		).toEqual([source]);
	} finally {
		release();
		await f.lifecycle.dispose();
	}
});
for (const change of [
	"consumption",
	"primary",
	"selected",
	"idle-time",
	"prefix",
] as const)
	test(`deferred terminal retry refuses changed ${change} ownership`, async () => {
		const f = await fixture();
		let release = () => {};
		try {
			await initialOwnershipWork(f);
			continuationProjection(f);
			await queuePublic(f, "msg_A", 100);
			const resumed = Promise.withResolvers<void>(),
				terminalFinished = Promise.withResolvers<void>();
			const resume = f.autoDrive.resumeDeferred.bind(f.autoDrive),
				onIdle = f.autoDrive.onIdle.bind(f.autoDrive);
			const retry = spyOn(f.autoDrive, "resumeDeferred").mockImplementation(
				async (...args) => {
					try {
						await resume(...args);
					} finally {
						resumed.resolve();
					}
				},
			);
			const terminal = spyOn(f.autoDrive, "onIdle").mockImplementation(
				async (...args) => {
					try {
						await onIdle(...args);
					} finally {
						terminalFinished.resolve();
					}
				},
			);
			const gate = f.blockNextDispatchReturn();
			release = gate.release;
			f.sendEvent(succeededIdle(f));
			await gate.entered;
			if (change === "consumption") {
				f.native.push({
					type: "user",
					id: "msg_A",
					text: "msg_A",
					time: { created: 31 },
				});
				await f.emit("context", f.context());
			}
			if (change === "primary") await f.emit("context", f.context());
			if (change === "selected")
				f.session.model = { ...model, id: Model.ID.make("changed") };
			if (change === "idle-time") f.session.time.idle = 31;
			if (change === "prefix")
				f.native.push({
					type: "user",
					id: "unknown",
					text: "unknown",
					time: { created: 31 },
				});
			await f.sendEventAndWait(
				inboxEvent("session.inbox.cancelled", "msg_A", 101),
			);
			release();
			if (change === "consumption") await terminalFinished.promise;
			else await resumed.promise;
			retry.mockRestore();
			terminal.mockRestore();
			expect(
				f.native.filter((message) => message.type === "synthetic"),
			).toEqual([]);
		} finally {
			release();
			await f.lifecycle.dispose();
		}
	});
test("registered queue compaction rejects a final changed control before replacing O", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		if (old.kind !== "flow") throw new Error("Missing old guard.");
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 20 },
		});
		const input = f.context();
		f.native.push(automaticControl("queued_running"));
		const read = f.ctxSessionContext;
		let reads = 0;
		const observation = spyOn(f.ctxSession, "context").mockImplementation(
			async (...args) => {
				const native = await read(...args);
				if (++reads === 3) {
					const control = native.findLast(
						(message) => message.type === "compaction",
					);
					if (control?.type === "compaction") control.reason = "manual";
				}
				return native;
			},
		);
		try {
			await expect(f.emit("compaction", input)).rejects.toThrow(
				"control identity changed",
			);
			expect(reads).toBe(3);
			expect(() => old.assertCurrent()).not.toThrow();
		} finally {
			observation.mockRestore();
		}
	} finally {
		await f.lifecycle.dispose();
	}
});

test("dispose cancels a held terminal policy read and drains its tracked job", async () => {
	const f = await fixture();
	let release = () => {};
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		const gate = f.blockPolicyRead("projection");
		release = gate.release;
		f.sendEvent(succeededIdle(f));
		await gate.entered;
		await f.lifecycle.dispose();
		release();
		await f.flush();
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.registrations).toContain("context");
	} finally {
		release();
		await f.lifecycle.dispose();
	}
});
test("a corrupt synthetic receipt cannot activate a dispatch intent", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		const native = f.ctxSession.synthetic.bind(f.ctxSession);
		const corrupt = spyOn(f.ctxSession, "synthetic").mockImplementation(
			async (...args) => ({
				...(await native(...args)),
				id: "msg_wrong_receipt",
			}),
		);
		const observe = spyOn(f.autoDrive, "observeMessage");
		try {
			await f.autoDrive.onIdle(sessionID);
			expect(observe).not.toHaveBeenCalled();
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(
				f.native.filter((message) => message.type === "synthetic"),
			).toHaveLength(1);
		} finally {
			corrupt.mockRestore();
			observe.mockRestore();
		}
	} finally {
		await f.lifecycle.dispose();
	}
});

test("terminal synthetic selected read cannot reserve over a same-epoch primary replacement", async () => {
	const f = await fixture(),
		entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>(),
		finished = Promise.withResolvers<void>();
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		const before = f.autoDrive.captureAuthority(sessionID),
			get = f.ctxSession.get.bind(f.ctxSession),
			onIdle = f.autoDrive.onIdle.bind(f.autoDrive);
		let reads = 0;
		const selected = spyOn(f.ctxSession, "get").mockImplementation(
			async (...args) => {
				const snapshot = await get(...args);
				if (++reads === 2) {
					entered.resolve();
					await release.promise;
				}
				return snapshot;
			},
		);
		const idle = spyOn(f.autoDrive, "onIdle").mockImplementation(
			async (...args) => {
				try {
					await onIdle(...args);
				} finally {
					finished.resolve();
				}
			},
		);
		try {
			f.sendEvent(succeededIdle(f));
			await entered.promise;
			const request = await startOwnedRequest(f),
				access = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
			release.resolve();
			await finished.promise;
			expect(
				f.native.filter((message) => message.type === "synthetic"),
			).toEqual([]);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			if (access.kind !== "flow") throw new Error("Missing replacement guard.");
			expect(() => access.assertCurrent()).not.toThrow();
			await finishOwnedResponse(f, request);
		} finally {
			selected.mockRestore();
			idle.mockRestore();
		}
	} finally {
		release.resolve();
		await f.lifecycle.dispose();
	}
});

test("compaction rechecks its third control after the held selected-session read", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
		if (old.kind !== "flow") throw new Error("Missing predecessor guard.");
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 20 },
		});
		const input = f.context();
		const control: Extract<SessionMessageInfo, { type: "compaction" }> =
			automaticControl("queued_selected_control");
		f.native.push(control);
		f.blockNextSessionRead();
		const pending = f.emit("compaction", input).catch(String);
		await f.waitSessionRead();
		control.reason = "manual";
		f.releaseSessionRead();
		expect(await pending).toBe(
			"Error: Flow automatic compaction control identity changed.",
		);
		expect(() => old.assertCurrent()).not.toThrow();
	} finally {
		f.releaseSessionRead();
		await f.lifecycle.dispose();
	}
});

for (const read of ["native", "selected"] as const)
	test(`failed deferred queue ${read} read preserves the usable predecessor and permits exact retry`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
				authority = f.autoDrive.captureAuthority(sessionID);
			if (old.kind !== "flow") throw new Error("Missing old guard.");
			await queuePublic(f, "msg_A");
			f.native.push({
				type: "user",
				id: "msg_A",
				text: "msg_A",
				time: { created: 20 },
			});
			if (read === "native") f.rejectNextContextRead();
			else f.rejectNextSessionRead();
			await expect(f.emit("context", f.context())).rejects.toThrow(
				read === "native"
					? "Native context snapshot failed."
					: "Native session snapshot failed.",
			);
			expect(() => old.assertCurrent()).not.toThrow();
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			const request = await startOwnedRequest(f);
			expect(() => old.assertCurrent()).toThrow();
			expect(
				(await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow")).kind,
			).toBe("flow");
			await finishOwnedResponse(f, request);
		} finally {
			await f.lifecycle.dispose();
		}
	});
test("a reused compaction control ID rejects a new queued source before handoff", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		await compactCurrentInput(f, "msg_existing_control");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
			authority = f.autoDrive.captureAuthority(sessionID);
		if (old.kind !== "flow") throw new Error("Missing old compaction guard.");
		await queuePublic(f, "msg_A");
		f.native.push({
			type: "user",
			id: "msg_A",
			text: "msg_A",
			time: { created: 20 },
		});
		const input = f.context();
		f.native.push(automaticControl("msg_existing_control"));
		await expect(f.emit("compaction", input)).rejects.toThrow(
			"control identity changed",
		);
		expect(() => old.assertCurrent()).not.toThrow();
		expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("stream loss cancels a held terminal read before disposal drains its job", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		f.blockNextContextRead();
		f.sendEvent(succeededIdle(f));
		await f.waitContextRead();
		f.loseStream();
		await f.flush();
		await f.lifecycle.dispose();
		f.releaseContextRead();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(
			f.logs.filter(
				(message) => message === "Flow event stream failed closed.",
			),
		).toHaveLength(1);
		expect(f.native.filter((message) => message.type === "synthetic")).toEqual(
			[],
		);
	} finally {
		f.releaseContextRead();
		await f.lifecycle.dispose();
	}
});

for (const rejectRead of [false, true])
	test(`review cancellation retry policy ${rejectRead ? "rejection" : "success"} preserves same-epoch replacement`, async () => {
		const f = await fixture();
		const terminalFinished = Promise.withResolvers<void>();
		const retryFinished = Promise.withResolvers<void>();
		let release = () => {};
		try {
			await initialOwnershipWork(f);
			continuationProjection(f);
			await queuePublic(f, "msg_A", 100);
			const before = f.autoDrive.captureAuthority(sessionID);
			const onIdle = f.autoDrive.onIdle.bind(f.autoDrive);
			let idles = 0;
			const idleSpy = spyOn(f.autoDrive, "onIdle").mockImplementation(
				async (...args) => {
					const sequence = ++idles;
					try {
						await onIdle(...args);
					} finally {
						(sequence === 1 ? terminalFinished : retryFinished).resolve();
					}
				},
			);
			f.sendEvent(succeededIdle(f));
			await terminalFinished.promise;
			const gate = f.blockPolicyRead("projection");
			release = gate.release;
			await f.sendEventAndWait(
				inboxEvent("session.inbox.cancelled", "msg_A", 101),
			);
			await gate.entered;
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const fresh = await f.lifecycle.verifyTool(
				ownershipNativeCall(f),
				"flow",
			);
			expect(fresh.kind).toBe("flow");
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			if (rejectRead)
				gate.reject(new Error("obsolete retry projection read failed"));
			else gate.release();
			await retryFinished.promise;
			idleSpy.mockRestore();
			let guardError: string | null = null;
			try {
				if (fresh.kind === "flow") fresh.assertCurrent();
			} catch (error) {
				guardError = String(error);
			}
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(before);
			expect(guardError).toBeNull();
		} finally {
			release();
			await f.lifecycle.dispose();
		}
	});
test("review current terminal policy rejection still deactivates its owned lease", async () => {
	const f = await fixture();
	const finished = Promise.withResolvers<void>();
	let release = () => {};
	try {
		await initialOwnershipWork(f);
		continuationProjection(f);
		const gate = f.blockPolicyRead("projection");
		release = gate.release;
		const onIdle = f.autoDrive.onIdle.bind(f.autoDrive);
		const idleSpy = spyOn(f.autoDrive, "onIdle").mockImplementation(
			async (...args) => {
				try {
					await onIdle(...args);
				} finally {
					finished.resolve();
				}
			},
		);
		f.sendEvent(succeededIdle(f));
		await gate.entered;
		gate.reject(new Error("current projection read failed"));
		await finished.promise;
		idleSpy.mockRestore();
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		expect(f.autoDrive.continuationSnapshot(sessionID)).toMatchObject({
			state: "inactive",
			reason: "status-error",
		});
	} finally {
		release();
		await f.lifecycle.dispose();
	}
});

for (const prior of ["ordinary", "automatic"] as const)
	test(`independent review valid queued user extends completed compaction alias before checkpoint primary ${prior}`, async () => {
		const f = await fixture();
		try {
			if (prior === "automatic") await initialOwnershipWork(f);
			else {
				await admitOrdinaryInput(f, "msg_review_O", "Ordinary predecessor");
				await finishOwnedResponse(f, await startOwnedRequest(f));
			}
			await compactCurrentInput(f, "msg_review_checkpoint");
			await queuePublic(f, "msg_review_after_compaction");
			f.native.push({
				type: "user",
				id: "msg_review_after_compaction",
				text: "msg_review_after_compaction",
				time: { created: 22 },
			});
			const request = await startOwnedRequest(f);
			const effects: string[] = [];
			const tool = await effectTool(f, effects);
			await tool.execute({}, ownershipNativeCall(f));
			expect(effects).toEqual(["effect"]);
			await finishOwnedResponse(f, request);
		} finally {
			await f.lifecycle.dispose();
		}
	});
test("independent review manual compaction alias followed by queued user retains ordinary Flow access", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_review_O", "Ordinary predecessor");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await compactCurrentInput(f, "msg_review_manual_checkpoint", "manual");
		await queuePublic(f, "msg_review_after_manual");
		f.native.push({
			type: "user",
			id: "msg_review_after_manual",
			text: "msg_review_after_manual",
			time: { created: 22 },
		});
		const request = await startOwnedRequest(f);
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		await tool.execute({}, ownershipNativeCall(f));
		expect(effects).toEqual(["effect"]);
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});
test("independent review observed native manual compaction inbox does not collide with its checkpoint identity", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_review_O", "Ordinary predecessor");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.sendEventAndWait({
			id: "evt_review_compaction_enqueued",
			created: 40,
			durable: { aggregateID: sessionID, seq: 40, version: 1 },
			type: "session.inbox.enqueued",
			data: {
				sessionID,
				inboxID: "msg_review_manual_control",
				item: { type: "compaction", payload: {}, delivery: "queue" },
			},
		});
		await f.sendEventAndWait({
			id: "evt_review_compaction_delivered",
			created: 41,
			durable: { aggregateID: sessionID, seq: 41, version: 1 },
			type: "session.inbox.delivered",
			data: { sessionID, inboxID: "msg_review_manual_control" },
		});
		await compactCurrentInput(f, "msg_review_manual_control", "manual");
		const request = await startOwnedRequest(f);
		const effects: string[] = [];
		const tool = await effectTool(f, effects);
		await tool.execute({}, ownershipNativeCall(f));
		expect(effects).toEqual(["effect"]);
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("a delivered-only compaction observation does not require an enqueue rendezvous", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_observed_O", "Ordinary predecessor");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await f.sendEventAndWait({
			id: "evt_compaction_delivered_only",
			created: 41,
			durable: { aggregateID: sessionID, seq: 41, version: 1 },
			type: "session.inbox.delivered",
			data: { sessionID, inboxID: "msg_delivered_control" },
		});
		await compactCurrentInput(f, "msg_delivered_control", "manual");
		const request = await startOwnedRequest(f),
			effects: string[] = [],
			tool = await effectTool(f, effects);
		await tool.execute({}, ownershipNativeCall(f));
		expect(effects).toEqual(["effect"]);
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});
for (const control of ["unknown", "summary-only", "wrong-reason"] as const)
	test(`fresh queued input cannot use an unproved ${control} checkpoint prefix bridge`, async () => {
		const f = await fixture();
		try {
			await admitOrdinaryInput(f, "msg_bridge_O", "Ordinary predecessor");
			await finishOwnedResponse(f, await startOwnedRequest(f));
			const old = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
			if (old.kind !== "flow") throw new Error("Missing predecessor.");
			if (control === "unknown")
				f.native.splice(0, f.native.length, {
					...automaticControl("msg_unproved_C"),
					status: "completed",
				});
			else {
				if (control === "summary-only")
					f.native.push({
						type: "user",
						id: "msg_unregistered_U",
						text: "Unknown history",
						time: { created: 15 },
					});
				await compactCurrentInput(
					f,
					"msg_unproved_C",
					control === "summary-only" ? "manual" : "auto",
				);
				if (control === "wrong-reason") {
					const completed = f.native[0];
					if (completed?.type !== "compaction")
						throw new Error("Missing completed control.");
					completed.reason = "manual";
				}
			}
			await queuePublic(f, "msg_new_A");
			f.native.push({
				type: "user",
				id: "msg_new_A",
				text: "msg_new_A",
				time: { created: 30 },
			});
			await expect(f.emit("context", f.context())).rejects.toThrow(
				control === "unknown"
					? "epoch was revoked"
					: control === "wrong-reason"
						? "control identity changed"
						: "does not extend",
			);
			expect(() => old.assertCurrent()).not.toThrow();
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("a fresh queued source after a checked checkpoint proves its own selected model", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_model_O", "Ordinary predecessor");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await compactCurrentInput(f, "msg_model_C");
		await queuePublic(f, "msg_model_A");
		f.native.push({
			type: "user",
			id: "msg_model_A",
			text: "msg_model_A",
			time: { created: 30 },
		});
		const chosen = {
			...model,
			id: Model.ID.make("new-selected-model"),
			variant: Model.VariantID.make("new-variant"),
		};
		f.session.model = chosen;
		await f.emit("context", { ...f.context(), model: chosen });
		const request = new Request("http://localhost/checked-new-model");
		await f.emit("http.request", {
			sessionID,
			agent,
			model: chosen,
			kind: "primary",
			request,
		});
		const call = ownershipNativeCall(f);
		const assistant = f.native.find((message) => message.id === call.messageID);
		if (assistant?.type !== "assistant")
			throw new Error("Missing selected-model assistant.");
		assistant.model = chosen;
		const effects: string[] = [],
			tool = await effectTool(f, effects);
		await tool.execute({}, call);
		expect(effects).toEqual(["effect"]);
		expect(f.codingModels.get(sessionID)).toMatchObject({
			modelID: "new-selected-model",
			variant: "new-variant",
		});
		const response = {
			sessionID,
			agent,
			model: chosen,
			kind: "primary" as const,
			request,
			response: new Response("selected model completed"),
		};
		await f.emit("http.response", response);
		expect(await response.response.text()).toBe("selected model completed");
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const interveningPrimary of [false, true])
	test(`queued input follows consecutive owned checkpoints, intermediate primary ${interveningPrimary}`, async () => {
		const f = await fixture();
		try {
			await admitOrdinaryInput(f, "msg_chain_O", "Ordinary predecessor");
			await finishOwnedResponse(f, await startOwnedRequest(f));
			await compactCurrentInput(f, "msg_chain_C1");
			if (interveningPrimary)
				await finishOwnedResponse(f, await startOwnedRequest(f));
			await compactCurrentInput(f, "msg_chain_C2");
			await queuePublic(f, "msg_chain_A");
			f.native.push({
				type: "user",
				id: "msg_chain_A",
				text: "msg_chain_A",
				time: { created: 40 },
			});
			const request = await startOwnedRequest(f),
				effects: string[] = [],
				tool = await effectTool(f, effects);
			await tool.execute({}, ownershipNativeCall(f));
			expect(effects).toEqual(["effect"]);
			await finishOwnedResponse(f, request);
		} finally {
			await f.lifecycle.dispose();
		}
	});

type FailedReservationCase =
	| "selected-read"
	| "parent"
	| "specialist"
	| "missing-agent"
	| "missing-model"
	| "native-rpc-before-history"
	| "native-rpc-after-history"
	| "receipt"
	| "activation"
	| "review-child";
async function triageRejectedCommand(
	f: OwnershipFixture,
	failure: FailedReservationCase,
) {
	let restore = () => {};
	let failedID: string | undefined;
	const before = f.native.filter((item) => item.type === "user").length;
	let command = "flow-status";
	let expected = "";
	if (failure === "selected-read") {
		f.failNextSessionRead();
		expected = "Native session read failed.";
	} else if (failure === "parent") {
		f.session.parentID = Session.ID.make("session-parent");
		restore = () => {
			delete f.session.parentID;
		};
		expected = "Flow commands require the native primary manager.";
	} else if (failure === "specialist") {
		f.session.agent = Agent.ID.make("flow-worker");
		restore = () => {
			f.session.agent = agent;
		};
		expected = "Flow commands require the native primary manager.";
	} else if (failure === "missing-agent") {
		delete f.session.agent;
		restore = () => {
			f.session.agent = agent;
		};
		expected = "Flow commands require the native primary manager.";
	} else if (failure === "missing-model") {
		delete f.session.model;
		restore = () => {
			f.session.model = model;
		};
		expected = "Flow requires the native selected agent and model.";
	} else if (failure === "native-rpc-before-history") {
		const prompt = spyOn(f.ctxSession, "prompt").mockImplementationOnce(
			async (input) => {
				failedID = input.id ?? undefined;
				throw new Error("Native prompt rejected before materialization.");
			},
		);
		restore = () => prompt.mockRestore();
		expected = "Native prompt rejected before materialization.";
	} else if (failure === "native-rpc-after-history") {
		const original = f.ctxSession.prompt;
		const prompt = spyOn(f.ctxSession, "prompt").mockImplementationOnce(
			async (...args) => {
				failedID = args[0].id ?? undefined;
				await original(...args);
				throw new Error("Native prompt rejected after unknown acceptance.");
			},
		);
		restore = () => prompt.mockRestore();
		expected = "Native prompt rejected after unknown acceptance.";
	} else if (failure === "receipt") {
		f.corruptReceipt();
		expected = "Flow admission receipt did not match its exact local payload.";
	} else if (failure === "activation") {
		const observe = spyOn(f.autoDrive, "observeMessage").mockRejectedValueOnce(
			new Error("Accepted activation failed."),
		);
		restore = () => observe.mockRestore();
		expected = "Accepted activation failed.";
	} else {
		command = "flow-review";
		const create = spyOn(f.ctxSession, "create").mockRejectedValueOnce(
			new Error("Reviewer child creation failed."),
		);
		restore = () => create.mockRestore();
		expected = "Reviewer child creation failed.";
	}
	try {
		const outcome = await f
			.command(command, "Inspect failed reservation")
			.then(() => "accepted", String);
		expect(outcome).toBe(`Error: ${expected}`);
		console.log(`TRIAGE ${failure} command=${outcome}`);
	} finally {
		restore();
	}
	const materialized =
		f.native.filter((item) => item.type === "user").length - before;
	expect(materialized).toBe(
		[
			"native-rpc-after-history",
			"receipt",
			"activation",
			"review-child",
		].includes(failure)
			? 1
			: 0,
	);
	console.log(`TRIAGE ${failure} materialized=${materialized}`);
	return { failedID };
}
async function triageOrdinaryPredecessor(f: OwnershipFixture) {
	await admitOrdinaryInput(f, "msg_triage_old", "Original ordinary request");
	await finishOwnedResponse(f, await startOwnedRequest(f));
	const oldCall = ownershipNativeCall(f);
	const old = await f.lifecycle.verifyTool(oldCall, "flow");
	if (old.kind !== "flow") throw new Error("Missing ordinary predecessor.");
	return { oldCall, old };
}
async function triageFreshPublic(f: OwnershipFixture, mode: "queue" | "steer") {
	const id = "msg_triage_fresh",
		text = "Fresh ordinary request after rejection";
	await f.emit("prompt", {
		sessionID,
		messageID: SessionMessage.ID.make(id),
		prompt: { text },
		delivery: mode,
	});
	f.native.push({ type: "user", id, text, time: { created: 20 } });
	const context = f.context();
	const outcome = await f
		.emit("context", context)
		.then(() => "context accepted", String);
	console.log(`TRIAGE ${mode} ${outcome}`);
	expect(outcome).toBe("context accepted");
	expect(context.messages.at(-1)).toEqual({
		role: "user",
		id,
		content: [{ type: "text", text }],
	});
	const request = new Request("http://localhost/triage-fresh", {
		method: "POST",
		body: text,
	});
	const outbound = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
	};
	await f.emit("http.request", outbound);
	expect(await outbound.request.clone().text()).toBe(
		"Fresh ordinary request after rejection",
	);
	await finishOwnedResponse(f, request);
	const effects: string[] = [];
	const tool = await effectTool(f, effects);
	const freshCall = ownershipNativeCall(f);
	expect(await tool.execute({}, freshCall)).toEqual({
		content: [{ type: "text", text: "applied" }],
	});
	expect(effects).toEqual(["effect"]);
	console.log(
		`TRIAGE ${mode} fresh-model-body=Fresh ordinary request after rejection fresh-tool=applied`,
	);
	return { freshCall, tool, effects };
}
for (const failure of [
	"selected-read",
	"parent",
	"specialist",
	"missing-agent",
	"missing-model",
	"native-rpc-before-history",
	"native-rpc-after-history",
	"receipt",
	"activation",
	"review-child",
] as const)
	for (const mode of ["queue", "steer"] as const)
		test(`reservation triage ${failure} then public ${mode} executes fresh exact tools`, async () => {
			const f = await fixture();
			try {
				const predecessor = await triageOrdinaryPredecessor(f);
				await triageRejectedCommand(f, failure);
				expect(() => predecessor.old.assertCurrent()).toThrow();
				const fresh = await triageFreshPublic(f, mode);
				await expect(
					fresh.tool.execute({}, predecessor.oldCall),
				).rejects.toThrow();
				expect(fresh.effects).toEqual(["effect"]);
				expect(await fresh.tool.execute({}, fresh.freshCall)).toEqual({
					content: [{ type: "text", text: "applied" }],
				});
				expect(fresh.effects).toEqual(["effect", "effect"]);
			} finally {
				await f.lifecycle.dispose();
			}
		});

test("reservation triage static parse failure keeps predecessor usable and permits queue", async () => {
	const f = await fixture();
	try {
		const predecessor = await triageOrdinaryPredecessor(f);
		await expect(f.command("flow-auto", "--recovery=shadow")).rejects.toThrow(
			"Recovery requires",
		);
		predecessor.old.assertCurrent();
		const effects: string[] = [],
			tool = await effectTool(f, effects);
		expect(await tool.execute({}, predecessor.oldCall)).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect"]);
		console.log("TRIAGE static-parse predecessor-tool=applied");
		await triageFreshPublic(f, "queue");
	} finally {
		await f.lifecycle.dispose();
	}
});

test("reservation triage pending command read blocks old context and tools immediately", async () => {
	const f = await fixture();
	let pending: Promise<string | null> | undefined;
	try {
		const predecessor = await triageOrdinaryPredecessor(f);
		const oldContext = f.context();
		f.blockNextSessionRead();
		f.rejectNextSessionRead();
		pending = f.command("flow-status", "Held command").then(() => null, String);
		await f.waitSessionRead();
		await expect(f.emit("context", oldContext)).rejects.toThrow(
			"epoch was revoked",
		);
		expect(() => predecessor.old.assertCurrent()).toThrow();
		await expect(
			f.lifecycle.verifyTool(predecessor.oldCall, "flow"),
		).rejects.toThrow();
		console.log("TRIAGE pending-read old-context=denied old-tool=denied");
		f.releaseSessionRead();
		expect(await pending).toBe("Error: Native session snapshot failed.");
	} finally {
		f.releaseSessionRead();
		await pending;
		await f.lifecycle.dispose();
	}
});

test("reservation triage exact rejected private ID cannot replay as Flow or native-only", async () => {
	const f = await fixture();
	try {
		const { failedID } = await triageRejectedCommand(
			f,
			"native-rpc-before-history",
		);
		if (!failedID) throw new Error("Missing rejected ID.");
		await f.emit("prompt", {
			sessionID,
			messageID: SessionMessage.ID.make(failedID),
			prompt: { text: "Replay private rejection" },
			delivery: "queue",
		});
		f.native.push({
			type: "user",
			id: failedID,
			text: "Replay private rejection",
			time: { created: 20 },
		});
		await expect(f.emit("context", f.context())).rejects.toThrow();
		await expect(
			f.emit("http.request", {
				sessionID,
				agent,
				model,
				kind: "primary",
				request: new Request("http://localhost/rejected-replay"),
			}),
		).rejects.toThrow();
		await expect(
			f.lifecycle.verifyTool(ownershipNativeCall(f), "flow"),
		).rejects.toThrow();
		console.log(
			"TRIAGE exact-rejected-id context=denied model-request=denied Flow-tool=denied",
		);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const replacement of [
	"same-epoch-synthetic",
	"new-epoch-command",
] as const)
	test(`reservation triage late old RPC reject preserves ${replacement} frontier and readiness`, async () => {
		const f = await fixture();
		let old: Promise<string | null> | undefined;
		const entered = Promise.withResolvers<void>(),
			gate = Promise.withResolvers<void>();
		const original = f.ctxSession.synthetic;
		let calls = 0;
		const mock = spyOn(f.ctxSession, "synthetic").mockImplementation(
			async (...args) => {
				calls++;
				if (calls === 1) {
					entered.resolve();
					await gate.promise;
					throw new Error("Old synthetic rejected before history.");
				}
				return original(...args);
			},
		);
		try {
			await initialOwnershipWork(f);
			old = f.lifecycle
				.prompt(sessionID, "Old synthetic dispatch", delivery, {
					[FLOW_AUTO_METADATA_KEY]: "local-token",
				})
				.then(() => null, String);
			await entered.promise;
			f.blockAdmission();
			const fresh =
				replacement === "same-epoch-synthetic"
					? f.lifecycle.prompt(
							sessionID,
							"Fresh synthetic dispatch",
							delivery,
							{ [FLOW_AUTO_METADATA_KEY]: "local-token" },
						)
					: f.command("flow-auto", "Fresh command dispatch");
			await f.flush();
			const authority = f.autoDrive.captureAuthority(sessionID);
			const context = f
				.emit("context", f.context())
				.then(() => "context accepted", String);
			let settled = false;
			void context.then(() => {
				settled = true;
			});
			await f.flush();
			expect(settled).toBe(false);
			gate.resolve();
			expect(await old).toBe("Error: Old synthetic rejected before history.");
			await f.flush();
			expect(settled).toBe(false);
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			f.releaseAdmission();
			await fresh;
			expect(await context).toBe("context accepted");
			const request = new Request("http://localhost/late-reject-fresh");
			await f.emit("http.request", {
				sessionID,
				agent,
				model,
				kind: "primary",
				request,
			});
			await finishOwnedResponse(f, request);
			const effects: string[] = [],
				tool = await effectTool(f, effects);
			expect(await tool.execute({}, ownershipNativeCall(f))).toEqual({
				content: [{ type: "text", text: "applied" }],
			});
			expect(effects).toEqual(["effect"]);
			console.log(
				`TRIAGE late-old-reject ${replacement} ready=preserved fresh-tool=applied`,
			);
		} finally {
			gate.resolve();
			f.releaseAdmission();
			await old;
			mock.mockRestore();
			await f.lifecycle.dispose();
		}
	});

test("reservation triage failed synthetic before history also permits fresh public queue", async () => {
	const f = await fixture();
	const original = f.ctxSession.synthetic;
	try {
		await initialOwnershipWork(f);
		f.ctxSession.synthetic = async () => {
			throw new Error("Synthetic rejected before materialization.");
		};
		await expect(
			f.lifecycle.prompt(sessionID, "Failed synthetic", delivery, {
				[FLOW_AUTO_METADATA_KEY]: "local-token",
			}),
		).rejects.toThrow("Synthetic rejected before materialization.");
		f.ctxSession.synthetic = original;
		await triageFreshPublic(f, "queue");
	} finally {
		f.ctxSession.synthetic = original;
		await f.lifecycle.dispose();
	}
});

for (const reason of ["auto", "manual"] as const)
	test(`reservation triage known automatic history plus failed private ID still refuses unowned ${reason} summary`, async () => {
		const f = await fixture();
		try {
			await initialOwnershipWork(f);
			await triageRejectedCommand(f, "native-rpc-before-history");
			f.native.push({
				type: "user",
				id: "msg_unregistered_suffix",
				text: "External history is not an authority reset",
				time: { created: 20 },
			});
			const input = f.context();
			f.native.push({
				...automaticControl("msg_triage_negative_control"),
				reason,
			});
			await expect(f.emit("compaction", input)).rejects.toThrow();
			expect(f.repository.saveCount).toBe(0);
			console.log(`TRIAGE known-automatic ${reason}-summary=denied`);
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const changed of ["text", "metadata"] as const)
	test(`reservation triage a rejected materialized private prefix retains its ${changed} guard`, async () => {
		const f = await fixture();
		try {
			await triageOrdinaryPredecessor(f);
			await triageRejectedCommand(f, "native-rpc-after-history");
			const failed = f.native.findLast((item) => item.type === "user");
			if (failed?.type !== "user")
				throw new Error("Missing materialized private prefix.");
			if (changed === "text") failed.text = "Changed rejected dispatch";
			else failed.metadata = { forged: true };
			await admitOrdinaryInput(
				f,
				"msg_payload_guard_fresh",
				"Fresh cannot launder changed history",
			);
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"payload conflicts",
			);
			expect(f.repository.saveCount).toBe(0);
			console.log(`TRIAGE rejected-prefix changed-${changed}=denied`);
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("reservation triage public queue after rejection still refuses forged automatic metadata", async () => {
	const f = await fixture();
	try {
		await triageRejectedCommand(f, "selected-read");
		await expect(
			f.emit("prompt", {
				sessionID,
				messageID: SessionMessage.ID.make("msg_forged_fresh"),
				prompt: { text: "Forged fresh" },
				delivery: "queue",
				metadata: { [FLOW_AUTO_METADATA_KEY]: "forged-token" },
			}),
		).rejects.toThrow("private admitted dispatch");
		expect(f.repository.saveCount).toBe(0);
		console.log("TRIAGE forged-public-auto-metadata=denied");
	} finally {
		await f.lifecycle.dispose();
	}
});

test("reservation triage failed private RPC cannot veto a fresh native-only user in the same ledger", async () => {
	const f = await fixture();
	try {
		await triageRejectedCommand(f, "native-rpc-before-history");
		f.native.push({
			type: "user",
			id: "msg_triage_native_only",
			text: "Fresh native-only input",
			time: { created: 30 },
		});
		await exerciseUnregisteredNativeExecution(f, [
			{
				role: "user",
				id: "msg_triage_native_only",
				content: [{ type: "text", text: "Fresh native-only input" }],
			},
		]);
		console.log(
			"TRIAGE fresh-native-only ordinary-tool=allowed Flow-tool=denied",
		);
	} finally {
		await f.lifecycle.dispose();
	}
});

for (const mode of ["queue", "steer"] as const)
	test(`candidate B claimed real activation failure then fresh ${mode}`, async () => {
		const f = await fixture();
		let reject: ReturnType<typeof spyOn> | undefined;
		try {
			const prior = await triageOrdinaryPredecessor(f);
			await admitOrdinaryInput(
				f,
				"msg_b_real_failed",
				"Consumed real activation fails",
			);
			reject = spyOn(f.autoDrive, "observeMessage").mockRejectedValueOnce(
				new Error("Real activation failed after claim."),
			);
			const failed = await f
				.emit("context", f.context())
				.then(() => "unexpected accepted", String);
			expect(failed).toBe("Error: Real activation failed after claim.");
			expect(reject.mock.calls[0]?.[3]).toBe("msg_b_real_failed");
			expect(
				f.native.filter((m) => m.type === "user").map((m) => m.id),
			).toEqual(["msg_triage_old", "msg_b_real_failed"]);
			expect(() => prior.old.assertCurrent()).toThrow();
			reject.mockRestore();
			console.log(
				`CANDIDATE_B claimed-real native-ID-present=true local-activation=failed old-clock=revoked next=${mode}`,
			);
			const fresh = await triageFreshPublic(f, mode);
			await expect(fresh.tool.execute({}, prior.oldCall)).rejects.toThrow();
			expect(fresh.effects).toEqual(["effect"]);
		} finally {
			reject?.mockRestore();
			await f.lifecycle.dispose();
		}
	});

for (const changed of ["none", "text", "metadata", "last"] as const)
	test(`candidate B materialized rejected private prefix ${changed}`, async () => {
		const f = await fixture();
		const original = f.ctxSession.prompt;
		let failedID: string | undefined;
		const prompt = spyOn(f.ctxSession, "prompt").mockImplementationOnce(
			async (...args) => {
				failedID = args[0].id ?? undefined;
				await original(...args);
				throw new Error("Locally rejected after native materialization.");
			},
		);
		try {
			await expect(
				f.command("flow-status", "Rejected exact payload"),
			).rejects.toThrow("Locally rejected after native materialization.");
			prompt.mockRestore();
			const failed = f.native.find((m) => m.id === failedID);
			if (failed?.type !== "user")
				throw new Error("Expected real fixture materialization.");
			expect(failed.text).toContain("Rejected exact payload");
			if (changed === "text") failed.text = "Tampered private text";
			if (changed === "metadata") failed.metadata = { changed: true };
			console.log(
				`CANDIDATE_B materialized-private id=${failedID} state=locally-rejected variant=${changed}`,
			);
			if (changed === "none") await triageFreshPublic(f, "queue");
			else {
				if (changed !== "last")
					await admitOrdinaryInput(f, "msg_b_guard_fresh", "Fresh exact queue");
				await expect(f.emit("context", f.context())).rejects.toThrow(
					changed === "last"
						? "unknown, synthetic, or stale"
						: "payload conflicts",
				);
				await expect(
					f.emit("http.request", {
						sessionID,
						agent,
						model,
						kind: "primary",
						request: new Request("http://localhost/b-no-request"),
					}),
				).rejects.toThrow();
				expect(f.repository.saveCount).toBe(0);
			}
		} finally {
			prompt.mockRestore();
			await f.lifecycle.dispose();
		}
	});

for (const type of ["user", "synthetic"] as const)
	test(`candidate B fresh unregistered ${type} after failed private keeps compaction negative`, async () => {
		const f = await fixture();
		try {
			await triageRejectedCommand(f, "native-rpc-before-history");
			const id = "msg_b_native_fresh",
				text = "Different exact native-only source";
			f.native.push({ type, id, text, time: { created: 30 } });
			const compaction = f.context();
			const control = {
				...automaticControl("msg_b_native_manual"),
				reason: "manual" as const,
			};
			f.native.push(control);
			await expect(f.emit("compaction", compaction)).rejects.toThrow();
			f.native.splice(f.native.indexOf(control), 1);
			console.log(`CANDIDATE_B native-only type=${type} unowned-manual=denied`);
			await exerciseUnregisteredNativeExecution(f, [
				{ role: "user", id, content: [{ type: "text", text }] },
			]);
			console.log(
				`CANDIDATE_B native-only type=${type} ordinary=allowed Flow=denied`,
			);
		} finally {
			await f.lifecycle.dispose();
		}
	});

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTools as candidateRealTools } from "../src/platform/opencode/tools.js";

async function candidateStatusTool(
	f: OwnershipFixture,
	workspace: typeof directory,
) {
	const registered = new Map<string, NativeToolDefinition>();
	const validation = new ValidationCaptureCoordinator({
		readSession: async () => f.session,
		persistObservation: async () => {
			throw new Error("Status must not persist validation.");
		},
	});
	const status = candidateRealTools({
		validation,
		prepareValidation: async () => {
			throw new Error("Status must not prepare validation.");
		},
	}).flow_status;
	if (!status) throw new Error("Missing real status definition.");
	await registerFlowTools(
		{
			location: { directory: workspace },
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
		{ flow_status: status },
		async (context) => {
			await f.lifecycle.verifyTool(context, "flow");
		},
	);
	const tool = registered.get("flow_status");
	if (!tool) throw new Error("Missing real registered status wrapper.");
	return tool;
}
for (const mode of ["queue", "steer"] as const)
	test(`candidate B failed parent command then ${mode} executes actual tracked application flow_status`, async () => {
		const f = await fixture();
		const workspace = AbsolutePath.make(
			realpathSync(mkdtempSync(join(tmpdir(), "flow-reservation-status-"))),
		);
		try {
			const old = await triageOrdinaryPredecessor(f);
			await triageRejectedCommand(f, "parent");
			const fresh = await triageFreshPublic(f, mode);
			const tool = await candidateStatusTool(f, workspace);
			const result = await tool.execute(
				{ request: { view: "compact" } },
				fresh.freshCall,
			);
			const content = result.content;
			const part =
				typeof content === "string"
					? undefined
					: content?.find((part) => part.type === "text");
			const text =
				typeof content === "string"
					? content
					: part?.type === "text"
						? part.text
						: undefined;
			if (text === undefined) throw new Error("Missing real Flow status text.");
			const response = JSON.parse(text);
			expect(response.status).toBe("ok");
			expect(response.summary).toBe("No active Flow session.");
			await expect(
				tool.execute({ request: { view: "compact" } }, old.oldCall),
			).rejects.toThrow();
			expect(f.repository.saveCount).toBe(0);
			console.log(
				`CANDIDATE_B actual-flow-status mode=${mode} status=ok summary=No active Flow session. old-call=denied`,
			);
		} finally {
			await f.lifecycle
				.dispose()
				.finally(() => rmSync(workspace, { recursive: true, force: true }));
		}
	});

for (const type of ["user", "synthetic"] as const)
	test(`candidate B materialized rejected prefix then fresh native-only ${type}`, async () => {
		const f = await fixture();
		try {
			const { failedID } = await triageRejectedCommand(
				f,
				"native-rpc-after-history",
			);
			const failed = f.native.find((m) => m.id === failedID);
			if (failed?.type !== "user")
				throw new Error("Expected materialized failed prefix.");
			const id = "msg_b_materialized_native",
				text = "Different native-only source after materialized rejection";
			f.native.push({ type, id, text, time: { created: 30 } });
			const compaction = f.context();
			const control = {
				...automaticControl("msg_b_materialized_manual"),
				reason: "manual" as const,
			};
			f.native.push(control);
			await expect(f.emit("compaction", compaction)).rejects.toThrow();
			f.native.splice(f.native.indexOf(control), 1);
			console.log(
				`CANDIDATE_B materialized native-only type=${type} manual-summary=denied`,
			);
			await exerciseUnregisteredNativeExecution(f, [
				{
					role: "user",
					id: failed.id,
					content: [{ type: "text", text: failed.text }],
				},
				{ role: "user", id, content: [{ type: "text", text }] },
			]);
		} finally {
			await f.lifecycle.dispose();
		}
	});

test("parent checked ordinary boundary resets unowned summary lineage without executing its summary", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		await triageRejectedCommand(f, "native-rpc-before-history");
		await triageFreshPublic(f, "steer");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		f.failNextSessionRead();
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"Native session read failed.",
		);
		f.native.push({
			type: "user",
			id: "msg_parent_unregistered",
			text: "Unregistered ordinary suffix",
			time: { created: 40 },
		});
		const input = f.context();
		const control = {
			...automaticControl("msg_parent_summary"),
			reason: "manual" as const,
		};
		f.native.push(control);
		await f.emit("compaction", input);
		expect(f.repository.saveCount).toBe(0);
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"unknown, synthetic, or stale",
		);
		console.log(
			"PARENT scoped-history manual-summary=accepted summary-execution=refused",
		);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("parent consecutive public queues after a checked checkpoint need no stale bridge", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		await compactCurrentInput(f, "msg_parent_checked_checkpoint");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await admitOrdinaryInput(
			f,
			"msg_parent_queue_one",
			"First ordinary after checkpoint",
		);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await admitOrdinaryInput(
			f,
			"msg_parent_queue_two",
			"Second ordinary after checkpoint",
		);
		const result = await f
			.emit("context", f.context())
			.then(() => "accepted", String);
		console.log(`PARENT consecutive-after-checkpoint=${result}`);
		expect(result).toBe("accepted");
	} finally {
		await f.lifecycle.dispose();
	}
});

async function refuseUnownedSummaries(f: OwnershipFixture, id: string) {
	for (const reason of ["manual", "auto"] as const) {
		const input = f.context(),
			control = { ...automaticControl(`${id}_${reason}`), reason };
		f.native.push(control);
		try {
			await expect(f.emit("compaction", input)).rejects.toThrow(
				"epoch was revoked",
			);
		} finally {
			f.native.splice(f.native.indexOf(control), 1);
		}
	}
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.recovery.snapshot(sessionID)).toMatchObject({ mode: "off" });
	expect(f.repository.saveCount).toBe(0);
}

for (const materialized of [false, true])
	for (const type of ["user", "synthetic"] as const)
		test(`terminal recovery ordinary ${type} executes before both summary denials with materialized prefix ${materialized}`, async () => {
			const f = await fixture();
			try {
				await triageRejectedCommand(
					f,
					materialized
						? "native-rpc-after-history"
						: "native-rpc-before-history",
				);
				f.native.push({
					type,
					id: "msg_terminal_native",
					text: "Distinct ordinary suffix",
					time: { created: 30 },
				});
				await exerciseUnregisteredNativeExecution(f, f.context().messages);
				await refuseUnownedSummaries(f, "msg_terminal_summary");
			} finally {
				await f.lifecycle.dispose();
			}
		});

for (const depth of [0, 2])
	for (const type of ["user", "synthetic"] as const)
		test(`terminal recovery ordinary ${type} preserves automatic history through ${depth} checked aliases after execution`, async () => {
			const f = await fixture();
			try {
				await initialOwnershipWork(f);
				for (let index = 0; index < depth; index++) {
					await compactCurrentInput(f, `msg_negative_alias_${index}`);
					await finishOwnedResponse(f, await startOwnedRequest(f));
				}
				f.failNextSessionRead();
				await expect(f.emit("context", f.context())).rejects.toThrow(
					"Native session read failed.",
				);
				f.native.push({
					type,
					id: "msg_after_automatic",
					text: "Ordinary suffix after automatic history",
					time: { created: 40 },
				});
				await exerciseRetiredAutomaticNativeExecution(f, f.context().messages);
				await refuseUnownedSummaries(f, "msg_automatic_history_summary");
			} finally {
				await f.lifecycle.dispose();
			}
		});

test("terminal recovery exact consumed real failure cannot replay before a new source", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(
			f,
			"msg_failed_real_replay",
			"Real failure cannot replay",
		);
		const observe = spyOn(f.autoDrive, "observeMessage").mockRejectedValueOnce(
			new Error("Claimed real activation failed."),
		);
		try {
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"Claimed real activation failed.",
			);
		} finally {
			observe.mockRestore();
		}
		expect(
			f.native.filter((item) => item.type === "user").map((item) => item.id),
		).toEqual(["msg_failed_real_replay"]);
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"epoch was revoked",
		);
		expect(f.repository.saveCount).toBe(0);
	} finally {
		await f.lifecycle.dispose();
	}
});

test("terminal recovery checked ordinary queue resets summary lineage while failed private replay stays denied", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		const { failedID } = await triageRejectedCommand(
			f,
			"native-rpc-before-history",
		);
		if (!failedID) throw new Error("Missing rejected private identity.");
		await triageFreshPublic(f, "queue");
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
		f.failNextSessionRead();
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"Native session read failed.",
		);
		f.native.push({
			type: "user",
			id: "msg_queue_reset_suffix",
			text: "Unregistered ordinary suffix",
			time: { created: 40 },
		});
		const input = f.context(),
			control = {
				...automaticControl("msg_queue_reset_summary"),
				reason: "manual" as const,
			};
		f.native.push(control);
		await f.emit("compaction", input);
		expect(f.repository.saveCount).toBe(0);
		f.native.splice(0, f.native.length, { ...control, status: "completed" });
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"unknown, synthetic, or stale",
		);
		f.native.splice(0, f.native.length, {
			type: "user",
			id: failedID,
			text: "Inspect failed reservation",
			time: { created: 0 },
		});
		await expect(f.emit("context", f.context())).rejects.toThrow();
	} finally {
		await f.lifecycle.dispose();
	}
});

test("terminal recovery expired checkpoint alone cannot execute after a failed command", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		await compactCurrentInput(f, "msg_expired_checkpoint");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await triageRejectedCommand(f, "native-rpc-before-history");
		expect(
			f.native
				.filter((item) => item.type === "compaction")
				.map((item) => item.id),
		).toEqual(["msg_expired_checkpoint"]);
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"epoch was revoked",
		);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});

test("terminal recovery queued command recovery works after an older checked checkpoint", async () => {
	const f = await fixture();
	try {
		await initialOwnershipWork(f);
		await compactCurrentInput(f, "msg_old_recovery_checkpoint");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await admitOrdinaryInput(
			f,
			"msg_before_failed_command",
			"Checked ordinary source after checkpoint",
		);
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await triageRejectedCommand(f, "native-rpc-before-history");
		const fresh = await triageFreshPublic(f, "queue");
		expect(fresh.effects).toEqual(["effect"]);
		expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	} finally {
		await f.lifecycle.dispose();
	}
});

test("terminal recovery compaction consumes a changing queue after the previous checkpoint origin retired", async () => {
	const f = await fixture();
	try {
		await admitOrdinaryInput(f, "msg_compact_source", "Ordinary predecessor");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await compactCurrentInput(f, "msg_compact_old_checkpoint");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await admitOrdinaryInput(f, "msg_compact_first_queue", "First queue");
		await finishOwnedResponse(f, await startOwnedRequest(f));
		await admitOrdinaryInput(f, "msg_compact_second_queue", "Second queue");
		await compactCurrentInput(f, "msg_compact_new_checkpoint");
		expect(f.native.map((item) => item.id)).toEqual([
			"msg_compact_new_checkpoint",
		]);
		const request = await startOwnedRequest(f);
		const effects: string[] = [],
			tool = await effectTool(f, effects);
		expect(await tool.execute({}, ownershipNativeCall(f))).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect"]);
		await finishOwnedResponse(f, request);
	} finally {
		await f.lifecycle.dispose();
	}
});

async function exerciseRetiredAutomaticNativeExecution(
	f: OwnershipFixture,
	expectedMessages: SessionContext["messages"],
) {
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.recovery.snapshot(sessionID)).toMatchObject({
		mode: "off",
		automation: { active: false, bound: false },
		advice: { active: false },
	});
	expect(f.repository.saveCount).toBe(0);
	const context = f.context();
	await f.emit("context", context);
	expect(context.messages).toEqual(expectedMessages);
	const request = new Request("http://localhost/unregistered-native", {
		method: "POST",
		body: "ordinary native request body",
	});
	const outbound = {
		sessionID,
		agent,
		model,
		kind: "primary" as const,
		request,
	};
	await f.emit("http.request", outbound);
	expect(await outbound.request.clone().text()).toBe(
		"ordinary native request body",
	);
	const inbound = {
		...outbound,
		response: new Response("ordinary native response body"),
	};
	await f.emit("http.response", inbound);
	expect(await inbound.response.text()).toBe("ordinary native response body");
	const shell = ownershipNativeCall(f, "shell");
	let shellEffects = 0;
	for (const callback of f.toolCallbacks["execute.before"])
		await callback({
			...shell,
			tool: "shell",
			input: { command: "printf not-run" },
		});
	shellEffects++;
	expect(shellEffects).toBe(1);
	const assistant = f.native.find((message) => message.id === shell.messageID);
	if (assistant?.type !== "assistant")
		throw new Error("Missing native tool assistant.");
	const flowCall = { ...shell, id: CallID.make("call_unregistered_flow") };
	assistant.content.push({
		type: "tool",
		id: flowCall.id,
		name: "flow_status",
		time: { created: 4 },
		state: {
			status: "running",
			input: { request: { view: "compact" } },
			metadata: {},
		},
	});
	const effects: string[] = [];
	const tool = await effectTool(f, effects);
	await expect(tool.execute({}, flowCall)).rejects.toThrow();
	expect(effects).toEqual([]);
	expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
	expect(f.recovery.snapshot(sessionID)).toMatchObject({
		mode: "off",
		automation: { active: false, bound: false },
		advice: { active: false },
	});
	expect(f.repository.saveCount).toBe(0);
	expect(f.repository.session).toBeNull();
}

test("terminal recovery an overlapping inspection cannot revoke the first checked queue before claim", async () => {
	const f = await fixture();
	try {
		await triageRejectedCommand(f, "native-rpc-before-history");
		await admitOrdinaryInput(
			f,
			"msg_inspection_queue",
			"Checked queue after failure",
		);
		f.blockNextContextRead();
		const pending = f.emit("context", f.context());
		await f.waitContextRead();
		await expect(f.emit("context", f.context())).rejects.toThrow(
			"context callbacks overlap",
		);
		f.releaseContextRead();
		await pending;
		const request = new Request("http://localhost/inspection-first");
		await f.emit("http.request", {
			sessionID,
			agent,
			model,
			kind: "primary",
			request,
		});
		const effects: string[] = [],
			tool = await effectTool(f, effects);
		expect(await tool.execute({}, ownershipNativeCall(f))).toEqual({
			content: [{ type: "text", text: "applied" }],
		});
		expect(effects).toEqual(["effect"]);
		await finishOwnedResponse(f, request);
		expect(f.repository.saveCount).toBe(0);
	} finally {
		f.releaseContextRead();
		await f.lifecycle.dispose();
	}
});

async function registrationNativeFixture(
	observed: boolean,
	type: "user" | "synthetic",
) {
	const f = await fixture();
	await initialOwnershipWork(f);
	const prior = await f.lifecycle.verifyTool(ownershipNativeCall(f), "flow");
	if (prior.kind !== "flow")
		throw new Error("Missing captured automatic owner");
	await triageRejectedCommand(f, "native-rpc-before-history");
	expect(() => prior.assertCurrent()).toThrow();
	const id = "msg_registration_native",
		text = "Original native payload";
	if (observed)
		await f.sendEventAndWait({
			type: "session.inbox.enqueued",
			id: "evt_registration_observed",
			created: 20,
			durable: { aggregateID: sessionID, seq: 200, version: 1 },
			data: {
				sessionID,
				inboxID: id,
				item: { type, payload: { text }, delivery: "queue" },
			},
		});
	f.native.push({ type, id, text, time: { created: 30 } });
	return { f, id, text };
}

for (const observed of [false, true])
	for (const type of ["user", "synthetic"] as const)
		for (const samePayload of [false, true])
			for (const when of [
				"before-resolve",
				"await-freeze",
				"before-http",
				"before-tool",
			] as const)
				test(`terminal registration lifecycle refuses ${type} observed ${observed} matching ${samePayload} ${when}`, async () => {
					const { f, id, text } = await registrationNativeFixture(
						observed,
						type,
					);
					const registeredText = samePayload
						? text
						: "Different registered payload";
					const register = () =>
						f.emit("prompt", {
							sessionID,
							messageID: SessionMessage.ID.make(id),
							prompt: { text: registeredText },
							delivery: "queue",
						});
					let registration: Promise<void> | undefined,
						checks = 0,
						httpEffects = 0,
						shellEffects = 0;
					const original = ExecutionAttribution.prototype.prepareReplacement;
					const check = spyOn(
						ExecutionAttribution.prototype,
						"prepareReplacement",
					).mockImplementation(function (this: ExecutionAttribution, ...args) {
						const result = original.apply(this, args);
						if (++checks === 2 && when === "await-freeze")
							queueMicrotask(() => {
								registration = register();
							});
						return result;
					});
					try {
						if (when === "before-resolve") f.blockNextContextRead();
						const pending = f
							.emit("context", f.context())
							.then(() => "accepted", String);
						if (when === "before-resolve") {
							await f.waitContextRead();
							await register();
							await f.flush();
							expect(
								await Promise.race([pending, Promise.resolve("still pending")]),
							).toBe("Error: Flow execution epoch was revoked.");
							f.releaseContextRead();
						}
						const outcome = await pending;
						await registration;
						check.mockRestore();
						if (when === "before-resolve" || when === "await-freeze") {
							expect(outcome).toBe("Error: Flow execution epoch was revoked.");
							if (when === "await-freeze") {
								expect(checks).toBe(2);
								expect(registration).toBeDefined();
							}
						} else {
							expect(outcome).toBe("accepted");
							if (when === "before-tool") {
								const request = new Request(
									"http://localhost/registration-before-mutation",
								);
								await f.emit("http.request", {
									sessionID,
									agent,
									model,
									kind: "primary",
									request,
								});
								await finishOwnedResponse(f, request);
							}
							await register();
						}
						const request = new Request(
							"http://localhost/registration-after-mutation",
						);
						await expect(
							(async () => {
								await f.emit("http.request", {
									sessionID,
									agent,
									model,
									kind: "primary",
									request,
								});
								httpEffects++;
							})(),
						).rejects.toThrow();
						const shell = ownershipNativeCall(f, "shell");
						await expect(
							(async () => {
								for (const callback of f.toolCallbacks["execute.before"])
									await callback({
										...shell,
										tool: "shell",
										input: { command: "printf not-run" },
									});
								shellEffects++;
							})(),
						).rejects.toThrow();
						await expect(
							f.lifecycle.verifyTool(shell, "native", "shell"),
						).rejects.toThrow();
						const flowEffects: string[] = [],
							tool = await effectTool(f, flowEffects);
						await expect(
							tool.execute({}, ownershipNativeCall(f)),
						).rejects.toThrow();
						expect(httpEffects).toBe(0);
						expect(shellEffects).toBe(0);
						expect(flowEffects).toEqual([]);
						expect(f.repository.saveCount).toBe(0);
						expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
						expect(f.recovery.snapshot(sessionID)).toMatchObject({
							mode: "off",
							advice: { active: false },
							automation: { active: false, bound: false },
						});
						if (type === "user" && samePayload) {
							await admitOrdinaryInput(
								f,
								"msg_registration_checked_successor",
								"Fresh checked successor",
							);
							const freshRequest = await startOwnedRequest(f);
							const applied: string[] = [],
								freshTool = await effectTool(f, applied);
							expect(
								await freshTool.execute({}, ownershipNativeCall(f)),
							).toEqual({ content: [{ type: "text", text: "applied" }] });
							expect(applied).toEqual(["effect"]);
							await finishOwnedResponse(f, freshRequest);
							expect(f.repository.saveCount).toBe(0);
						}
					} finally {
						check.mockRestore();
						f.releaseContextRead();
						await f.lifecycle.dispose();
					}
				});

for (const type of ["user", "synthetic"] as const)
	test(`terminal registration earlier mismatched ${type} registration still refuses before capture`, async () => {
		const { f, id } = await registrationNativeFixture(false, type);
		try {
			await f.emit("prompt", {
				sessionID,
				messageID: SessionMessage.ID.make(id),
				prompt: { text: "Different registered payload" },
				delivery: "queue",
			});
			await expect(f.emit("context", f.context())).rejects.toThrow(
				"unknown, synthetic, or stale real input",
			);
			expect(f.repository.saveCount).toBe(0);
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.recovery.snapshot(sessionID)).toMatchObject({
				mode: "off",
				advice: { active: false },
				automation: { active: false, bound: false },
			});
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const queuedHost of ["same-host", "other-host"] as const)
	test(`terminal registration unrelated ${queuedHost} preparation preserves ordinary execution and a current Flow lease`, async () => {
		const { f } = await registrationNativeFixture(false, "user");
		try {
			const request = await startOwnedRequest(f);
			const shell = ownershipNativeCall(f, "shell");
			const target =
				queuedHost === "same-host"
					? sessionID
					: Session.ID.make("session-registration-other");
			await f.emit("prompt", {
				sessionID: target,
				messageID: SessionMessage.ID.make("msg_positive_queued_one"),
				prompt: { text: "msg_positive_queued_one" },
				delivery: "queue",
			});
			for (const callback of f.toolCallbacks["execute.before"])
				await callback({
					...shell,
					tool: "shell",
					input: { command: "printf not-run" },
				});
			expect(await f.lifecycle.verifyTool(shell, "native", "shell")).toEqual({
				kind: "native-only",
			});
			await finishOwnedResponse(f, request);
			await f.command(
				"flow-auto",
				"Current lease remains active during unrelated queue preparation",
			);
			const primaryRequest = await startOwnedRequest(f);
			const call = ownershipNativeCall(f),
				guard = await f.lifecycle.verifyTool(call, "flow");
			if (guard.kind !== "flow") throw new Error("Missing Flow guard");
			const authority = f.autoDrive.captureAuthority(sessionID);
			expect(authority?.token).toBe("local-token");
			await f.emit("prompt", {
				sessionID: target,
				messageID: SessionMessage.ID.make("msg_positive_queued_two"),
				prompt: { text: "msg_positive_queued_two" },
				delivery: "queue",
			});
			expect(() => guard.assertCurrent()).not.toThrow();
			expect(f.autoDrive.captureAuthority(sessionID)).toEqual(authority);
			const applied: string[] = [],
				tool = await effectTool(f, applied);
			expect(await tool.execute({}, call)).toEqual({
				content: [{ type: "text", text: "applied" }],
			});
			expect(applied).toEqual(["effect"]);
			await finishOwnedResponse(f, primaryRequest);
			if (queuedHost === "same-host") {
				f.native.push(
					{
						type: "user",
						id: "msg_positive_queued_one",
						text: "msg_positive_queued_one",
						time: { created: 40 },
					},
					{
						type: "user",
						id: "msg_positive_queued_two",
						text: "msg_positive_queued_two",
						time: { created: 41 },
					},
				);
				const queuedRequest = await startOwnedRequest(f);
				const queuedEffects: string[] = [],
					queuedTool = await effectTool(f, queuedEffects);
				expect(await queuedTool.execute({}, ownershipNativeCall(f))).toEqual({
					content: [{ type: "text", text: "applied" }],
				});
				expect(queuedEffects).toEqual(["effect"]);
				await finishOwnedResponse(f, queuedRequest);
			}
		} finally {
			await f.lifecycle.dispose();
		}
	});

for (const scheduled of [false, true])
	test(`terminal registration original ownerless await-gap scheduled ${scheduled} refuses context and HTTP`, async () => {
		const f = await fixture();
		let checks = 0,
			registration: Promise<void> | undefined;
		const original = ExecutionAttribution.prototype.prepareReplacement;
		const register = () =>
			f.emit("prompt", {
				sessionID,
				messageID: SessionMessage.ID.make("msg_ownerless_registration_gap"),
				prompt: { text: "Different registered payload" },
				delivery: "queue",
			});
		const check = spyOn(
			ExecutionAttribution.prototype,
			"prepareReplacement",
		).mockImplementation(function (this: ExecutionAttribution, ...args) {
			const result = original.apply(this, args);
			if (++checks === 2 && scheduled)
				queueMicrotask(() => {
					registration = register();
				});
			return result;
		});
		try {
			await triageRejectedCommand(f, "native-rpc-before-history");
			f.native.push({
				type: "user",
				id: "msg_ownerless_registration_gap",
				text: "Original native payload",
				time: { created: 30 },
			});
			if (!scheduled) await register();
			await expect(f.emit("context", f.context())).rejects.toThrow(
				scheduled
					? "epoch was revoked"
					: "unknown, synthetic, or stale real input",
			);
			await registration;
			if (scheduled) {
				expect(checks).toBe(2);
				expect(registration).toBeDefined();
			}
			check.mockRestore();
			let httpEffects = 0;
			await expect(
				(async () => {
					await f.emit("http.request", {
						sessionID,
						agent,
						model,
						kind: "primary",
						request: new Request("http://localhost/ownerless-gap-refusal"),
					});
					httpEffects++;
				})(),
			).rejects.toThrow();
			const effects: string[] = [],
				tool = await effectTool(f, effects);
			await expect(tool.execute({}, ownershipNativeCall(f))).rejects.toThrow();
			expect(httpEffects).toBe(0);
			expect(effects).toEqual([]);
			expect(f.repository.saveCount).toBe(0);
			expect(f.autoDrive.captureAuthority(sessionID)).toBeNull();
			expect(f.recovery.snapshot(sessionID)).toEqual({ mode: "off" });
		} finally {
			check.mockRestore();
			await f.lifecycle.dispose();
		}
	});
