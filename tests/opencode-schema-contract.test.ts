import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolContext, tool } from "@opencode-ai/plugin";
import {
	FlowFeatureCompleteToolSchema,
	FlowFeatureResetSchema,
	FlowPlanSaveSchema,
	FlowReviewStartSchema,
	FlowRunStartSchema,
	FlowSessionCloseSchema,
} from "../src/application/flow-service.js";
import { MAX_WORKFLOW_PROSE_BYTES } from "../src/application/schema.js";
import {
	MAX_REVIEW_ASSIGNMENT_RESULT_BYTES,
	MAX_SESSION_ID_LENGTH,
} from "../src/domain/limits.js";
import {
	MAX_EXECUTION_PROJECTION_BYTES,
	MAX_ORCHESTRATION_COLLECTION_BYTES,
	MAX_PLAN_FEATURES,
} from "../src/domain/transitions.js";
import { createTools } from "../src/platform/opencode/tools.js";
import {
	LIFECYCLE_APPLICATION_SCHEMAS,
	LIFECYCLE_CONTRACT_CASES,
	LIFECYCLE_HOST_FIXTURES,
	LIFECYCLE_OPERATION_TOOLS,
	type LifecycleCriticalOperation,
} from "./support/lifecycle-host-contract-corpus.js";

const {
	blockedCompletion,
	closeStart,
	closeRetry,
	featureReviewStart,
	guard,
	oversizedAsciiAssignmentResult,
	oversizedMultibyteAssignmentResult,
	plan,
	smallMultibyteAssignmentResult,
	statusCompact,
	targetedCompletion,
	validation,
} = LIFECYCLE_HOST_FIXTURES;

const registeredTools = createTools({});
const REGISTERED_TOOL_NAMES = [
	"flow_guidance",
	"flow_status",
	"flow_plan_save",
	"flow_plan_approve",
	"flow_run_start",
	"flow_feature_complete",
	"flow_review_start",
	"flow_feature_reset",
	"flow_session_close",
] as const;
type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number];

type SafeParseSchema = {
	safeParse(value: unknown): { success: boolean };
};

type TextBoundaryCase = {
	name: string;
	toolName: RegisteredToolName;
	applicationSchema: SafeParseSchema;
	maximumBytes: number;
	input(value: string): unknown;
};

function exactMultibyteUtf8(byteLength: number): string {
	const fullCharacters = Math.floor(byteLength / 3);
	return "界".repeat(fullCharacters) + "x".repeat(byteLength % 3);
}

function planWithFeature(changes: Record<string, unknown>): {
	plan: Record<string, unknown>;
} {
	return {
		plan: {
			...plan,
			features: [{ ...plan.features[0], ...changes }],
		},
	};
}

function planWithCollection(
	name: "requirements" | "decisions",
	values: readonly string[],
): { plan: Record<string, unknown> } {
	return { plan: { ...plan, [name]: values } };
}

function featureWithCollection(
	name: "targets" | "validation" | "dependsOn",
	values: readonly string[],
): { plan: Record<string, unknown> } {
	return planWithFeature({ [name]: values });
}

function planTextBoundary(
	name: string,
	input: (value: string) => unknown,
): TextBoundaryCase {
	return {
		name,
		toolName: "flow_plan_save",
		applicationSchema: FlowPlanSaveSchema,
		maximumBytes: MAX_EXECUTION_PROJECTION_BYTES,
		input,
	};
}

