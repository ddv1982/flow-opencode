#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import {
	EvalHost,
	packPlugin,
	preparePackageCache,
	splitModel,
} from "../evals/harness.js";
import packageJson from "../package.json" with { type: "json" };

const REQUEST_TIMEOUT_MS = 120_000;
const REVIEWER_STEP_LIMIT = 8;
const SENSITIVE_FIELD_WORDS = new Set([
	"authorization",
	"content",
	"credential",
	"cookie",
	"key",
	"output",
	"password",
	"prompt",
	"secret",
	"signature",
	"text",
	"token",
	"tokens",
]);
const MODEL_IDENTITY_PATHS = new Set([
	"[].info.model.modelID",
	"[].info.model.providerID",
	"[].info.modelID",
	"[].info.providerID",
]);

export const HOST_METADATA_CONTRACT = {
	hostVersion: packageJson.devDependencies["@opencode-ai/plugin"],
	endpoints: {
		agents: "GET /agent",
		createSession: "POST /session",
		dispatchReview: "POST /session/:id/command",
		parentMessages: "GET /session/:id/message",
		childSessions: "GET /session/:id/children",
		childMessages: "GET /session/:child_id/message",
	},
	limits: {
		requestTimeoutMs: REQUEST_TIMEOUT_MS,
		reviewerSteps: REVIEWER_STEP_LIMIT,
	},
} as const;

export type EndpointName =
	(typeof HOST_METADATA_CONTRACT.endpoints)[keyof typeof HOST_METADATA_CONTRACT.endpoints];
type FieldKind = "array" | "boolean" | "null" | "number" | "object" | "string";
type FieldObservation = { readonly path: string; readonly kind: FieldKind };
type ParentLabel = `parent-${number}`;
type ChildLabel = `child-${number}`;
type ActorLabel = ParentLabel | ChildLabel;
type UnobservedReason =
	| "endpoint-failure"
	| "field-unavailable"
	| "parent-mismatch"
	| "reviewer-child-not-observed";
type Capability<T> =
	| ({ readonly kind: "observed" } & T)
	| {
			readonly kind: "unobserved";
			readonly reason: UnobservedReason;
			readonly endpoints: readonly EndpointName[];
	  };
type ModelIdentityCapability = Capability<{
	readonly actors: readonly {
		readonly actor: ActorLabel;
		readonly fieldPaths: readonly string[];
	}[];
}>;
type ChildLineageCapability = Capability<{
	readonly links: readonly {
		readonly parent: ParentLabel;
		readonly child: ChildLabel;
		readonly fieldPaths: readonly string[];
	}[];
}>;
type HostVersionCapability = Capability<{
	readonly matchesRequested: boolean;
	readonly fieldPath: "version";
}>;
type UnsupportedClaim =
	| "parent-manager-model-identity"
	| "child-reviewer-model-identity"
	| "child-session-lineage";
type Capabilities = {
	readonly hostVersion: HostVersionCapability;
	readonly parentManagerModelIdentity: ModelIdentityCapability;
	readonly childReviewerModelIdentity: ModelIdentityCapability;
	readonly childLineage: ChildLineageCapability;
};
type InconclusiveReason =
	| "endpoint-failure"
	| "host-version-mismatch"
	| "model-did-not-answer"
	| "required-capability-unavailable"
	| "reviewer-child-not-observed";
type EndpointObservation =
	| {
			readonly kind: "observed";
			readonly endpoint: EndpointName;
			readonly fields: readonly FieldObservation[];
			readonly actor?: ActorLabel;
	  }
	| {
			readonly kind: "endpoint-failure";
			readonly endpoint: EndpointName;
			readonly actor?: ActorLabel;
	  };
export type HostEvidenceCapabilities = {
	readonly opencodeVersion: string;
	readonly generatedAt: string;
	readonly fieldMap: readonly EndpointObservation[];
	readonly capabilities: Capabilities;
	readonly unsupportedClaims: readonly UnsupportedClaim[];
	readonly result:
		| { readonly kind: "complete" }
		| { readonly kind: "inconclusive"; readonly reason: InconclusiveReason };
};
type ProbeArgs = {
	readonly model: string;
	readonly output?: string;
	readonly opencodeVersion: string;
};
export type EndpointAttempt =
	| {
			readonly kind: "observed";
			readonly endpoint: EndpointName;
			readonly response: unknown;
	  }
	| { readonly kind: "endpoint-failure"; readonly endpoint: EndpointName };
