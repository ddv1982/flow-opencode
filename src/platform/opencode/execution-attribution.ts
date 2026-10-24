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

type FrozenPrimary = {
	readonly sessionID: string;
	readonly agent: string;
	readonly model: SessionContext["model"];
	readonly inputs: readonly string[];
	readonly previousAssistants: ReadonlySet<string>;
	readonly previousTerminals: ReadonlySet<string>;
	readonly previousRetries: ReadonlySet<string>;
	readonly origin: InputOrigin;
	phase: "context" | "request" | "streaming" | "ended";
	request: Request | null;
};
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
	readonly #primary = new Map<string, FrozenPrimary>();
	readonly #requests = new WeakMap<Request, FrozenPrimary>();
	readonly #retries = new WeakSet<FrozenPrimary>();
	readonly #assistants = new Map<string, FrozenPrimary>();
	readonly #bindings = new Map<
		string,
		Readonly<{ primary: FrozenPrimary; tool: string }>
	>();
	readonly #assertLive: (origin: InputOrigin) => void;
	#closed = false;
	constructor(assertLive: (origin: InputOrigin) => void) {
		this.#assertLive = assertLive;
	}
	#key(session: string, id: string): string {
		return JSON.stringify([session, id]);
	}
	requestOwner(request: Request): FrozenPrimary | undefined {
		return this.#requests.get(request);
	}
	executionOwner(execution: NativeExecution): FrozenPrimary | undefined {
		const binding = this.#bindings.get(
			JSON.stringify([execution.sessionID, execution.messageID, execution.id]),
		);
		const primary =
			binding?.primary ??
			this.#assistants.get(this.#key(execution.sessionID, execution.messageID));
		if (primary) return primary;
		const current = this.#primary.get(execution.sessionID);
		return current?.previousAssistants.has(execution.messageID)
			? undefined
			: current;
	}
	current(sessionID: string): FrozenPrimary | undefined {
		return this.#primary.get(sessionID);
	}
	freeze(
		input: SessionContext,
		native: readonly SessionMessageInfo[],
		origin: InputOrigin,
	): FrozenPrimary {
		if (this.#closed) throw new Error("Flow lifecycle is closed.");
		const prior = this.#primary.get(input.sessionID);
		if (prior && prior.phase !== "ended")
			throw new Error("Flow primary contexts or streams overlap.");
		this.#assertLive(origin);
		const inputs = modelInputIDs(input);
		if (!same(inputs, nativeInputIDs(native)))
			throw new Error(
				"Flow native inputs differ from the model-visible prefix.",
			);
		const delivery = nativeDelivery({ agent: input.agent, model: input.model });
		if (!sameDelivery(origin.delivery, delivery))
			throw new Error(
				"Flow admitted agent or model differs from its primary request.",
			);
		const retry =
			prior &&
			this.#retries.delete(prior) &&
			prior.origin === origin &&
			same(prior.inputs, inputs) &&
			prior.agent === input.agent &&
			sameModel(prior.model, input.model);
		const primary: FrozenPrimary = {
			sessionID: input.sessionID,
			agent: input.agent,
			model: Object.freeze({ ...input.model }),
			inputs: Object.freeze(inputs),
			previousAssistants: retry
				? prior.previousAssistants
				: new Set(
						native
							.filter((message) => message.type === "assistant")
							.map((message) => message.id),
					),
			origin,
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
			phase: "context",
			request: null,
		};
		this.#primary.set(input.sessionID, primary);
		return primary;
	}
	request(input: SessionHttpRequest): void {
		if (input.kind !== "primary") return;
		const primary = this.#primary.get(input.sessionID);
		if (
			primary?.phase !== "context" ||
			primary.agent !== input.agent ||
			!sameModel(primary.model, input.model) ||
			this.#requests.has(input.request)
		)
			throw new Error(
				"Flow primary HTTP request has no unique frozen context.",
			);
		this.#assertLive(primary.origin);
		primary.request = input.request;
		primary.phase = "request";
		this.#requests.set(input.request, primary);
	}
	hasFailedTerminal(
		primary: FrozenPrimary,
		native: readonly SessionMessageInfo[],
	): boolean {
		return native.some(
			(message, position) =>
				message.type === "idle" &&
				message.outcome !== "succeeded" &&
				!primary.previousTerminals.has(message.id) &&
				same(nativeInputIDs(native.slice(0, position)), primary.inputs),
		);
	}
	retry(
		primary: FrozenPrimary,
		native: readonly SessionMessageInfo[],
	): boolean {
		if (
			this.#primary.get(primary.sessionID) !== primary ||
			primary.phase !== "request" ||
			!same(nativeInputIDs(native), primary.inputs)
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
				!primary.previousAssistants.has(message.id) &&
				!primary.previousRetries.has(retryIdentity(message)) &&
				!this.#assistants.has(this.#key(primary.sessionID, message.id)) &&
				same(nativeInputIDs(native.slice(0, position)), primary.inputs),
		);
		if (candidates.length !== 1) return false;
		this.#retries.add(primary);
		this.end(primary);
		return true;
	}
	end(primary: FrozenPrimary): boolean {
		const active = primary.phase !== "ended";
		primary.phase = "ended";
		return active && this.#primary.get(primary.sessionID) === primary;
	}
	response(
		input: SessionHttpResponse,
		failed: (sessionID: string) => void,
	): void {
		if (input.kind !== "primary") return;
		const primary = this.#requests.get(input.request);
		if (
			!primary ||
			primary !== this.#primary.get(input.sessionID) ||
			primary.phase !== "request" ||
			primary.agent !== input.agent ||
			!sameModel(primary.model, input.model)
		) {
			if (primary) {
				if (this.end(primary)) failed(primary.sessionID);
			} else {
				const current = this.#primary.get(input.sessionID);
				if (current) this.end(current);
				failed(input.sessionID);
			}
			throw new Error(
				"Flow primary response did not match its Request identity.",
			);
		}
		const finish = () => this.end(primary);
		const fail = () => {
			if (finish()) failed(primary.sessionID);
		};
		if (!input.response.ok) {
			fail();
			return;
		}
		try {
			this.#assertLive(primary.origin);
			if (!input.response.body)
				throw new Error("Flow primary response has no successful stream.");
			const reader = input.response.body.getReader();
			primary.phase = "streaming";
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
						fail();
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
	): Readonly<{ primary: FrozenPrimary; tool: string }> {
		if (
			this.#closed ||
			session.id !== execution.sessionID ||
			session.agent !== execution.agent ||
			canonical(session.location.directory) !== canonical(workspace)
		)
			throw new Error(
				"Flow native execution session or workspace identity changed.",
			);
		const primary = this.#primary.get(execution.sessionID);
		if (
			!primary?.request ||
			primary.phase === "context" ||
			primary.agent !== execution.agent
		)
			throw new Error("Flow tool has no attributable primary request.");
		const position = native.findIndex(
			(message) => message.id === execution.messageID,
		);
		const assistant = native[position];
		if (
			assistant?.type !== "assistant" ||
			assistant.agent !== execution.agent ||
			!sameModel(assistant.model, primary.model) ||
			primary.previousAssistants.has(assistant.id) ||
			!same(nativeInputIDs(native.slice(0, position)), primary.inputs)
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
		const assistantKey = this.#key(execution.sessionID, execution.messageID);
		const prior = this.#assistants.get(assistantKey);
		if (prior && prior !== primary)
			throw new Error("Flow assistant cannot be rebound to another request.");
		const key = JSON.stringify([
			execution.sessionID,
			execution.messageID,
			execution.id,
		]);
		const binding = this.#bindings.get(key);
		if (binding && (binding.primary !== primary || binding.tool !== call.name))
			throw new Error(
				"Flow execution identity conflicts with an immutable binding.",
			);
		this.#assertLive(primary.origin);
		this.#assistants.set(assistantKey, primary);
		const verified = binding ?? Object.freeze({ primary, tool: call.name });
		this.#bindings.set(key, verified);
		return verified;
	}
	clear(): void {
		this.#closed = true;
		this.#primary.clear();
		this.#assistants.clear();
		this.#bindings.clear();
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
