import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolContext, tool } from "@opencode-ai/plugin";
import {
	FlowFeatureResetSchema,
	FlowPlanSaveSchema,
	FlowRunStartSchema,
} from "../src/application/flow-service.js";
import { MAX_REVIEW_ASSIGNMENT_RESULT_BYTES } from "../src/domain/limits.js";
import { createTools } from "../src/platform/opencode/tools.js";
import {
	LIFECYCLE_APPLICATION_SCHEMAS,
	LIFECYCLE_CONTRACT_CASES,
	LIFECYCLE_HOST_FIXTURES,
	LIFECYCLE_OPERATION_TOOLS,
	type LifecycleCriticalOperation,
} from "./support/lifecycle-host-contract-corpus.js";

const {
	closeRetry,
	featureReviewStart,
	guard,
	oversizedAsciiAssignmentResult,
	oversizedMultibyteAssignmentResult,
	plan,
	smallMultibyteAssignmentResult,
	statusCompact,
	targetedCompletion,
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

function registeredSchema(operation: LifecycleCriticalOperation) {
	const definition = registeredTools[LIFECYCLE_OPERATION_TOOLS[operation]];
	if (!definition) throw new Error(`Missing registered ${operation} tool.`);
	return tool.schema.object(definition.args);
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
};

function emittedSchema(operation: LifecycleCriticalOperation): JsonSchema {
	return tool.schema.toJSONSchema(registeredSchema(operation)) as JsonSchema;
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
