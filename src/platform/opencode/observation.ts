import { createHash, randomBytes } from "node:crypto";
import type { Hooks } from "./sdk.js";

const DEFAULT_MAX_ROOTS = 64;
const DEFAULT_MAX_CALLS_PER_ROOT = 4_096;
const DEFAULT_MAX_MESSAGES_PER_ROOT = 4_096;
const DEFAULT_MAX_DISTINCT_VALUES_PER_ROOT = 4_096;
const MAX_SIGNATURE_INPUT_BYTES = 64 * 1024;
const MAX_SIGNATURE_STRING_CHARACTERS = 16 * 1024;
const MAX_SIGNATURE_NODES = 1_024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

type Provenance = "host_observed" | "unavailable";

export type ObservedMetric = {
	value: number | null;
	provenance: Provenance;
};

export type FlowHostObservationReport = {
	schemaVersion: 1;
	rootSessionKey: string;
	epoch: number;
	children: {
		count: number;
		workerRoleCount: number;
	};
	models: {
		requestedObservations: number;
		actualObservations: number;
		uniqueRequestedRoutes: number;
		uniqueActualRoutes: number;
		routeMismatchCount: number;
	};
	tokens: {
		input: ObservedMetric;
		output: ObservedMetric;
		reasoning: ObservedMetric;
		cacheRead: ObservedMetric;
		cacheWrite: ObservedMetric;
		cost: ObservedMetric;
	};
	tools: {
		calls: number;
		completed: number;
		errors: number;
		durationMs: ObservedMetric;
		resultBytes: number;
		repeatedResultCount: number;
	};
	reads: {
		total: number;
		unique: number;
		exactDuplicates: number;
		sameWaveDuplicates: number;
		verificationRereads: number;
	};
	guidance: {
		calls: number;
		uniqueIds: number;
		duplicateCalls: number;
		resultCharacters: number;
	};
	overflow: ObservationOverflow;
};

export type ObservationOverflow = {
	childSessions: number;
	workerRoles: number;
	requestedRoutes: number;
	actualRoutes: number;
	requestedRouteBindings: number;
	messages: number;
	calls: number;
	resultSignatures: number;
	readSignatures: number;
	guidanceSignatures: number;
	signatureInputs: number;
	counterSaturations: number;
};

type TokenContribution = {
	input: number;
	output: number;
	reasoning: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	actualRoute?: string | undefined;
};

type PendingCall = {
	startedAt: number;
	role?: string | undefined;
	readSignature?: string | undefined;
	guidanceSignature?: string | undefined;
	completed: boolean;
};

type RootObservation = {
	rootSessionKey: string;
	epoch: number;
	childSessions: Set<string>;
	workerRoles: Set<string>;
	requestedRoutes: Set<string>;
	actualRoutes: Set<string>;
	requestedRouteBySession: Map<string, string>;
	requestedObservations: number;
	actualObservations: number;
	routeMismatchCount: number;
	messageContributions: Map<string, TokenContribution>;
	tokenTotals: TokenContribution;
	hasTokenObservation: boolean;
	calls: Map<string, PendingCall>;
	toolCalls: number;
	toolCompleted: number;
	toolErrors: number;
	toolDurationMs: number;
	hasDurationObservation: boolean;
	resultBytes: number;
	resultSignatures: Set<string>;
	repeatedResultCount: number;
	readSignatures: Map<string, { role?: string | undefined; epoch: number }>;
	readTotal: number;
	readExactDuplicates: number;
	sameWaveDuplicates: number;
	verificationRereads: number;
	guidanceSignatures: Set<string>;
	guidanceCalls: number;
	guidanceDuplicateCalls: number;
	guidanceResultCharacters: number;
	overflow: ObservationOverflow;
};

export type FlowHostObservationRegistryOptions = {
	maxRoots?: number;
	maxCallsPerRoot?: number;
	maxMessagesPerRoot?: number;
	maxDistinctValuesPerRoot?: number;
	now?: () => number;
	signatureSalt?: string;
};

type ChatMessageInput = Parameters<NonNullable<Hooks["chat.message"]>>[0];
type ToolBeforeInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type ToolBeforeOutput = Parameters<
	NonNullable<Hooks["tool.execute.before"]>
>[1];
type ToolAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];
type ToolAfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1];
type FlowObservationHooks = Pick<
	Hooks,
	"event" | "chat.message" | "tool.execute.before" | "tool.execute.after"