type ChildSession = {
	readonly agent: string;
	readonly id: string;
	readonly parentID: string;
};
type ProbeInput = {
	readonly opencodeVersion: string;
	readonly generatedAt: string;
	readonly parentSessionId: string | null;
	readonly endpointResponses: readonly EndpointAttempt[];
	readonly childSessions: EndpointAttempt | null;
	readonly parentMessages: EndpointAttempt | null;
	readonly childMessages: readonly {
		readonly sessionId: string;
		readonly messages: EndpointAttempt;
	}[];
};

function usage(): string {
	return [
		"usage: bun run scripts/probe-opencode-eval-metadata.ts --allow-live-credentials --model <provider/model> [--output <path>]",
		"",
		"This paid live probe copies your OpenCode credentials into an isolated host and can make one manager and one bounded reviewer call.",
		`The reviewer is limited to ${REVIEWER_STEP_LIMIT} steps and each HTTP request to ${REQUEST_TIMEOUT_MS}ms.`,
		"The run creates one parent session, dispatches /flow-review, and emits a redacted field map.",
		"Set OPENCODE_FLOW_REVIEWER_MODEL to force a reviewer model before running this probe.",
	].join("\n");
}

function parseArgs(argv: readonly string[]): ProbeArgs {
	let model: string | undefined;
	let output: string | undefined;
	let opencodeVersion = HOST_METADATA_CONTRACT.hostVersion;
	let allowLiveCredentials = false;
	for (let index = 0; index < argv.length; index += 1) {
		const [flag, value] = [argv[index], argv[index + 1]];
		if (flag === "--allow-live-credentials") allowLiveCredentials = true;
		else if (flag === "--model" && value) {
			model = value;
			index += 1;
		} else if (flag === "--output" && value) {
			output = value;
			index += 1;
		} else if (flag === "--opencode-version" && value) {
			opencodeVersion = value;
			index += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(usage());
			process.exit(0);
		} else throw new Error(`Unknown or incomplete argument: ${flag ?? ""}`);
	}
	if (!allowLiveCredentials)
		throw new Error(
			"Pass --allow-live-credentials to acknowledge paid model calls.",
		);
	if (!model) throw new Error("Pass --model provider/model.");
	splitModel(model);
	return {
		model,
		opencodeVersion,
		...(output ? { output } : {}),
	};
}

function kindOf(value: unknown): FieldKind {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	switch (typeof value) {
		case "boolean":
			return "boolean";
		case "number":
			return "number";
		case "object":
			return "object";
		case "string":
			return "string";
		default:
			return "string";
	}
}

function redactsField(key: string): boolean {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.some((word) => SENSITIVE_FIELD_WORDS.has(word));
}

function childLabel(index: number): ChildLabel {
	return `child-${index + 1}`;
}

