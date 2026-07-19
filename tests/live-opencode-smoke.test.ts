import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { SessionSchema } from "../src/application/schema.js";
import type { Session } from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import { closeSession } from "../src/domain/transitions.js";
import {
	MAX_VALIDATION_RECEIPT_BYTES,
	parseValidationReceiptRef,
	type ValidationReceiptRef,
} from "../src/domain/validation-receipt.js";
import { archivedSessionFilename } from "../src/infrastructure/fs/workspace.js";
import { systemTransitionEnvironment } from "../src/infrastructure/system/transition-environment.js";
import {
	assertLifecycleLiveProofObservation,
	LIFECYCLE_LIVE_PROOF_REGISTRY,
	PINNED_LIVE_OPENCODE_VERSION,
} from "./support/lifecycle-live-proof-registry.js";

// Boots a real OpenCode server with the packed tarball installed as a
// plugin and verifies the public Flow surface over the HTTP API. It boots the
// exact OpenCode version paired with the pinned plugin dev dependency through
// bunx by default. Scheduled compatibility monitoring overrides the package
// spec with FLOW_OPENCODE_SMOKE_VERSION=latest. The test requires network
// access, so it only runs when explicitly requested: FLOW_LIVE_SMOKE=1.
const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const PINNED_OPENCODE_VERSION =
	packageJson.devDependencies["@opencode-ai/plugin"];

function resolveOpenCodeVersion(override: string | undefined): string {
	return override?.trim() || PINNED_OPENCODE_VERSION;
}

const OPENCODE_VERSION = resolveOpenCodeVersion(
	process.env.FLOW_OPENCODE_SMOKE_VERSION,
);
// The server reports healthy before plugins finish loading, and the first
// data request blocks while it bun-installs the plugin's dependencies over
// the network — so health polls retry on a short timeout while data
// requests get a generous but bounded one (a hung request must not stall
// the test past its own failure reporting).
const STARTUP_TIMEOUT_MS = 180_000;
const HEALTH_POLL_TIMEOUT_MS = 3_000;
const DATA_REQUEST_TIMEOUT_MS = 120_000;

const EXPECTED_COMMANDS = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
];
const EXPECTED_AGENTS = [
	"flow-audit-worker",
	"flow-candidate-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
];

// The read-only workers whose isolation must actually bind: they may inspect
// and read, but must not mutate Flow state, spawn subagents, load native
// skills, or edit files. (flow-candidate-worker is excluded — it may edit/bash
// with "ask" in an assigned slice.)
const READ_ONLY_WORKERS = [
	"flow-audit-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
];

type ResolvedPermissionRule = {
	permission: string;
	pattern: string;
	action: "ask" | "allow" | "deny";
};

type ResolvedAgent = {
	name: string;
	permission?: ResolvedPermissionRule[];
};

