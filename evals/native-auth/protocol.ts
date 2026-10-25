import type { CredentialEntry, JsonValue } from "@opencode/client";
import { Rpc } from "@opencode/plugin/rpc";

export const PLACEHOLDER_REFRESH = "flow-native-auth-source-owned";
export const UNRESOLVED_ACCESS = "flow-native-auth-unresolved";
export type OAuthValue = Extract<CredentialEntry["value"], { type: "oauth" }>;
export type AccountRoute = {
	providerID: string;
	integrationID: string;
	credentialID: string;
	methodID: string;
	label: string;
};
export type NativeAccount = {
	route: AccountRoute;
	metadata?: Record<string, JsonValue>;
};
export type ResolvedAccount = { route: AccountRoute; value: OAuthValue };
export type NativeAccountConnection = {
	version: 1;
	url: string;
	capability: string;
	accounts: readonly NativeAccount[];
};
export type ChildOptions = {
	connection: NativeAccountConnection;
	lease: string;
	models: readonly string[];
};

export class NativeAuthError extends Error {
	constructor() {
		super("Native account authentication failed.");
		this.name = "NativeAuthError";
	}
}
export function refuse(): never {
	throw new NativeAuthError();
}
export function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function identifier(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_.:@+-]{1,256}$/.test(value);
}
function json(value: unknown, depth = 0): value is JsonValue {
	if (depth > 64) return false;
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(Array.isArray(value) && value.every((item) => json(item, depth + 1))) ||
		(object(value) &&
			Object.values(value).every((item) => json(item, depth + 1)))
	);
}
export function containsSecret(value: unknown, secret: string): boolean {
	if (!secret) return false;
	if (typeof value === "string") return value.includes(secret);
	if (Array.isArray(value))
		return value.some((item) => containsSecret(item, secret));
	return (
		object(value) &&
		Object.entries(value).some(
			([key, item]) => key.includes(secret) || containsSecret(item, secret),
		)
	);
}
export function metadata(
	value: unknown,
): Record<string, JsonValue> | undefined {
	if (value === undefined) return undefined;
	if (!object(value)) refuse();
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => {
			if (!json(item)) refuse();
			return [key, item] as const;
		}),
	);
}
export function sameMetadata(left: unknown, right: unknown): boolean {
	const stable = (value: unknown): string => {
		if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
		if (object(value))
			return `{${Object.keys(value)
				.sort()
				.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
				.join(",")}}`;
		return JSON.stringify(value) ?? "undefined";
	};
	return stable(left) === stable(right);
}
export function providersForModels(models: readonly string[]): string[] {
	if (!Array.isArray(models) || models.length === 0) refuse();
	return [
		...new Set(
			models.map((model) => {
				if (typeof model !== "string") refuse();
				const slash = model.indexOf("/");
				const provider = model.slice(0, slash);
				if (slash < 1 || slash === model.length - 1 || !identifier(provider))
					refuse();
				return provider;
			}),
		),
	];
}
export function parseRoute(value: unknown): AccountRoute {
	if (
		!object(value) ||
		!identifier(value.providerID) ||
		!identifier(value.integrationID) ||
		!identifier(value.credentialID) ||
		!identifier(value.methodID) ||
		typeof value.label !== "string"
	)
		refuse();
	return {
		providerID: value.providerID,
		integrationID: value.integrationID,
		credentialID: value.credentialID,
		methodID: value.methodID,
		label: value.label,
	};
}
export function parseOAuth(value: unknown, placeholder = true): OAuthValue {
	if (
		!object(value) ||
		value.type !== "oauth" ||
		!identifier(value.methodID) ||
		typeof value.access !== "string" ||
		typeof value.refresh !== "string" ||
		(placeholder && value.refresh !== PLACEHOLDER_REFRESH) ||
		typeof value.expires !== "number" ||
		!Number.isSafeInteger(value.expires) ||
		value.expires < 0
	)
		refuse();
	const extra = metadata(value.metadata);
	return {
		type: "oauth",
		methodID: value.methodID,
		access: value.access,
		refresh: value.refresh,
		expires: value.expires,
		...(extra === undefined ? {} : { metadata: extra }),
	};
}
export function parseResolved(value: unknown): ResolvedAccount {
	if (!object(value)) refuse();
	const route = parseRoute(value.route);
	const credential = parseOAuth(value.value);
	if (route.methodID !== credential.methodID) refuse();
	return { route, value: credential };
}
export function privateAccount(value: ResolvedAccount): NativeAccount {
	return {
		route: value.route,
		...(value.value.metadata === undefined
			? {}
			: { metadata: value.value.metadata }),
	};
}
export function loopbackURL(value: unknown): string {
	try {
		if (typeof value !== "string") refuse();
		const url = new URL(value);
		if (
			url.protocol !== "http:" ||
			url.hostname !== "127.0.0.1" ||
			!url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/"
		)
			refuse();
		return url.href;
	} catch {
		refuse();
	}
}
export function capability(value: unknown): string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) refuse();
	return value;
}
export function parseConnection(value: unknown): NativeAccountConnection {
	if (
		!object(value) ||
		value.version !== 1 ||
		!Array.isArray(value.accounts) ||
		value.accounts.length === 0
	)
		refuse();
	const accounts = value.accounts.map((account: unknown): NativeAccount => {
		if (!object(account)) refuse();
		const extra = metadata(account.metadata);
		return {
			route: parseRoute(account.route),
			...(extra === undefined ? {} : { metadata: extra }),
		};
	});
	if (
		new Set(accounts.map((account) => account.route.providerID)).size !==
		accounts.length
	)
		refuse();
	const credentials = new Map<string, NativeAccount>();
	for (const account of accounts) {
		const previous = credentials.get(account.route.credentialID);
		if (
			previous &&
			(previous.route.integrationID !== account.route.integrationID ||
				previous.route.methodID !== account.route.methodID ||
				!sameMetadata(previous.metadata, account.metadata))
		)
			refuse();
		credentials.set(account.route.credentialID, account);
	}
	return {
		version: 1,
		url: loopbackURL(value.url),
		capability: capability(value.capability),
		accounts,
	};
}
export function parseChildOptions(value: unknown): ChildOptions {
	if (!object(value)) refuse();
	return {
		connection: parseConnection(value.connection),
		lease: capability(value.lease),
		models: parseApprovedModels(value.models),
	};
}
export function parseSelection(value: unknown): {
	providerID: string;
	credentialID: string;
} {
	if (
		!object(value) ||
		!identifier(value.providerID) ||
		!identifier(value.credentialID)
	)
		refuse();
	return { providerID: value.providerID, credentialID: value.credentialID };
}
export async function responseJSON(response: Response): Promise<unknown> {
	try {
		if (!response.ok) refuse();
		const body = await response.text();
		if (body.length > 1024 * 1024) refuse();
		return JSON.parse(body);
	} catch {
		refuse();
	}
}
const empty = {
	type: "object",
	properties: {},
	additionalProperties: false,
} as const;
const selection = {
	type: "object",
	properties: {
		providerID: { type: "string" },
		credentialID: { type: "string" },
	},
	required: ["providerID", "credentialID"],
	additionalProperties: false,
} as const;
export const NativeAccountRpc = Rpc.define({
	id: "flow.native-account-source",
	methods: {
		describe: { input: empty, output: { type: "object" } },
		check: { input: selection, output: empty },
		resolve: {
			input: {
				type: "object",
				properties: {
					providerID: { type: "string" },
					credentialID: { type: "string" },
				},
				required: ["providerID", "credentialID"],
				additionalProperties: false,
			},
			output: { type: "object" },
		},
		close: { input: empty, output: empty },
	},
	events: {},
});

