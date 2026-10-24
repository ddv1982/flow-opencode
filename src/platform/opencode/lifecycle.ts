import { isDeepStrictEqual } from "node:util";
import type { SessionMessageInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/promise/plugin";
import type { Registration } from "@opencode/plugin/promise/registration";
import type { SessionContext } from "@opencode/plugin/promise/session";
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
	type Participation,
	rememberCodingModel,
	sameDelivery,
} from "./execution-attribution.js";
import { InputAdmissions, type InputScope } from "./input-admission.js";
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
	): Promise<void>;
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
	const contextPending = new Map<string, InputScope>();
	const controller = new AbortController();
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
	const revoke = (
		host: string,
		deactivate = true,
		captured = attribution.current(host) ?? null,
	) => {
		if (captured) attribution.end(captured);
		inputs.invalidate(host);
		autoDrive.revokeExecutions(host);
		recovery.invalidateOrigins(host);
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
	) => {
		try {
			inputs.assertReservation(reservation);
		} catch {
			return;
		}
		failOwned(owner);
	};
	const makeOrigin = (...args: Parameters<InputAdmissions["makeOrigin"]>) =>
		inputs.makeOrigin(...args);
	const observeAccepted = async (
		host: string,
		id: string,
		text: string,
		delivery: AutoDriveDelivery,
		metadata: Readonly<Record<string, unknown>> | null,
		synthetic: boolean,
		assertCurrent: () => void,
	) => {
		assertCurrent();
		const parts = metadata
			? [{ type: "text", text, synthetic: true, metadata }]
			: [{ type: "text", text }];
		const result = await autoDrive.observeMessage(host, delivery, parts, id);
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
				ctx.session.context({ sessionID: execution.sessionID }),
				ctx.session.get({ sessionID: execution.sessionID }),
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
	) => {
		assertOpen();
		const token = metadata[FLOW_AUTO_METADATA_KEY];
		if (typeof token !== "string" || !autoDrive.captureAuthority(host, token))
			throw new Error(
				"Flow synthetic dispatch has no live authenticated token.",
			);
		if (Object.keys(metadata).some((key) => key !== FLOW_AUTO_METADATA_KEY))
			throw new Error("Flow synthetic metadata has unknown fields.");
		const id = SessionMessage.ID.create();
		const reservation = inputs.reserve(host, id);
		const expectedEpoch = reservation.epoch;
		const owner = captureOwner(
			host,
			"admission",
			attribution.current(host),
			expectedEpoch,
		);
		const authority = autoDrive.captureAuthority(host, token);
		if (!authority) throw new Error("Flow synthetic authority expired.");
		const assertCurrent = () => {
			inputs.assertReservation(reservation);
			if (
				epoch(host) !== expectedEpoch ||
				!autoDrive.isAuthorityCurrent(authority)
			)
				throw new Error("Flow synthetic dispatch was superseded.");
		};
		const selected = await ctx.session
			.get({ sessionID: host })
			.then(nativeDelivery)
			.catch((error: unknown) => {
				failReservation(reservation, owner);
				throw error;
			});
		assertCurrent();
		if (!sameDelivery(delivery, selected))
			throw new Error(
				"Flow queued continuation cannot change the user's selected agent or model.",
			);
		const payload = { text, metadata: { [FLOW_AUTO_METADATA_KEY]: token } };
		const admission = inputs.register(reservation, {
			type: "synthetic",
			payload,
		});
		try {
			assertCurrent();
			const receipt = await ctx.session.synthetic(
				{ sessionID: host, id, ...payload, delivery: "queue", resume: true },
				{ signal: controller.signal },
			);
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
				);
				assertCurrent();
				return makeOrigin(host, id, delivery, true, expectedEpoch);
			});
		} catch (error) {
			inputs.reject(admission, error);
			failReservation(reservation, owner);
			throw error;
		}
	};
	const sourceFailure = (
		scope: InputScope,
		primary?: ReturnType<ExecutionAttribution["current"]>,
	) => {
		const origin = inputs.positive(scope);
		if (origin)
			failOwned(
				captureOwner(
					scope.host,
					"admission",
					primary,
					origin.epoch,
					origin,
					origin.id,
				),
			);
	};
	const compactions = new CompactionBoundary({
		inputs,
		readNative: (host) => ctx.session.context({ sessionID: host }),
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
	const resolveParticipation = async (
		input: SessionContext,
		native: readonly SessionMessageInfo[],
		scope: InputScope,
	): Promise<Participation> => {
		const completed = compactions.completed(input, native);
		if (completed) return { kind: "flow", origin: completed };
		const evidence = await inputs.evidence(
			scope,
			native,
			nativeDelivery(input),
		);
		if (evidence.kind === "live") {
			assertLive(evidence.origin);
			return { kind: "flow", origin: evidence.origin };
		}
		const source = native.find((message) => message.id === scope.source);
		if (
			(source?.type === "user" || source?.type === "synthetic") &&
			(evidence.kind === "retired-ordinary" ||
				(evidence.kind === "unregistered" && evidence.lineage !== "rejected"))
		)
			return { kind: "native-only" };
		throw new Error(
			"Flow context has an unknown, synthetic, or stale real input.",
		);
	};
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
								if (epoch(input.sessionID) !== expectedEpoch)
									throw new Error("Flow command was superseded.");
							};
							const session = await ctx.session
								.get({ sessionID: input.sessionID })
								.catch((error: unknown) => {
									failReservation(reservation, owner);
									throw error;
								});
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
								...nativePromptPayload({ ...input.prompt, text: command.text }),
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
							try {
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
									return makeOrigin(
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
								inputs.reject(admission, error);
								failReservation(reservation, owner);
								throw error;
							}
						},
					});
				}
			}),
		);
		registrations.push(
			await ctx.session.hook("context", async (input) => {
				assertOpen();
				const scope = inputs.capture(input);
				const pending = contextPending.get(input.sessionID);
				if (pending?.current()) {
					sourceFailure(scope);
					scope.release();
					throw new Error("Flow primary context callbacks overlap.");
				}
				contextPending.set(input.sessionID, scope);
				const prior = attribution.current(input.sessionID);
				let frozen: ReturnType<ExecutionAttribution["freeze"]> | undefined;
				try {
					await scope.ready();
					const native = await scope.wait(
						ctx.session.context({ sessionID: input.sessionID }),
					);
					if (
						prior &&
						attribution.isCurrent(prior) &&
						prior.http.phase !== "ended" &&
						!attribution.retry(prior, native)
					)
						throw new Error("Flow primary contexts or streams overlap.");
					if (!isDeepStrictEqual(scope.consumed, nativeInputIDs(native)))
						throw new Error(
							"Flow native inputs differ from the model-visible prefix.",
						);
					const participation = await resolveParticipation(
						input,
						native,
						scope,
					);
					scope.assertCurrent();
					const session = await scope.wait(
						ctx.session.get({ sessionID: input.sessionID }),
					);
					if (
						participation.kind === "native-only" &&
						(session.id !== input.sessionID ||
							!sameDelivery(nativeDelivery(session), nativeDelivery(input)))
					)
						throw new Error(
							"Flow native selected session agent or model changed.",
						);
					scope.assertCurrent();
					frozen = attribution.freeze(input, native, participation, scope);
					attribution.assertCurrent(frozen);
					rememberCodingModel(codingModels, input, session, specialists);
				} catch (error) {
					if (frozen)
						failOwned(captureOwner(input.sessionID, "attempt", frozen));
					else sourceFailure(scope, prior);
					throw error;
				} finally {
					if (contextPending.get(input.sessionID) === scope)
						contextPending.delete(input.sessionID);
					scope.release();
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
	const subscription = (async () => {
		try {
			for await (const event of ctx.event.subscribe({
				signal: controller.signal,
			})) {
				if (closed) break;
				if (event.type === "session.deleted") {
					if (outcomes.has(event.id)) continue;
					outcomes.add(event.id);
					const host = event.data.sessionID;
					revoke(host);
					attribution.deleteSession(host);
					codingModels.delete(host);
					continue;
				}
				if (
					event.type !== "session.execution.failed" &&
					event.type !== "session.execution.interrupted" &&
					event.type !== "session.execution.succeeded" &&
					event.type !== "session.idle"
				)
					continue;
				if (outcomes.has(event.id)) continue;
				const host = event.data.sessionID;
				const primary = attribution.current(host);
				if (!primary) continue;
				const owner = captureOwner(host, "attempt", primary);
				let proved = false;
				try {
					const native = await ctx.session.context({ sessionID: host });
					if (!owns(owner)) continue;
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
						continue;
					proved = true;
					outcomes.add(event.id);
					if (primary.participation.kind === "native-only") {
						attribution.retire(primary);
						continue;
					}
					if (terminal.outcome !== "succeeded") {
						options.onFlowTerminal?.(host);
						failOwned(owner);
						continue;
					}
					const session = await ctx.session.get({ sessionID: host });
					if (!owns(owner)) continue;
					if (session.id !== host)
						throw new Error("Flow native terminal session identity changed.");
					if (session.time.idle === undefined || session.outcome === undefined)
						continue;
					if (
						session.outcome !== terminal.outcome ||
						session.time.idle !== terminal.time.created
					)
						continue;
					const watermark = String(session.time.idle);
					if (idle.get(host) === watermark) continue;
					idle.set(host, watermark);
					options.onFlowTerminal?.(host);
					if (!runtimeGuard.query().operational) {
						failOwned(owner);
						continue;
					}
					await autoDrive.onIdle(host);
				} catch (error) {
					if (proved && owns(owner)) failOwned(owner);
					log("warn", "Flow terminal observation failed.", {
						host,
						message: errorOf(error).message,
					});
				}
			}
			if (!closed) throw new Error("Flow event stream ended unexpectedly.");
		} catch (error) {
			if (!closed) {
				streamLost = true;
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
				inputs.clear();
				attribution.clear();
				autoDrive.clear();
				recovery.revoke();
				codingModels.clear();
				await subscription;
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