type JsonSchema = {
	[key: string]: unknown;
	additionalProperties?: boolean;
	allOf?: JsonSchema[];
	anyOf?: JsonSchema[];
	const?: unknown;
	exclusiveMinimum?: number;
	items?: JsonSchema;
	maximum?: number;
	minimum?: number;
	minItems?: number;
	oneOf?: JsonSchema[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	type?: string;
};

type ModelTool = {
	function?: {
		name?: string;
		parameters?: JsonSchema;
	};
};

type ChatCompletionBody = {
	messages?: Array<{ content?: unknown; role?: string }>;
	model?: string;
	stream?: boolean;
	tools?: ModelTool[];
};

type CallExpectation =
	| "accepted-mutation"
	| "accepted-read"
	| "accepted-command"
	| "archive-failure"
	| "archive-retry"
	| "schema-rejected";

type ScriptedCall = {
	expectation: CallExpectation;
	label: string;
	name: string;
};

type ScriptedModel = {
	baseUrl: string;
	commandRequests: Array<{
		toolNames: string[];
		transcript: string;
	}>;
	modelVisibleSchemas: Map<string, JsonSchema>;
	modelErrors: string[];
	recoveredRetryOperationId: string | null;
	rejectionMutationChecks: string[];
	stateValidationChecks: string[];
	toolCalls: ScriptedCall[];
	beginCommandObservation(): void;
	close(): Promise<void>;
};

type PendingObservation = {
	beforeBytes: string | null;
	call: ScriptedCall;
};

const CONDITIONAL_TOOL_NAMES = [
	"flow_status",
	"flow_review_start",
	"flow_feature_complete",
	"flow_session_close",
] as const;
const MODEL_SCHEMA_TOOL_NAMES = [
	...CONDITIONAL_TOOL_NAMES,
	"flow_validation_start",
] as const;

function property(schema: JsonSchema, name: string): JsonSchema {
	const value = schema.properties?.[name];
	if (!value) throw new Error(`Missing JSON Schema property '${name}'.`);
	return value;
}

function items(schema: JsonSchema): JsonSchema {
	if (!schema.items) throw new Error("Missing JSON Schema items.");
	return schema.items;
}

function schemaBranches(schema: JsonSchema): JsonSchema[] {
	return schema.anyOf ?? schema.oneOf ?? [];
}

function literalValue(schema: JsonSchema): unknown {
	if ("const" in schema) return schema.const;
	const values = schema.enum;
	return Array.isArray(values) && values.length === 1 ? values[0] : undefined;
}

function branchWithLiteral(
	schema: JsonSchema,
	propertyName: string,
	value: string,
): JsonSchema {
	const branch = schemaBranches(schema).find(
		(candidate) => literalValue(property(candidate, propertyName)) === value,
	);
	if (!branch) {
		throw new Error(
			`Missing JSON Schema branch ${propertyName}=${JSON.stringify(value)}.`,
		);
	}
	return branch;
}

function expectPassingSubmittedReviewSchema(schema: JsonSchema): void {
	expect(literalValue(property(schema, "verdict"))).toBe("passed");
	expect(literalValue(property(schema, "terminalDisposition"))).toBe(
		"submitted",
	);
	expect(
		literalValue(property(items(property(schema, "findings")), "severity")),
	).toBe("advisory");
}

function collectNamedProperties(
	schema: JsonSchema,
	names: ReadonlySet<string>,
	result: Array<{ name: string; schema: JsonSchema }> = [],
): Array<{ name: string; schema: JsonSchema }> {
	for (const [name, child] of Object.entries(schema.properties ?? {})) {
		if (names.has(name)) result.push({ name, schema: child });
		collectNamedProperties(child, names, result);
	}
	for (const branch of schema.anyOf ?? []) {
		collectNamedProperties(branch, names, result);
	}
	for (const branch of schema.oneOf ?? []) {
		collectNamedProperties(branch, names, result);
	}
	for (const branch of schema.allOf ?? []) {
		collectNamedProperties(branch, names, result);
	}
	if (schema.items) collectNamedProperties(schema.items, names, result);
	return result;
}

function assertModelVisibleSchemas(
	schemas: ReadonlyMap<string, JsonSchema>,
): void {
	for (const toolName of CONDITIONAL_TOOL_NAMES) {
		const schema = schemas.get(toolName);
		if (!schema) throw new Error(`The model did not receive ${toolName}.`);
		expect(
			schema.required,
			`${toolName} requires the request envelope`,
		).toContain("request");
		// OpenCode 1.18.3 constructs this SDK-owned outer object from the raw
		// argument shape and omits `additionalProperties`. Flow owns and advertises
		// the strict nested request branches below, then re-parses the complete
		// envelope at handler entry. Accept a future host tightening the wrapper,
		// but never an explicitly permissive wrapper.
		expect(
			schema.additionalProperties,
			`${toolName} outer wrapper is not explicitly permissive`,
		).not.toBe(true);
	}

	const statusRequest = property(
		schemas.get("flow_status") as JsonSchema,
		"request",
	);
	expect(schemaBranches(statusRequest)).toHaveLength(4);
	for (const branch of schemaBranches(statusRequest)) {
		expect(branch.additionalProperties).toBe(false);
	}
	const reviewerStatus = branchWithLiteral(statusRequest, "view", "reviewer");
	expect(reviewerStatus.required).toEqual(["view", "assignmentId"]);

	const reviewRequest = property(
		schemas.get("flow_review_start") as JsonSchema,
		"request",
	);
	expect(schemaBranches(reviewRequest)).toHaveLength(2);
	const featureReview = branchWithLiteral(
		reviewRequest,
		"reviewKind",
		"feature",
	);
	const finalReview = branchWithLiteral(reviewRequest, "reviewKind", "final");
	for (const branch of [featureReview, finalReview]) {
		expect(branch.additionalProperties).toBe(false);
	}
	const featureValidationRef = items(property(featureReview, "validationRefs"));
	expect(featureValidationRef.additionalProperties).toBe(false);
	expect(literalValue(property(featureValidationRef, "kind"))).toBe(
		"validation_receipt_ref_v1",
	);
	expect(featureValidationRef.required).toEqual([
		"kind",
		"digest",
		"byteLength",
	]);
	expect(featureReview.required).not.toContain("featureReview");
	expect(featureReview.properties).not.toHaveProperty("featureReview");
	expect(finalReview.required).toContain("featureReview");
	expect(literalValue(property(featureReview, "validationScope"))).toBe(
		"targeted",
	);
	expect(literalValue(property(finalReview, "validationScope"))).toBe("broad");
	expectPassingSubmittedReviewSchema(property(finalReview, "featureReview"));

	const validationStart = schemas.get("flow_validation_start");
	if (!validationStart) {
		throw new Error("The model did not receive flow_validation_start.");
	}
	// Like the request-envelope tools above, OpenCode reconstructs the SDK raw
	// argument shape and currently omits this marker. It must never advertise an
	// explicitly permissive boundary; the tool reparses the strict object.
	expect(
		validationStart.additionalProperties,
		"flow_validation_start is not explicitly permissive",
	).not.toBe(true);
	expect(validationStart.required).toEqual([
		"expectedRevision",
		"expectedSnapshotId",
		"featureId",
		"command",
		"coverageScope",
		"environmentKeys",
	]);
	expect(property(validationStart, "coverageScope").enum).toEqual([
		"focused",
		"broad",
		"artifact",
	]);

	const completionRequest = property(
		schemas.get("flow_feature_complete") as JsonSchema,
		"request",
	);
	expect(completionRequest.additionalProperties).toBe(false);
	const completionResult = property(completionRequest, "result");
	expect(schemaBranches(completionResult)).toHaveLength(3);
	const targetedCompletion = branchWithLiteral(
		completionResult,
		"validationScope",
		"targeted",
	);
	const broadCompletion = branchWithLiteral(
		completionResult,
		"validationScope",
		"broad",
	);
	const blockedCompletion = branchWithLiteral(
		completionResult,
		"kind",
		"blocked",
	);
	expect(targetedCompletion.required).toContain("featureReview");
	expect(targetedCompletion.required).not.toContain("finalReview");
	expect(targetedCompletion.properties).not.toHaveProperty("finalReview");
	expect(broadCompletion.required).toContain("finalReview");
	expect(broadCompletion.required).not.toContain("featureReview");
	expect(broadCompletion.properties).not.toHaveProperty("featureReview");
	expectPassingSubmittedReviewSchema(
		property(targetedCompletion, "featureReview"),
	);
	expectPassingSubmittedReviewSchema(property(broadCompletion, "finalReview"));
	const blockedReview = property(blockedCompletion, "review");
	expect(literalValue(property(blockedReview, "verdict"))).toBe("failed");
	expect(property(blockedReview, "terminalDisposition").enum).toEqual([
		"submitted",
		"observed_unsubmitted",
	]);
	expect(property(blockedReview, "findings").minItems).toBe(1);

	const closeRequest = property(
		schemas.get("flow_session_close") as JsonSchema,
		"request",
	);
	expect(schemaBranches(closeRequest)).toHaveLength(2);
	const closeStart = branchWithLiteral(closeRequest, "mode", "start");
	const closeRetry = branchWithLiteral(closeRequest, "mode", "retry");
	for (const branch of [closeStart, closeRetry]) {
		expect(branch.additionalProperties).toBe(false);
	}
	expect(closeStart.required).toEqual([
		"mode",
		"operationId",
		"expectedRevision",
		"expectedSnapshotId",
		"kind",
	]);
	expect(closeRetry.required).toEqual(["mode", "operationId"]);
	expect(closeRetry.properties).not.toHaveProperty("summary");
	expect(closeRetry.properties).not.toHaveProperty("expectedRevision");

	const boundedNames = new Set([
		"byteLength",
		"expectedRevision",
		"sinceRevision",
	]);
	const bounded = [...schemas.values()].flatMap((schema) =>
		collectNamedProperties(schema, boundedNames),
	);
	expect(new Set(bounded.map((entry) => entry.name))).toEqual(boundedNames);
	for (const entry of bounded) {
		expect(entry.schema.type, `${entry.name} is emitted as an integer`).toBe(
			"integer",
		);
		if (entry.name === "byteLength") {
			expect(
				entry.schema.exclusiveMinimum,
				"receipt byteLength is positive",
			).toBe(0);
			expect(
				entry.schema.maximum,
				"receipt byteLength remains artifact-bounded",
			).toBe(MAX_VALIDATION_RECEIPT_BYTES);
		} else {
			expect(entry.schema.minimum, `${entry.name} is nonnegative`).toBe(0);
			expect(
				entry.schema.maximum,
				`${entry.name} stays safely representable`,
			).toBe(Number.MAX_SAFE_INTEGER);
		}
	}
}

// OpenCode resolves an agent's permission config into an ordered rule list
// returned by GET /agent. Pinned OpenCode 1.18.3 wildcard-matches both fields
// and uses the last matching rule, so the live proof must evaluate precedence
// instead of treating any earlier matching rule as authoritative.
function matchesOpenCodeWildcard(input: string, pattern: string): boolean {
	const normalized = input.replaceAll("\\", "/");
	let escaped = pattern
		.replaceAll("\\", "/")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	if (escaped.endsWith(" .*")) {
		escaped = `${escaped.slice(0, -3)}( .*)?`;
	}
	return new RegExp(`^${escaped}$`, "s").test(normalized);
}

function effectivePermissionAction(
	rules: ResolvedPermissionRule[],
	permission: string,
	pattern = "*",
): ResolvedPermissionRule["action"] {
	for (let index = rules.length - 1; index >= 0; index -= 1) {
		const rule = rules[index];
		if (
			rule &&
			matchesOpenCodeWildcard(permission, rule.permission) &&
			matchesOpenCodeWildcard(pattern, rule.pattern)
		) {
			return rule.action;
		}
	}
	return "ask";
}

async function fetchJson(
	url: string,
	timeoutMs = DATA_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed with ${response.status}`);
	}
	return response.json();
}

async function postJson(
	url: string,
	body: unknown,
	timeoutMs = DATA_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(
			`POST ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	if (response.status === 204) return null;
	return response.json();
}

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

async function startScriptedModel(project: string): Promise<ScriptedModel> {
	const toolCalls: ScriptedCall[] = [];
	const modelVisibleSchemas = new Map<string, JsonSchema>();
	const modelErrors: string[] = [];
	const rejectionMutationChecks: string[] = [];
	const stateValidationChecks: string[] = [];
	const activeSessionPath = join(project, ".flow", "session.json");
	const archiveDirectory = join(project, ".flow", "history");
	let recoveredRetryOperationId: string | null = null;
	let pendingObservation: PendingObservation | null = null;
	let phase = 0;
	let phaseStep = 0;
	let responseSequence = 0;
	let observeCommandRequests = false;
	let focusedValidationRef: ValidationReceiptRef | null = null;
	let broadValidationRef: ValidationReceiptRef | null = null;
	const commandRequests: ScriptedModel["commandRequests"] = [];

	const sessionBytes = async (): Promise<string | null> => {
		try {
			return await readFile(activeSessionPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	};

	const parseSession = (bytes: string, label: string): Session => {
		const session = SessionSchema.parse(JSON.parse(bytes));
		expect(validateSessionInvariants(session), label).toBeNull();
		return session;
	};

	const activeSession = async (): Promise<Session> => {
		const bytes = await sessionBytes();
		if (bytes === null) throw new Error("Expected an active Session v4 file.");
		return parseSession(bytes, "active Session v4 invariants");
	};

	const validateActiveState = async (label: string): Promise<Session> => {
		const session = await activeSession();
		stateValidationChecks.push(label);
		return session;
	};

	const validateArchive = async (label: string): Promise<Session> => {
		const archiveNames = (await readdir(archiveDirectory)).filter((name) =>
			name.endsWith(".json"),
		);
		expect(
			archiveNames,
			"exactly one Session v4 archive is published",
		).toHaveLength(1);
		const archiveName = archiveNames[0];
		if (!archiveName) throw new Error("Expected a Session v4 archive name.");
		const archived = parseSession(
			await readFile(join(archiveDirectory, archiveName), "utf8"),
			label,
		);
		stateValidationChecks.push(label);
		return archived;
	};

	const flowResponseFromContent = (
		content: unknown,
	): { status: string; workflowData?: Record<string, unknown> } | null => {
		if (typeof content === "string") {
			try {
				return flowResponseFromContent(JSON.parse(content));
			} catch {
				return null;
			}
		}
		if (Array.isArray(content)) {
			for (let index = content.length - 1; index >= 0; index -= 1) {
				const result = flowResponseFromContent(content[index]);
				if (result) return result;
			}
			return null;
		}
		if (content === null || typeof content !== "object") return null;
		const record = content as Record<string, unknown>;
		if (
			typeof record.status === "string" &&
			(record.workflowData === undefined ||
				typeof record.workflowData === "object")
		) {
			return record as {
				status: string;
				workflowData?: Record<string, unknown>;
			};
		}
		for (const value of Object.values(record).reverse()) {
			const result = flowResponseFromContent(value);
			if (result) return result;
		}
		return null;
	};

	const latestFlowResponse = (
		body: ChatCompletionBody,
	): { status: string; workflowData?: Record<string, unknown> } | null => {
		for (const message of [...(body.messages ?? [])].reverse()) {
			if (message.role !== "tool") continue;
			return flowResponseFromContent(message.content);
		}
		return null;
	};

	const validationReceiptRefFromContent = (
		content: unknown,
	): ValidationReceiptRef | null => {
		if (typeof content === "string") {
			const marker = "[flow-validation-receipt] ";
			const markerIndex = content.lastIndexOf(marker);
			if (markerIndex < 0) return null;
			const line = content
				.slice(markerIndex + marker.length)
				.split(/\r?\n/, 1)[0]
				?.trim();
			if (!line) return null;
			try {
				return parseValidationReceiptRef(JSON.parse(line));
			} catch {
				return null;
			}
		}
		if (Array.isArray(content)) {
			for (let index = content.length - 1; index >= 0; index -= 1) {
				const reference = validationReceiptRefFromContent(content[index]);
				if (reference) return reference;
			}
			return null;
		}
		if (content === null || typeof content !== "object") return null;
		for (const value of Object.values(content).reverse()) {
			const reference = validationReceiptRefFromContent(value);
			if (reference) return reference;
		}
		return null;
	};

	const latestValidationReceiptRef = (
		body: ChatCompletionBody,
	): ValidationReceiptRef | null => {
		for (const message of [...(body.messages ?? [])].reverse()) {
			if (message.role !== "tool") continue;
			return validationReceiptRefFromContent(message.content);
		}
		return null;
	};

	const observePendingCall = async (
		body: ChatCompletionBody,
	): Promise<void> => {
		if (!pendingObservation) return;
		const { beforeBytes, call } = pendingObservation;
		const afterBytes = await sessionBytes();
		const response = latestFlowResponse(body);
		switch (call.expectation) {
			case "schema-rejected":
				expect(
					afterBytes,
					`${call.label} leaves Session v4 bytes unchanged`,
				).toBe(beforeBytes);
				expect(
					response,
					`${call.label} never reaches Flow execution`,
				).toBeNull();
				if (afterBytes !== null) parseSession(afterBytes, call.label);
				rejectionMutationChecks.push(call.label);
				break;
			case "accepted-read":
				expect(afterBytes, `${call.label} is read-only`).toBe(beforeBytes);
				expect(response?.status, call.label).toBe("ok");
				await validateActiveState(call.label);
				break;
			case "accepted-command": {
				expect(afterBytes, `${call.label} does not mutate Session v4`).toBe(
					beforeBytes,
				);
				const reference = latestValidationReceiptRef(body);
				expect(
					reference,
					`${call.label} returns an immutable receipt ref`,
				).not.toBe(null);
				if (!reference)
					throw new Error(`${call.label} omitted its receipt ref.`);
				if (call.label === "run focused validation command") {
					focusedValidationRef = reference;
				} else if (call.label === "run broad validation command") {
					broadValidationRef = reference;
				}
				await validateActiveState(call.label);
				break;
			}
			case "accepted-mutation":
				expect(afterBytes, `${call.label} persists a new state`).not.toBe(
					beforeBytes,
				);
				expect(response?.status, call.label).toBe("ok");
				await validateActiveState(call.label);
				break;
			case "archive-failure": {
				expect(afterBytes, `${call.label} durably records closure`).not.toBe(
					beforeBytes,
				);
				expect(response?.status, call.label).toBe("error");
				const closed = await validateActiveState(call.label);
				expect(closed.closure?.retryOperationId).toHaveLength(128);
				break;
			}
			case "archive-retry": {
				expect(response?.status, call.label).toBe("ok");
				expect(
					afterBytes,
					`${call.label} clears the active session`,
				).toBeNull();
				const archived = await validateArchive(call.label);
				expect(archived.closure?.retryOperationId ?? null).toBe(
					recoveredRetryOperationId,
				);
				break;
			}
		}
		pendingObservation = null;
	};

	const captureModelVisibleSchemas = (tools: ModelTool[]): void => {
		for (const candidate of tools) {
			const name = candidate.function?.name;
			const parameters = candidate.function?.parameters;
			if (
				!name ||
				!parameters ||
				!MODEL_SCHEMA_TOOL_NAMES.includes(
					name as (typeof MODEL_SCHEMA_TOOL_NAMES)[number],
				)
			) {
				continue;
			}
			const prior = modelVisibleSchemas.get(name);
			if (prior) {
				expect(parameters, `${name} model schema remains stable`).toEqual(
					prior,
				);
			} else {
				modelVisibleSchemas.set(name, structuredClone(parameters));
			}
		}
	};

	const pendingAssignment = (
		session: Session,
		reviewKind: "feature" | "final",
	) => {
		const assignment = session.reviewAssignments.find(
			(candidate) =>
				candidate.reviewKind === reviewKind && candidate.status === "pending",
		);
		if (!assignment) {
			throw new Error(`Expected a pending ${reviewKind} review assignment.`);
		}
		return assignment;
	};

	const passingResult = (assignment: ReturnType<typeof pendingAssignment>) => ({
		assignmentId: assignment.id,
		verdict: "passed" as const,
		findings: [],
		completedAt: assignment.startedAt,
		terminalDisposition: "submitted" as const,
	});

	const failingResult = (assignment: ReturnType<typeof pendingAssignment>) => ({
		assignmentId: assignment.id,
		verdict: "failed" as const,
		findings: [
			{
				taxonomy: "implementation_defect" as const,
				subject: "packed Session v4 prerequisite",
				requirementOrRisk: "Final review requires a passing feature review.",
				evidenceLocator: "packed-live-smoke:feature-review",
				summary: "The feature prerequisite failed.",
				severity: "blocking" as const,
			},
		],
		completedAt: assignment.startedAt,
		terminalDisposition: "submitted" as const,
	});

	const guard = (session: Session, operationId: string) => ({
		operationId,
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: "smoke-feature",
	});

	const validationStartRequest = (
		session: Session,
		coverageScope: "focused" | "broad",
	) => ({
		expectedRevision: session.causal.revision,
		expectedSnapshotId: session.causal.snapshotId,
		featureId: "smoke-feature",
		command: `test -n packed-flow-${coverageScope}`,
		coverageScope,
		environmentKeys: [],
	});

	const requiredValidationRef = (
		reference: ValidationReceiptRef | null,
		coverageScope: "focused" | "broad",
	): ValidationReceiptRef => {
		if (!reference) {
			throw new Error(`Expected a ${coverageScope} validation receipt ref.`);
		}
		return reference;
	};

	const featureReviewRequest = (session: Session, operationId: string) => ({
		...guard(session, operationId),
		reviewKind: "feature" as const,
		validationScope: "targeted" as const,
		packet: {
			summary: "Review the packed-host smoke feature.",
			riskLenses: ["assignment recovery", "host contract"],
		},
		validationRefs: [requiredValidationRef(focusedValidationRef, "focused")],
	});

	const finalReviewRequest = (
		session: Session,
		operationId: string,
		includePrerequisite: boolean,
	) => {
		const featureResult = includePrerequisite
			? passingResult(pendingAssignment(session, "feature"))
			: null;
		return {
			...guard(session, operationId),
			reviewKind: "final" as const,
			validationScope: "broad" as const,
			packet: {
				summary: "Review the one-feature plan after broad validation.",
				riskLenses: ["persisted prerequisite", "context loss"],
			},
			validationRefs: [requiredValidationRef(broadValidationRef, "broad")],
			...(featureResult ? { featureReview: featureResult } : {}),
		};
	};

	const broadCompletionRequest = (
		session: Session,
		includeForbiddenFeatureResult: boolean,
	) => {
		const finalAssignment = pendingAssignment(session, "final");
		if (!finalAssignment.prerequisite) {
			throw new Error("Expected a persisted final-review prerequisite.");
		}
		return {
			...guard(session, "packed-smoke-broad-completion"),
			result: {
				kind: "completed" as const,
				summary: "Packed-host final review completed.",
				artifactsChanged: [],
				validationScope: "broad" as const,
				finalReview: passingResult(finalAssignment),
				...(includeForbiddenFeatureResult
					? { featureReview: finalAssignment.prerequisite.result }
					: {}),
			},
		};
	};

	const emit = async (
		name: string,
		args: unknown,
		label: string,
		expectation: CallExpectation,
	) => {
		const call = { expectation, label, name } satisfies ScriptedCall;
		pendingObservation = { beforeBytes: await sessionBytes(), call };
		toolCalls.push(call);
		phaseStep += 1;
		return { arguments: args, name };
	};

	const finishPhase = () => {
		phase += 1;
		phaseStep = 0;
		return null;
	};

	const nextToolCall = async (body: ChatCompletionBody) => {
		switch (phase) {
			case 0: {
				switch (phaseStep) {
					case 0:
						return emit(
							"flow_plan_save",
							{
								goal: "Prove the complete packed Session v4 lifecycle",
								plan: {
									summary: "Exercise one feature through both review stages.",
									overview:
										"Reject invalid host calls, recover durable assignments, and archive.",
									requirements: ["Use only the Session v4 lifecycle."],
									decisions: ["Recover final completion from persisted state."],
									finalReviewPolicy: "broad",
									features: [
										{
											id: "smoke-feature",
											title: "Smoke feature",
											summary: "Complete the packed-host lifecycle.",
											targets: ["README.md"],
											validation: ["deterministic smoke observation"],
											dependsOn: [],
										},
									],
								},
							},
							"save one-feature plan",
							"accepted-mutation",
						);
					case 1:
						return emit(
							"flow_plan_approve",
							{ unexpectedOuterField: true },
							"reject unknown plan-approve outer field before mutation",
							"schema-rejected",
						);
					case 2:
						return emit(
							"flow_plan_approve",
							{},
							"approve plan",
							"accepted-mutation",
						);
					case 3:
						return emit(
							"flow_run_start",
							{ featureId: "smoke-feature" },
							"start feature run",
							"accepted-mutation",
						);
					case 4: {
						const session = await activeSession();
						return emit(
							"flow_validation_start",
							validationStartRequest(session, "focused"),
							"arm focused validation command",
							"accepted-read",
						);
					}
					case 5:
						return emit(
							"bash",
							{ command: "test -n packed-flow-focused" },
							"run focused validation command",
							"accepted-command",
						);
					case 6:
						return emit(
							"flow_status",
							{ request: { view: "reviewer" } },
							"reject reviewer status without assignmentId",
							"schema-rejected",
						);
					case 7:
						return emit(
							"flow_status",
							{
								request: { view: "compact" },
								unexpectedOuterField: true,
							},
							"reject unknown outer envelope field at handler entry",
							"schema-rejected",
						);
					case 8:
						return emit(
							"flow_status",
							{ view: "compact" },
							"reject legacy flat status",
							"schema-rejected",
						);
					case 9: {
						const session = await activeSession();
						return emit(
							"flow_review_start",
							featureReviewRequest(session, "packed-smoke-flat-review"),
							"reject legacy flat review start",
							"schema-rejected",
						);
					}
					case 10: {
						const session = await activeSession();
						return emit(
							"flow_review_start",
							{
								request: featureReviewRequest(
									session,
									"packed-smoke-feature-review",
								),
							},
							"start feature review assignment",
							"accepted-mutation",
						);
					}
					default:
						return finishPhase();
				}
			}
			case 1: {
				if (phaseStep > 0) return finishPhase();
				const session = await activeSession();
				return emit(
					"flow_status",
					{
						request: {
							view: "reviewer",
							assignmentId: pendingAssignment(session, "feature").id,
						},
					},
					"recover feature reviewer assignment",
					"accepted-read",
				);
			}
			case 2: {
				switch (phaseStep) {
					case 0: {
						const session = await activeSession();
						return emit(
							"flow_validation_start",
							validationStartRequest(session, "broad"),
							"arm broad validation command",
							"accepted-read",
						);
					}
					case 1:
						return emit(
							"bash",
							{ command: "test -n packed-flow-broad" },
							"run broad validation command",
							"accepted-command",
						);
					case 2: {
						const session = await activeSession();
						return emit(
							"flow_review_start",
							{
								request: finalReviewRequest(
									session,
									"packed-smoke-missing-prerequisite",
									false,
								),
							},
							"reject final review without feature prerequisite",
							"schema-rejected",
						);
					}
					case 3: {
						const session = await activeSession();
						return emit(
							"flow_review_start",
							{
								request: {
									...finalReviewRequest(
										session,
										"packed-smoke-failed-prerequisite",
										true,
									),
									featureReview: failingResult(
										pendingAssignment(session, "feature"),
									),
								},
							},
							"reject failed feature prerequisite before final review",
							"schema-rejected",
						);
					}
					case 4: {
						const session = await activeSession();
						return emit(
							"flow_review_start",
							{
								request: finalReviewRequest(
									session,
									"packed-smoke-final-review",
									true,
								),
							},
							"start final review with durable prerequisite",
							"accepted-mutation",
						);
					}
					default:
						return finishPhase();
				}
			}
			case 3: {
				if (phaseStep > 0) return finishPhase();
				const session = await activeSession();
				return emit(
					"flow_status",
					{
						request: {
							view: "reviewer",
							assignmentId: pendingAssignment(session, "final").id,
						},
					},
					"recover final reviewer assignment",
					"accepted-read",
				);
			}
			case 4: {
				switch (phaseStep) {
					case 0:
						return emit(
							"flow_status",
							{ request: { view: "detail" } },
							"recover manager state after context loss",
							"accepted-read",
						);
					case 1: {
						const session = await activeSession();
						return emit(
							"flow_feature_complete",
							{
								request: broadCompletionRequest(session, true),
							},
							"reject broad completion carrying featureReview",
							"schema-rejected",
						);
					}
					case 2: {
						const session = await activeSession();
						return emit(
							"flow_feature_complete",
							{
								request: broadCompletionRequest(session, false),
							},
							"complete final review from persisted assignment",
							"accepted-mutation",
						);
					}
					default:
						return finishPhase();
				}
			}
			case 5: {
				switch (phaseStep) {
					case 0:
						return emit(
							"flow_status",
							{ request: { view: "compact" } },
							"recover completed session",
							"accepted-read",
						);
					case 1: {
						const session = await activeSession();
						const competingClose = closeSession(
							session,
							"completed",
							systemTransitionEnvironment,
							"Inject a valid competing archive after close-id preflight.",
							{
								operationId: "packed-smoke-competing-close",
								expectedRevision: session.causal.revision,
								expectedSnapshotId: session.causal.snapshotId,
							},
						);
						if (!competingClose.ok) {
							throw new Error(competingClose.message);
						}
						await mkdir(archiveDirectory, { recursive: true });
						await writeFile(
							join(archiveDirectory, archivedSessionFilename(session.id)),
							`${JSON.stringify(competingClose.value, null, 2)}\n`,
							"utf8",
						);
						return emit(
							"flow_session_close",
							{
								request: {
									mode: "start",
									operationId: "c".repeat(128),
									expectedRevision: session.causal.revision,
									expectedSnapshotId: session.causal.snapshotId,
									kind: "completed",
									summary: "Packed Session v4 smoke completed.",
								},
							},
							"persist closure before injected archive collision",
							"archive-failure",
						);
					}
					case 2:
						return emit(
							"flow_status",
							{ request: { view: "compact" } },
							"recover compact close retry handle",
							"accepted-read",
						);
					case 3: {
						const session = await activeSession();
						const status = latestFlowResponse(body);
						const projection = status?.workflowData?.projection as
							| { closure?: { retryOperationId?: string } }
							| undefined;
						recoveredRetryOperationId =
							projection?.closure?.retryOperationId ?? null;
						expect(recoveredRetryOperationId).toBe(
							session.closure?.retryOperationId ?? null,
						);
						expect(recoveredRetryOperationId).toHaveLength(128);
						await rm(archiveDirectory, { force: true, recursive: true });
						await mkdir(archiveDirectory, { recursive: true });
						return emit(
							"flow_session_close",
							{
								request: {
									mode: "retry",
									operationId: recoveredRetryOperationId,
								},
							},
							"retry archive from compact status handle",
							"archive-retry",
						);
					}
					default:
						return finishPhase();
				}
			}
			default:
				return null;
		}
	};

	const server = createServer(async (request, response) => {
		try {
			if (request.method === "GET" && request.url?.endsWith("/models")) {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						object: "list",
						data: [{ id: "smoke-model", object: "model" }],
					}),
				);
				return;
			}
			if (
				request.method !== "POST" ||
				!request.url?.endsWith("/chat/completions")
			) {
				response.writeHead(404);
				response.end();
				return;
			}
			let rawBody = "";
			for await (const chunk of request) rawBody += String(chunk);
			const body = JSON.parse(rawBody) as ChatCompletionBody;
			if (observeCommandRequests) {
				commandRequests.push({
					toolNames: (body.tools ?? [])
						.map((candidate) => candidate.function?.name)
						.filter((name): name is string => Boolean(name)),
					transcript: JSON.stringify(body.messages ?? []),
				});
			}
			captureModelVisibleSchemas(body.tools ?? []);
			await observePendingCall(body);
			const selected = await nextToolCall(body);
			if (
				selected &&
				!body.tools?.some(
					(candidate) => candidate.function?.name === selected.name,
				)
			) {
				throw new Error(
					`OpenCode did not expose '${selected.name}' to the model.`,
				);
			}
			const id = `chatcmpl-flow-smoke-${++responseSequence}`;
			const model = body.model ?? "smoke-model";
			const finishReason = selected ? "tool_calls" : "stop";
			const message = selected
				? {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: `call-flow-smoke-${responseSequence}`,
								type: "function",
								function: {
									name: selected.name,
									arguments: JSON.stringify(selected.arguments),
								},
							},
						],
					}
				: { role: "assistant", content: "Packed Flow lifecycle complete." };
			if (body.stream) {
				response.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive",
				});
				const delta = selected
					? {
							role: "assistant",
							tool_calls: message.tool_calls?.map((toolCall, index) => ({
								index,
								...toolCall,
							})),
						}
					: { role: "assistant", content: message.content };
				response.write(
					`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
				);
				response.write(
					`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`,
				);
				response.write(
					`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
				);
				response.end("data: [DONE]\n\n");
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					id,
					object: "chat.completion",
					created: 0,
					model,
					choices: [{ index: 0, message, finish_reason: finishReason }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			modelErrors.push(message);
			// Script errors are deterministic contract failures. A non-retryable
			// response keeps the live smoke from hiding them behind provider backoff.
			response.writeHead(400, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					error: message,
				}),
			);
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		commandRequests,
		modelVisibleSchemas,
		modelErrors,
		get recoveredRetryOperationId() {
			return recoveredRetryOperationId;
		},
		rejectionMutationChecks,
		stateValidationChecks,
		toolCalls,
		beginCommandObservation: () => {
			observeCommandRequests = true;
		},
		close: () => closeServer(server),
	};
}