export function collectFieldObservations(value: unknown): FieldObservation[] {
	const fields = new Map<string, FieldKind>();
	const visit = (node: unknown, path: string): void => {
		if (path) fields.set(path, kindOf(node));
		if (Array.isArray(node)) {
			for (const item of node) visit(item, `${path}[]`);
			return;
		}
		if (!isRecord(node)) return;
		for (const [key, child] of Object.entries(node))
			if (!redactsField(key)) visit(child, path ? `${path}.${key}` : key);
	};
	visit(value, "");
	return [...fields]
		.map(([path, kind]) => ({ path, kind }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value : null;
}

function parseChildren(value: unknown): {
	children: readonly ChildSession[];
	malformed: boolean;
} {
	if (!Array.isArray(value)) return { children: [], malformed: false };
	const children: ChildSession[] = [];
	let malformed = false;
	for (const row of value) {
		if (!isRecord(row)) {
			malformed = true;
			continue;
		}
		const [agent, id, parentID] = ["agent", "id", "parentID"].map((key) =>
			stringField(row, key),
		);
		if (!agent || !id || !parentID) malformed = true;
		else children.push({ agent, id, parentID });
	}
	return { children, malformed };
}

function completedAssistantMessages(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(message) =>
			isRecord(message) &&
			isRecord(message.info) &&
			message.info.role === "assistant" &&
			!("error" in message.info) &&
			isRecord(message.info.time) &&
			typeof message.info.time.completed === "number",
	);
}

function modelIdentityFields(messages: unknown): readonly string[] {
	return collectFieldObservations(completedAssistantMessages(messages))
		.filter((field) => MODEL_IDENTITY_PATHS.has(field.path))
		.map((field) => field.path)
		.sort();
}

function hasModelIdentity(fields: readonly string[]): boolean {
	return ["providerID", "modelID"].every((suffix) =>
		fields.some((path) => path.endsWith(suffix)),
	);
}

function unobserved<T>(
	reason: UnobservedReason,
	endpoints: readonly EndpointName[],
): Capability<T> {
	return {
		kind: "unobserved",
		reason,
		endpoints: [...new Set(endpoints)].sort(),
	};
}

function endpointObservation(
	attempt: EndpointAttempt,
	actor?: ActorLabel,
): EndpointObservation {
	if (attempt.kind === "endpoint-failure")
		return {
			kind: "endpoint-failure",
			endpoint: attempt.endpoint,
			...(actor ? { actor } : {}),
		};
	return {
		kind: "observed",
		endpoint: attempt.endpoint,
		fields: collectFieldObservations(attempt.response),
		...(actor ? { actor } : {}),
	};
}

function endpointFailure(
	attempt: EndpointAttempt | null | undefined,
	fallback: EndpointName,
): readonly EndpointName[] {
	return !attempt || attempt.kind === "endpoint-failure"
		? [attempt?.endpoint ?? fallback]
		: [];
}

function hostVersion(
	attempt: EndpointAttempt | undefined,
	requested: string,
): HostVersionCapability {
	const endpoint = HOST_METADATA_CONTRACT.endpoints.createSession;
	if (!attempt || attempt.kind === "endpoint-failure")
		return unobserved("endpoint-failure", [endpoint]);
	if (!isRecord(attempt.response))
		return unobserved("field-unavailable", [endpoint]);
	const version = stringField(attempt.response, "version");
	return version
		? {
				kind: "observed",
				matchesRequested: version === requested,
				fieldPath: "version",
			}
		: unobserved("field-unavailable", [endpoint]);
}

function unsupportedClaims(
	capabilities: Capabilities,
): readonly UnsupportedClaim[] {
	const claims: UnsupportedClaim[] = [];
	const add = (
		capability: Capability<unknown>,
		claim: UnsupportedClaim,
		ignored: readonly UnobservedReason[] = [],
	) => {
		if (
			capability.kind === "unobserved" &&
			!ignored.includes(capability.reason)
		)
			claims.push(claim);
	};
	add(
		capabilities.parentManagerModelIdentity,
		"parent-manager-model-identity",
		["endpoint-failure"],
	);
	add(
		capabilities.childReviewerModelIdentity,
		"child-reviewer-model-identity",
		["endpoint-failure", "reviewer-child-not-observed"],
	);
	add(capabilities.childLineage, "child-session-lineage", [
		"endpoint-failure",
		"reviewer-child-not-observed",
	]);
	return claims;
}

export function buildHostEvidenceCapabilities(
	input: ProbeInput,
): HostEvidenceCapabilities {
	const parent: ParentLabel = "parent-1";
	const createSession = input.endpointResponses.find(
		(attempt) =>
			attempt.endpoint === HOST_METADATA_CONTRACT.endpoints.createSession,
	);
	const { children, malformed } =
		input.childSessions?.kind === "observed"
			? parseChildren(input.childSessions.response)
			: { children: [], malformed: false };
	const reviewers = children.filter((child) => child.agent === "flow-reviewer");
	const matching = input.parentSessionId
		? reviewers.filter((child) => child.parentID === input.parentSessionId)
		: [];
	const lineageValid =
		reviewers.length > 0 && !malformed && matching.length === reviewers.length;
	const labels = new Map(
		matching.map((child, index) => [child.id, childLabel(index)]),
	);
	const childMessages = input.childMessages.flatMap((child) => {
		const label = labels.get(child.sessionId);
		return label ? [{ ...child, label }] : [];
	});
	const fieldMap = [
		...input.endpointResponses.map((attempt) => endpointObservation(attempt)),
		...(input.childSessions ? [endpointObservation(input.childSessions)] : []),
		...(input.parentMessages
			? [endpointObservation(input.parentMessages, parent)]
			: []),
		...childMessages.map((child) =>
			endpointObservation(child.messages, child.label),
		),
	];
	const parentFailures = endpointFailure(
		input.parentMessages,
		HOST_METADATA_CONTRACT.endpoints.parentMessages,
	);
	const parentFields =
		input.parentMessages?.kind === "observed"
			? modelIdentityFields(input.parentMessages.response)
			: [];
	const parentManagerModelIdentity: ModelIdentityCapability =
		parentFailures.length
			? unobserved("endpoint-failure", parentFailures)
			: hasModelIdentity(parentFields)
				? {
						kind: "observed",
						actors: [{ actor: parent, fieldPaths: parentFields }],
					}
				: unobserved("field-unavailable", [
						HOST_METADATA_CONTRACT.endpoints.parentMessages,
					]);
	const lineageFailures = endpointFailure(
		input.childSessions,
		HOST_METADATA_CONTRACT.endpoints.childSessions,
	);
	const childLineage: ChildLineageCapability = lineageFailures.length
		? unobserved("endpoint-failure", lineageFailures)
		: !lineageValid
			? unobserved(
					reviewers.length === 0
						? "reviewer-child-not-observed"
						: malformed
							? "field-unavailable"
							: "parent-mismatch",
					[HOST_METADATA_CONTRACT.endpoints.childSessions],
				)
			: {
					kind: "observed",
					links: matching.flatMap((child) => {
						const label = labels.get(child.id);
						return label
							? [
									{
										parent,
										child: label,
										fieldPaths: ["[].id", "[].parentID"],
									},
								]
							: [];
					}),
				};
	const childFailures = childMessages.flatMap((child) =>
		endpointFailure(
			child.messages,
			HOST_METADATA_CONTRACT.endpoints.childMessages,
		),
	);
	const childReviewerModelIdentity: ModelIdentityCapability = [
		...lineageFailures,
		...childFailures,
	].length
		? unobserved("endpoint-failure", [...lineageFailures, ...childFailures])
		: childLineage.kind === "unobserved"
			? unobserved(childLineage.reason, childLineage.endpoints)
			: (() => {
					const actors = childMessages.flatMap((child) => {
						const fields =
							child.messages.kind === "observed"
								? modelIdentityFields(child.messages.response)
								: [];
						return hasModelIdentity(fields)
							? [{ actor: child.label, fieldPaths: fields }]
							: [];
					});
					return actors.length === matching.length && matching.length > 0
						? { kind: "observed", actors }
						: unobserved("field-unavailable", [
								HOST_METADATA_CONTRACT.endpoints.childMessages,
							]);
				})();
	const capabilities = {
		hostVersion: hostVersion(createSession, input.opencodeVersion),
		parentManagerModelIdentity,
		childReviewerModelIdentity,
		childLineage,
	};
	const unsupported = unsupportedClaims(capabilities);
	const unanswered =
		(input.parentMessages?.kind === "observed" &&
			completedAssistantMessages(input.parentMessages.response).length === 0) ||
		childMessages.some(
			(child) =>
				child.messages.kind === "observed" &&
				completedAssistantMessages(child.messages.response).length === 0,
		);
	const result: HostEvidenceCapabilities["result"] = fieldMap.some(
		(entry) => entry.kind === "endpoint-failure",
	)
		? { kind: "inconclusive", reason: "endpoint-failure" }
		: capabilities.hostVersion.kind === "observed" &&
				!capabilities.hostVersion.matchesRequested
			? {
					kind: "inconclusive",
					reason: "host-version-mismatch",
				}
			: unanswered
				? {
						kind: "inconclusive",
						reason: "model-did-not-answer",
					}
				: capabilities.childLineage.kind === "unobserved"
					? {
							kind: "inconclusive",
							reason: "reviewer-child-not-observed",
						}
					: capabilities.hostVersion.kind === "unobserved" || unsupported.length
						? {
								kind: "inconclusive",
								reason: "required-capability-unavailable",
							}
						: { kind: "complete" };
	return {
		opencodeVersion: input.opencodeVersion,
		generatedAt: input.generatedAt,
		fieldMap,
		capabilities,
		unsupportedClaims: unsupported,
		result,
	};
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok)
		throw new Error(`GET ${url} failed with ${response.status}.`);
	return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok)
		throw new Error(`POST ${url} failed with ${response.status}.`);
	return response.json();
}