>;

function finiteNonNegative(value: unknown): number | undefined {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > MAX_COUNTER
	) {
		return undefined;
	}
	return value;
}

function metric(value: number, observed: boolean): ObservedMetric {
	return observed
		? { value, provenance: "host_observed" }
		: { value: null, provenance: "unavailable" };
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

type SerializationBudget = {
	remainingNodes: number;
	remainingStringCharacters: number;
	truncated: boolean;
};

function boundedStableValue(
	value: unknown,
	budget: SerializationBudget,
	depth = 0,
	seen = new WeakSet<object>(),
): unknown {
	if (budget.remainingNodes <= 0) {
		budget.truncated = true;
		return "[budget]";
	}
	budget.remainingNodes -= 1;
	if (depth > 8) {
		budget.truncated = true;
		return "[depth]";
	}
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		typeof value === "string"
	) {
		if (typeof value !== "string") return value;
		const allowed = Math.max(0, budget.remainingStringCharacters);
		const bounded = value.slice(0, allowed);
		budget.remainingStringCharacters -= bounded.length;
		if (bounded.length !== value.length) budget.truncated = true;
		return bounded;
	}
	if (typeof value !== "object") return `[${typeof value}]`;
	if (seen.has(value)) return "[cycle]";
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 128) budget.truncated = true;
		const result: unknown[] = [];
		for (let index = 0; index < Math.min(value.length, 128); index += 1) {
			if (budget.remainingNodes <= 0) {
				budget.truncated = true;
				break;
			}
			result.push(boundedStableValue(value[index], budget, depth + 1, seen));
		}
		return result;
	}
	const record = value as Record<string, unknown>;
	const keys: Array<{ original: string; bounded: string }> = [];
	let scannedKeys = 0;
	for (const key in record) {
		scannedKeys += 1;
		if (scannedKeys > 256) {
			budget.truncated = true;
			break;
		}
		if (!Object.hasOwn(record, key)) continue;
		if (keys.length === 128) {
			budget.truncated = true;
			break;
		}
		const bounded = key.slice(0, 256);
		if (bounded.length !== key.length) budget.truncated = true;
		keys.push({ original: key, bounded });
	}
	keys.sort((left, right) => {
		if (left.bounded < right.bounded) return -1;
		if (left.bounded > right.bounded) return 1;
		return 0;
	});
	const result: Record<string, unknown> = {};
	for (const [index, key] of keys.entries()) {
		if (budget.remainingNodes <= 0) {
			budget.truncated = true;
			break;
		}
		result[`${key.bounded}#${index}`] = boundedStableValue(
			record[key.original],
			budget,
			depth + 1,
			seen,
		);
	}
	return result;
}

function isReadTool(tool: string): boolean {
	return /(^|[._-])(read|grep|glob|search|find|list)([._-]|$)/i.test(tool);
}

function isVerificationRole(role: string | undefined): boolean {
	return role !== undefined && /review|verif|audit/i.test(role);
}

function metadataIndicatesError(metadata: unknown): boolean {
	if (!metadata || typeof metadata !== "object") return false;
	const record = metadata as Record<string, unknown>;
	return (
		record.error === true ||
		record.status === "error" ||
		record.status === "failed" ||
		(typeof record.exit === "number" && record.exit !== 0) ||
		record.exitCode === 1 ||
		(typeof record.exitCode === "number" && record.exitCode !== 0)
	);
}

function emptyTokenContribution(): TokenContribution {
	return {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};
}

function emptyOverflow(): ObservationOverflow {
	return {
		childSessions: 0,
		workerRoles: 0,
		requestedRoutes: 0,
		actualRoutes: 0,
		requestedRouteBindings: 0,
		messages: 0,
		calls: 0,
		resultSignatures: 0,
		readSignatures: 0,
		guidanceSignatures: 0,
		signatureInputs: 0,
		counterSaturations: 0,
	};
}