async function waitForHealth(baseUrl: string, deadline: number): Promise<void> {
	while (Date.now() < deadline) {
		try {
			const health = (await fetchJson(
				`${baseUrl}/global/health`,
				HEALTH_POLL_TIMEOUT_MS,
			)) as {
				healthy?: boolean;
			};
			if (health.healthy) return;
		} catch {
			// Server not accepting connections yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`OpenCode server did not become healthy at ${baseUrl}.`);
}

function stopServer(server: ChildProcess): void {
	if (!server.killed) server.kill("SIGTERM");
}

describe("live OpenCode smoke configuration", () => {
	test("uses the pinned host by default and accepts an explicit compatibility target", () => {
		expect(PINNED_OPENCODE_VERSION).toBe(PINNED_LIVE_OPENCODE_VERSION);
		expect(resolveOpenCodeVersion(undefined)).toBe(PINNED_OPENCODE_VERSION);
		expect(resolveOpenCodeVersion("  ")).toBe(PINNED_OPENCODE_VERSION);
		expect(resolveOpenCodeVersion("latest")).toBe("latest");
		for (const registration of Object.values(LIFECYCLE_LIVE_PROOF_REGISTRY)) {
			expect(
				registration.proofs.pinned_packed_live_host.pinnedHostVersion,
			).toBe(PINNED_OPENCODE_VERSION);
		}
	});
});

describe.skipIf(!LIVE)(`live OpenCode ${OPENCODE_VERSION} smoke`, () => {
	test(
		"packed plugin enforces and completes the Session v4 lifecycle in a real OpenCode server",
		async () => {
			const liveProofEvidence = {
				"S4-FINAL-REC-01": new Set<string>(),
				"S4-HOST-01": new Set<string>(),
			};
			const scratch = join(tmpdir(), `flow-live-smoke-${crypto.randomUUID()}`);
			const home = join(scratch, "home");
			const project = join(scratch, "project");
			await mkdir(home, { recursive: true });
			await mkdir(join(project, ".opencode", "plugins"), { recursive: true });

			const build = spawnSync("bun", ["run", "build"], {
				cwd: join(import.meta.dir, ".."),
				encoding: "utf8",
			});
			expect(
				build.status,
				`The live smoke must pack the current build.\n${build.stdout}\n${build.stderr}`,
			).toBe(0);

			const pack = spawnSync("bun", ["pm", "pack", "--destination", scratch], {
				cwd: join(import.meta.dir, ".."),
				encoding: "utf8",
			});
			expect(pack.status).toBe(0);
			const tarball = join(
				scratch,
				`opencode-plugin-flow-${packageJson.version}.tgz`,
			);
			expect((await lstat(tarball)).isFile()).toBe(true);
			for (const evidence of Object.values(liveProofEvidence)) {
				evidence.add("current-build-packed-tarball");
			}

			await writeFile(
				join(project, ".opencode", "package.json"),
				`${JSON.stringify(
					{ dependencies: { "opencode-plugin-flow": `file:${tarball}` } },
					null,
					2,
				)}\n`,
				"utf8",
			);
			await writeFile(
				join(project, ".opencode", "plugins", "flow.ts"),
				'export { default } from "opencode-plugin-flow";\n',
				"utf8",
			);
			await writeFile(join(project, "README.md"), "# smoke\n", "utf8");
			const scriptedModel = await startScriptedModel(project);
			await writeFile(
				join(project, "opencode.json"),
				`${JSON.stringify(
					{
						model: "flow-smoke/smoke-model",
						small_model: "flow-smoke/smoke-model",
						enabled_providers: ["flow-smoke"],
						permission: { "flow_*": "allow", bash: "allow" },
						provider: {
							"flow-smoke": {
								npm: "@ai-sdk/openai-compatible",
								name: "Flow smoke provider",
								options: {
									baseURL: scriptedModel.baseUrl,
									apiKey: "flow-smoke-key",
								},
								models: {
									"smoke-model": {
										name: "Flow smoke model",
										tool_call: true,
										limit: { context: 32_000, output: 4_096 },
									},
								},
							},
						},
					},
					null,
					2,
				)}\n`,
				"utf8",
			);

			const port = 41000 + Math.floor(Math.random() * 1000);
			const baseUrl = `http://127.0.0.1:${port}`;
			const server = spawn(
				"bunx",
				[
					`opencode-ai@${OPENCODE_VERSION}`,
					"serve",
					"--port",
					String(port),
					"--hostname",
					"127.0.0.1",
				],
				{
					cwd: project,
					env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "" },
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			const serverOutput: string[] = [];
			server.stdout?.on("data", (chunk) => serverOutput.push(String(chunk)));
			server.stderr?.on("data", (chunk) => serverOutput.push(String(chunk)));

			try {
				await waitForHealth(baseUrl, Date.now() + STARTUP_TIMEOUT_MS);
				for (const evidence of Object.values(liveProofEvidence)) {
					evidence.add("real-opencode-host");
				}

				const commands = (await fetchJson(`${baseUrl}/command`)) as Array<{
					name: string;
				}>;
				const commandNames = commands.map((command) => command.name);
				for (const expected of EXPECTED_COMMANDS) {
					expect(commandNames).toContain(expected);
				}

				const agents = (await fetchJson(`${baseUrl}/agent`)) as ResolvedAgent[];
				const agentNames = agents.map((agent) => agent.name);
				for (const expected of EXPECTED_AGENTS) {
					expect(agentNames).toContain(expected);
				}

				// Prove the hidden read-only worker isolation actually binds at
				// runtime. Flow declares these denials with tool-name and wildcard
				// permission keys (skill, task, flow_*, flow_status) that are absent
				// from the SDK's simplified AgentConfig permission type — this test
				// exists to confirm OpenCode nonetheless compiles them into the
				// resolved permission rules, rather than silently dropping them.
				const agentsByName = new Map(
					agents.map((agent) => [agent.name, agent]),
				);
				for (const name of READ_ONLY_WORKERS) {
					const agent = agentsByName.get(name);
					if (!agent) throw new Error(`Expected agent '${name}' to register.`);
					const rules = agent.permission ?? [];
					expect(
						rules.length,
						`${name} has resolved permission rules`,
					).toBeGreaterThan(0);
					// Cannot mutate Flow state, but flow_status stays readable (the
					// allow rule follows the flow_* deny, so status resolves to allow).
					expect(
						effectivePermissionAction(rules, "flow_feature_complete"),
						`${name} denies state-changing Flow tools`,
					).toBe("deny");
					expect(
						effectivePermissionAction(rules, "flow_status"),
						`${name} still allows flow_status`,
					).toBe("allow");
					// Only the workers responsible for producing immutable evidence may
					// call their respective exception tool.
					expect(
						effectivePermissionAction(rules, "flow_validation_start"),
						`${name} has the intended validation receipt access`,
					).toBe(name === "flow-validation-worker" ? "allow" : "deny");
					expect(
						effectivePermissionAction(rules, "flow_audit_render"),
						`${name} has the intended audit rendering access`,
					).toBe(name === "flow-audit-worker" ? "allow" : "deny");
					// Cannot spawn subagents, load native skills, or edit files.
					expect(
						effectivePermissionAction(rules, "task"),
						`${name} cannot spawn task subagents`,
					).toBe("deny");
					expect(
						effectivePermissionAction(rules, "skill"),
						`${name} cannot load native skills`,
					).toBe("deny");
					expect(
						effectivePermissionAction(rules, "edit"),
						`${name} is read-only`,
					).toBe("deny");
					// Bash is never fully granted for a read-only worker. Validation,
					// audit, and verifier workers may request it; the others deny it.
					expect(
						effectivePermissionAction(rules, "bash"),
						`${name} never gets unrestricted bash`,
					).toBe(
						name === "flow-reviewer" || name === "flow-evidence-worker"
							? "deny"
							: "ask",
					);
				}
				// Plugin startup must not install, refresh, or inspect global skills.
				await expect(
					lstat(join(home, ".config", "opencode", "skills")),
				).rejects.toMatchObject({ code: "ENOENT" });
				// Config registration must remain workspace-read-only. The lifecycle
				// request below is the first operation allowed to create .flow state.
				await expect(lstat(join(project, ".flow"))).rejects.toMatchObject({
					code: "ENOENT",
				});

				const session = (await postJson(`${baseUrl}/session`, {
					title: "Packed Flow lifecycle smoke",
				})) as { id?: string };
				if (!session.id) throw new Error("OpenCode did not create a session.");
				const sendMessage = (agent: string, text: string) =>
					postJson(
						`${baseUrl}/session/${session.id}/message`,
						{
							model: { providerID: "flow-smoke", modelID: "smoke-model" },
							agent,
							parts: [{ type: "text", text }],
						},
						2 * DATA_REQUEST_TIMEOUT_MS,
					);

				await sendMessage(
					"build",
					"Create the one-feature Session v4 run and dispatch feature review.",
				);
				await sendMessage(
					"flow-reviewer",
					"Recover the pending feature assignment from Flow status.",
				);
				await sendMessage(
					"build",
					"Start broad validation and final review from persisted state.",
				);
				await sendMessage(
					"flow-reviewer",
					"Recover the pending final assignment from Flow status.",
				);
				await sendMessage(
					"build",
					"Assume all manager context was lost; recover status and complete final review.",
				);
				await sendMessage(
					"build",
					"Close the completed session and recover any durable archive retry.",
				);

				const expectedToolNames = [
					"flow_plan_save",
					"flow_plan_approve",
					"flow_plan_approve",
					"flow_run_start",
					"flow_validation_start",
					"bash",
					"flow_status",
					"flow_status",
					"flow_status",
					"flow_review_start",
					"flow_review_start",
					"flow_status",
					"flow_validation_start",
					"bash",
					"flow_review_start",
					"flow_review_start",
					"flow_review_start",
					"flow_status",
					"flow_status",
					"flow_feature_complete",
					"flow_feature_complete",
					"flow_status",
					"flow_session_close",
					"flow_status",
					"flow_session_close",
				];
				expect(scriptedModel.toolCalls.map((call) => call.name)).toEqual(
					expectedToolNames,
				);
				assertModelVisibleSchemas(scriptedModel.modelVisibleSchemas);
				liveProofEvidence["S4-HOST-01"].add("host-emitted-request-schemas");
				expect(scriptedModel.rejectionMutationChecks).toEqual([
					"reject unknown plan-approve outer field before mutation",
					"reject reviewer status without assignmentId",
					"reject unknown outer envelope field at handler entry",
					"reject legacy flat status",
					"reject legacy flat review start",
					"reject final review without feature prerequisite",
					"reject failed feature prerequisite before final review",
					"reject broad completion carrying featureReview",
				]);
				expect(scriptedModel.stateValidationChecks).toEqual([
					"save one-feature plan",
					"approve plan",
					"start feature run",
					"arm focused validation command",
					"run focused validation command",
					"start feature review assignment",
					"recover feature reviewer assignment",
					"arm broad validation command",
					"run broad validation command",
					"start final review with durable prerequisite",
					"recover final reviewer assignment",
					"recover manager state after context loss",
					"complete final review from persisted assignment",
					"recover completed session",
					"persist closure before injected archive collision",
					"recover compact close retry handle",
					"retry archive from compact status handle",
				]);
				liveProofEvidence["S4-FINAL-REC-01"].add(
					"manager-context-loss-recovered",
				);
				expect(scriptedModel.recoveredRetryOperationId).toHaveLength(128);
				liveProofEvidence["S4-HOST-01"].add("close-retry-handle-recovered");

				const messages = (await fetchJson(
					`${baseUrl}/session/${session.id}/message`,
				)) as Array<{
					parts?: Array<{
						type?: string;
						tool?: string;
						state?: { status?: string; output?: string; error?: string };
					}>;
				}>;
				const scriptedToolParts = messages
					.flatMap((message) => message.parts ?? [])
					.filter(
						(part) =>
							part.type === "tool" &&
							part.tool !== undefined &&
							expectedToolNames.includes(part.tool),
					);
				expect(scriptedToolParts.map((part) => part.tool)).toEqual(
					expectedToolNames,
				);
				expect(scriptedToolParts).toHaveLength(scriptedModel.toolCalls.length);
				for (const [index, part] of scriptedToolParts.entries()) {
					const call = scriptedModel.toolCalls[index];
					if (!call) throw new Error(`Missing scripted call ${index}.`);
					if (call.expectation === "schema-rejected") {
						expect(
							part.state?.status,
							`${call.label} is rejected at the registered host boundary before Flow execution`,
						).toBe("error");
						expect(part.state?.error, call.label).toBeTruthy();
						continue;
					}
					expect(
						part.state?.status,
						`${call.label} completes host execution: ${part.state?.error ?? ""}`,
					).toBe("completed");
					if (call.expectation === "accepted-command") {
						expect(part.state?.output, call.label).toContain(
							"[flow-validation-receipt]",
						);
						continue;
					}
					const output = JSON.parse(part.state?.output ?? "{}") as {
						status?: string;
					};
					expect(output.status, call.label).toBe(
						call.expectation === "archive-failure" ? "error" : "ok",
					);
				}
				for (const [invalidLabel, correctedLabel] of [
					[
						"reject failed feature prerequisite before final review",
						"start final review with durable prerequisite",
					],
					[
						"reject broad completion carrying featureReview",
						"complete final review from persisted assignment",
					],
				] as const) {
					const invalidIndex = scriptedModel.toolCalls.findIndex(
						(call) => call.label === invalidLabel,
					);
					const correctedIndex = scriptedModel.toolCalls.findIndex(
						(call) => call.label === correctedLabel,
					);
					expect(invalidIndex, invalidLabel).toBeGreaterThanOrEqual(0);
					expect(correctedIndex, correctedLabel).toBeGreaterThan(invalidIndex);
					expect(scriptedModel.toolCalls[invalidIndex]?.name).toBe(
						scriptedModel.toolCalls[correctedIndex]?.name,
					);
					expect(scriptedToolParts[invalidIndex]?.state?.status).toBe("error");
					expect(scriptedToolParts[correctedIndex]?.state?.status).toBe(
						"completed",
					);
				}
				liveProofEvidence["S4-HOST-01"].add(
					"invalid-then-corrected-host-calls",
				);

				const reviewerParts = scriptedToolParts.filter((_part, index) =>
					scriptedModel.toolCalls[index]?.label.includes("reviewer assignment"),
				);
				expect(reviewerParts).toHaveLength(2);
				const recoveredReviewKinds: string[] = [];
				for (const reviewerPart of reviewerParts) {
					const reviewerOutput = JSON.parse(
						reviewerPart.state?.output ?? "{}",
					) as {
						workflowData?: {
							projection?: {
								assignmentStatus?: string;
								reviewKind?: string;
							};
						};
					};
					expect(reviewerOutput.workflowData?.projection).toMatchObject({
						assignmentStatus: "pending",
					});
					const reviewKind =
						reviewerOutput.workflowData?.projection?.reviewKind;
					if (reviewKind) recoveredReviewKinds.push(reviewKind);
				}
				expect(recoveredReviewKinds).toEqual(["feature", "final"]);
				liveProofEvidence["S4-FINAL-REC-01"].add("final-assignment-recovered");

				await expect(
					lstat(join(project, ".flow", "session.json")),
				).rejects.toMatchObject({ code: "ENOENT" });
				const archiveNames = (
					await readdir(join(project, ".flow", "history"))
				).filter((name) => name.endsWith(".json"));
				expect(archiveNames).toHaveLength(1);
				const archiveName = archiveNames[0];
				if (!archiveName) throw new Error("Expected the packed-host archive.");
				const archived = SessionSchema.parse(
					JSON.parse(
						await readFile(
							join(project, ".flow", "history", archiveName),
							"utf8",
						),
					),
				);
				expect(validateSessionInvariants(archived)).toBeNull();
				expect(archived).toMatchObject({
					version: 4,
					status: "completed",
					closure: {
						kind: "completed",
						retryOperationId: scriptedModel.recoveredRetryOperationId,
					},
					history: [{ featureId: "smoke-feature", status: "completed" }],
				});
				expect(archived.reviewAssignments).toHaveLength(2);
				expect(
					archived.reviewAssignments.every(
						(assignment) => assignment.status === "submitted",
					),
				).toBe(true);
				expect(
					archived.reviewAssignments.find(
						(assignment) => assignment.reviewKind === "final",
					)?.prerequisite,
				).not.toBeNull();
				expect(archived.history[0]?.reviewAssignmentIds).toHaveLength(2);
				liveProofEvidence["S4-FINAL-REC-01"].add(
					"final-completion-from-persisted-assignment",
				);
				liveProofEvidence["S4-HOST-01"].add("close-retry-archive-published");

				const commandSession = (await postJson(`${baseUrl}/session`, {
					title: "Packed Flow command preflight smoke",
				})) as { id?: string };
				if (!commandSession.id) {
					throw new Error("OpenCode did not create a command smoke session.");
				}
				scriptedModel.beginCommandObservation();
				await postJson(
					`${baseUrl}/session/${commandSession.id}/command`,
					{
						arguments: "packed-manager-command-marker",
						command: "flow-plan",
						model: "flow-smoke/smoke-model",
					},
					2 * DATA_REQUEST_TIMEOUT_MS,
				);
				await postJson(
					`${baseUrl}/session/${commandSession.id}/command`,
					{
						arguments: "packed-reviewer-command-marker",
						command: "flow-review",
						model: "flow-smoke/smoke-model",
					},
					2 * DATA_REQUEST_TIMEOUT_MS,
				);

				const managerCommandRequest = scriptedModel.commandRequests.find(
					(request) =>
						request.transcript.includes("packed-manager-command-marker"),
				);
				expect(managerCommandRequest?.transcript).toContain(
					"# Flow plan command contract",
				);
				expect(managerCommandRequest?.transcript).toContain(
					"## Active Flow harness runtime policy",
				);
				expect(managerCommandRequest?.transcript).toContain(
					"Profile: `standard`",
				);
				expect(managerCommandRequest?.toolNames).toContain("flow_plan_save");
				const reviewerCommandRequest = scriptedModel.commandRequests.find(
					(request) =>
						request.transcript.includes("packed-reviewer-command-marker"),
				);
				expect(reviewerCommandRequest?.transcript).toContain(
					"# Flow review assignment",
				);
				expect(reviewerCommandRequest?.toolNames).toContain("flow_status");
				expect(reviewerCommandRequest?.toolNames).not.toContain(
					"flow_review_start",
				);
				liveProofEvidence["S4-HOST-01"].add(
					"manager-and-reviewer-command-preflight",
				);
				if (OPENCODE_VERSION === PINNED_LIVE_OPENCODE_VERSION) {
					assertLifecycleLiveProofObservation({
						boundary: "packed-plugin-real-opencode",
						hostPackage: "opencode-ai",
						hostVersion: OPENCODE_VERSION,
						pluginArtifact: "current-build-packed-tarball",
						evidence: {
							"S4-FINAL-REC-01": [...liveProofEvidence["S4-FINAL-REC-01"]],
							"S4-HOST-01": [...liveProofEvidence["S4-HOST-01"]],
						},
					});
				}
			} catch (error) {
				const observedCalls = scriptedModel.toolCalls
					.map((call, index) => `${index + 1}. ${call.name}: ${call.label}`)
					.join("\n");
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\nObserved Flow calls:\n${observedCalls || "(none)"}\nScripted model errors:\n${scriptedModel.modelErrors.join("\n") || "(none)"}\nServer output:\n${serverOutput.join("")}`,
				);
			} finally {
				stopServer(server);
				await scriptedModel.close();
			}
		},
		STARTUP_TIMEOUT_MS + 12 * DATA_REQUEST_TIMEOUT_MS,
	);
});
