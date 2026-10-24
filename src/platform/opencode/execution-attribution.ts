import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import type {
	SessionContext,
	SessionHttpRequest,
	SessionHttpResponse,
} from "@opencode/plugin/promise/session";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import type { FlowCodingModel } from "../../config-shared.js";
import type { AutoDriveAuthority, AutoDriveDelivery } from "./auto-drive.js";

export type NativeExecution = Pick<
	ToolContext,
	"sessionID" | "messageID" | "agent" | "id"
>;
export type InputOrigin = Readonly<{
	id: string;
	epoch: number;
	delivery: AutoDriveDelivery;
}> &
	(
		| Readonly<{ automatic: true; authority: AutoDriveAuthority }>
		| Readonly<{ automatic: false; authority: AutoDriveAuthority | null }>
	);

export type Participation =
	| Readonly<{ kind: "flow"; origin: InputOrigin }>
	| Readonly<{ kind: "native-only" }>;
type InputClock = Readonly<{ current(): boolean; assertCurrent(): void }>;

type Snapshot = Readonly<{
	clock: InputClock;
	inputs: readonly string[];
	previousAssistants: ReadonlySet<string>;
	previousTerminals: ReadonlySet<string>;
	previousRetries: ReadonlySet<string>;
}>;
type HttpResource =
	| Readonly<{ phase: "context"; requestSeen: false }>
	| Readonly<{ phase: "ended"; requestSeen: false }>
	| Readonly<{
			phase: "request" | "streaming" | "ended";
			requestSeen: true;
	  }>;
type Lifetime =
	| Readonly<{ kind: "current"; snapshot: Snapshot }>
	| Readonly<{ kind: "retired" }>;
type PrimaryOwner = {
	readonly sessionID: string;
	readonly agent: string;
	readonly model: SessionContext["model"];
	readonly participation: Participation;
	http: HttpResource;
	lifetime: Lifetime;
};
type Binding = Readonly<{ primary: PrimaryOwner; tool: string }>;
type AssistantRecord =
	| Readonly<{ kind: "bound"; primary: PrimaryOwner }>
	| Readonly<{ kind: "historical" }>;