export type ReadinessModel = {
	providerID: string;
	id: string;
	variant?: string;
};
export const READINESS_REASONS = [
	"profile-unapproved",
	"selection-changed",
	"source-unavailable",
	"credential-invalid",
	"credential-unresolved",
	"credential-stale",
	"route-unsettled",
	"metadata-unavailable",
	"readiness-deadline",
	"readiness-cancelled",
	"readiness-unavailable",
] as const;
export type ReadinessReason = (typeof READINESS_REASONS)[number];
export type ReadinessResult =
	| { version: 1; state: "ready" }
	| { version: 1; state: "not-ready"; reason: ReadinessReason };
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
	if (Object.keys(value).some((key) => !allowed.includes(key))) refuse();
}
export function parseApprovedModels(value: unknown): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > 256 ||
		!value.every(
			(model) =>
				typeof model === "string" &&
				model.length <= 512 &&
				/^[^\s/]+\/[^\s]+$/.test(model),
		)
	)
		refuse();
	providersForModels(value);
	return Object.freeze([...new Set(value)]);
}
export function parseReadinessInput(value: unknown): {
	models: ReadinessModel[];
	timeoutMs: number;
} {
	if (!object(value)) refuse();
	keys(value, ["models", "timeoutMs"]);
	if (
		!Array.isArray(value.models) ||
		value.models.length === 0 ||
		value.models.length > 256 ||
		typeof value.timeoutMs !== "number" ||
		!Number.isInteger(value.timeoutMs) ||
		value.timeoutMs <= 0 ||
		value.timeoutMs > 15000
	)
		refuse();
	const models = value.models.map((model: unknown): ReadinessModel => {
		if (!object(model)) refuse();
		keys(model, ["providerID", "id", "variant"]);
		if (
			!identifier(model.providerID) ||
			typeof model.id !== "string" ||
			!model.id ||
			model.id.length > 512 ||
			/\s/.test(model.id) ||
			(model.variant !== undefined &&
				(typeof model.variant !== "string" || model.variant.length > 256))
		)
			refuse();
		return {
			providerID: model.providerID,
			id: model.id,
			...(model.variant === undefined ? {} : { variant: model.variant }),
		};
	});
	return { models, timeoutMs: value.timeoutMs };
}
export function parseReadinessResult(value: unknown): ReadinessResult {
	if (!object(value) || value.version !== 1) refuse();
	if (value.state === "ready") {
		keys(value, ["version", "state"]);
		return { version: 1, state: "ready" };
	}
	keys(value, ["version", "state", "reason"]);
	if (
		value.state !== "not-ready" ||
		!READINESS_REASONS.some((reason) => reason === value.reason)
	)
		refuse();
	return {
		version: 1,
		state: "not-ready",
		reason: value.reason as ReadinessReason,
	};
}
export async function boundedNativeAuth<T>(
	signal: AbortSignal,
	operation: () => Promise<T>,
): Promise<T> {
	if (signal.aborted) refuse();
	let onAbort = () => {};
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(new NativeAuthError());
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		const result = await Promise.race([operation(), aborted]);
		if (signal.aborted) refuse();
		return result;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
export const NativeAccountReadinessRpc = Rpc.define({
	id: "flow.native-account-readiness",
	methods: {
		ready: {
			input: {
				type: "object",
				properties: {
					models: {
						type: "array",
						minItems: 1,
						maxItems: 256,
						items: {
							type: "object",
							properties: {
								providerID: { type: "string" },
								id: { type: "string" },
								variant: { type: "string" },
							},
							required: ["providerID", "id"],
							additionalProperties: false,
						},
					},
					timeoutMs: { type: "integer", minimum: 1, maximum: 15000 },
				},
				required: ["models", "timeoutMs"],
				additionalProperties: false,
			},
			output: {
				oneOf: [
					{
						type: "object",
						properties: { version: { const: 1 }, state: { const: "ready" } },
						required: ["version", "state"],
						additionalProperties: false,
					},
					{
						type: "object",
						properties: {
							version: { const: 1 },
							state: { const: "not-ready" },
							reason: { type: "string", enum: READINESS_REASONS },
						},
						required: ["version", "state", "reason"],
						additionalProperties: false,
					},
				],
			},
		},
	},
	events: {},
});