function createRoot(rootSessionKey: string): RootObservation {
	return {
		rootSessionKey,
		epoch: 0,
		childSessions: new Set(),
		workerRoles: new Set(),
		requestedRoutes: new Set(),
		actualRoutes: new Set(),
		requestedRouteBySession: new Map(),
		requestedObservations: 0,
		actualObservations: 0,
		routeMismatchCount: 0,
		messageContributions: new Map(),
		tokenTotals: emptyTokenContribution(),
		hasTokenObservation: false,
		calls: new Map(),
		toolCalls: 0,
		toolCompleted: 0,
		toolErrors: 0,
		toolDurationMs: 0,
		hasDurationObservation: false,
		resultBytes: 0,
		resultSignatures: new Set(),
		repeatedResultCount: 0,
		readSignatures: new Map(),
		readTotal: 0,
		readExactDuplicates: 0,
		sameWaveDuplicates: 0,
		verificationRereads: 0,
		guidanceSignatures: new Set(),
		guidanceCalls: 0,
		guidanceDuplicateCalls: 0,
		guidanceResultCharacters: 0,
		overflow: emptyOverflow(),
	};
}

export class FlowHostObservationRegistry {
	readonly #maxRoots: number;
	readonly #maxCallsPerRoot: number;
	readonly #maxMessagesPerRoot: number;
	readonly #maxDistinctValuesPerRoot: number;
	readonly #now: () => number;
	readonly #signatureSalt: string;
	readonly #roots = new Map<string, RootObservation>();
	readonly #sessionRoots = new Map<string, string>();
	readonly #sessionRoles = new Map<string, string>();

	constructor(options: FlowHostObservationRegistryOptions = {}) {
		this.#maxRoots = options.maxRoots ?? DEFAULT_MAX_ROOTS;
		this.#maxCallsPerRoot =
			options.maxCallsPerRoot ?? DEFAULT_MAX_CALLS_PER_ROOT;
		this.#maxMessagesPerRoot =
			options.maxMessagesPerRoot ?? DEFAULT_MAX_MESSAGES_PER_ROOT;
		this.#maxDistinctValuesPerRoot =
			options.maxDistinctValuesPerRoot ?? DEFAULT_MAX_DISTINCT_VALUES_PER_ROOT;
		this.#now = options.now ?? Date.now;
		this.#signatureSalt =
			options.signatureSalt === undefined
				? randomBytes(32).toString("hex")
				: createHash("sha256")
						.update(
							options.signatureSalt.slice(0, MAX_SIGNATURE_STRING_CHARACTERS),
						)
						.digest("hex");
		if (
			!Number.isSafeInteger(this.#maxRoots) ||
			this.#maxRoots < 1 ||
			this.#maxRoots > DEFAULT_MAX_ROOTS ||
			!Number.isSafeInteger(this.#maxCallsPerRoot) ||
			this.#maxCallsPerRoot < 1 ||
			this.#maxCallsPerRoot > DEFAULT_MAX_CALLS_PER_ROOT ||
			!Number.isSafeInteger(this.#maxMessagesPerRoot) ||
			this.#maxMessagesPerRoot < 1 ||
			this.#maxMessagesPerRoot > DEFAULT_MAX_MESSAGES_PER_ROOT ||
			!Number.isSafeInteger(this.#maxDistinctValuesPerRoot) ||
			this.#maxDistinctValuesPerRoot < 1 ||
			this.#maxDistinctValuesPerRoot > DEFAULT_MAX_DISTINCT_VALUES_PER_ROOT
		) {
			throw new Error(
				"Flow observation limits must be positive integers within their hard caps.",
			);
		}
	}

	#signature(value: unknown, root?: RootObservation): string {
		const budget: SerializationBudget = {
			remainingNodes: MAX_SIGNATURE_NODES,
			remainingStringCharacters: MAX_SIGNATURE_STRING_CHARACTERS,
			truncated: false,
		};
		let serialized: string;
		try {
			serialized = JSON.stringify(boundedStableValue(value, budget));
		} catch {
			serialized = "[unserializable]";
		}
		const maxSerializedCharacters = Math.floor(MAX_SIGNATURE_INPUT_BYTES / 4);
		if (serialized.length > maxSerializedCharacters) {
			serialized = serialized.slice(0, maxSerializedCharacters);
			budget.truncated = true;
		}
		const signature = createHash("sha256")
			.update(this.#signatureSalt)
			.update("\0")
			.update(serialized)
			.digest("hex");
		if (budget.truncated && root) {
			this.#noteOverflow(root, "signatureInputs");
		}
		return budget.truncated ? `truncated:${signature}` : signature;
	}

	#sessionKey(sessionID: string): string {
		return this.#signature(sessionID);
	}

	#rootID(sessionID: string): string {
		const sessionKey = this.#sessionKey(sessionID);
		return this.#sessionRoots.get(sessionKey) ?? sessionKey;
	}

	#root(sessionID: string): RootObservation {
		const rootID = this.#rootID(sessionID);
		const existing = this.#roots.get(rootID);
		if (existing) {
			this.#roots.delete(rootID);
			this.#roots.set(rootID, existing);
			return existing;
		}
		const created = createRoot(rootID);
		this.#roots.set(rootID, created);
		this.#sessionRoots.set(rootID, rootID);
		while (this.#roots.size > this.#maxRoots) {
			const oldest = this.#roots.keys().next().value;
			if (typeof oldest !== "string") break;
			this.#roots.delete(oldest);
			for (const [sessionID, mappedRoot] of this.#sessionRoots) {
				if (mappedRoot !== oldest) continue;
				this.#sessionRoots.delete(sessionID);
				this.#sessionRoles.delete(sessionID);
			}
		}
		return created;
	}

	#noteOverflow(
		root: RootObservation,
		key: keyof ObservationOverflow,
		amount = 1,
	): void {
		root.overflow[key] = Math.min(
			MAX_COUNTER,
			root.overflow[key] + Math.max(0, amount),
		);
	}