async function observeEndpoint(
	endpoint: EndpointName,
	task: () => Promise<unknown>,
): Promise<EndpointAttempt> {
	try {
		return { kind: "observed", endpoint, response: await task() };
	} catch {
		return { kind: "endpoint-failure", endpoint };
	}
}

function sessionId(attempt: EndpointAttempt): string | null {
	return attempt.kind === "observed" && isRecord(attempt.response)
		? stringField(attempt.response, "id")
		: null;
}

async function runProbe(args: ProbeArgs): Promise<HostEvidenceCapabilities> {
	const repositoryRoot = join(import.meta.dir, "..");
	const toolchain = currentBunToolchain(packageJson.packageManager);
	const packDir = await mkdtemp(join(tmpdir(), "flow-metadata-probe-"));
	const previousReviewerSteps = process.env.OPENCODE_FLOW_REVIEWER_STEPS;
	process.env.OPENCODE_FLOW_REVIEWER_STEPS = String(REVIEWER_STEP_LIMIT);
	let host: EvalHost | null = null;
	try {
		const packageCache = await preparePackageCache(
			await packPlugin(repositoryRoot, packDir, toolchain),
			packDir,
			toolchain,
		);
		host = await EvalHost.start({
			packageCache,
			opencodeVersion: args.opencodeVersion,
			files: { "README.md": "# Metadata probe\n" },
		});
		const baseUrl = host.url;
		const agents = await observeEndpoint(
			HOST_METADATA_CONTRACT.endpoints.agents,
			() => fetchJson(`${baseUrl}/agent`),
		);
		const createSession = await observeEndpoint(
			HOST_METADATA_CONTRACT.endpoints.createSession,
			() => postJson(`${baseUrl}/session`, { title: "flow metadata probe" }),
		);
		const parentSessionId = sessionId(createSession);
		if (!parentSessionId)
			return buildHostEvidenceCapabilities({
				opencodeVersion: args.opencodeVersion,
				generatedAt: new Date().toISOString(),
				parentSessionId: null,
				endpointResponses: [agents, createSession],
				childSessions: null,
				parentMessages: null,
				childMessages: [],
			});
		const dispatchReview = await observeEndpoint(
			HOST_METADATA_CONTRACT.endpoints.dispatchReview,
			() =>
				postJson(`${baseUrl}/session/${parentSessionId}/command`, {
					command: "flow-review",
					arguments:
						"Review this tiny project and submit the Flow review result.",
					model: args.model,
				}),
		);
		const childSessions = await observeEndpoint(
			HOST_METADATA_CONTRACT.endpoints.childSessions,
			() => fetchJson(`${baseUrl}/session/${parentSessionId}/children`),
		);
		const parentMessages = await observeEndpoint(
			HOST_METADATA_CONTRACT.endpoints.parentMessages,
			() => fetchJson(`${baseUrl}/session/${parentSessionId}/message`),
		);
		const children =
			childSessions.kind === "observed"
				? parseChildren(childSessions.response).children.filter(
						(child) =>
							child.agent === "flow-reviewer" &&
							child.parentID === parentSessionId,
					)
				: [];
		const childMessages = await Promise.all(
			children.map(async (child) => ({
				sessionId: child.id,
				messages: await observeEndpoint(
					HOST_METADATA_CONTRACT.endpoints.childMessages,
					() => fetchJson(`${baseUrl}/session/${child.id}/message`),
				),
			})),
		);
		return buildHostEvidenceCapabilities({
			opencodeVersion: args.opencodeVersion,
			generatedAt: new Date().toISOString(),
			parentSessionId,
			endpointResponses: [agents, createSession, dispatchReview],
			childSessions,
			parentMessages,
			childMessages,
		});
	} finally {
		try {
			await host?.stop();
		} finally {
			await rm(packDir, { recursive: true, force: true });
			if (previousReviewerSteps === undefined)
				delete process.env.OPENCODE_FLOW_REVIEWER_STEPS;
			else process.env.OPENCODE_FLOW_REVIEWER_STEPS = previousReviewerSteps;
		}
	}
}

if (import.meta.main) {
	try {
		const args = parseArgs(Bun.argv.slice(2));
		const capabilities = await runProbe(args);
		const output = `${JSON.stringify(capabilities, null, 2)}\n`;
		if (args.output) await writeFile(args.output, output, "utf8");
		else process.stdout.write(output);
		if (capabilities.result.kind === "inconclusive") process.exitCode = 1;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(usage());
		process.exitCode = 2;
	}
}