const TEXT_BOUNDARY_CASES: TextBoundaryCase[] = [
	planTextBoundary("plan summary", (value) => ({
		plan: { ...plan, summary: value },
	})),
	planTextBoundary("plan overview", (value) => ({
		plan: { ...plan, overview: value },
	})),
	planTextBoundary("plan requirement", (value) => ({
		plan: { ...plan, requirements: [value] },
	})),
	planTextBoundary("plan decision", (value) => ({
		plan: { ...plan, decisions: [value] },
	})),
	planTextBoundary("feature title", (value) =>
		planWithFeature({ title: value }),
	),
	planTextBoundary("feature summary", (value) =>
		planWithFeature({ summary: value }),
	),
	planTextBoundary("feature target", (value) =>
		planWithFeature({ targets: [value] }),
	),
	planTextBoundary("feature validation", (value) =>
		planWithFeature({ validation: [value] }),
	),
	{
		name: "validation command",
		toolName: "flow_review_start",
		applicationSchema: FlowReviewStartSchema,
		maximumBytes: MAX_EXECUTION_PROJECTION_BYTES,
		input: (value) => ({
			request: {
				...featureReviewStart.request,
				validations: [{ ...validation, command: value }],
			},
		}),
	},
	{
		name: "validation summary",
		toolName: "flow_review_start",
		applicationSchema: FlowReviewStartSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: {
				...featureReviewStart.request,
				validations: [{ ...validation, summary: value }],
			},
		}),
	},
	{
		name: "review packet summary",
		toolName: "flow_review_start",
		applicationSchema: FlowReviewStartSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: {
				...featureReviewStart.request,
				packet: { ...featureReviewStart.request.packet, summary: value },
			},
		}),
	},
	{
		name: "completed result summary",
		toolName: "flow_feature_complete",
		applicationSchema: FlowFeatureCompleteToolSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: {
				...targetedCompletion.request,
				result: { ...targetedCompletion.request.result, summary: value },
			},
		}),
	},
	{
		name: "blocked result summary",
		toolName: "flow_feature_complete",
		applicationSchema: FlowFeatureCompleteToolSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: {
				...blockedCompletion.request,
				result: { ...blockedCompletion.request.result, summary: value },
			},
		}),
	},
	{
		name: "blocked result resolution hint",
		toolName: "flow_feature_complete",
		applicationSchema: FlowFeatureCompleteToolSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: {
				...blockedCompletion.request,
				result: { ...blockedCompletion.request.result, resolutionHint: value },
			},
		}),
	},
	{
		name: "session close summary",
		toolName: "flow_session_close",
		applicationSchema: FlowSessionCloseSchema,
		maximumBytes: MAX_WORKFLOW_PROSE_BYTES,
		input: (value) => ({
			request: { ...closeStart.request, summary: value },
		}),
	},
];

function toolContext(workspace: string): ToolContext {
	return {
		sessionID: "host-contract-session",
		messageID: "host-contract-message",
		agent: "build",
		directory: workspace,
		worktree: workspace,
		abort: new AbortController().signal,
		metadata: () => {},
		ask: async () => {},
	};
}

function executeRegisteredTool(
	toolName: RegisteredToolName,
	input: unknown,
	context: ToolContext,
) {
	const definition = registeredTools[toolName];
	if (!definition) throw new Error(`Missing registered ${toolName} tool.`);
	return Promise.resolve().then(() =>
		definition.execute(input as never, context),
	);
}

async function expectNoPersistedSession(workspace: string): Promise<void> {
	await expect(
		lstat(join(workspace, ".flow", "session.json")),
	).rejects.toMatchObject({ code: "ENOENT" });
}

async function expectNoFlowState(workspace: string): Promise<void> {
	await expect(lstat(join(workspace, ".flow"))).rejects.toMatchObject({
		code: "ENOENT",
	});
}

function registeredToolSchema(toolName: RegisteredToolName) {
	const definition = registeredTools[toolName];
	if (!definition) throw new Error(`Missing registered ${toolName} tool.`);
	return tool.schema.object(definition.args);
}

function registeredSchema(operation: LifecycleCriticalOperation) {
	return registeredToolSchema(LIFECYCLE_OPERATION_TOOLS[operation]);
}

