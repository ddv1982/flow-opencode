import { isDeepStrictEqual as same } from "node:util";
import type {
	SessionInboxSynthetic,
	SessionInboxUser,
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
import { type InputOrigin, modelInputIDs } from "./execution-attribution.js";

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
type Real = {
	kind: "real";
	reservation: InputReservation;
	prompt: SessionPrompt["prompt"];
	metadata: SessionPrompt["metadata"];
	origin: InputOrigin | null;
	resolving: Promise<InputOrigin> | null;
};
type Alias = Readonly<{
	kind: "alias";
	source: Entry | undefined;
	origin: InputOrigin | null;
}>;
type Entry =
	| Admission
	| Real
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
		if (this.#closed || this.#entries.has(key))
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
	observePrompt(input: SessionPrompt, beforeReserve: () => void): void {
		const prior = this.#entries.get(
			this.#key(input.sessionID, input.messageID),
		);
		if (prior?.kind === "real") {
			if (
				!same(prior.prompt, input.prompt) ||
				!same(prior.metadata, input.metadata)
			)
				throw new Error("Flow duplicate prompt changed its payload.");
			return;
		}
		beforeReserve();
		const reservation = this.reserve(input.sessionID, input.messageID);
		this.#entries.set(this.#key(input.sessionID, input.messageID), {
			kind: "real",
			reservation,
			prompt: structuredClone(input.prompt),
			metadata: structuredClone(input.metadata),
			origin: null,
			resolving: null,
		});
	}
	#covers(entry: Entry | undefined, frontier: InputReservation): boolean {
		return entry?.kind === "alias"
			? this.#covers(entry.source, frontier)
			: entry?.reservation === frontier;
	}
	capture(input: Pick<SessionContext, "sessionID" | "messages">): InputScope {
		this.#options.assertOpen();
		const host = input.sessionID,
			consumed = Object.freeze(modelInputIDs(input)),
			source = consumed.at(-1);
		if (!source)
			throw new Error("Flow primary context has no attributable input.");
		const epoch = this.epoch(host),
			frontier = this.#frontier.get(host);
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
		const current = () =>
			!this.#closed &&
			this.epoch(host) === epoch &&
			this.#frontier.get(host) === frontier;
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
				if (entry?.kind === "private") await scope.wait(entry.ready);
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
	positive(scope: InputScope): InputOrigin | undefined {
		if (!scope.current()) return;
		const entry = this.#scopes.get(scope)?.entry;
		const origin = entry && entry.kind !== "reserved" ? entry.origin : null;
		return origin && this.isLive(origin) ? origin : undefined;
	}
	async evidence(
		scope: InputScope,
		native: readonly SessionMessageInfo[],
		delivery: AutoDriveDelivery,
	): Promise<SourceEvidence> {
		scope.assertCurrent();
		await scope.ready();
		const entry = this.#scopes.get(scope)?.entry;
		if (!entry)
			return {
				kind: "unregistered",
				lineage: this.#history(this.#scopes.get(scope)?.frontierEntry).kind,
			};
		if (entry.kind === "reserved") return { kind: "rejected" };
		if (entry.kind === "alias") {
			if (entry.origin) return this.#classify(entry.origin);
			return this.#history(entry.source);
		}
		const message = native.find((message) => message.id === scope.source);
		if (!message)
			throw new Error("Flow consumed input is missing from native context.");
		if (entry.kind === "private") {
			if (entry.state === "rejected") return { kind: "rejected" };
			if (
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
		if (
			message.type !== "user" ||
			!same(entry.metadata ?? {}, message.metadata ?? {}) ||
			!matchesAdmissionPayload(
				{
					...nativePromptPayload(entry.prompt),
					...(message.metadata === undefined
						? {}
						: { metadata: message.metadata }),
				},
				message,
			)
		)
			throw new Error(
				"Flow context has an unknown, synthetic, or stale real input.",
			);
		if (entry.origin) return this.#classify(entry.origin);
		if (entry.reservation.epoch !== this.epoch(scope.host))
			return { kind: "retired-ordinary" };
		entry.resolving ??= (async () => {
			await this.#options.observeReal(
				scope.host,
				scope.source,
				message.text,
				delivery,
				scope.assertCurrent,
			);
			scope.assertCurrent();
			const origin = this.makeOrigin(
				scope.host,
				scope.source,
				delivery,
				false,
				entry.reservation.epoch,
			);
			entry.origin = origin;
			return origin;
		})();
		return this.#classify(await scope.wait(entry.resolving));
	}
	#history(entry: Entry | undefined): Readonly<{ kind: History }> {
		if (!entry) return { kind: "unknown-history" };
		if (entry.kind === "alias") return this.#history(entry.source);
		if (
			entry.kind === "reserved" ||
			(entry.kind === "private" && entry.state !== "accepted")
		)
			return { kind: "rejected" };
		return {
			kind: entry.origin?.authority ? "retired-automatic" : "retired-ordinary",
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
	checkpoint(scope: InputScope, id: string, origin: InputOrigin | null): void {
		scope.assertCurrent();
		const state = this.#scopes.get(scope);
		if (!state)
			throw new Error("Flow checkpoint has no captured admission scope.");
		const key = this.#key(scope.host, id);
		if (this.#entries.has(key))
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
	clear(): void {
		this.#closed = true;
		for (const state of this.#scopes.values()) state.cancel(revoked());
		this.#scopes.clear();
		this.#entries.clear();
		this.#frontier.clear();
	}
}
function matchesAdmissionPayload(
	expected: Admission["payload"],
	actual: SessionInboxUser["payload"] | SessionInboxSynthetic["payload"],
): boolean {
	if (
		expected.text !== actual.text ||
		!same(expected.metadata ?? {}, actual.metadata ?? {})
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
