import { isDeepStrictEqual as same } from "node:util";
import type {
	SessionInboxSynthetic,
	SessionInboxUser,
	SessionInfo,
	SessionMessageInfo,
} from "@opencode/client";
import type {
	SessionContext,
	SessionPrompt,
} from "@opencode/plugin/promise/session";
import type { AutoDriveAuthority, AutoDriveDelivery } from "./auto-drive.js";
import {
	type InputOrigin,
	modelInputIDs,
	nativeDelivery,
	nativeInputIDs,
	type Participation,
	sameDelivery,
} from "./execution-attribution.js";

import {
	type Admission,
	checkConsumed,
	checkReceipt,
	type Entry,
	type FailureFact,
	facts,
	type InboxEvent,
	type InputReservation,
	matchesReal,
	type Observation,
	type Payload,
	type Real,
	type SourceEvidence,
	terminalize,
} from "./input-evidence.js";

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
	gate:
		| Readonly<{ kind: "covered"; failure: FailureFact | null }>
		| Readonly<{ kind: "inspection"; failure: FailureFact }>;
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
	#cancel(host: string, source?: string) {
		for (const [scope, state] of this.#scopes)
			if (
				scope.host === host &&
				(source === undefined || (scope.source === source && !scope.current()))
			)
				state.cancel(revoked());
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
			phase: { state: "pending" },
		};
		this.#entries.set(key, admission);
		return admission;
	}
	async accept(
		admission: Admission,
		receipt: SessionInboxUser | SessionInboxSynthetic,
		activate: () => Promise<InputOrigin>,
	): Promise<void> {
		if (admission.phase.state !== "pending")
			throw new Error("Flow admission was already settled.");
		try {
			this.assertReservation(admission.reservation);
			checkReceipt(admission, receipt);
			const acceptedPayload = structuredClone(receipt.payload);
			const pending: Extract<Admission["phase"], { state: "pending" }> = {
				state: "pending",
				acceptedPayload,
			};
			admission.phase = pending;
			const origin = await activate();
			this.assertReservation(admission.reservation);
			this.assertLive(origin);
			if (origin.epoch !== admission.reservation.epoch)
				throw new Error("Flow admission epoch changed before acceptance.");
			if (admission.phase !== pending) throw revoked();
			admission.phase = {
				state: "accepted",
				acceptedPayload,
				origin,
				failure: null,
			};
			admission.settle(origin);
		} catch (error) {
			this.#reject(admission, error);
			throw error;
		}
	}
	#reject(admission: Admission, error: unknown): void {
		if (admission.phase.state !== "pending") return;
		const next = terminalize(admission, {
			kind: "reservation",
			reservation: admission.reservation,
		});
		if (next?.kind !== "private") return;
		admission.phase = next.phase;
		if (next.reject)
			admission.fail(error instanceof Error ? error : new Error(String(error)));
	}
	finishReservation(reservation: InputReservation, error: unknown): boolean {
		const key = this.#key(reservation.host, reservation.id),
			entry = this.#entries.get(key);
		if (!entry) return false;
		const next = terminalize(entry, { kind: "reservation", reservation });
		if (!next) return false;
		if (next.kind === "reserved") this.#entries.set(key, next.next);
		if (next.kind === "private" && entry.kind === "private") {
			entry.phase = next.phase;
			if (next.reject)
				entry.fail(error instanceof Error ? error : new Error(String(error)));
		}
		if (
			this.#closed ||
			this.#deleted.has(reservation.host) ||
			this.#frontier.get(reservation.host) !== reservation ||
			this.epoch(reservation.host) !== reservation.epoch
		)
			return false;
		this.invalidate(reservation.host);
		return true;
	}
	hasPrivate(host: string, id: string): boolean {
		const entry = this.#entries.get(this.#key(host, id));
		return (
			entry?.kind === "private" ||
			entry?.kind === "reserved" ||
			entry?.kind === "failed-reservation"
		);
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
				this.#cancel(input.sessionID, input.messageID);
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
		this.#cancel(input.sessionID, input.messageID);
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
			this.#cancel(host, id);
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
					matchesReal(entry, observation.item.payload) &&
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
	#capture(input: Pick<SessionContext, "sessionID" | "messages">): InputScope {
		this.#options.assertOpen();
		const host = input.sessionID,
			consumed = Object.freeze(modelInputIDs(input)),
			source = consumed.at(-1);
		if (!source)
			throw new Error("Flow primary context has no attributable input.");
		const frontier = this.#frontier.get(host),
			frontierEntry = frontier
				? this.#entries.get(this.#key(host, frontier.id))
				: undefined,
			entry = this.#entries.get(this.#key(host, source)),
			failure = facts(frontierEntry).failure;
		const terminal =
			failure?.reservation === frontier &&
			source !== frontier?.id &&
			(!entry ||
				entry.kind === "observed" ||
				(entry.kind === "real" && entry.state.kind === "deferred"))
				? failure
				: null;
		const covered =
			!frontier ||
			consumed.some(
				(id) =>
					facts(this.#entries.get(this.#key(host, id))).coverage === frontier,
			);
		let gate: ScopeState["gate"];
		if (covered) gate = { kind: "covered", failure: terminal };
		else if (terminal) gate = { kind: "inspection", failure: terminal };
		else throw revoked();
		const cancelled = Promise.withResolvers<never>();
		void cancelled.promise.catch(() => {});
		const barrier = this.captureBarrier(host),
			registration = entry?.kind === "real" ? entry.registration : undefined;
		const current = () =>
			barrier.current() &&
			(!terminal ||
				(facts(this.#entries.get(this.#key(host, terminal.reservation.id)))
					.failure === terminal &&
					this.#entries.get(this.#key(host, source)) === entry &&
					(entry?.kind !== "real" || entry.registration === registration)));
		const assertCurrent = () => {
			this.#options.assertOpen();
			if (!current()) throw revoked();
		};
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
				if (entry?.kind === "private" && entry.phase.state !== "rejected")
					await scope.wait(entry.ready);
				assertCurrent();
			},
			release: () => {
				this.#scopes.delete(scope);
			},
		};
		this.#scopes.set(scope, {
			entry,
			frontierEntry,
			gate,
			cancel: cancelled.reject,
		});
		return scope;
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
		const capturedState = this.#scopes.get(scope);
		let claimed: InputReservation | undefined;
		let successor: InputScope | undefined,
			owned = false,
			resolved = false;
		const failClaimed = () => {
			for (const { entry } of fresh) {
				const next = terminalize(entry, { kind: "claim", token });
				if (next?.kind === "real") entry.state = next.state;
			}
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
					final?.kind === "private" && final.phase.state === "accepted"
						? final.phase.origin
						: final?.kind === "alias"
							? final.origin
							: final?.kind === "real" && final.state.kind === "settled"
								? final.state.origin
								: null;
				if (!fresh.length) owned ||= !!origin && this.isLive(origin);
				failClaimed();
				if (
					!owned ||
					!active.current() ||
					!stillExpected() ||
					(fresh.length > 0 &&
						(this.#operations.get(token) !== host ||
							!claimed ||
							this.#frontier.get(host) !== claimed ||
							this.epoch(host) !== claimed.epoch))
				)
					return false;
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
						entry.phase.state === "pending"
					)
						await scope.wait(entry.ready);
				for (const { id, entry } of captured)
					if (entry)
						checkConsumed(entry, id, native, id === scope.source, (origin) =>
							this.#classify(origin),
						);
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
							!matchesReal(item.entry, observation.item.payload))
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
				const terminal = capturedState?.gate.failure;
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
				if (fresh.length) claimed = frontier;
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
										(evidence.lineage !== "rejected" || !!terminal)))
							? { kind: "native-only" }
							: null;
				owned ||= evidence.kind === "live";
				return { scope: successor, evidence, participation, native, selected };
			},
		};
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
				lineage: facts(state?.frontierEntry).history,
			};
		return checkConsumed(entry, scope.source, native, true, (origin) =>
			this.#classify(origin),
		);
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
		this.#cancel(scope.host, id);
	}
	isLive(origin: InputOrigin): boolean {
		const host = this.#hosts.get(origin);
		if (this.#closed || host === undefined || this.epoch(host) !== origin.epoch)
			return false;
		const frontier = this.#frontier.get(host);
		return (
			(!frontier ||
				facts(this.#entries.get(this.#key(host, origin.id))).coverage ===
					frontier) &&
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
