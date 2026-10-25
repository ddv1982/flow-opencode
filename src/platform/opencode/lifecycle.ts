import { isDeepStrictEqual } from "node:util";
import type { SessionMessageInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/promise/plugin";
import type { Registration } from "@opencode/plugin/promise/registration";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import { SessionMessage } from "@opencode/schema/session-message";
import type { FlowService } from "../../application/flow-service.js";
import type {
	RecoveryController,
	RecoverySettings,
} from "../../application/recovery-policy.js";
import {
	FLOW_CORE_COMMANDS,
	type FlowCodingModel,
} from "../../config-shared.js";
import { CompactionBoundary } from "./auto-compaction.js";
import {
	type AutoDriveCoordinator,
	type AutoDriveDelivery,
	FLOW_AUTO_METADATA_KEY,
} from "./auto-drive.js";
import type {
	DispatchIntent,
	DispatchResult,
	IdleOwner,
} from "./auto-drive-dispatch.js";
import {
	createCommandHook,
	flowCommandName,
	nativePromptPayload,
	prepareFlowCommand,
} from "./command-hook.js";
import {
	ExecutionAttribution,
	type InputOrigin,
	type NativeExecution,
	nativeDelivery,
	nativeInputIDs,
	rememberCodingModel,
	sameDelivery,
} from "./execution-attribution.js";
import { InputAdmissions, type SourceOperation } from "./input-admission.js";
import type { FlowLeadershipHandle } from "./leadership.js";

type LifecycleContext = Readonly<{
	location: Pick<Context["location"], "directory">;
	session: Pick<
		Context["session"],
		"context" | "get" | "synthetic" | "prompt" | "create" | "hook"
	>;
	agent: Pick<Context["agent"], "get">;
	command: Pick<Context["command"], "transform">;
	tool: Pick<Context["tool"], "hook">;
	event: Context["event"];
}>;
type LifecycleOptions = Readonly<{
	ctx: LifecycleContext;
	autoDrive: AutoDriveCoordinator;
	recovery: RecoveryController;
	flow: FlowService;
	runtimeGuard: FlowLeadershipHandle;
	onFlowTerminal?: ((host: string) => void) | undefined;
	defaultRecovery?: (() => RecoverySettings | null) | undefined;
	log(
		level: "info" | "warn" | "error",
		message: string,
		extra?: Readonly<Record<string, unknown>>,
	): void;
	codingModels: Map<string, FlowCodingModel>;
}>;
type ToolAccess =
	| Readonly<{ kind: "flow"; assertCurrent(): void }>
	| Readonly<{ kind: "native-only" | "untracked" }>;
type FlowLifecycle = Readonly<{
	verifyTool(
		execution: NativeExecution | ToolContext,
		use: "native" | "flow",
		tool?: string,
	): Promise<ToolAccess>;
	prompt(
		sessionID: string,
		prompt: string,
		delivery: AutoDriveDelivery,
		metadata: Readonly<Record<string, unknown>>,
		intent?: DispatchIntent,
	): Promise<DispatchResult>;
	dispose(): Promise<void>;
}>;
type CallbackOwner = Readonly<{
	host: string;
	epoch: number;
	primary: ReturnType<ExecutionAttribution["current"]>;
	kind: "attempt" | "admission";
	input: InputOrigin | undefined;
	source: string | undefined;
}>;
const specialists = new Set(["flow-planner", "flow-worker", "flow-reviewer"]);
const errorOf = (error: unknown) =>
	error instanceof Error ? error : new Error(String(error));

export async function registerFlowLifecycle(
	options: LifecycleOptions,
): Promise<FlowLifecycle> {
	const { ctx, autoDrive, recovery, runtimeGuard, codingModels, log } = options;
	const registrations: Registration[] = [];
	const idle = new Map<string, string>();
	const outcomes = new Set<string>();
	const contextPending = new Map<string, SourceOperation>();
	const controller = new AbortController();
	const readController = new AbortController();
	const readOptions = { signal: readController.signal };
	let closed = false;
	let streamLost = false;
	let disposal: Promise<void> | null = null;
	const epoch = (host: string) => inputs.epoch(host);
	const assertOpen = () => {
		if (closed || streamLost)
			throw new Error(
				"Flow lifecycle is unavailable after unload or event-stream loss.",
			);
		runtimeGuard.assertOperational("authorize native Flow execution");
	};
	const inputs = new InputAdmissions({
		assertOpen,
		authorityCurrent: (authority) => autoDrive.isAuthorityCurrent(authority),
		authority: (host) => autoDrive.captureAuthority(host),
		observeReal: (host, id, text, delivery, assertCurrent) =>
			observeAccepted(host, id, text, delivery, null, false, assertCurrent),
	});
	const assertLive = (origin: InputOrigin) => inputs.assertLive(origin);
	const attribution = new ExecutionAttribution(assertLive);
	const revokeEffects = (host: string) => {
		autoDrive.revokeExecutions(host);
		recovery.invalidateOrigins(host);
	};
	const revoke = (
		host: string,
		deactivate = true,
		captured = attribution.current(host) ?? null,
	) => {
		if (captured) attribution.end(captured);
		inputs.invalidate(host);
		revokeEffects(host);
		if (deactivate) {
			autoDrive.deactivate(host);
			recovery.revoke(host);
		}
	};
	const captureOwner = (
		host: string,
		kind: CallbackOwner["kind"] = "attempt",
		primary: ReturnType<ExecutionAttribution["current"]> = undefined,
		expectedEpoch = kind === "attempt" && primary?.participation.kind === "flow"
			? primary.participation.origin.epoch
			: epoch(host),
		input?: InputOrigin,
		source = input?.id,
	): CallbackOwner =>
		Object.freeze({
			host,
			kind,
			primary,
			epoch: expectedEpoch,
			input,
			source,
		});
	const owns = (owner: CallbackOwner, primary = owner.primary) => {
		const origin =
			owner.input ??
			(owner.kind === "attempt" && primary?.participation.kind === "flow"
				? primary.participation.origin
				: undefined);
		return (
			!closed &&
			!streamLost &&
			epoch(owner.host) === owner.epoch &&
			(owner.kind === "admission" ||
				(primary !== undefined && attribution.isCurrent(primary))) &&
			(!origin || inputs.isLive(origin))
		);
	};
	const assertOwned = (owner: CallbackOwner, primary = owner.primary) => {
		assertOpen();
		if (!owns(owner, primary))
			throw new Error("Flow execution epoch was revoked.");
	};
	const failOwned = (owner: CallbackOwner, primary = owner.primary) => {
		if (
			owner.kind === "attempt" &&
			primary?.participation.kind === "native-only"
		) {
			attribution.retire(primary);
			return;
		}
		if (
			primary?.participation.kind === "flow" &&
			primary.participation.origin.epoch === owner.epoch &&
			(!owner.input || primary.participation.origin === owner.input) &&
			(!owner.source || owns(owner, primary))
		)
			attribution.end(primary);
		if (owns(owner, primary)) revoke(owner.host, true, primary ?? null);
	};
	const failReservation = (
		reservation: Parameters<InputAdmissions["assertReservation"]>[0],
		owner: CallbackOwner,
		error: unknown,
	) => {
		if (!inputs.finishReservation(reservation, error)) return;
		if (owner.primary) attribution.end(owner.primary);
		revokeEffects(owner.host);
		autoDrive.deactivate(owner.host);
		recovery.revoke(owner.host);
	};
	const observeAccepted = async (
		host: string,
		id: string,
		text: string,
		delivery: AutoDriveDelivery,
		metadata: Readonly<Record<string, unknown>> | null,
		synthetic: boolean,
		assertCurrent: () => void,
		intent?: DispatchIntent,
	) => {
		assertCurrent();
		const parts = metadata
			? [{ type: "text", text, synthetic: true, metadata }]
			: [{ type: "text", text }];
		const result = await autoDrive.observeMessage(
			host,
			delivery,
			parts,
			id,
			intent,
		);
		assertCurrent();
		if (result === "stale-continuation")
			throw new Error("Flow rejected a stale admitted continuation.");
		recovery.observeMessage(
			host,
			id,
			synthetic,
			result === "accepted-continuation",
		);
	};
	const verifyTool = async (
		execution: NativeExecution,
		use: "native" | "flow",
		tool?: string,
	): Promise<ToolAccess> => {
		assertOpen();
		const primary = attribution.executionOwner(execution);
		if (!primary) {
			if (use === "native" && !attribution.current(execution.sessionID))
				return { kind: "untracked" };
			throw new Error("Flow tool has no attributable primary request.");
		}
		const owner = captureOwner(execution.sessionID, "attempt", primary);
		try {
			if (
				epoch(owner.host) === owner.epoch &&
				attribution.current(owner.host) !== primary
			)
				throw new Error("Flow assistant cannot be rebound to another request.");
			assertOwned(owner);
			attribution.assertCurrent(primary);
			const [native, session] = await Promise.all([
				ctx.session.context({ sessionID: execution.sessionID }, readOptions),
				ctx.session.get({ sessionID: execution.sessionID }, readOptions),
			]);
			assertOwned(owner);
			attribution.verify(
				execution,
				native,
				session,
				ctx.location.directory,
				tool,
			);
		} catch (error) {
			failOwned(owner);
			throw error;
		}
		if (primary.participation.kind === "native-only") {
			if (use === "flow")
				throw new Error("Flow tool requires a live admitted input origin.");
			return { kind: "native-only" };
		}
		const origin = primary.participation.origin;
		autoDrive.observeAssistant(
			execution.sessionID,
			execution.messageID,
			origin.id,
		);
		recovery.observeAssistant(
			execution.sessionID,
			execution.messageID,
			origin.id,
		);
		return {
			kind: "flow",
			assertCurrent: () => {
				assertOpen();
				attribution.assertCurrent(primary);
			},
		};
	};
	const commandAccepted = createCommandHook({
		...options,
		assertOperational: (action) => runtimeGuard.assertOperational(action),
	});
	const synthetic = async (
		host: string,
		text: string,
		delivery: AutoDriveDelivery,
		metadata: Readonly<Record<string, unknown>>,
		intent?: DispatchIntent,
	): Promise<DispatchResult> => {
		assertOpen();
		const token = metadata[FLOW_AUTO_METADATA_KEY];
		if (typeof token !== "string")
			throw new Error(
				"Flow synthetic dispatch has no live authenticated token.",
			);
		const capture = autoDrive.captureDispatch(host, token, intent);
		if (!capture)
			throw new Error(
				"Flow synthetic dispatch has no live authenticated token.",
			);
		if (Object.keys(metadata).some((key) => key !== FLOW_AUTO_METADATA_KEY))
			throw new Error("Flow synthetic metadata has unknown fields.");
		const barrier = inputs.captureBarrier(host);
		const block = inputs.automaticBlock(host);
		if (block) return { kind: "withheld", reason: block };
		const session = await ctx.session.get({ sessionID: host }, readOptions);
		barrier.assertCurrent();
		if (!capture.current())
			throw new Error("Flow synthetic dispatch was superseded.");
		if (session.id !== host || !sameDelivery(delivery, nativeDelivery(session)))
			throw new Error(
				"Flow queued continuation cannot change the user's selected agent or model.",
			);
		const reason = inputs.automaticBlock(host);
		if (reason) return { kind: "withheld", reason };
		const id = SessionMessage.ID.create(),
			reservation = inputs.reserve(host, id);
		const expectedEpoch = reservation.epoch;
		const owner = captureOwner(
			host,
			"admission",
			attribution.current(host),
			expectedEpoch,
		);
		const assertCurrent = () => {
			inputs.assertReservation(reservation);
			if (!autoDrive.isAuthorityCurrent(capture.authority))
				throw new Error("Flow synthetic dispatch was superseded.");
		};
		const payload = { text, metadata: { [FLOW_AUTO_METADATA_KEY]: token } };
		try {
			const admission = inputs.register(reservation, {
				type: "synthetic",
				payload,
			});
			const pending = ctx.session.synthetic(
				{ sessionID: host, id, ...payload, delivery: "queue", resume: true },
				{ signal: controller.signal },
			);
			const receipt = await pending;
			await inputs.accept(admission, receipt, async () => {
				assertCurrent();
				await observeAccepted(
					host,
					id,
					text,
					delivery,
					payload.metadata,
					true,
					assertCurrent,
					intent,
				);
				assertCurrent();
				return inputs.makeOrigin(host, id, delivery, true, expectedEpoch);
			});
			return { kind: "sent", source: id };
		} catch (error) {
			failReservation(reservation, owner, error);
			throw error;
		}
	};
	const sourceFailure = (
		operation: SourceOperation,
		stillExpected = () => true,
	) => {
		if (!operation.fail(stillExpected)) return;
		autoDrive.deactivate(operation.scope.host);
		recovery.revoke(operation.scope.host);
	};
	const replacementEffects = (host: string) => {
		const expected = attribution.current(host);
		return {
			check: (
				input: Parameters<ExecutionAttribution["prepareReplacement"]>[0],
				native: readonly SessionMessageInfo[],
				changing: boolean,
			) => {
				attribution.assertExpected(host, expected);
				if (changing)
					attribution.prepareReplacement(input, native, expected, true, () =>
						compactions.prefixBridge(
							input,
							native,
							expected?.participation.kind === "flow"
								? expected.participation.origin
								: undefined,
						),
					);
			},
			current: () => attribution.current(host) === expected,
			supersede: () => {
				if (expected) attribution.end(expected);
				revokeEffects(host);
			},
		};
	};
	const compactions = new CompactionBoundary({
		inputs,
		readNative: (host) => ctx.session.context({ sessionID: host }, readOptions),
		readSelected: (host) => ctx.session.get({ sessionID: host }, readOptions),
		captureReplacement: replacementEffects,
		failure: sourceFailure,
		hasActivePrimary: (host) => {
			const current = attribution.current(host);
			return current !== undefined && current.http.phase !== "ended";
		},
		guidance: (host) => autoDrive.compactionContext(host),
		observe: (host, origin, source, id) => {
			if (
				origin.authority &&
				!autoDrive.isAuthorityCurrent(origin.authority, id)
			)
				autoDrive.observeCompaction(
					origin.authority.hostSessionId,
					origin.authority,
					source,
					id,
				);
			if (!origin.authority) recovery.observeMessage(host, id, true, true);
		},
	});
	try {
		registrations.push(
			await ctx.session.hook("prompt", (input) => {
				assertOpen();
				if (inputs.hasPrivate(input.sessionID, input.messageID)) return;
				if (input.metadata?.[FLOW_AUTO_METADATA_KEY] !== undefined)
					throw new Error("Flow tokens require a private admitted dispatch.");
				inputs.observePrompt(input, () => revoke(input.sessionID, false));
			}),
		);
		registrations.push(
			await ctx.command.transform((editor) => {
				for (const name of Object.keys(FLOW_CORE_COMMANDS)) {
					if (!Object.hasOwn(FLOW_CORE_COMMANDS, name)) continue;
					const commandName = flowCommandName(name);
					editor.add({
						name,
						description: FLOW_CORE_COMMANDS[commandName].description,
						execute: async (input) => {
							assertOpen();
							const command = prepareFlowCommand(
								commandName,
								input.prompt.text,
							);
							revoke(input.sessionID, false);
							const id = SessionMessage.ID.create();
							const reservation = inputs.reserve(input.sessionID, id);
							const expectedEpoch = reservation.epoch;
							const owner = captureOwner(
								input.sessionID,
								"admission",
								attribution.current(input.sessionID),
								expectedEpoch,
							);
							const assertCurrent = () => {
								inputs.assertReservation(reservation);
							};
							try {
								const session = await ctx.session.get(
									{ sessionID: input.sessionID },
									readOptions,
								);
								assertCurrent();
								if (
									session.parentID ||
									!session.agent ||
									specialists.has(session.agent)
								)
									throw new Error(
										"Flow commands require the native primary manager.",
									);
								const delivery = nativeDelivery(session);
								const invocationToken =
									command.name === "flow-auto" && !command.stopping
										? autoDrive.createInvocationToken()
										: undefined;
								const payload = {
									...nativePromptPayload({
										...input.prompt,
										text: command.text,
									}),
									...(invocationToken === undefined
										? {}
										: {
												metadata: { [FLOW_AUTO_METADATA_KEY]: invocationToken },
											}),
								};
								const admission = inputs.register(reservation, {
									type: "user",
									payload,
								});
								assertCurrent();
								const receipt = await ctx.session.prompt(
									{
										sessionID: input.sessionID,
										id,
										...payload,
										delivery: input.delivery,
										resume: !command.stopping && command.name !== "flow-review",
									},
									{ signal: controller.signal },
								);
								await inputs.accept(admission, receipt, async () => {
									assertCurrent();
									const metadata = await commandAccepted(
										command,
										input.sessionID,
										assertCurrent,
										invocationToken,
									);
									assertCurrent();
									await observeAccepted(
										input.sessionID,
										id,
										command.text,
										delivery,
										metadata,
										false,
										assertCurrent,
									);
									assertCurrent();
									return inputs.makeOrigin(
										input.sessionID,
										id,
										delivery,
										metadata !== null,
										expectedEpoch,
									);
								});
								if (command.name === "flow-review") {
									const reviewer = await ctx.agent.get({
										agentID: "flow-reviewer",
									});
									assertCurrent();
									const child = await ctx.session.create({
										parentID: session.id,
										agent: "flow-reviewer",
										title: "Flow review",
										location: { directory: ctx.location.directory },
										...((reviewer.data.model ?? session.model)
											? { model: reviewer.data.model ?? session.model }
											: {}),
									});
									assertCurrent();
									if (
										child.parentID !== session.id ||
										child.agent !== "flow-reviewer"
									)
										throw new Error(
											"Flow reviewer child identity was not confirmed.",
										);
									await ctx.session.prompt(
										{ sessionID: child.id, ...payload, delivery: "queue" },
										{ signal: controller.signal },
									);
								}
							} catch (error) {
								failReservation(reservation, owner, error);
								throw error;
							}
						},
					});
				}
			}),
		);
		registrations.push(
			await ctx.session.hook("context", async (value) => {
				assertOpen();
				const input = {
					...value,
					model: { ...value.model },
					messages: structuredClone(value.messages),
				};
				const prior = attribution.current(input.sessionID),
					operation = inputs.openSource(input);
				if (contextPending.get(input.sessionID)?.current()) {
					sourceFailure(
						operation,
						() => attribution.current(input.sessionID) === prior,
					);
					operation.release();
					throw new Error("Flow primary context callbacks overlap.");
				}
				contextPending.set(input.sessionID, operation);
				let frozen: ReturnType<ExecutionAttribution["freeze"]> | undefined;
				let completed: InputOrigin | undefined;
				let replacement:
					| ReturnType<ExecutionAttribution["prepareReplacement"]>
					| undefined;
				try {
					await operation.scope.ready();
					const native = await operation.scope.wait(
						ctx.session.context({ sessionID: input.sessionID }, readOptions),
					);
					const session = await operation.scope.wait(
						ctx.session.get({ sessionID: input.sessionID }, readOptions),
					);
					attribution.prepareReplacement(input, native, prior, false);

					const resolved = await operation.resolve(native, session, {
						check: (changing) => {
							replacement = attribution.prepareReplacement(
								input,
								native,
								prior,
								changing,
								() =>
									compactions.prefixBridge(
										input,
										native,
										prior?.participation.kind === "flow"
											? prior.participation.origin
											: undefined,
									),
							);
							completed = compactions.completed(input, native);
						},
						supersede: () => {
							if (prior) attribution.end(prior);
							revokeEffects(input.sessionID);
						},
					});
					const participation = completed
						? { kind: "flow" as const, origin: completed }
						: resolved.participation;
					if (!participation)
						throw new Error(
							"Flow context has an unknown, synthetic, or stale real input.",
						);
					attribution.assertExpected(input.sessionID, prior);
					frozen = attribution.freeze(
						input,
						resolved.native,
						participation,
						resolved.scope,
						replacement,
					);
					attribution.assertCurrent(frozen);
					rememberCodingModel(
						codingModels,
						input,
						resolved.selected,
						specialists,
					);
				} catch (error) {
					if (frozen)
						failOwned(captureOwner(input.sessionID, "attempt", frozen));
					else
						sourceFailure(
							operation,
							() => attribution.current(input.sessionID) === prior,
						);
					throw error;
				} finally {
					if (contextPending.get(input.sessionID) === operation)
						contextPending.delete(input.sessionID);
					operation.release();
				}
			}),
		);
		registrations.push(
			await ctx.session.hook("compaction", async (input) => {
				const result = await compactions.admit(input);
				if (result.kind === "continuation") {
					const guidance = autoDrive.compactionContext(input.sessionID);
					if (guidance) input.system.push({ type: "text", text: guidance });
				}
			}),
		);
		registrations.push(
			await ctx.session.hook("http.request", (input) => {
				const primary = attribution.requestOwner(input.request);
				try {
					attribution.request(input);
				} catch (error) {
					if (primary)
						failOwned(captureOwner(primary.sessionID, "attempt", primary));
					throw error;
				}
			}),
		);
		registrations.push(
			await ctx.session.hook("http.response", (input) => {
				attribution.response(input, (primary) =>
					failOwned(captureOwner(primary.sessionID, "attempt", primary)),
				);
			}),
		);
		registrations.push(
			await ctx.session.hook("experimental.ws.handshake", (input) => {
				if (input.kind !== "primary") return;
				const primary = attribution.current(input.sessionID);
				failOwned(
					captureOwner(
						input.sessionID,
						"attempt",
						primary,
						primary?.participation.kind === "flow"
							? primary.participation.origin.epoch
							: epoch(input.sessionID),
					),
				);
				throw new Error(
					"Flow request attribution has not been proved for WebSocket transports.",
				);
			}),
		);
		registrations.push(
			await ctx.tool.hook("execute.before", async (input) => {
				const current = attribution.current(input.sessionID);
				const executionOwner = attribution.executionOwner(input);
				const staleAssistant =
					current !== undefined && executionOwner === undefined;
				const protectedAutomatic = Boolean(
					(current?.participation.kind === "flow" &&
						current.participation.origin.authority) ||
						(executionOwner?.participation.kind === "flow" &&
							executionOwner.participation.origin.authority),
				);
				if (
					!input.tool.startsWith("flow_") &&
					!protectedAutomatic &&
					current?.participation.kind !== "native-only" &&
					executionOwner?.participation.kind !== "native-only" &&
					!staleAssistant
				)
					return;
				await verifyTool(
					input,
					input.tool.startsWith("flow_") ? "flow" : "native",
					input.tool,
				);
			}),
		);
	} catch (error) {
		closed = true;
		inputs.clear();
		attribution.clear();
		autoDrive.clear();
		recovery.revoke();
		for (const registration of registrations.reverse())
			await registration.dispose();
		throw error;
	}
	const tasks = new Set<Promise<void>>(),
		chains = new Map<string, Promise<void>>(),
		scheduled = new Set<string>();
	const cancelled = Promise.withResolvers<never>();
	void cancelled.promise.catch(() => {});
	readController.signal.addEventListener(
		"abort",
		() => cancelled.reject(new Error("Flow lifecycle disposed.")),
		{ once: true },
	);
	const wait = <T>(promise: Promise<T>) =>
		Promise.race([promise, cancelled.promise]);
	const enqueue = (host: string, job: () => Promise<void>) => {
		const task = (chains.get(host) ?? Promise.resolve())
			.then(async () => {
				if (!closed && !streamLost) await job();
			})
			.catch((error) =>
				log("warn", "Flow terminal observation failed.", {
					host,
					message: errorOf(error).message,
				}),
			)
			.finally(() => {
				tasks.delete(task);
				if (chains.get(host) === task) chains.delete(host);
			});
		chains.set(host, task);
		tasks.add(task);
	};
	const subscription = (async () => {
		try {
			for await (const event of ctx.event.subscribe({
				signal: controller.signal,
			})) {
				if (closed) break;
				const host =
					"sessionID" in event.data ? event.data.sessionID : undefined;
				if (
					event.type === "session.inbox.enqueued" ||
					event.type === "session.inbox.cancelled" ||
					event.type === "session.inbox.delivered" ||
					event.type === "session.inbox.delivery.changed"
				) {
					const { retryHost } = inputs.observeInbox(event, (host) =>
						revoke(host, false),
					);
					if (retryHost) {
						const primary = attribution.current(retryHost),
							owner = captureOwner(retryHost, "attempt", primary);
						enqueue(retryHost, async () => {
							if (owns(owner) && !inputs.automaticBlock(retryHost))
								await autoDrive.resumeDeferred(retryHost);
						});
					}
					continue;
				}
				if (event.type === "session.deleted") {
					if (outcomes.has(event.id)) continue;
					outcomes.add(event.id);
					revoke(event.data.sessionID);
					inputs.deleteHost(event.data.sessionID);
					attribution.deleteSession(event.data.sessionID);
					codingModels.delete(event.data.sessionID);
					continue;
				}
				if (
					event.type !== "session.execution.failed" &&
					event.type !== "session.execution.interrupted" &&
					event.type !== "session.execution.succeeded" &&
					event.type !== "session.idle"
				)
					continue;
				if (!host || outcomes.has(event.id) || scheduled.has(event.id))
					continue;
				const primary = attribution.current(host);
				if (!primary) continue;
				const owner = captureOwner(host, "attempt", primary);
				scheduled.add(event.id);
				enqueue(host, async () => {
					let proved = false;
					try {
						if (!owns(owner)) return;
						const native = await wait(
							ctx.session.context({ sessionID: host }, readOptions),
						);
						if (!owns(owner)) return;
						const terminal = attribution.terminal(
							primary,
							native,
							event.type === "session.idle"
								? undefined
								: SessionMessage.ID.fromEvent(event.id),
						);
						if (
							!terminal ||
							(event.type === "session.execution.failed" &&
								terminal.outcome !== "failed") ||
							(event.type === "session.execution.interrupted" &&
								terminal.outcome !== "interrupted") ||
							(event.type === "session.execution.succeeded" &&
								terminal.outcome !== "succeeded")
						)
							return;
						proved = true;
						outcomes.add(event.id);
						if (primary.participation.kind === "native-only") {
							attribution.retire(primary);
							return;
						}
						if (terminal.outcome !== "succeeded") {
							options.onFlowTerminal?.(host);
							failOwned(owner);
							return;
						}
						const session = await wait(
							ctx.session.get({ sessionID: host }, readOptions),
						);
						if (!owns(owner)) return;
						if (session.id !== host)
							throw new Error("Flow native terminal session identity changed.");
						if (
							session.outcome !== terminal.outcome ||
							session.time.idle !== terminal.time.created
						)
							return;
						const watermark = String(session.time.idle);
						if (idle.get(host) === watermark) return;
						idle.set(host, watermark);
						options.onFlowTerminal?.(host);
						if (!runtimeGuard.query().operational) {
							failOwned(owner);
							return;
						}
						const consumed = nativeInputIDs(native),
							delivery = nativeDelivery(session);
						const current = () => owns(owner) && attribution.isCurrent(primary);
						const idleOwner: IdleOwner = {
							current,
							recheck: async () => {
								if (!current()) return false;
								const fresh = await wait(
									ctx.session.context({ sessionID: host }, readOptions),
								);
								if (!current()) return false;
								const exact = attribution.terminal(primary, fresh, terminal.id);
								const selected = await wait(
									ctx.session.get({ sessionID: host }, readOptions),
								);
								return (
									current() &&
									exact?.outcome === "succeeded" &&
									exact.time.created === terminal.time.created &&
									isDeepStrictEqual(nativeInputIDs(fresh), consumed) &&
									selected.id === host &&
									selected.time.idle === terminal.time.created &&
									selected.outcome === "succeeded" &&
									sameDelivery(nativeDelivery(selected), delivery)
								);
							},
						};
						await autoDrive.onIdle(host, idleOwner);
					} catch (error) {
						if (proved && owns(owner)) failOwned(owner);
						throw error;
					} finally {
						scheduled.delete(event.id);
					}
				});
			}
			if (!closed) throw new Error("Flow event stream ended unexpectedly.");
		} catch (error) {
			if (!closed) {
				streamLost = true;
				readController.abort();
				inputs.clear();
				attribution.clear();
				autoDrive.clear();
				recovery.revoke();
				log("error", "Flow event stream failed closed.", {
					message: errorOf(error).message,
				});
			}
		}
	})();
	return {
		verifyTool,
		prompt: synthetic,
		dispose: () => {
			disposal ??= (async () => {
				closed = true;
				controller.abort();
				readController.abort();
				inputs.clear();
				attribution.clear();
				autoDrive.clear();
				recovery.revoke();
				codingModels.clear();
				await subscription;
				await Promise.allSettled([...tasks]);
				const errors: unknown[] = [];
				for (const registration of registrations.reverse()) {
					try {
						await registration.dispose();
					} catch (error) {
						errors.push(error);
					}
				}
				if (errors.length)
					throw new AggregateError(errors, "Flow lifecycle cleanup failed.");
			})();
			return disposal;
		},
	};
}