type JsonSchema = {
	[key: string]: unknown;
	const?: unknown;
	enum?: unknown[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	items?: JsonSchema;
	additionalProperties?: boolean;
	minimum?: number;
	minItems?: number;
	maxItems?: number;
	maxLength?: number;
};

function emittedSchema(operation: LifecycleCriticalOperation): JsonSchema {
	return emittedToolSchema(LIFECYCLE_OPERATION_TOOLS[operation]);
}

function emittedToolSchema(toolName: RegisteredToolName): JsonSchema {
	return tool.schema.toJSONSchema(registeredToolSchema(toolName)) as JsonSchema;
}

function property(schema: JsonSchema, name: string): JsonSchema {
	const value = schema.properties?.[name];
	if (!value) throw new Error(`Missing JSON Schema property '${name}'.`);
	return value;
}

function items(schema: JsonSchema): JsonSchema {
	if (!schema.items) throw new Error("Missing JSON Schema items.");
	return schema.items;
}

function literalValue(schema: JsonSchema): unknown {
	if ("const" in schema) return schema.const;
	return schema.enum?.length === 1 ? schema.enum[0] : undefined;
}

function branchWithLiteral(
	schema: JsonSchema,
	propertyName: string,
	value: string,
): JsonSchema {
	const branches = schema.anyOf ?? schema.oneOf ?? [];
	const branch = branches.find(
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

describe("OpenCode registered host contract", () => {
	test("aggregate-budget fixtures stay within leaf limits and exceed total UTF-8 bytes", () => {
		const encoder = new TextEncoder();
		for (const result of [
			oversizedAsciiAssignmentResult,
			oversizedMultibyteAssignmentResult,
		]) {
			expect(result.findings.length).toBeLessThanOrEqual(100);
			expect(encoder.encode(JSON.stringify(result)).byteLength).toBeGreaterThan(
				MAX_REVIEW_ASSIGNMENT_RESULT_BYTES,
			);
		}
		expect(
			encoder.encode(JSON.stringify(smallMultibyteAssignmentResult)).byteLength,
		).toBeLessThanOrEqual(MAX_REVIEW_ASSIGNMENT_RESULT_BYTES);
	});

	test("rejects goals that leave no room for the smallest execution projection", async () => {
		const registered = registeredToolSchema("flow_plan_save");
		const reachableBytes = 10_000;
		const projectionUnreachableBytes = 12_000;
		const accepted = [
			"x".repeat(reachableBytes),
			exactMultibyteUtf8(reachableBytes),
		];
		const rejected = [
			"x".repeat(projectionUnreachableBytes),
			exactMultibyteUtf8(projectionUnreachableBytes),
			"x".repeat(MAX_EXECUTION_PROJECTION_BYTES),
			exactMultibyteUtf8(MAX_EXECUTION_PROJECTION_BYTES),
			"x".repeat(MAX_EXECUTION_PROJECTION_BYTES + 1),
			`${exactMultibyteUtf8(MAX_EXECUTION_PROJECTION_BYTES)}界`,
		];
		const root = await mkdtemp(join(tmpdir(), "flow-host-goal-boundary-"));
		try {
			for (const [index, value] of accepted.entries()) {
				const input = { goal: value };
				expect(registered.safeParse(input).success).toBe(true);
				expect(FlowPlanSaveSchema.safeParse(input).success).toBe(true);
				const workspace = join(root, `accepted-${index}`);
				await mkdir(workspace);
				const output = await executeRegisteredTool(
					"flow_plan_save",
					input,
					toolContext(workspace),
				);
				expect(typeof output).toBe("string");
			}

			for (const [index, value] of rejected.entries()) {
				const input = { goal: value };
				expect(registered.safeParse(input).success).toBe(false);
				expect(FlowPlanSaveSchema.safeParse(input).success).toBe(false);
				const workspace = join(root, `rejected-${index}`);
				await mkdir(workspace);
				await expect(
					executeRegisteredTool(
						"flow_plan_save",
						input,
						toolContext(workspace),
					),
				).rejects.toThrow();
				await expectNoFlowState(workspace);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	for (const boundaryCase of TEXT_BOUNDARY_CASES) {
		test(`enforces the exact UTF-8 boundary for ${boundaryCase.name} before state I/O`, async () => {
			const root = await mkdtemp(join(tmpdir(), "flow-host-text-boundary-"));
			const exactAscii = "x".repeat(boundaryCase.maximumBytes);
			const exactMultibyte = exactMultibyteUtf8(boundaryCase.maximumBytes);
			const accepted = [exactAscii, exactMultibyte];
			const rejected = [`${exactAscii}x`, `${exactMultibyte}界`];
			const registered = registeredToolSchema(boundaryCase.toolName);
			try {
				for (const [index, value] of accepted.entries()) {
					expect(new TextEncoder().encode(value).byteLength).toBe(
						boundaryCase.maximumBytes,
					);
					const input = boundaryCase.input(value);
					expect(registered.safeParse(input).success, "registered schema").toBe(
						true,
					);
					expect(
						boundaryCase.applicationSchema.safeParse(input).success,
						"application schema",
					).toBe(true);
					const workspace = join(root, `accepted-${index}`);
					await mkdir(workspace);
					const output = await executeRegisteredTool(
						boundaryCase.toolName,
						input,
						toolContext(workspace),
					);
					expect(typeof output).toBe("string");
				}

				for (const [index, value] of rejected.entries()) {
					expect(new TextEncoder().encode(value).byteLength).toBeGreaterThan(
						boundaryCase.maximumBytes,
					);
					const input = boundaryCase.input(value);
					expect(registered.safeParse(input).success, "registered schema").toBe(
						false,
					);
					expect(
						boundaryCase.applicationSchema.safeParse(input).success,
						"application schema",
					).toBe(false);
					const workspace = join(root, `rejected-${index}`);
					await mkdir(workspace);
					await expect(
						executeRegisteredTool(
							boundaryCase.toolName,
							input,
							toolContext(workspace),
						),
					).rejects.toThrow();
					await expectNoFlowState(workspace);
				}
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	}

	test("mirrors plan collection and feature-identifier bounds through registered execution", async () => {
		const boundedFeatures = Array.from(
			{ length: MAX_PLAN_FEATURES },
			(_, index) => ({ ...plan.features[0], id: `feature-${index}` }),
		);
		const repeated = Array.from(
			{ length: MAX_PLAN_FEATURES },
			() => "bounded-entry",
		);
		const cases = [
			{
				name: "feature id",
				accepted: planWithFeature({ id: "x".repeat(MAX_SESSION_ID_LENGTH) }),
				rejected: planWithFeature({
					id: "x".repeat(MAX_SESSION_ID_LENGTH + 1),
				}),
			},
			{
				name: "features",
				accepted: { plan: { ...plan, features: boundedFeatures } },
				rejected: {
					plan: {
						...plan,
						features: [
							...boundedFeatures,
							{ ...plan.features[0], id: "one-feature-over" },
						],
					},
				},
			},
			{
				name: "requirements",
				accepted: planWithCollection("requirements", repeated),
				rejected: planWithCollection("requirements", [
					...repeated,
					"one-entry-over",
				]),
			},
			{
				name: "decisions",
				accepted: planWithCollection("decisions", repeated),
				rejected: planWithCollection("decisions", [
					...repeated,
					"one-entry-over",
				]),
			},
			{
				name: "targets",
				accepted: featureWithCollection("targets", repeated),
				rejected: featureWithCollection("targets", [
					...repeated,
					"one-entry-over",
				]),
			},
			{
				name: "validation",
				accepted: featureWithCollection("validation", repeated),
				rejected: featureWithCollection("validation", [
					...repeated,
					"one-entry-over",
				]),
			},
			{
				name: "dependsOn",
				accepted: featureWithCollection("dependsOn", repeated),
				rejected: featureWithCollection("dependsOn", [
					...repeated,
					"one-entry-over",
				]),
			},
		];
		const registered = registeredToolSchema("flow_plan_save");
		const root = await mkdtemp(join(tmpdir(), "flow-host-plan-boundary-"));
		try {
			for (const [index, boundaryCase] of cases.entries()) {
				expect(
					registered.safeParse(boundaryCase.accepted).success,
					`${boundaryCase.name}: registered boundary`,
				).toBe(true);
				expect(
					FlowPlanSaveSchema.safeParse(boundaryCase.accepted).success,
					`${boundaryCase.name}: application boundary`,
				).toBe(true);
				expect(
					registered.safeParse(boundaryCase.rejected).success,
					`${boundaryCase.name}: registered overflow`,
				).toBe(false);
				expect(
					FlowPlanSaveSchema.safeParse(boundaryCase.rejected).success,
					`${boundaryCase.name}: application overflow`,
				).toBe(false);

				const acceptedWorkspace = join(root, `accepted-${index}`);
				await mkdir(acceptedWorkspace);
				const output = await executeRegisteredTool(
					"flow_plan_save",
					boundaryCase.accepted,
					toolContext(acceptedWorkspace),
				);
				expect(typeof output).toBe("string");

				const rejectedWorkspace = join(root, `rejected-${index}`);
				await mkdir(rejectedWorkspace);
				await expect(
					executeRegisteredTool(
						"flow_plan_save",
						boundaryCase.rejected,
						toolContext(rejectedWorkspace),
					),
				).rejects.toThrow();
				await expectNoFlowState(rejectedWorkspace);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("preserves malformed orchestration soft-fail behavior while hard-rejecting oversized raw telemetry", async () => {
		const payloadBytes = MAX_ORCHESTRATION_COLLECTION_BYTES - 2;
		const exactAscii = "x".repeat(payloadBytes);
		const exactMultibyte = exactMultibyteUtf8(payloadBytes);
		const input = (orchestrationPasses: unknown) => ({
			request: {
				...targetedCompletion.request,
				result: {
					...targetedCompletion.request.result,
					orchestrationPasses,
				},
			},
		});
		const accepted = [
			{ malformed: true },
			Array.from({ length: 51 }, () => ({})),
			exactAscii,
			exactMultibyte,
		];
		const rejected = [`${exactAscii}x`, `${exactMultibyte}界`, 1n];
		const registered = registeredToolSchema("flow_feature_complete");
		const root = await mkdtemp(join(tmpdir(), "flow-host-telemetry-boundary-"));
		try {
			for (const [index, value] of accepted.entries()) {
				if (typeof value === "string") {
					expect(
						new TextEncoder().encode(JSON.stringify(value)).byteLength,
					).toBe(MAX_ORCHESTRATION_COLLECTION_BYTES);
				}
				const candidate = input(value);
				expect(registered.safeParse(candidate).success).toBe(true);
				expect(FlowFeatureCompleteToolSchema.safeParse(candidate).success).toBe(
					true,
				);
				const workspace = join(root, `accepted-${index}`);
				await mkdir(workspace);
				const output = await executeRegisteredTool(
					"flow_feature_complete",
					candidate,
					toolContext(workspace),
				);
				expect(typeof output).toBe("string");
			}

			for (const [index, value] of rejected.entries()) {
				const candidate = input(value);
				expect(registered.safeParse(candidate).success).toBe(false);
				expect(FlowFeatureCompleteToolSchema.safeParse(candidate).success).toBe(
					false,
				);
				const workspace = join(root, `rejected-${index}`);
				await mkdir(workspace);
				await expect(
					executeRegisteredTool(
						"flow_feature_complete",
						candidate,
						toolContext(workspace),
					),
				).rejects.toThrow();
				await expectNoFlowState(workspace);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("keeps the unresolved artifact-path contract aligned with the application boundary", async () => {
		const input = (path: string) => ({
			request: {
				...targetedCompletion.request,
				result: {
					...targetedCompletion.request.result,
					artifactsChanged: [{ path }],
				},
			},
		});
		const longPath = `src/${"x".repeat(MAX_EXECUTION_PROJECTION_BYTES)}`;
		const registered = registeredToolSchema("flow_feature_complete");
		expect(registered.safeParse(input(longPath)).success).toBe(true);
		expect(
			FlowFeatureCompleteToolSchema.safeParse(input(longPath)).success,
		).toBe(true);
		expect(registered.safeParse(input("")).success).toBe(false);
		expect(FlowFeatureCompleteToolSchema.safeParse(input("")).success).toBe(
			false,
		);
	});

	test("executes every shared conditional corpus case through the actual registered callbacks", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-host-corpus-"));
		try {
			for (const [index, contractCase] of LIFECYCLE_CONTRACT_CASES.entries()) {
				const workspace = join(root, String(index));
				await mkdir(workspace);
				const operation = LIFECYCLE_OPERATION_TOOLS[contractCase.operation];
				const execution = executeRegisteredTool(
					operation,
					contractCase.input,
					toolContext(workspace),
				);
				if (!contractCase.expected) {
					await expect(execution, contractCase.name).rejects.toThrow();
					await expectNoPersistedSession(workspace);
					continue;
				}

				const output = await execution;
				expect(typeof output, contractCase.name).toBe("string");
				if (typeof output !== "string") {
					throw new Error(`${contractCase.name} did not return JSON text.`);
				}
				expect(JSON.parse(output), contractCase.name).toMatchObject({
					status: "missing_session",
				});
				await expectNoPersistedSession(workspace);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("all nine registered callbacks reject unknown outer fields before accepting a corrected call", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-host-outer-"));
		const calls = [
			{
				toolName: "flow_guidance",
				corrected: { id: "flow" },
				expectedStatus: null,
			},
			{
				toolName: "flow_status",
				corrected: statusCompact,
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_plan_save",
				corrected: {},
				expectedStatus: "missing_goal",
			},
			{
				toolName: "flow_plan_approve",
				corrected: {},
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_run_start",
				corrected: {},
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_review_start",
				corrected: featureReviewStart,
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_feature_complete",
				corrected: targetedCompletion,
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_feature_reset",
				corrected: guard,
				expectedStatus: "missing_session",
			},
			{
				toolName: "flow_session_close",
				corrected: closeRetry,
				expectedStatus: "missing_session",
			},
		] as const;
		expect(Object.keys(registeredTools)).toEqual([...REGISTERED_TOOL_NAMES]);
		expect(new Set(calls.map((call) => call.toolName))).toEqual(
			new Set(REGISTERED_TOOL_NAMES),
		);

		try {
			for (const [index, call] of calls.entries()) {
				const workspace = join(root, String(index));
				await mkdir(workspace);
				const context = toolContext(workspace);
				await expect(
					executeRegisteredTool(
						call.toolName,
						{ ...call.corrected, unexpectedOuterField: true },
						context,
					),
				).rejects.toThrow();
				await expectNoPersistedSession(workspace);

				const output = await executeRegisteredTool(
					call.toolName,
					call.corrected,
					context,
				);
				expect(typeof output).toBe("string");
				if (typeof output !== "string") {
					throw new Error(`${call.toolName} did not return text.`);
				}
				if (call.expectedStatus === null) {
					expect(output.length).toBeGreaterThan(0);
				} else {
					expect(JSON.parse(output)).toMatchObject({
						status: call.expectedStatus,
					});
				}
				await expectNoPersistedSession(workspace);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	for (const fixture of LIFECYCLE_CONTRACT_CASES) {
		test(fixture.name, () => {
			const registered = registeredSchema(fixture.operation).safeParse(
				fixture.input,
			);
			const application = LIFECYCLE_APPLICATION_SCHEMAS[
				fixture.operation
			].safeParse(fixture.input);
			expect(registered.success, "registered OpenCode schema").toBe(
				fixture.expected,
			);
			expect(application.success, "application schema").toBe(fixture.expected);
		});
	}

	test("registers one required request envelope for every conditional tool", () => {
		for (const operation of Object.keys(
			LIFECYCLE_OPERATION_TOOLS,
		) as LifecycleCriticalOperation[]) {
			const definition = registeredTools[LIFECYCLE_OPERATION_TOOLS[operation]];
			expect(Object.keys(definition?.args ?? {})).toEqual(["request"]);
			const emitted = emittedSchema(operation);
			expect(emitted.required).toContain("request");
		}
	});

	test("emits strict structural branches for conditional lifecycle requests", () => {
		const statusRequest = property(emittedSchema("status"), "request");
		expect(statusRequest.anyOf).toHaveLength(4);
		for (const branch of statusRequest.anyOf ?? []) {
			expect(branch.additionalProperties).toBe(false);
		}
		const reviewerBranch = statusRequest.anyOf?.find((branch) =>
			branch.required?.includes("assignmentId"),
		);
		expect(reviewerBranch?.required).toEqual(["view", "assignmentId"]);

		const reviewRequest = property(emittedSchema("reviewStart"), "request");
		expect(reviewRequest.anyOf).toHaveLength(2);
		expect(
			reviewRequest.anyOf?.filter((branch) =>
				branch.required?.includes("featureReview"),
			),
		).toHaveLength(1);
		for (const branch of reviewRequest.anyOf ?? []) {
			expect(branch.additionalProperties).toBe(false);
		}
		const featureReviewStartBranch = branchWithLiteral(
			reviewRequest,
			"reviewKind",
			"feature",
		);
		const finalReviewStartBranch = branchWithLiteral(
			reviewRequest,
			"reviewKind",
			"final",
		);
		expect(
			literalValue(
				property(
					items(property(featureReviewStartBranch, "validations")),
					"exitCode",
				),
			),
		).toBe(0);
		expectPassingSubmittedReviewSchema(
			property(finalReviewStartBranch, "featureReview"),
		);

		const completionRequest = property(
			emittedSchema("featureComplete"),
			"request",
		);
		expect(completionRequest.additionalProperties).toBe(false);
		const result = property(completionRequest, "result");
		expect(result.anyOf).toHaveLength(3);
		expect(
			result.anyOf?.filter((branch) =>
				branch.required?.includes("featureReview"),
			),
		).toHaveLength(1);
		expect(
			result.anyOf?.filter((branch) =>
				branch.required?.includes("finalReview"),
			),
		).toHaveLength(1);
		const targetedResult = branchWithLiteral(
			result,
			"validationScope",
			"targeted",
		);
		const broadResult = branchWithLiteral(result, "validationScope", "broad");
		const blockedResult = branchWithLiteral(result, "kind", "blocked");
		expectPassingSubmittedReviewSchema(
			property(targetedResult, "featureReview"),
		);
		expectPassingSubmittedReviewSchema(property(broadResult, "finalReview"));
		const blockedReview = property(blockedResult, "review");
		expect(literalValue(property(blockedReview, "verdict"))).toBe("failed");
		expect(property(blockedReview, "terminalDisposition").enum).toEqual([
			"submitted",
			"observed_unsubmitted",
		]);
		expect(property(blockedReview, "findings").minItems).toBe(1);

		const closeRequest = property(emittedSchema("close"), "request");
		expect(closeRequest.anyOf).toHaveLength(2);
		for (const branch of closeRequest.anyOf ?? []) {
			expect(branch.additionalProperties).toBe(false);
		}
	});

	test("emits nonnegative safe integer bounds", () => {
		const names = new Set(["expectedRevision", "sinceRevision", "byteLength"]);
		const properties = (
			Object.keys(LIFECYCLE_OPERATION_TOOLS) as LifecycleCriticalOperation[]
		).flatMap((operation) =>
			collectNamedProperties(emittedSchema(operation), names),
		);
		expect(new Set(properties.map((entry) => entry.name))).toEqual(names);
		for (const entry of properties) {
			expect(entry.schema.minimum, entry.name).toBe(0);
		}
	});

	test("emits portable feature-id and plan collection limits", () => {
		const emittedPlan = property(emittedToolSchema("flow_plan_save"), "plan");
		for (const name of ["requirements", "decisions"] as const) {
			expect(property(emittedPlan, name).maxItems, name).toBe(
				MAX_PLAN_FEATURES,
			);
		}
		const features = property(emittedPlan, "features");
		expect(features.maxItems).toBe(MAX_PLAN_FEATURES);
		const emittedFeature = items(features);
		expect(property(emittedFeature, "id").maxLength).toBe(
			MAX_SESSION_ID_LENGTH,
		);
		for (const name of ["targets", "validation", "dependsOn"] as const) {
			expect(property(emittedFeature, name).maxItems, name).toBe(
				MAX_PLAN_FEATURES,
			);
		}
		expect(items(property(emittedFeature, "dependsOn")).maxLength).toBe(
			MAX_SESSION_ID_LENGTH,
		);
	});
});

describe("unchanged flat OpenCode contracts", () => {
	const fixtures = [
		{
			name: "plan save",
			toolName: "flow_plan_save",
			applicationSchema: FlowPlanSaveSchema,
			input: { goal: "Ship Flow v5.2", plan },
			expected: true,
		},
		{
			name: "plan save with malformed feature id",
			toolName: "flow_plan_save",
			applicationSchema: FlowPlanSaveSchema,
			input: {
				goal: "Ship Flow v5.2",
				plan: {
					...plan,
					features: [{ ...plan.features[0], id: "Domain Rewrite" }],
				},
			},
			expected: false,
		},
		{
			name: "implicit next run",
			toolName: "flow_run_start",
			applicationSchema: FlowRunStartSchema,
			input: {},
			expected: true,
		},
		{
			name: "explicit run with malformed feature id",
			toolName: "flow_run_start",
			applicationSchema: FlowRunStartSchema,
			input: { featureId: "Domain Rewrite" },
			expected: false,
		},
		{
			name: "feature reset",
			toolName: "flow_feature_reset",
			applicationSchema: FlowFeatureResetSchema,
			input: guard,
			expected: true,
		},
		{
			name: "feature reset with negative revision",
			toolName: "flow_feature_reset",
			applicationSchema: FlowFeatureResetSchema,
			input: { ...guard, expectedRevision: -1 },
			expected: false,
		},
	] as const;

	for (const fixture of fixtures) {
		test(fixture.name, () => {
			const definition = registeredTools[fixture.toolName];
			if (!definition)
				throw new Error(`Missing registered ${fixture.toolName}.`);
			const registered = tool.schema
				.object(definition.args)
				.safeParse(fixture.input);
			const application = fixture.applicationSchema.safeParse(fixture.input);
			expect(registered.success, "registered OpenCode schema").toBe(
				fixture.expected,
			);
			expect(application.success, "application schema").toBe(fixture.expected);
		});
	}
});
