import { isDeepStrictEqual as same } from "node:util";
import type {
	OpenCodeEvent,
	SessionInboxSynthetic,
	SessionInboxUser,
	SessionInfo,
	SessionMessageInfo,
	SessionPromptInput,
	SessionSyntheticInput,
} from "@opencode/client";
import type {
	SessionContext,
	SessionPrompt,
} from "@opencode/plugin/promise/session";
import type { AutoDriveAuthority, AutoDriveDelivery } from "./auto-drive.js";
import { nativePromptPayload } from "./command-hook.js";
import {
	type InputOrigin,
	modelInputIDs,
	nativeDelivery,
	nativeInputIDs,
	type Participation,
	sameDelivery,
} from "./execution-attribution.js";

type Payload =
	| Omit<SessionPromptInput, "sessionID" | "id" | "delivery" | "resume">
	| Omit<SessionSyntheticInput, "sessionID" | "id" | "delivery" | "resume">;
type InputReservation = Readonly<{
	host: string;
	id: string;
	epoch: number;
}>;
type Admission = {
	kind: "private";
	reservation: InputReservation;
	type: "user" | "synthetic";
	payload: Payload;
	acceptedPayload?:
		| SessionInboxUser["payload"]
		| SessionInboxSynthetic["payload"];
	ready: Promise<InputOrigin>;
	settle(origin: InputOrigin): void;
	fail(error: Error): void;
	state: "pending" | "accepted" | "rejected";
	origin: InputOrigin | null;
};
type InboxEvent = Extract<
	OpenCodeEvent,
	{
		type:
			| "session.inbox.enqueued"
			| "session.inbox.cancelled"
			| "session.inbox.delivered"
			| "session.inbox.delivery.changed";
	}
>;
type InboxEnqueued = Extract<InboxEvent, { type: "session.inbox.enqueued" }>;
type EnqueuedUserPayload = Extract<
	InboxEnqueued["data"]["item"],
	{ type: "user" }
>["payload"];
type Observation = {
	seq: number;
	generation: number | null;
	item: InboxEnqueued["data"]["item"] | null;
	state: "pending" | "delivered" | "cancelled" | "unseen" | "consumed";
};
type RealState =
	| Readonly<{ kind: "deferred" }>
	| Readonly<{ kind: "immediate"; reservation: InputReservation }>
	| Readonly<{
			kind: "activating";
			token: symbol;
			reservation: InputReservation | null;
	  }>
	| Readonly<{
			kind: "settled";
			reservation: InputReservation | null;
			origin: InputOrigin | null;
			automaticHistory: boolean;
	  }>
	| Readonly<{ kind: "failed" }>;
type Real = {
	kind: "real";
	registration: symbol;
	prompt: SessionPrompt["prompt"];
	metadata: SessionPrompt["metadata"];
	state: RealState;
	observation: Observation | null;
	reuse: { cancelled: number; hook: boolean } | null;
};
type Alias = Readonly<{
	kind: "alias";
	source: Entry | undefined;
	origin: InputOrigin | null;
}>;
type Entry =
	| Admission
	| Real
	| { kind: "observed"; observation: Observation }
	| Alias
	| Readonly<{ kind: "reserved"; reservation: InputReservation }>;
type History =
	| "retired-ordinary"
	| "retired-automatic"
	| "unknown-history"
	| "rejected";
type SourceEvidence =
	| Readonly<{ kind: "unregistered"; lineage: History }>
	| Readonly<{ kind: "live"; origin: InputOrigin }>
	| Readonly<{ kind: History }>;