	#sum(root: RootObservation, current: number, delta: number): number {
		const next = current + delta;
		if (!Number.isFinite(next) || next > MAX_COUNTER) {
			this.#noteOverflow(root, "counterSaturations");
			return MAX_COUNTER;
		}
		if (next < 0) return 0;
		return next;
	}

	#addBounded(
		root: RootObservation,
		set: Set<string>,
		value: string,
		overflowKey: keyof ObservationOverflow,
	): boolean {
		if (set.has(value)) return true;
		if (set.size >= this.#maxDistinctValuesPerRoot) {
			this.#noteOverflow(root, overflowKey);
			return false;
		}
		set.add(value);
		return true;
	}

	#rememberBounded<K, V>(
		root: RootObservation,
		map: Map<K, V>,
		key: K,
		value: V,
		limit: number,
		overflowKey: keyof ObservationOverflow,
	): void {
		if (map.has(key)) map.delete(key);
		map.set(key, value);
		while (map.size > limit) {
			const oldest = map.keys().next().value;
			if (oldest === undefined) break;
			map.delete(oldest);
			this.#noteOverflow(root, overflowKey);
		}
	}

	observeEvent(event: unknown): void {
		try {
			if (!event || typeof event !== "object") return;
			const typed = event as {
				type?: unknown;
				properties?: Record<string, unknown>;
			};
			if (typed.type === "session.created") {
				const info = typed.properties?.info;
				if (!info || typeof info !== "object") return;
				const session = info as Record<string, unknown>;
				if (typeof session.id !== "string") return;
				const parentID =
					typeof session.parentID === "string" ? session.parentID : undefined;
				const sessionKey = this.#sessionKey(session.id);
				const root = this.#root(parentID ?? session.id);
				const rootID = root.rootSessionKey;
				if (
					!parentID ||
					this.#addBounded(
						root,
						root.childSessions,
						sessionKey,
						"childSessions",
					)
				) {
					this.#sessionRoots.set(sessionKey, rootID);
				}
				return;
			}
			if (typed.type === "session.compacted") {
				const sessionID = typed.properties?.sessionID;
				if (typeof sessionID !== "string") return;
				const root = this.#root(sessionID);
				root.epoch = this.#sum(root, root.epoch, 1);
				root.readSignatures.clear();
				root.guidanceSignatures.clear();
				return;
			}
			if (typed.type === "message.updated") {
				const info = typed.properties?.info;
				if (!info || typeof info !== "object") return;
				this.#observeAssistantMessage(info as Record<string, unknown>);
				return;
			}
			if (typed.type === "message.part.updated") {
				const part = typed.properties?.part;
				if (!part || typeof part !== "object") return;
				const record = part as Record<string, unknown>;
				if (record.type !== "tool") return;
				const state = record.state;
				if (!state || typeof state !== "object") return;
				if ((state as Record<string, unknown>).status !== "error") return;
				if (typeof record.sessionID !== "string") return;
				const root = this.#root(record.sessionID);
				root.toolErrors = this.#sum(root, root.toolErrors, 1);
			}
		} catch {
			// Observation is best-effort and must never affect host execution.
		}
	}

	#observeAssistantMessage(info: Record<string, unknown>): void {
		if (
			info.role !== "assistant" ||
			typeof info.id !== "string" ||
			typeof info.sessionID !== "string"
		) {
			return;
		}
		const tokens =
			info.tokens && typeof info.tokens === "object"
				? (info.tokens as Record<string, unknown>)
				: undefined;
		const cache =
			tokens?.cache && typeof tokens.cache === "object"
				? (tokens.cache as Record<string, unknown>)
				: undefined;
		const contribution: TokenContribution = {
			input: finiteNonNegative(tokens?.input) ?? 0,
			output: finiteNonNegative(tokens?.output) ?? 0,
			reasoning: finiteNonNegative(tokens?.reasoning) ?? 0,
			cacheRead: finiteNonNegative(cache?.read) ?? 0,
			cacheWrite: finiteNonNegative(cache?.write) ?? 0,
			cost: finiteNonNegative(info.cost) ?? 0,
			...(typeof info.providerID === "string" &&
			typeof info.modelID === "string"
				? {
						actualRoute: `${info.providerID.slice(0, 256)}/${info.modelID.slice(0, 256)}`,
					}
				: {}),
		};
		const root = this.#root(info.sessionID);
		const messageKey = this.#signature(info.id, root);
		const previous = root.messageContributions.get(messageKey);
		if (previous && JSON.stringify(previous) === JSON.stringify(contribution)) {
			return;
		}
		if (previous) {
			root.tokenTotals.input = this.#sum(
				root,
				root.tokenTotals.input,
				-previous.input,
			);
			root.tokenTotals.output = this.#sum(
				root,
				root.tokenTotals.output,
				-previous.output,
			);
			root.tokenTotals.reasoning = this.#sum(
				root,
				root.tokenTotals.reasoning,
				-previous.reasoning,
			);
			root.tokenTotals.cacheRead = this.#sum(
				root,
				root.tokenTotals.cacheRead,
				-previous.cacheRead,
			);
			root.tokenTotals.cacheWrite = this.#sum(
				root,
				root.tokenTotals.cacheWrite,
				-previous.cacheWrite,
			);
			root.tokenTotals.cost = this.#sum(
				root,
				root.tokenTotals.cost,
				-previous.cost,
			);
		} else {
			root.actualObservations = this.#sum(root, root.actualObservations, 1);
		}
		root.tokenTotals.input = this.#sum(
			root,
			root.tokenTotals.input,
			contribution.input,
		);
		root.tokenTotals.output = this.#sum(
			root,
			root.tokenTotals.output,
			contribution.output,
		);
		root.tokenTotals.reasoning = this.#sum(
			root,
			root.tokenTotals.reasoning,
			contribution.reasoning,
		);
		root.tokenTotals.cacheRead = this.#sum(
			root,
			root.tokenTotals.cacheRead,
			contribution.cacheRead,
		);
		root.tokenTotals.cacheWrite = this.#sum(
			root,
			root.tokenTotals.cacheWrite,
			contribution.cacheWrite,
		);
		root.tokenTotals.cost = this.#sum(
			root,
			root.tokenTotals.cost,
			contribution.cost,
		);
		root.hasTokenObservation = true;
		if (contribution.actualRoute) {
			const actualRouteKey = this.#signature(contribution.actualRoute, root);
			this.#addBounded(root, root.actualRoutes, actualRouteKey, "actualRoutes");
			const requested = root.requestedRouteBySession.get(
				this.#sessionKey(info.sessionID),
			);
			if (requested && requested !== actualRouteKey && !previous) {
				root.routeMismatchCount = this.#sum(root, root.routeMismatchCount, 1);
			}
		}
		this.#rememberBounded(
			root,
			root.messageContributions,
			messageKey,
			contribution,
			this.#maxMessagesPerRoot,
			"messages",
		);
	}

	observeChatMessage(input: ChatMessageInput): void {
		try {
			const root = this.#root(input.sessionID);
			const sessionKey = this.#sessionKey(input.sessionID);
			if (input.agent) {
				const boundedRole = input.agent.slice(0, 256);
				this.#sessionRoles.set(sessionKey, boundedRole);
				this.#addBounded(
					root,
					root.workerRoles,
					this.#signature(boundedRole, root),
					"workerRoles",
				);
			}
			if (!input.model) return;
			const providerID = input.model.providerID.slice(0, 256);
			const modelID = input.model.modelID.slice(0, 256);
			const variant = input.variant?.slice(0, 256);
			const route = `${providerID}/${modelID}${variant ? `#${variant}` : ""}`;
			root.requestedObservations = this.#sum(
				root,
				root.requestedObservations,
				1,
			);
			this.#addBounded(
				root,
				root.requestedRoutes,
				this.#signature(route, root),
				"requestedRoutes",
			);
			this.#rememberBounded(
				root,
				root.requestedRouteBySession,
				sessionKey,
				this.#signature(`${providerID}/${modelID}`, root),
				this.#maxDistinctValuesPerRoot,
				"requestedRouteBindings",
			);
		} catch {
			// Observation is best-effort and must never affect host execution.
		}
	}

	observeToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): void {
		try {
			const root = this.#root(input.sessionID);
			const callKey = this.#signature(
				{ session: this.#sessionKey(input.sessionID), call: input.callID },
				root,
			);
			if (root.calls.has(callKey)) return;
			const role = this.#sessionRoles.get(this.#sessionKey(input.sessionID));
			const boundedTool = input.tool.slice(0, 256);
			const readSignature = isReadTool(boundedTool)
				? this.#signature({ tool: boundedTool, args: output.args }, root)
				: undefined;
			const guidanceSignature =
				boundedTool === "flow_guidance" &&
				output.args &&
				typeof output.args === "object" &&
				typeof (output.args as Record<string, unknown>).id === "string"
					? this.#signature((output.args as Record<string, unknown>).id, root)
					: undefined;
			const call: PendingCall = {
				startedAt: this.#now(),
				...(role ? { role } : {}),
				...(readSignature ? { readSignature } : {}),
				...(guidanceSignature ? { guidanceSignature } : {}),
				completed: false,
			};
			this.#rememberBounded(
				root,
				root.calls,
				callKey,
				call,
				this.#maxCallsPerRoot,
				"calls",
			);
			root.toolCalls = this.#sum(root, root.toolCalls, 1);
			if (readSignature) {
				root.readTotal = this.#sum(root, root.readTotal, 1);
				const first = root.readSignatures.get(readSignature);
				if (first) {
					root.readExactDuplicates = this.#sum(
						root,
						root.readExactDuplicates,
						1,
					);
					if (isVerificationRole(role) || isVerificationRole(first.role)) {
						root.verificationRereads = this.#sum(
							root,
							root.verificationRereads,
							1,
						);
					} else if (first.epoch === root.epoch) {
						root.sameWaveDuplicates = this.#sum(
							root,
							root.sameWaveDuplicates,
							1,
						);
					}
				} else {
					this.#rememberBounded(
						root,
						root.readSignatures,
						readSignature,
						{ role, epoch: root.epoch },
						this.#maxDistinctValuesPerRoot,
						"readSignatures",
					);
				}
			}
			if (guidanceSignature) {
				root.guidanceCalls = this.#sum(root, root.guidanceCalls, 1);
				if (root.guidanceSignatures.has(guidanceSignature)) {
					root.guidanceDuplicateCalls = this.#sum(
						root,
						root.guidanceDuplicateCalls,
						1,
					);
				} else {
					this.#addBounded(
						root,
						root.guidanceSignatures,
						guidanceSignature,
						"guidanceSignatures",
					);
				}
			}
		} catch {
			// Observation is best-effort and must never affect host execution.
		}
	}

	observeToolAfter(input: ToolAfterInput, output: ToolAfterOutput): void {
		try {
			const root = this.#root(input.sessionID);
			const callKey = this.#signature(
				{ session: this.#sessionKey(input.sessionID), call: input.callID },
				root,
			);
			let call = root.calls.get(callKey);
			if (!call) {
				call = {
					startedAt: this.#now(),
					completed: false,
				};
				root.toolCalls = this.#sum(root, root.toolCalls, 1);
				this.#rememberBounded(
					root,
					root.calls,
					callKey,
					call,
					this.#maxCallsPerRoot,
					"calls",
				);
			}
			if (call.completed) return;
			call.completed = true;
			root.toolCompleted = this.#sum(root, root.toolCompleted, 1);
			const elapsed = Math.max(0, this.#now() - call.startedAt);
			root.toolDurationMs = this.#sum(root, root.toolDurationMs, elapsed);
			root.hasDurationObservation = true;
			if (metadataIndicatesError(output.metadata)) {
				root.toolErrors = this.#sum(root, root.toolErrors, 1);
			}
			const boundedOutput = output.output.slice(
				0,
				MAX_SIGNATURE_STRING_CHARACTERS,
			);
			if (boundedOutput.length !== output.output.length) {
				this.#noteOverflow(root, "signatureInputs");
			}
			root.resultBytes = this.#sum(
				root,
				root.resultBytes,
				byteLength(boundedOutput),
			);
			const resultSignature = this.#signature(output.output, root);
			if (root.resultSignatures.has(resultSignature)) {
				root.repeatedResultCount = this.#sum(root, root.repeatedResultCount, 1);
			} else {
				this.#addBounded(
					root,
					root.resultSignatures,
					resultSignature,
					"resultSignatures",
				);
			}
			if (call.guidanceSignature) {
				root.guidanceResultCharacters = this.#sum(
					root,
					root.guidanceResultCharacters,
					Math.min(output.output.length, MAX_SIGNATURE_STRING_CHARACTERS),
				);
			}
		} catch {
			// Observation is best-effort and must never affect host execution.
		}
	}

	compact(sessionID: string): void {
		this.observeEvent({ type: "session.compacted", properties: { sessionID } });
	}

	snapshot(sessionID: string): FlowHostObservationReport | null {
		const rootID = this.#rootID(sessionID);
		const root = this.#roots.get(rootID);
		if (!root) return null;
		return {
			schemaVersion: 1,
			rootSessionKey: root.rootSessionKey,
			epoch: root.epoch,
			children: {
				count: root.childSessions.size,
				workerRoleCount: root.workerRoles.size,
			},
			models: {
				requestedObservations: root.requestedObservations,
				actualObservations: root.actualObservations,
				uniqueRequestedRoutes: root.requestedRoutes.size,
				uniqueActualRoutes: root.actualRoutes.size,
				routeMismatchCount: root.routeMismatchCount,
			},
			tokens: {
				input: metric(root.tokenTotals.input, root.hasTokenObservation),
				output: metric(root.tokenTotals.output, root.hasTokenObservation),
				reasoning: metric(root.tokenTotals.reasoning, root.hasTokenObservation),
				cacheRead: metric(root.tokenTotals.cacheRead, root.hasTokenObservation),
				cacheWrite: metric(
					root.tokenTotals.cacheWrite,
					root.hasTokenObservation,
				),
				cost: metric(root.tokenTotals.cost, root.hasTokenObservation),
			},
			tools: {
				calls: root.toolCalls,
				completed: root.toolCompleted,
				errors: root.toolErrors,
				durationMs: metric(root.toolDurationMs, root.hasDurationObservation),
				resultBytes: root.resultBytes,
				repeatedResultCount: root.repeatedResultCount,
			},
			reads: {
				total: root.readTotal,
				unique: root.readSignatures.size,
				exactDuplicates: root.readExactDuplicates,
				sameWaveDuplicates: root.sameWaveDuplicates,
				verificationRereads: root.verificationRereads,
			},
			guidance: {
				calls: root.guidanceCalls,
				uniqueIds: root.guidanceSignatures.size,
				duplicateCalls: root.guidanceDuplicateCalls,
				resultCharacters: root.guidanceResultCharacters,
			},
			overflow: { ...root.overflow },
		};
	}

	reset(sessionID: string): void {
		const rootID = this.#rootID(sessionID);
		this.#roots.delete(rootID);
		for (const [candidate, mappedRoot] of this.#sessionRoots) {
			if (mappedRoot !== rootID) continue;
			this.#sessionRoots.delete(candidate);
			this.#sessionRoles.delete(candidate);
		}
	}
}

export function createFlowHostObservationHooks(
	registry: FlowHostObservationRegistry,
): FlowObservationHooks {
	return {
		event: async ({ event }) => {
			registry.observeEvent(event);
		},
		"chat.message": async (input) => {
			registry.observeChatMessage(input);
		},
		"tool.execute.before": async (input, output) => {
			registry.observeToolBefore(input, output);
		},
		"tool.execute.after": async (input, output) => {
			registry.observeToolAfter(input, output);
		},
	};
}
