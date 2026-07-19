import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolContext, tool } from "@opencode-ai/plugin";
import { MAX_VALIDATION_RECEIPT_BYTES } from "../../src/domain/validation-receipt.js";
import { createTools } from "../../src/platform/opencode/tools.js";
import {
	LIFECYCLE_APPLICATION_SCHEMAS,
	LIFECYCLE_CONTRACT_CASES,
	LIFECYCLE_HOST_FIXTURES,
	LIFECYCLE_OPERATION_TOOLS,
	type LifecycleCriticalOperation,
} from "./lifecycle-host-contract-corpus.js";
import {
	executableProof,
	type ProofAssertions,
} from "./lifecycle-invariant-registry.js";

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

function registeredSchema(operation: LifecycleCriticalOperation) {
	const definition = registeredTools[LIFECYCLE_OPERATION_TOOLS[operation]];
	if (!definition) throw new Error(`Missing registered ${operation} tool.`);
	return tool.schema.object(definition.args);
}

function toolContext(workspace: string): ToolContext {
	return {
		sessionID: "lifecycle-proof-session",
		messageID: "lifecycle-proof-message",
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

async function hasPersistedSession(workspace: string): Promise<boolean> {
	try {
		await lstat(join(workspace, ".flow", "session.json"));
		return true;
	} catch (error) {
		if (
			error !== null &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return false;
		}
		throw error;
	}
}

const operationEvidence: Record<LifecycleCriticalOperation, string> = {
	status: "operation-status",
	reviewStart: "operation-review-start",
	featureComplete: "operation-feature-complete",
	close: "operation-close",
};

const requiredOperationEvidence = Object.values(operationEvidence);

const aggregateBudgetCases = [
	"multibyte review result within total budget",
	"review start with oversized total ASCII review result",
	"completion with oversized total multibyte review result",
] as const;

export const sharedContractCorpusProof = executableProof(
	"The application schemas accept every canonical host-contract decision.",
	(assertions: ProofAssertions) => {
		assertions.ok(
			LIFECYCLE_CONTRACT_CASES.length >= 100,
			"The shared corpus must retain broad required-field and branch coverage.",
		);
		assertions.cover("canonical-corpus-100-plus");
		const seenOperations = new Set<LifecycleCriticalOperation>();
		for (const contractCase of LIFECYCLE_CONTRACT_CASES) {
			seenOperations.add(contractCase.operation);
			assertions.equal(
				LIFECYCLE_APPLICATION_SCHEMAS[contractCase.operation].safeParse(
					contractCase.input,
				).success,
				contractCase.expected,
				contractCase.name,
			);
		}
		for (const operation of Object.keys(
			LIFECYCLE_OPERATION_TOOLS,
		) as LifecycleCriticalOperation[]) {
			assertions.ok(seenOperations.has(operation), operation);
			assertions.cover(operationEvidence[operation]);
		}
		for (const caseName of aggregateBudgetCases) {
			assertions.ok(
				LIFECYCLE_CONTRACT_CASES.some(
					(contractCase) => contractCase.name === caseName,
				),
				caseName,
			);
		}
		assertions.cover("aggregate-result-budget");
	},
	[
		"canonical-corpus-100-plus",
		...requiredOperationEvidence,
		"aggregate-result-budget",
	],
);

export const actualRegistrationDifferentialProof = executableProof(
	"The schemas actually registered with OpenCode match every shared corpus decision.",
	(assertions: ProofAssertions) => {
		for (const contractCase of LIFECYCLE_CONTRACT_CASES) {
			const application = LIFECYCLE_APPLICATION_SCHEMAS[
				contractCase.operation
			].safeParse(contractCase.input).success;
			const registered = registeredSchema(contractCase.operation).safeParse(
				contractCase.input,
			).success;
			assertions.equal(registered, application, contractCase.name);
			assertions.equal(registered, contractCase.expected, contractCase.name);
		}
		assertions.cover("actual-registration");
		assertions.cover("all-canonical-cases");
		assertions.cover("aggregate-result-budget");
	},
	["actual-registration", "all-canonical-cases", "aggregate-result-budget"],
);

type JsonSchema = {
	type?: string;
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
	exclusiveMinimum?: number;
	maximum?: number;
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

function assertPassingSubmittedReviewSchema(
	assertions: ProofAssertions,
	schema: JsonSchema,
): void {
	assertions.equal(literalValue(property(schema, "verdict")), "passed");
	assertions.equal(
		literalValue(property(schema, "terminalDisposition")),
		"submitted",
	);
	assertions.equal(
		literalValue(property(items(property(schema, "findings")), "severity")),
		"advisory",
	);
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

export const emittedJsonSchemaProof = executableProof(
	"Emitted model-visible schemas retain envelopes, strict branches, and numeric bounds.",
	(assertions: ProofAssertions) => {
		for (const operation of Object.keys(
			LIFECYCLE_OPERATION_TOOLS,
		) as LifecycleCriticalOperation[]) {
			const definition = registeredTools[LIFECYCLE_OPERATION_TOOLS[operation]];
			assertions.deepEqual(Object.keys(definition?.args ?? {}), ["request"]);
			assertions.ok(
				emittedSchema(operation).required?.includes("request"),
				operation,
			);
		}
		assertions.cover("request-envelope");

		const statusRequest = property(emittedSchema("status"), "request");
		assertions.equal(statusRequest.anyOf?.length, 4);
		for (const branch of statusRequest.anyOf ?? []) {
			assertions.equal(branch.additionalProperties, false);
		}
		assertions.deepEqual(
			statusRequest.anyOf?.find((branch) =>
				branch.required?.includes("assignmentId"),
			)?.required,
			["view", "assignmentId"],
		);

		const reviewRequest = property(emittedSchema("reviewStart"), "request");
		assertions.equal(reviewRequest.anyOf?.length, 2);
		assertions.equal(
			reviewRequest.anyOf?.filter((branch) =>
				branch.required?.includes("featureReview"),
			).length,
			1,
		);
		for (const branch of reviewRequest.anyOf ?? []) {
			assertions.equal(branch.additionalProperties, false);
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
		const featureValidationRefs = property(
			featureReviewStartBranch,
			"validationRefs",
		);
		assertions.equal(featureValidationRefs.minItems, 1);
		const validationRef = items(featureValidationRefs);
		assertions.deepEqual(validationRef.required, [
			"kind",
			"digest",
			"byteLength",
		]);
		assertions.equal(validationRef.additionalProperties, false);
		assertions.equal(
			literalValue(property(validationRef, "kind")),
			"validation_receipt_ref_v1",
		);
		const receiptByteLength = property(validationRef, "byteLength");
		assertions.equal(receiptByteLength.type, "integer");
		assertions.equal(receiptByteLength.exclusiveMinimum, 0);
		assertions.equal(receiptByteLength.maximum, MAX_VALIDATION_RECEIPT_BYTES);
		assertions.deepEqual(
			property(finalReviewStartBranch, "validationRefs"),
			featureValidationRefs,
		);
		assertPassingSubmittedReviewSchema(
			assertions,
			property(finalReviewStartBranch, "featureReview"),
		);

		const completionRequest = property(
			emittedSchema("featureComplete"),
			"request",
		);
		assertions.equal(completionRequest.additionalProperties, false);
		const completionResult = property(completionRequest, "result");
		assertions.equal(completionResult.anyOf?.length, 3);
		assertions.equal(
			completionResult.anyOf?.filter((branch) =>
				branch.required?.includes("featureReview"),
			).length,
			1,
		);
		const targetedResult = branchWithLiteral(
			completionResult,
			"validationScope",
			"targeted",
		);
		const broadResult = branchWithLiteral(
			completionResult,
			"validationScope",
			"broad",
		);
		const blockedResult = branchWithLiteral(
			completionResult,
			"kind",
			"blocked",
		);
		assertPassingSubmittedReviewSchema(
			assertions,
			property(targetedResult, "featureReview"),
		);
		assertPassingSubmittedReviewSchema(
			assertions,
			property(broadResult, "finalReview"),
		);
		const blockedReview = property(blockedResult, "review");
		assertions.equal(
			literalValue(property(blockedReview, "verdict")),
			"failed",
		);
		assertions.deepEqual(property(blockedReview, "terminalDisposition").enum, [
			"submitted",
			"observed_unsubmitted",
		]);
		assertions.equal(property(blockedReview, "findings").minItems, 1);
		assertions.cover("branch-outcome-literals");
		assertions.equal(
			completionResult.anyOf?.filter((branch) =>
				branch.required?.includes("finalReview"),
			).length,
			1,
		);

		const closeRequest = property(emittedSchema("close"), "request");
		assertions.equal(closeRequest.anyOf?.length, 2);
		for (const branch of closeRequest.anyOf ?? []) {
			assertions.equal(branch.additionalProperties, false);
		}
		assertions.cover("strict-branches");

		const boundedNames = new Set([
			"expectedRevision",
			"sinceRevision",
			"byteLength",
		]);
		const boundedProperties = (
			Object.keys(LIFECYCLE_OPERATION_TOOLS) as LifecycleCriticalOperation[]
		).flatMap((operation) =>
			collectNamedProperties(emittedSchema(operation), boundedNames),
		);
		assertions.deepEqual(
			[...new Set(boundedProperties.map((entry) => entry.name))].sort(),
			[...boundedNames].sort(),
		);
		for (const entry of boundedProperties) {
			assertions.equal(entry.schema.type, "integer", entry.name);
			if (entry.name === "byteLength") {
				assertions.equal(entry.schema.exclusiveMinimum, 0, entry.name);
				assertions.equal(
					entry.schema.maximum,
					MAX_VALIDATION_RECEIPT_BYTES,
					entry.name,
				);
			} else {
				assertions.equal(entry.schema.minimum, 0, entry.name);
				assertions.equal(
					entry.schema.maximum,
					Number.MAX_SAFE_INTEGER,
					entry.name,
				);
			}
		}
		assertions.cover("nonnegative-integers");
		assertions.cover("safe-integer-bounds");
	},
	[
		"request-envelope",
		"strict-branches",
		"branch-outcome-literals",
		"nonnegative-integers",
		"safe-integer-bounds",
	],
);

export const registeredHostCallProof = executableProof(
	"All shared conditional cases execute through registered callbacks, and every tool rejects unknown outer input before accepting a corrected call.",
	async (assertions: ProofAssertions) => {
		const root = await mkdtemp(join(tmpdir(), "flow-registered-call-"));
		const {
			closeRetry,
			featureReviewStart,
			guard,
			statusCompact,
			targetedCompletion,
		} = LIFECYCLE_HOST_FIXTURES;
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
		assertions.deepEqual(Object.keys(registeredTools), [
			...REGISTERED_TOOL_NAMES,
		]);
		assertions.deepEqual(
			new Set(calls.map((call) => call.toolName)),
			new Set(REGISTERED_TOOL_NAMES),
		);
		assertions.cover("nine-tool-surface");

		try {
			let executedCorpusCases = 0;
			for (const [index, contractCase] of LIFECYCLE_CONTRACT_CASES.entries()) {
				const workspace = join(root, `corpus-${index}`);
				await mkdir(workspace);
				const toolName = LIFECYCLE_OPERATION_TOOLS[contractCase.operation];
				const context = toolContext(workspace);
				if (!contractCase.expected) {
					await assertions.rejects(
						() => executeRegisteredTool(toolName, contractCase.input, context),
						undefined,
						contractCase.name,
					);
					assertions.cover("invalid-before-flow");
				} else {
					const output = await executeRegisteredTool(
						toolName,
						contractCase.input,
						context,
					);
					assertions.equal(typeof output, "string", contractCase.name);
					if (typeof output !== "string") {
						throw new Error(`${contractCase.name} did not return JSON text.`);
					}
					const response = JSON.parse(output) as { status?: string };
					assertions.equal(
						response.status,
						"missing_session",
						contractCase.name,
					);
					assertions.cover("corrected-call");
				}
				assertions.equal(
					await hasPersistedSession(workspace),
					false,
					contractCase.name,
				);
				executedCorpusCases += 1;
			}
			assertions.equal(
				executedCorpusCases,
				LIFECYCLE_CONTRACT_CASES.length,
				"Every shared corpus case must execute through a registered callback.",
			);
			assertions.cover("executed-full-corpus");

			let outerEnvelopeChecks = 0;
			for (const [index, call] of calls.entries()) {
				const workspace = join(root, `outer-${index}`);
				await mkdir(workspace);
				const context = toolContext(workspace);
				await assertions.rejects(() =>
					executeRegisteredTool(
						call.toolName,
						{ ...call.corrected, unexpectedOuterField: true },
						context,
					),
				);
				assertions.cover("unknown-outer-envelope-before-flow");
				assertions.equal(await hasPersistedSession(workspace), false);

				const output = await executeRegisteredTool(
					call.toolName,
					call.corrected,
					context,
				);
				assertions.equal(typeof output, "string", call.toolName);
				if (typeof output !== "string") {
					throw new Error(`${call.toolName} did not return text.`);
				}
				if (call.expectedStatus === null) {
					assertions.ok(output.length > 0, call.toolName);
				} else {
					const response = JSON.parse(output) as { status?: string };
					assertions.equal(response.status, call.expectedStatus, call.toolName);
				}
				assertions.cover("corrected-call");
				assertions.equal(await hasPersistedSession(workspace), false);
				assertions.cover("unchanged-state");
				assertions.cover(call.toolName);
				outerEnvelopeChecks += 1;
			}
			assertions.equal(outerEnvelopeChecks, REGISTERED_TOOL_NAMES.length);
			assertions.equal(outerEnvelopeChecks, 9);
			assertions.cover("all-nine-outer-envelopes");
			assertions.cover("actual-registration");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	[
		"actual-registration",
		"invalid-before-flow",
		"executed-full-corpus",
		"unknown-outer-envelope-before-flow",
		"all-nine-outer-envelopes",
		"nine-tool-surface",
		"unchanged-state",
		"corrected-call",
		"flow_guidance",
		"flow_status",
		"flow_plan_save",
		"flow_plan_approve",
		"flow_run_start",
		"flow_review_start",
		"flow_feature_complete",
		"flow_feature_reset",
		"flow_session_close",
	],
);