export type InputScope = Readonly<{
	host: string;
	consumed: readonly string[];
	source: string;
	assertCurrent(): void;
	current(): boolean;
	wait<T>(promise: Promise<T>): Promise<T>;
	ready(): Promise<void>;
	release(): void;
}>;
export type ResolvedSource = Readonly<{
	scope: InputScope;
	evidence: SourceEvidence;
	participation: Participation | null;
	native: readonly SessionMessageInfo[];
	selected: SessionInfo;
}>;
export type SourceOperation = Readonly<{
	token: symbol;
	current(): boolean;
	scope: InputScope;
	resolve(
		native: readonly SessionMessageInfo[],
		selected: SessionInfo,
		effects: Readonly<{
			check(changing: boolean, evidence: SourceEvidence | null): void;
			supersede(): void;
		}>,
	): Promise<ResolvedSource>;
	fail(stillExpected: () => boolean): boolean;
	release(): void;
}>;
type ScopeState = Readonly<{
	entry: Entry | undefined;
	frontierEntry: Entry | undefined;
	cancel(error: Error): void;
}>;
const revoked = () => new Error("Flow execution epoch was revoked.");
type InputAdmissionOptions = Readonly<{
	assertOpen(): void;
	authorityCurrent(authority: AutoDriveAuthority): boolean;
	observeReal(
		host: string,
		id: string,
		text: string,
		delivery: AutoDriveDelivery,
		assertCurrent: () => void,
	): Promise<void>;
	authority(host: string): AutoDriveAuthority | null;
}>;
export class InputAdmissions {
	readonly #entries = new Map<string, Entry>();
	readonly #frontier = new Map<string, InputReservation>();
	readonly #epochs = new Map<string, number>();
	readonly #hosts = new WeakMap<InputOrigin, string>();
	readonly #operations = new Map<symbol, string>();
	readonly #deleted = new Set<string>();
	readonly #scopes = new Map<InputScope, ScopeState>();
	#closed = false;
	readonly #options: InputAdmissionOptions;
	constructor(options: InputAdmissionOptions) {
		this.#options = options;
	}
	#key(host: string, id: string) {
		return JSON.stringify([host, id]);
	}
	epoch(host: string): number {
		return this.#epochs.get(host) ?? 0;
	}
	#cancel(host: string) {
		for (const [scope, state] of this.#scopes)
			if (scope.host === host) state.cancel(revoked());
	}
	invalidate(host: string): void {
		this.#epochs.set(host, this.epoch(host) + 1);
		this.#cancel(host);
	}
	reserve(host: string, id: string): InputReservation {
		this.#options.assertOpen();
		const key = this.#key(host, id);
		if (this.#closed || this.#deleted.has(host) || this.#entries.has(key))
			throw new Error(
				"Flow admission identity is unavailable or already registered.",
			);
		const reservation = Object.freeze({ host, id, epoch: this.epoch(host) });
		this.#frontier.set(host, reservation);
		this.#entries.set(key, { kind: "reserved", reservation });
		this.#cancel(host);
		return reservation;
	}
	assertReservation(reservation: InputReservation): void {
		this.#options.assertOpen();
		if (
			this.#closed ||
			this.epoch(reservation.host) !== reservation.epoch ||
			this.#frontier.get(reservation.host) !== reservation
		)
			throw revoked();
	}
	register(
		reservation: InputReservation,
		input: Readonly<{ type: "user" | "synthetic"; payload: Payload }>,
	): Admission {
		this.assertReservation(reservation);
		const key = this.#key(reservation.host, reservation.id);
		if (this.#entries.get(key)?.kind !== "reserved")
			throw new Error(
				"Flow admission identity is unavailable or already registered.",
			);
		const {
			promise: ready,
			resolve: settle,
			reject: fail,
		} = Promise.withResolvers<InputOrigin>();
		void ready.catch(() => {});
		const admission: Admission = {
			kind: "private",
			reservation,
			...input,
			payload: structuredClone(input.payload),
			ready,
			settle,
			fail,
			state: "pending",
			origin: null,
		};
		this.#entries.set(key, admission);
		return admission;
	}
	async accept(
		admission: Admission,
		receipt: SessionInboxUser | SessionInboxSynthetic,
		activate: () => Promise<InputOrigin>,
	): Promise<void> {
		if (admission.state !== "pending")
			throw new Error("Flow admission was already settled.");
		try {
			this.assertReservation(admission.reservation);
			if (
				receipt.sessionID !== admission.reservation.host ||
				receipt.id !== admission.reservation.id ||
				receipt.type !== admission.type ||
				!matchesAdmissionPayload(admission.payload, receipt.payload)
			)
				throw new Error(
					"Flow admission receipt did not match its exact local payload.",
				);
			admission.acceptedPayload = structuredClone(receipt.payload);
			const origin = await activate();
			this.assertReservation(admission.reservation);
			this.assertLive(origin);
			if (origin.epoch !== admission.reservation.epoch)
				throw new Error("Flow admission epoch changed before acceptance.");
			admission.origin = origin;
			admission.state = "accepted";
			admission.settle(origin);
		} catch (error) {
			this.reject(admission, error);
			throw error;
		}
	}
	reject(admission: Admission, error: unknown): void {
		if (admission.state !== "pending") return;
		admission.state = "rejected";
		admission.fail(error instanceof Error ? error : new Error(String(error)));
	}
	hasPrivate(host: string, id: string): boolean {
		const entry = this.#entries.get(this.#key(host, id));
		return entry?.kind === "private" || entry?.kind === "reserved";
	}
	observePrompt(input: SessionPrompt, immediate: () => void): void {
		this.#options.assertOpen();
		if (this.#deleted.has(input.sessionID)) throw revoked();
		const key = this.#key(input.sessionID, input.messageID),
			prior = this.#entries.get(key);
		if (prior?.kind === "real") {
			if (
				!same(prior.prompt, input.prompt) ||
				!same(prior.metadata, input.metadata)
			)
				throw new Error("Flow duplicate prompt changed its payload.");
			if (prior.reuse && !prior.reuse.hook && prior.state.kind !== "settled") {
				prior.reuse.hook = true;
				prior.registration = Symbol();
			}
			return;
		}
		if (prior && prior.kind !== "observed")
			throw new Error(
				"Flow admission identity is unavailable or already registered.",
			);
		const real: Real = {
			kind: "real",
			registration: Symbol(),
			prompt: structuredClone(input.prompt),
			metadata: structuredClone(input.metadata),
			state: { kind: "deferred" },
			observation: prior?.observation ?? null,
			reuse:
				prior?.observation.state === "cancelled"
					? { cancelled: prior.observation.seq, hook: true }
					: null,
		};
		if (input.delivery === "steer" && !real.reuse) {
			immediate();
			if (prior) this.#entries.delete(key);
			real.state = {
				kind: "immediate",
				reservation: this.reserve(input.sessionID, input.messageID),
			};
		}
		this.#entries.set(key, real);
	}
	observeInbox(
		event: InboxEvent,
		immediate: (host: string) => void,
	): Readonly<{ retryHost: string | null }> {
		const { sessionID: host, inboxID: id } = event.data,
			key = this.#key(host, id);
		if (
			this.#deleted.has(host) ||
			event.durable.aggregateID !== host ||
			event.durable.version !== 1
		)
			return { retryHost: null };
		let entry = this.#entries.get(key);
		if (entry && entry.kind !== "real" && entry.kind !== "observed")
			return { retryHost: null };
		if (
			entry?.kind === "real" &&
			(entry.state.kind === "settled" ||
				entry.state.kind === "failed" ||
				entry.state.kind === "activating")
		)
			return { retryHost: null };
		if (entry?.kind === "observed" && entry.observation.state === "consumed")
			return { retryHost: null };
		const prior = entry?.observation;
		if (prior && event.durable.seq <= prior.seq) return { retryHost: null };
		const observation: Observation = prior ?? {
			seq: 0,
			generation: null,
			item: null,
			state: "unseen",
		};
		observation.seq = event.durable.seq;
		if (!entry) {
			entry = { kind: "observed", observation };
			this.#entries.set(key, entry);
		} else entry.observation = observation;
		if (event.type === "session.inbox.enqueued") {
			observation.generation = event.durable.seq;
			observation.item = structuredClone(event.data.item);
			observation.state = "pending";
		} else if (
			observation.generation !== null &&
			observation.state !== "cancelled"
		) {
			if (event.type === "session.inbox.delivered")
				observation.state = "delivered";
			if (
				event.type === "session.inbox.cancelled" &&
				observation.state === "pending"
			) {
				observation.state = "cancelled";
				if (entry.kind === "real")
					entry.reuse = { cancelled: event.durable.seq, hook: false };
				return { retryHost: host };
			}
			if (event.type === "session.inbox.delivery.changed" && observation.item) {
				observation.item = {
					...observation.item,
					delivery: event.data.delivery,
				};
				if (
					event.data.delivery === "steer" &&
					entry.kind === "real" &&
					entry.state.kind === "deferred" &&
					observation.item.type === "user" &&
					this.#matchesPayload(entry, observation.item.payload) &&
					(!entry.reuse ||
						(entry.reuse.hook &&
							observation.generation > entry.reuse.cancelled))
				) {
					immediate(host);
					const reservation = Object.freeze({
						host,
						id,
						epoch: this.epoch(host),
					});
					this.#frontier.set(host, reservation);
					entry.state = { kind: "immediate", reservation };
					this.#cancel(host);
				}
			}
		}
		return { retryHost: null };
	}
	automaticBlock(host: string): "pending-user" | "input-settlement" | null {
		if ([...this.#operations.values()].includes(host))
			return "input-settlement";
		for (const [key, entry] of this.#entries) {
			if (
				JSON.parse(key)[0] !== host ||
				(entry.kind !== "real" && entry.kind !== "observed")
			)
				continue;
			if (
				entry.kind === "real" &&
				(entry.state.kind === "settled" || entry.state.kind === "failed")
			)
				continue;
			const observation = entry.observation;
			if (
				observation?.item?.type === "user" &&
				(observation.state === "pending" || observation.state === "delivered")
			)
				return "pending-user";
		}
		return null;
	}
	captureBarrier(host: string): Pick<InputScope, "current" | "assertCurrent"> {
		const epoch = this.epoch(host),
			frontier = this.#frontier.get(host);
		const current = () =>
			!this.#closed &&
			!this.#deleted.has(host) &&
			this.epoch(host) === epoch &&
			this.#frontier.get(host) === frontier;
		const assertCurrent = () => {
			this.#options.assertOpen();
			if (!current()) throw revoked();
		};
		return Object.freeze({ current, assertCurrent });
	}
	#covers(entry: Entry | undefined, frontier: InputReservation): boolean {
		return entry?.kind === "alias"
			? this.#covers(entry.source, frontier)
			: entry?.kind === "real"
				? (entry.state.kind === "immediate" ||
						entry.state.kind === "activating" ||
						entry.state.kind === "settled") &&
					entry.state.reservation === frontier
				: entry?.kind !== "observed" && entry?.reservation === frontier;
	}
	#capture(input: Pick<SessionContext, "sessionID" | "messages">): InputScope {
		this.#options.assertOpen();
		const host = input.sessionID,
			consumed = Object.freeze(modelInputIDs(input)),
			source = consumed.at(-1);
		if (!source)
			throw new Error("Flow primary context has no attributable input.");
		const frontier = this.#frontier.get(host);
		if (
			frontier &&
			!consumed.some((id) =>
				this.#covers(this.#entries.get(this.#key(host, id)), frontier),
			)
		)
			throw revoked();
		const entry = this.#entries.get(this.#key(host, source));
		const cancelled = Promise.withResolvers<never>();
		void cancelled.promise.catch(() => {});
		const { current, assertCurrent } = this.captureBarrier(host);
		const scope: InputScope = {
			host,
			consumed,
			source,
			current,
			assertCurrent,
			wait: async (promise) => {
				assertCurrent();
				const result = await Promise.race([promise, cancelled.promise]);
				assertCurrent();
				return result;
			},
			ready: async () => {
				if (entry?.kind === "private" && entry.state !== "rejected")
					await scope.wait(entry.ready);
				assertCurrent();
			},
			release: () => {
				this.#scopes.delete(scope);
			},
		};
		this.#scopes.set(scope, {
			entry,
			frontierEntry: frontier
				? this.#entries.get(this.#key(host, frontier.id))
				: undefined,
			cancel: cancelled.reject,
		});
		return scope;
	}
	#matchesPayload(
		entry: Real,
		payload: SessionInboxUser["payload"] | EnqueuedUserPayload,
	): boolean {
		return (
			same(entry.metadata ?? {}, payload.metadata ?? {}) &&
			matchesAdmissionPayload(nativePromptPayload(entry.prompt), payload, false)
		);
	}
	#matchesReal(entry: Real, message: SessionMessageInfo): boolean {
		return message.type === "user" && this.#matchesPayload(entry, message);
	}
	openSource(
		input: Pick<SessionContext, "sessionID" | "messages" | "agent" | "model">,
	): SourceOperation {
		input = {
			sessionID: input.sessionID,
			agent: input.agent,
			model: { ...input.model },
			messages: structuredClone(input.messages),
		};
		const scope = this.#capture(input),
			token = Symbol(),
			host = scope.host;
		const captured = scope.consumed.map((id) => ({
			id,
			entry: this.#entries.get(this.#key(host, id)),
		}));
		const fresh = captured.filter(
			(item): item is { id: string; entry: Real } =>
				item.entry?.kind === "real" &&
				(item.entry.state.kind === "deferred" ||
					item.entry.state.kind === "immediate"),
		);
		const registrations = fresh.map(({ entry }) => entry.registration);
		if (fresh.length) this.#operations.set(token, host);
		const final = captured.at(-1)?.entry;
		let successor: InputScope | undefined,
			owned = false,
			resolved = false;
		const failClaimed = () => {
			for (const { entry } of fresh)
				if (entry.state.kind === "activating" && entry.state.token === token)
					entry.state = { kind: "failed" };
		};

		const release = () => {
			this.#operations.delete(token);
			scope.release();
			successor?.release();
		};
		return {
			token,
			current: () => (successor ?? scope).current(),
			scope,
			release,
			fail: (stillExpected) => {
				const active = successor ?? scope;
				const origin =
					final?.kind === "private" || final?.kind === "alias"
						? final.origin
						: final?.kind === "real" && final.state.kind === "settled"
							? final.state.origin
							: null;
				if (!fresh.length) owned ||= !!origin && this.isLive(origin);
				if (!owned || !active.current() || !stillExpected()) return false;
				failClaimed();
				this.invalidate(host);
				return true;
			},
			resolve: async (rawNative, rawSelected, effects) => {
				if (resolved)
					throw new Error("Flow source operation was already resolved.");
				resolved = true;
				scope.assertCurrent();
				const native = structuredClone(rawNative),
					selected = structuredClone(rawSelected),
					delivery = nativeDelivery(input);
				if (!same(scope.consumed, nativeInputIDs(native)))
					throw new Error(
						"Flow native inputs differ from the model-visible prefix.",
					);
				if (
					selected.id !== host ||
					!sameDelivery(nativeDelivery(selected), delivery)
				)
					throw new Error(
						final?.kind === "real" ||
							final?.kind === "private" ||
							final?.kind === "alias"
							? "Flow admitted agent or model differs from its primary request."
							: "Flow native selected session agent or model changed.",
					);
				for (const { id, entry } of captured)
					if (
						entry?.kind === "private" &&
						id === scope.source &&
						entry.state === "pending"
					)
						await scope.wait(entry.ready);
				for (const { id, entry } of captured) {
					if (entry?.kind === "real") {
						const message = native.find((message) => message.id === id);
						if (!message || !this.#matchesReal(entry, message))
							throw new Error(
								"Flow context has an unknown, synthetic, or stale real input.",
							);
						if (
							entry.state.kind === "activating" ||
							(entry.state.kind === "failed" && id === scope.source)
						)
							throw revoked();
					}
					if (entry?.kind === "reserved") throw revoked();
					if (entry?.kind === "private") {
						if (entry.state === "accepted" || id === scope.source)
							this.#privateEvidence(entry, id, native);
						else {
							const message = native.find((message) => message.id === id);
							if (
								!message ||
								message.type !== entry.type ||
								(message.type !== "user" && message.type !== "synthetic") ||
								!matchesAdmissionPayload(entry.payload, message)
							)
								throw new Error(
									"Flow native input payload conflicts with its admitted dispatch.",
								);
						}
					}
				}
				for (const [i, item] of fresh.entries()) {
					if (
						this.#entries.get(this.#key(host, item.id)) !== item.entry ||
						registrations[i] !== item.entry.registration
					)
						throw revoked();
					const reuse = item.entry.reuse,
						observation = item.entry.observation;
					if (
						reuse &&
						(!reuse.hook ||
							!observation?.generation ||
							observation.generation <= reuse.cancelled ||
							observation.state === "cancelled" ||
							observation.item?.type !== "user" ||
							!this.#matchesPayload(item.entry, observation.item.payload))
					)
						throw new Error(
							"Flow cancelled input reuse has no matching new hook and enqueue.",
						);
				}
				const changing = fresh.at(-1)?.entry.state.kind === "deferred";
				const firstNew = captured.findIndex((item) =>
					fresh.some((f) => f.entry === item.entry),
				);
				if (
					fresh.length > 0 &&
					captured
						.slice(firstNew)
						.some(
							(item) =>
								item.entry?.kind === "private" ||
								item.entry?.kind === "reserved",
						)
				)
					throw new Error(
						"Flow mixed input batch cannot rebase a private admission.",
					);
				const finalEntry = captured.at(-1)?.entry;
				const finalFresh = fresh.some((item) => item.id === scope.source);
				if (
					finalFresh &&
					finalEntry?.kind === "real" &&
					finalEntry.state.kind === "immediate" &&
					(finalEntry.state.reservation.epoch !== this.epoch(host) ||
						this.#frontier.get(host) !== finalEntry.state.reservation)
				)
					throw revoked();
				const preparedEvidence = finalFresh
					? null
					: this.#evidence(scope, native);
				if (
					preparedEvidence?.kind === "live" &&
					!sameDelivery(preparedEvidence.origin.delivery, delivery)
				)
					throw new Error(
						"Flow admitted agent or model differs from its primary request.",
					);
				effects.check(changing, preparedEvidence);
				scope.assertCurrent();
				if (changing) {
					this.invalidate(host);
					const last = fresh.at(-1);
					if (!last) throw revoked();
					const reservation = Object.freeze({
						host,
						id: last.id,
						epoch: this.epoch(host),
					});
					this.#frontier.set(host, reservation);
					last.entry.state = { kind: "immediate", reservation };
					effects.supersede();
				}
				successor = this.#capture(input);
				owned ||= fresh.length > 0;
				const frontier = this.#frontier.get(host);
				for (const { id, entry } of fresh)
					entry.state = {
						kind: "activating",
						token,
						reservation: frontier?.id === id ? frontier : null,
					};
				for (const { id, entry } of fresh) {
					try {
						successor.assertCurrent();
						const message = native.find((message) => message.id === id);
						if (message?.type !== "user") throw revoked();
						await successor.wait(
							this.#options.observeReal(
								host,
								id,
								message.text,
								delivery,
								successor.assertCurrent,
							),
						);
						successor.assertCurrent();
						const authority = this.#options.authority(host);
						const origin =
							id === scope.source
								? this.makeOrigin(host, id, delivery, false, this.epoch(host))
								: null;
						entry.state = {
							kind: "settled",
							reservation: frontier?.id === id ? frontier : null,
							origin,
							automaticHistory: authority !== null,
						};
					} catch (error) {
						failClaimed();
						throw error;
					}
				}
				successor.assertCurrent();
				for (const { entry } of captured)
					if (entry?.kind === "observed") entry.observation.state = "consumed";
				const evidence = this.#evidence(successor, native);
				if (
					evidence.kind === "live" &&
					!sameDelivery(evidence.origin.delivery, delivery)
				)
					throw new Error(
						"Flow admitted agent or model differs from its primary request.",
					);
				const source = native.find((message) => message.id === scope.source);
				const participation: Participation | null =
					evidence.kind === "live"
						? { kind: "flow", origin: evidence.origin }
						: (source?.type === "user" || source?.type === "synthetic") &&
								(evidence.kind === "retired-ordinary" ||
									(evidence.kind === "unregistered" &&
										evidence.lineage !== "rejected"))
							? { kind: "native-only" }
							: null;
				owned ||= evidence.kind === "live";
				return { scope: successor, evidence, participation, native, selected };
			},
		};
	}
	#privateEvidence(
		entry: Admission,
		id: string,
		native: readonly SessionMessageInfo[],
	): SourceEvidence {
		if (entry.state === "rejected") return { kind: "rejected" };
		const message = native.find((message) => message.id === id);
		if (
			!message ||
			message.type !== entry.type ||
			(message.type !== "user" && message.type !== "synthetic")
		)
			throw new Error(
				"Flow native input type conflicts with its admitted dispatch.",
			);
		const { id: _id, time: _time, type: _type, ...payload } = message;
		if (!same(payload, entry.acceptedPayload))
			throw new Error(
				"Flow native input payload conflicts with its admitted dispatch.",
			);
		if (!entry.origin)
			throw new Error("Flow admitted input has no settled origin.");
		return this.#classify(entry.origin);
	}
	#evidence(
		scope: InputScope,
		native: readonly SessionMessageInfo[],
	): SourceEvidence {
		const state = this.#scopes.get(scope),
			entry = state?.entry;
		if (!entry || entry.kind === "observed")
			return {
				kind: "unregistered",
				lineage: this.#history(state?.frontierEntry).kind,
			};
		if (entry.kind === "reserved") return { kind: "rejected" };
		if (entry.kind === "alias")
			return entry.origin
				? this.#classify(entry.origin)
				: this.#history(entry.source);
		if (entry.kind === "private")
			return this.#privateEvidence(entry, scope.source, native);
		return entry.state.kind === "settled" && entry.state.origin
			? this.#classify(entry.state.origin)
			: this.#history(entry);
	}
	#history(entry: Entry | undefined): Readonly<{ kind: History }> {
		if (!entry || entry.kind === "observed") return { kind: "unknown-history" };
		if (entry.kind === "alias") return this.#history(entry.source);
		if (
			entry.kind === "reserved" ||
			(entry.kind === "real" && entry.state.kind === "failed") ||
			(entry.kind === "private" && entry.state !== "accepted")
		)
			return { kind: "rejected" };
		return {
			kind: (
				entry.kind === "real"
					? entry.state.kind === "settled" && entry.state.automaticHistory
					: entry.origin?.authority
			)
				? "retired-automatic"
				: "retired-ordinary",
		};
	}
	#classify(origin: InputOrigin): SourceEvidence {
		return this.isLive(origin)
			? { kind: "live", origin }
			: { kind: origin.authority ? "retired-automatic" : "retired-ordinary" };
	}
	makeOrigin(
		host: string,
		id: string,
		delivery: AutoDriveDelivery,
		automatic: boolean,
		epoch: number,
	): InputOrigin {
		const identity = {
			id,
			epoch,
			delivery: Object.freeze({
				...delivery,
				model: Object.freeze({ ...delivery.model }),
			}),
		};
		const authority = this.#options.authority(host);
		let origin: InputOrigin;
		if (automatic) {
			if (!authority)
				throw new Error(
					"Flow automatic input lost its live admitted authority.",
				);
			origin = Object.freeze({ ...identity, automatic: true, authority });
		} else origin = Object.freeze({ ...identity, automatic: false, authority });
		this.#hosts.set(origin, host);
		this.assertLive(origin);
		return origin;
	}
	assertCheckpointAvailable(host: string, id: string): () => boolean {
		const key = this.#key(host, id),
			entry = this.#entries.get(key);
		if (!entry) return () => true;
		if (
			entry.kind !== "observed" ||
			(entry.observation.item && entry.observation.item.type !== "compaction")
		)
			throw new Error("Flow checkpoint identity conflicts with an input.");
		const generation = entry.observation.generation;
		return () =>
			this.#entries.get(key) === entry &&
			entry.observation.generation === generation;
	}
	checkpoint(
		scope: InputScope,
		id: string,
		origin: InputOrigin | null,
		matchesTransfer?: () => boolean,
	): void {
		scope.assertCurrent();
		const state = this.#scopes.get(scope);
		if (!state)
			throw new Error("Flow checkpoint has no captured admission scope.");
		const key = this.#key(scope.host, id);
		this.assertCheckpointAvailable(scope.host, id);
		if (matchesTransfer && !matchesTransfer())
			throw new Error("Flow checkpoint identity conflicts with an input.");
		if (origin) this.#hosts.set(origin, scope.host);
		this.#entries.set(key, {
			kind: "alias",
			source: state.entry ?? state.frontierEntry,
			origin,
		});
	}
	isLive(origin: InputOrigin): boolean {
		const host = this.#hosts.get(origin);
		if (this.#closed || host === undefined || this.epoch(host) !== origin.epoch)
			return false;
		const frontier = this.#frontier.get(host);
		return (
			(!frontier ||
				this.#covers(
					this.#entries.get(this.#key(host, origin.id)),
					frontier,
				)) &&
			(!origin.authority || this.#options.authorityCurrent(origin.authority))
		);
	}
	assertLive(origin: InputOrigin): void {
		this.#options.assertOpen();
		if (!this.isLive(origin)) throw revoked();
	}
	deleteHost(host: string): void {
		this.#deleted.add(host);
		this.#cancel(host);
		this.#frontier.delete(host);
		for (const key of this.#entries.keys())
			if (JSON.parse(key)[0] === host) this.#entries.delete(key);
		for (const [scope] of this.#scopes)
			if (scope.host === host) this.#scopes.delete(scope);
		for (const [token, operationHost] of this.#operations)
			if (operationHost === host) this.#operations.delete(token);
	}
	clear(): void {
		this.#closed = true;
		for (const state of this.#scopes.values()) state.cancel(revoked());
		this.#scopes.clear();
		this.#entries.clear();
		this.#frontier.clear();
		this.#operations.clear();
	}
}
function matchesAdmissionPayload(
	expected: Admission["payload"],
	actual:
		| SessionInboxUser["payload"]
		| SessionInboxSynthetic["payload"]
		| EnqueuedUserPayload,
	checkMetadata = true,
): boolean {
	if (
		expected.text !== actual.text ||
		(checkMetadata && !same(expected.metadata ?? {}, actual.metadata ?? {}))
	)
		return false;
	if ("description" in expected || "description" in actual)
		return (
			("description" in expected ? expected.description : undefined) ===
			("description" in actual ? actual.description : undefined)
		);
	const files = "files" in expected ? (expected.files ?? []) : [];
	const nativeFiles = "files" in actual ? (actual.files ?? []) : [];
	if (
		files.length !== nativeFiles.length ||
		files.some((file, i) => {
			const native = nativeFiles[i];
			if (
				!native ||
				file.name !== native.name ||
				file.description !== native.description ||
				!same(file.mention, native.mention)
			)
				return true;
			if (native.source.type === "uri") return native.source.uri !== file.uri;
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(file.uri);
			return !match || match[1] !== native.mime || match[2] !== native.data;
		})
	)
		return false;
	const agents = "agents" in expected ? (expected.agents ?? []) : [];
	const nativeAgents = "agents" in actual ? (actual.agents ?? []) : [];
	if (!same(agents, nativeAgents)) return false;
	const skills = "skills" in expected ? (expected.skills ?? []) : [];
	const nativeSkills = "skills" in actual ? (actual.skills ?? []) : [];
	return (
		skills.length === nativeSkills.length &&
		skills.every(
			(skill, i) =>
				skill.id === nativeSkills[i]?.id &&
				same(skill.mention, nativeSkills[i]?.mention),
		)
	);
}