type SessionRecord = {
	current: PrimaryOwner;
	assistants: Map<string, AssistantRecord>;
	bindings: Map<string, Binding>;
};
const retired: Lifetime = Object.freeze({ kind: "retired" });
const historical: AssistantRecord = Object.freeze({ kind: "historical" });
const same = isDeepStrictEqual;
function retryIdentity(
	message: Extract<SessionMessageInfo, { type: "assistant" }>,
): string {
	return JSON.stringify([
		message.id,
		message.retry?.attempt,
		message.retry?.at,
	]);
}
function sameModel(
	left: Readonly<{
		providerID: string;
		id: string;
		variant?: string | undefined;
	}>,
	right: Readonly<{
		providerID: string;
		id: string;
		variant?: string | undefined;
	}>,
): boolean {
	return (
		left.providerID === right.providerID &&
		left.id === right.id &&
		left.variant === right.variant
	);
}
export function nativeInputIDs(
	messages: readonly SessionMessageInfo[],
): string[] {
	return messages
		.filter(
			(message) =>
				message.type === "user" ||
				message.type === "synthetic" ||
				(message.type === "compaction" && message.status === "completed"),
		)
		.map((message) => message.id);
}
export function modelInputIDs(
	input: Pick<SessionContext, "messages">,
): string[] {
	return input.messages
		.filter((message) => message.role === "user")
		.map((message) => {
			if (!message.id)
				throw new Error("Flow model context omitted durable input identity.");
			return message.id;
		});
}
export function nativeDelivery(
	session: Readonly<{
		agent?: string | undefined;
		model?:
			| Readonly<{
					providerID: string;
					id: string;
					variant?: string | undefined;
			  }>
			| undefined;
	}>,
): AutoDriveDelivery {
	if (!session.agent || !session.model)
		throw new Error("Flow requires the native selected agent and model.");
	return {
		agent: session.agent,
		model: { providerID: session.model.providerID, modelID: session.model.id },
		...(session.model.variant === undefined
			? {}
			: { variant: session.model.variant }),
	};
}
export function sameDelivery(
	left: AutoDriveDelivery,
	right: AutoDriveDelivery,
): boolean {
	return (
		left.agent === right.agent &&
		left.model.providerID === right.model.providerID &&
		left.model.modelID === right.model.modelID &&
		left.variant === right.variant
	);
}
function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
export class ExecutionAttribution {
	readonly #sessions = new Map<string, SessionRecord | null>();
	readonly #requests = new WeakMap<Request, PrimaryOwner>();
	readonly #retries = new WeakSet<PrimaryOwner>();
	readonly #assertLive: (origin: InputOrigin) => void;
	#closed = false;
	constructor(assertLive: (origin: InputOrigin) => void) {
		this.#assertLive = assertLive;
	}
	#session(sessionID: string): SessionRecord | undefined {
		const record = this.#sessions.get(sessionID);
		if (record === null) throw new Error("Flow execution session was deleted.");
		return record;
	}
	#evidence(primary: PrimaryOwner): Snapshot {
		if (
			this.current(primary.sessionID) !== primary ||
			primary.lifetime.kind !== "current"
		)
			throw new Error("Flow primary ownership was superseded.");
		return primary.lifetime.snapshot;
	}
	assertCurrent(primary: PrimaryOwner): void {
		const snapshot = this.#evidence(primary);
		snapshot.clock.assertCurrent();
		if (primary.participation.kind === "flow")
			this.#assertLive(primary.participation.origin);
	}
	isCurrent(primary: PrimaryOwner): boolean {
		return (
			!this.#closed &&
			this.current(primary.sessionID) === primary &&
			primary.lifetime.kind === "current" &&
			primary.lifetime.snapshot.clock.current()
		);
	}
	requestOwner(request: Request): PrimaryOwner | undefined {
		return this.#requests.get(request);
	}
	executionOwner(execution: NativeExecution): PrimaryOwner | undefined {
		const record = this.#session(execution.sessionID);
		if (!record) return undefined;
		const binding = record.bindings.get(
			JSON.stringify([execution.messageID, execution.id]),
		);
		if (binding) return binding.primary;
		const assistant = record.assistants.get(execution.messageID);
		if (assistant?.kind === "bound") return assistant.primary;
		if (assistant?.kind === "historical") return undefined;
		const primary = record.current;
		return this.#evidence(primary).previousAssistants.has(execution.messageID)
			? undefined
			: primary;
	}
	current(sessionID: string): PrimaryOwner | undefined {
		return this.#sessions.get(sessionID)?.current;
	}
	freeze(
		input: SessionContext,
		native: readonly SessionMessageInfo[],
		participation: Participation,
		clock: InputClock,
	): PrimaryOwner {
		if (this.#closed) throw new Error("Flow lifecycle is closed.");
		const record = this.#session(input.sessionID);
		const prior = record?.current;
		if (prior && this.isCurrent(prior) && prior.http.phase !== "ended")
			throw new Error("Flow primary contexts or streams overlap.");
		clock.assertCurrent();
		if (participation.kind === "flow") this.#assertLive(participation.origin);
		const inputs = modelInputIDs(input);
		if (!same(inputs, nativeInputIDs(native)))
			throw new Error(
				"Flow native inputs differ from the model-visible prefix.",
			);
		const delivery = nativeDelivery({ agent: input.agent, model: input.model });
		if (
			participation.kind === "flow" &&
			!sameDelivery(participation.origin.delivery, delivery)
		)
			throw new Error(
				"Flow admitted agent or model differs from its primary request.",
			);
		const previous =
			prior?.lifetime.kind === "current" ? prior.lifetime.snapshot : undefined;
		const retry =
			prior &&
			this.#retries.delete(prior) &&
			previous?.clock.current() &&
			prior.participation.kind === participation.kind &&
			(participation.kind === "native-only" ||
				(prior.participation.kind === "flow" &&
					prior.participation.origin === participation.origin)) &&
			same(previous?.inputs, inputs) &&
			prior.agent === input.agent &&
			sameModel(prior.model, input.model);
		const snapshot: Snapshot = Object.freeze({
			clock: Object.freeze({
				current: clock.current,
				assertCurrent: clock.assertCurrent,
			}),
			inputs: Object.freeze(inputs),
			previousAssistants:
				retry && previous
					? previous.previousAssistants
					: new Set(
							native
								.filter((message) => message.type === "assistant")
								.map((message) => message.id),
						),
			previousRetries: new Set(
				native.flatMap((message) =>
					message.type === "assistant" && message.retry !== undefined
						? [retryIdentity(message)]
						: [],
				),
			),
			previousTerminals: new Set(
				native
					.filter((message) => message.type === "idle")
					.map((message) => message.id),
			),
		});
		const primary: PrimaryOwner = {
			sessionID: input.sessionID,
			agent: input.agent,
			model: Object.freeze({ ...input.model }),
			participation: Object.freeze(participation),
			http: { phase: "context", requestSeen: false },
			lifetime: { kind: "current", snapshot },
		};
		const next = record ?? {
			current: primary,
			assistants: new Map<string, AssistantRecord>(),
			bindings: new Map<string, Binding>(),
		};
		if (prior) this.retire(prior);
		next.current = primary;
		this.#sessions.set(input.sessionID, next);
		for (const id of snapshot.previousAssistants)
			if (!next.assistants.has(id)) next.assistants.set(id, historical);
		return primary;
	}
	request(input: SessionHttpRequest): void {
		if (input.kind !== "primary") return;
		const primary = this.#session(input.sessionID)?.current;
		if (
			primary?.http.phase !== "context" ||
			primary.agent !== input.agent ||
			!sameModel(primary.model, input.model) ||
			this.#requests.has(input.request)
		)
			throw new Error(
				"Flow primary HTTP request has no unique frozen context.",
			);
		this.assertCurrent(primary);
		primary.http = { phase: "request", requestSeen: true };
		this.#requests.set(input.request, primary);
	}
	terminal(
		primary: PrimaryOwner,
		native: readonly SessionMessageInfo[],
		id?: string,
	): Extract<SessionMessageInfo, { type: "idle" }> | undefined {
		this.assertCurrent(primary);
		const snapshot = this.#evidence(primary);
		return native.find(
			(
				message,
				position,
			): message is Extract<SessionMessageInfo, { type: "idle" }> =>
				message.type === "idle" &&
				(id === undefined || message.id === id) &&
				!snapshot.previousTerminals.has(message.id) &&
				same(nativeInputIDs(native.slice(0, position)), snapshot.inputs),
		);
	}
	retry(primary: PrimaryOwner, native: readonly SessionMessageInfo[]): boolean {
		this.assertCurrent(primary);
		const snapshot = this.#evidence(primary);
		const record = this.#session(primary.sessionID);
		if (
			primary.http.phase !== "request" ||
			!same(nativeInputIDs(native), snapshot.inputs)
		)
			return false;
		const candidates = native.filter(
			(message, position) =>
				message.type === "assistant" &&
				message.retry !== undefined &&
				message.finish === undefined &&
				message.time.completed === undefined &&
				message.time.streamed === undefined &&
				message.content.length === 0 &&
				message.agent === primary.agent &&
				sameModel(message.model, primary.model) &&
				!snapshot.previousAssistants.has(message.id) &&
				!snapshot.previousRetries.has(retryIdentity(message)) &&
				!record?.assistants.has(message.id) &&
				same(nativeInputIDs(native.slice(0, position)), snapshot.inputs),
		);
		if (candidates.length !== 1) return false;
		this.#retries.add(primary);
		this.end(primary);
		return true;
	}
	end(primary: PrimaryOwner): boolean {
		const active = primary.http.phase !== "ended";
		primary.http = { phase: "ended", requestSeen: primary.http.requestSeen };
		return active && this.current(primary.sessionID) === primary;
	}
	retire(primary: PrimaryOwner): void {
		this.end(primary);
		primary.lifetime = retired;
	}
	response(
		input: SessionHttpResponse,
		failed: (primary: PrimaryOwner) => void,
	): void {
		if (input.kind !== "primary") return;
		this.#session(input.sessionID);
		const primary = this.#requests.get(input.request);
		if (
			!primary ||
			primary !== this.current(input.sessionID) ||
			primary.http.phase !== "request" ||
			primary.agent !== input.agent ||
			!sameModel(primary.model, input.model)
		) {
			if (primary) {
				if (this.end(primary)) failed(primary);
			}
			throw new Error(
				"Flow primary response did not match its Request identity.",
			);
		}
		const finish = () => this.end(primary);
		const fail = () => {
			if (finish()) failed(primary);
		};
		if (!input.response.ok) {
			fail();
			return;
		}
		try {
			this.assertCurrent(primary);
			if (!input.response.body)
				throw new Error("Flow primary response has no successful stream.");
			const reader = input.response.body.getReader();
			primary.http = { phase: "streaming", requestSeen: true };
			const response = input.response;
			input.response = new Response(
				new ReadableStream({
					async pull(controller) {
						try {
							const next = await reader.read();
							if (next.done) {
								finish();
								controller.close();
							} else controller.enqueue(next.value);
						} catch (error) {
							fail();
							controller.error(error);
						}
					},
					async cancel(reason) {
						finish();
						await reader.cancel(reason);
					},
				}),
				{
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				},
			);
		} catch (error) {
			fail();
			throw error;
		}
	}
	verify(
		execution: NativeExecution,
		native: readonly SessionMessageInfo[],
		session: SessionInfo,
		workspace: string,
		tool?: string,
	): Readonly<{ primary: PrimaryOwner; tool: string }> {
		if (
			this.#closed ||
			session.id !== execution.sessionID ||
			session.agent !== execution.agent ||
			canonical(session.location.directory) !== canonical(workspace)
		)
			throw new Error(
				"Flow native execution session or workspace identity changed.",
			);
		const record = this.#session(execution.sessionID);
		const primary = record?.current;
		if (
			!record ||
			!primary?.http.requestSeen ||
			primary.agent !== execution.agent
		)
			throw new Error("Flow tool has no attributable primary request.");
		const snapshot = this.#evidence(primary);
		const position = native.findIndex(
			(message) => message.id === execution.messageID,
		);
		const assistant = native[position];
		if (
			assistant?.type !== "assistant" ||
			assistant.agent !== execution.agent ||
			!sameModel(assistant.model, primary.model) ||
			snapshot.previousAssistants.has(assistant.id) ||
			!same(nativeInputIDs(native.slice(0, position)), snapshot.inputs)
		)
			throw new Error(
				"Flow exact assistant identity or frozen input prefix did not match.",
			);
		const call = assistant.content.find(
			(part) => part.type === "tool" && part.id === execution.id,
		);
		if (
			call?.type !== "tool" ||
			call.state.status !== "running" ||
			(tool !== undefined && call.name !== tool)
		)
			throw new Error("Flow exact native running tool call did not match.");
		const prior = record.assistants.get(execution.messageID);
		if (prior && (prior.kind === "historical" || prior.primary !== primary))
			throw new Error("Flow assistant cannot be rebound to another request.");
		const key = JSON.stringify([execution.messageID, execution.id]);
		const binding = record.bindings.get(key);
		if (binding && (binding.primary !== primary || binding.tool !== call.name))
			throw new Error(
				"Flow execution identity conflicts with an immutable binding.",
			);
		this.assertCurrent(primary);
		if (!prior)
			record.assistants.set(
				execution.messageID,
				Object.freeze({ kind: "bound", primary }),
			);
		const verified = binding ?? Object.freeze({ primary, tool: call.name });
		if (!binding) record.bindings.set(key, verified);
		return verified;
	}
	deleteSession(sessionID: string): void {
		const record = this.#sessions.get(sessionID);
		if (record) record.current.lifetime = retired;
		this.#sessions.set(sessionID, null);
	}
	clear(): void {
		this.#closed = true;
		for (const record of this.#sessions.values())
			if (record) record.current.lifetime = retired;
		this.#sessions.clear();
	}
}

export function rememberCodingModel(
	models: Map<string, FlowCodingModel>,
	input: Pick<SessionContext, "sessionID" | "agent">,
	session: SessionInfo,
	specialists: ReadonlySet<string>,
): void {
	if (
		session.parentID ||
		session.agent !== input.agent ||
		specialists.has(input.agent)
	)
		return;
	const selected = nativeDelivery(session);
	models.delete(input.sessionID);
	models.set(input.sessionID, {
		...selected.model,
		...(selected.variant === undefined ? {} : { variant: selected.variant }),
	});
	if (models.size > 128) {
		const oldest = models.keys().next().value;
		if (oldest) models.delete(oldest);
	}
}
