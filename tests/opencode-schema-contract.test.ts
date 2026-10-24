import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
	FeatureCompleteInputSchema,
	FeatureResetInputSchema,
	PlanAmendInputSchema,
	PlanApproveInputSchema,
	PlanSaveInputSchema,
	ReviewStartInputSchema,
	RunStartInputSchema,
	SessionCloseInputSchema,
	StatusInputSchema,
	ValidationStartInputSchema,
} from "../src/application/schema.js";
import { FLOW_GUIDANCE_IDS } from "../src/guidance/catalog.js";
import type { FlowToolContext as ToolContext } from "../src/platform/opencode/flow-tool.js";
import { createTools } from "../src/platform/opencode/tools.js";
import { ValidationCaptureCoordinator } from "../src/platform/opencode/validation-capture.js";

const LIFECYCLE_TOOL_NAMES = [
	"flow_status",
	"flow_plan_save",
	"flow_plan_amend",
	"flow_plan_approve",
	"flow_run_start",
	"flow_validation_start",
	"flow_review_start",
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_session_close",
] as const;

type LifecycleToolName = (typeof LIFECYCLE_TOOL_NAMES)[number];

type SafeSchema = {
	safeParse(
		value: unknown,
	): { success: true; data: unknown } | { success: false; error: unknown };
};

function createRegisteredTools() {
	return createTools({
		validation: new ValidationCaptureCoordinator({
			readSession: async () => undefined,
			persistObservation: async () => {
				throw new Error("Unused persistence.");
			},
		}),
		prepareValidation: async () => {
			throw new Error("Validation execution is outside this schema test.");
		},
	});
}

const registeredTools = createRegisteredTools();

function hostSchema(name: LifecycleToolName) {
	const definition = registeredTools[name];
	if (!definition) throw new Error(`Missing registered ${name}.`);
	return z.fromJSONSchema(definition.input);
}

type JsonSchema = z.core.JSONSchema.JSONSchema;

function emittedHostSchema(name: LifecycleToolName): JsonSchema {
	const definition = registeredTools[name];
	if (!definition) throw new Error(`Missing ${name}.`);
	return definition.input;
}

function property(schema: JsonSchema, name: string): JsonSchema {
	const result = schema.properties?.[name];
	if (!result || typeof result === "boolean")
		throw new Error(`Missing JSON Schema property '${name}'.`);
	return result;
}

function propertyNames(schema: JsonSchema): string[] {
	return Object.keys(schema.properties ?? {}).sort();
}

function collectPropertyNames(schema: JsonSchema, result = new Set<string>()) {
	for (const [name, child] of Object.entries(schema.properties ?? {})) {
		result.add(name);
		if (typeof child !== "boolean") collectPropertyNames(child, result);
	}
	for (const branch of schema.anyOf ?? []) collectPropertyNames(branch, result);
	for (const branch of schema.oneOf ?? []) collectPropertyNames(branch, result);
	for (const branch of schema.allOf ?? []) collectPropertyNames(branch, result);
	const items = Array.isArray(schema.items) ? schema.items : [schema.items];
	for (const item of items)
		if (item && typeof item !== "boolean") collectPropertyNames(item, result);
	return result;
}

const guard = { operationId: "operation-1", expectedRevision: 0 };
const featureId = "simplify-flow";
const assignmentId = "  review-assignment:1  ";
const plan = {
	summary: "Simplify Flow",
	overview: "Keep one serial lifecycle.",
	requirements: ["Keep independent review"],
	decisions: ["Remove optional orchestration"],
	features: [
		{
			id: featureId,
			title: "Simplify runtime",
			summary: "Deliver the smaller runtime",
			targets: ["src"],
			validation: ["Run focused tests"],
			dependsOn: [],
		},
	],
};

const validInputs: Record<
	LifecycleToolName,
	{ request: Record<string, unknown> }
> = {
	flow_status: {
		request: { view: "reviewer", assignmentId },
	},
	flow_plan_save: {
		request: { ...guard, goal: "Ship a simpler Flow", plan },
	},
	flow_plan_amend: {
		request: {
			...guard,
			featureId,
			validationId: "validation-1",
			reason: "The canonical gate exposed a prerequisite failure.",
			repair: "Repair the test setup.",
			targets: ["tests/setup.ts"],
			sameGoal: true,
			reversible: true,
		},
	},
	flow_plan_approve: { request: { ...guard } },
	flow_run_start: { request: { ...guard, featureId } },
	flow_validation_start: {
		request: {
			expectedRevision: 0,
			featureId,
			command: "bun test",
			scope: "focused",
		},
	},
	flow_review_start: {
		request: {
			...guard,
			featureId,
			artifactsChanged: [{ path: "src/example.ts" }],
			packet: { summary: "  Review the feature  " },
		},
	},
	flow_feature_complete: {
		request: {
			...guard,
			featureId,
			assignmentId,
			summary: "  Feature completed  ",
			result: {
				verdict: "passed",
				terminalDisposition: "submitted",
			},
		},
	},
	flow_feature_reset: { request: { ...guard, featureId } },
	flow_session_close: {
		request: {
			...guard,
			sessionId: "session-1",
			kind: "completed",
			summary: "Delivered",
		},
	},
};

const applicationSchemas = {
	flow_status: StatusInputSchema,
	flow_plan_save: PlanSaveInputSchema,
	flow_plan_amend: PlanAmendInputSchema,
	flow_plan_approve: PlanApproveInputSchema,
	flow_run_start: RunStartInputSchema,
	flow_validation_start: ValidationStartInputSchema,
	flow_review_start: ReviewStartInputSchema,
	flow_feature_complete: FeatureCompleteInputSchema,
	flow_feature_reset: FeatureResetInputSchema,
	flow_session_close: SessionCloseInputSchema,
} satisfies Record<LifecycleToolName, SafeSchema>;

function expectParity(
	name: LifecycleToolName,
	input: unknown,
	expected: boolean,
): void {
	const hostResult = hostSchema(name).safeParse(input);
	const applicationResult = applicationSchemas[name].safeParse(input);
	if (expected) expect(hostResult.success, `${name} host schema`).toBe(true);
	else {
		const definition = registeredTools[name];
		if (!definition) throw new Error(`Missing ${name}.`);
		expect(() =>
			definition.execute(input, {
				sessionID: "schema-session",
				messageID: "schema-message",
				callID: "schema-call",
				agent: "build",
				directory: "/unused",
				abort: new AbortController().signal,
			}),
		).toThrow();
	}
	expect(applicationResult.success, `${name} application schema`).toBe(
		expected,
	);
}

describe("Flow OpenCode host schemas", () => {
	test("keeps strict requests with optional status-only recovery proposals", () => {
		for (const name of LIFECYCLE_TOOL_NAMES) {
			const definition = registeredTools[name];
			expect(Object.keys(definition?.input.properties ?? {}), name).toEqual(
				name === "flow_status" ? ["recoveryProposal", "request"] : ["request"],
			);
			const emitted = emittedHostSchema(name);
			expect(emitted.required, name).toContain("request");
			expect(emitted.additionalProperties, name).toBe(false);

			const valid = validInputs[name];
			expectParity(name, valid, true);
			expectParity(name, { ...valid.request }, false);
			expectParity(
				name,
				{ request: { ...valid.request, unexpected: true } },
				false,
			);
		}
	});

	test("matches the compact v6 request shapes", () => {
		const expected: Partial<Record<LifecycleToolName, readonly string[]>> = {
			flow_validation_start: [
				"command",
				"expectedRevision",
				"featureId",
				"resultsPath",
				"scope",
			],
			flow_review_start: [
				"artifactsChanged",
				"expectedRevision",
				"featureId",
				"operationId",
				"packet",
			],
			flow_feature_complete: [
				"assignmentId",
				"expectedRevision",
				"featureId",
				"operationId",
				"result",
				"summary",
			],
			flow_feature_reset: [
				"existingWork",
				"expectedRevision",
				"featureId",
				"nextFeatureId",
				"operationId",
			],
			flow_session_close: [
				"expectedRevision",
				"kind",
				"operationId",
				"sessionId",
				"summary",
			],
		} as const;

		for (const name of LIFECYCLE_TOOL_NAMES) {
			if (name === "flow_status") continue;
			const fields = expected[name];
			if (!fields) continue;
			const request = property(emittedHostSchema(name), "request");
			expect(propertyNames(request), name).toEqual([...fields]);
			expect(request.additionalProperties, name).toBe(false);
		}
		expect(
			property(emittedHostSchema("flow_status"), "request").oneOf,
		).toHaveLength(5);
		expectParity(
			"flow_feature_reset",
			{
				request: {
					...validInputs.flow_feature_reset.request,
					nextFeatureId: "independent-feature",
				},
			},
			true,
		);
	});

	test("preserves opaque review assignment ids", () => {
		for (const name of ["flow_status", "flow_feature_complete"] as const) {
			for (const schema of [hostSchema(name), applicationSchemas[name]]) {
				const result = schema.safeParse(validInputs[name]);
				if (!result.success) throw new Error(`Expected valid ${name} input.`);
				expect(
					z
						.object({ request: z.object({ assignmentId: z.string() }) })
						.parse(result.data).request.assignmentId,
				).toBe(assignmentId);
			}
		}
	});

	test("matches UTF-8 bounds, plan bounds, and review-result semantics", () => {
		const oversizedText = "🧪".repeat(8_193);
		expectParity(
			"flow_plan_save",
			{
				request: {
					...validInputs.flow_plan_save.request,
					goal: oversizedText,
				},
			},
			false,
		);
		expectParity(
			"flow_review_start",
			{
				request: {
					...validInputs.flow_review_start.request,
					artifactsChanged: [{ path: "🧪".repeat(1_025) }],
				},
			},
			false,
		);
		for (const path of [
			"../outside.ts",
			"/outside.ts",
			"C:/outside.ts",
			"src\\outside.ts",
			"src//outside.ts",
		]) {
			expectParity(
				"flow_review_start",
				{
					request: {
						...validInputs.flow_review_start.request,
						artifactsChanged: [{ path }],
					},
				},
				false,
			);
		}

		const oversizedPlan = {
			...plan,
			features: Array.from({ length: 64 }, (_, index) => ({
				...plan.features[0],
				id: `feature-${index}`,
				summary: "x".repeat(4_096),
			})),
		};
		expectParity(
			"flow_plan_save",
			{
				request: {
					...validInputs.flow_plan_save.request,
					plan: oversizedPlan,
				},
			},
			false,
		);

		for (const result of [
			{
				verdict: "failed",
				findings: [],
				terminalDisposition: "submitted",
			},
			{
				verdict: "passed",
				findings: [
					{
						severity: "blocking",
						summary: "Still broken",
						evidence: "src/example.ts:1",
					},
				],
				terminalDisposition: "submitted",
			},
			{
				verdict: "failed",
				findings: [{ severity: "blocking", summary: "Still broken" }],
				terminalDisposition: "submitted",
			},
			{
				verdict: "passed",
				findings: [],
				terminalDisposition: "observed_unsubmitted",
			},
		]) {
			expectParity(
				"flow_feature_complete",
				{
					request: {
						...validInputs.flow_feature_complete.request,
						result,
					},
				},
				false,
			);
		}
	});

	test("accepts the review finding fields the reviewer is instructed to send", () => {
		// `skills/flow-review/SKILL.md` tells the reviewer to send `scopeBlocker`
		// and `findingId`, and `nextAction` reads `scopeBlocker` to decide between
		// an automatic reset and a user checkpoint. The strict host schema once
		// omitted both, so every such submission was rejected at the host boundary
		// while the application schema accepted it.
		const names = collectPropertyNames(
			emittedHostSchema("flow_feature_complete"),
		);
		for (const field of ["scopeBlocker", "findingId"])
			expect(names.has(field), `emitted ${field}`).toBe(true);

		expectParity(
			"flow_feature_complete",
			{
				request: {
					...validInputs.flow_feature_complete.request,
					result: {
						verdict: "failed",
						findings: [
							{
								severity: "blocking",
								summary: "Repair needs work outside the approved plan",
								evidence: "src/example.ts:1",
								scopeBlocker: true,
								findingId: `${featureId}.R12-01`,
							},
						],
						terminalDisposition: "submitted",
					},
				},
			},
			true,
		);

		expectParity(
			"flow_feature_complete",
			{
				request: {
					...validInputs.flow_feature_complete.request,
					result: {
						verdict: "failed",
						findings: [
							{
								severity: "blocking",
								summary: "Malformed recurrence id",
								findingId: "not-a-finding-id",
							},
						],
						terminalDisposition: "submitted",
					},
				},
			},
			false,
		);
	});

	test("keeps completion authorization separate from validation cancellation", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "flow-schema-contract-"));
		const cancelled: string[] = [];
		const validation = new ValidationCaptureCoordinator({
			readSession: async () => undefined,
			persistObservation: async () => {
				throw new Error("Unused persistence.");
			},
		});
		const cancel = validation.cancel.bind(validation);
		validation.cancel = (sessionID) => {
			cancelled.push(sessionID);
			return cancel(sessionID);
		};
		const tools = createTools({
			validation,
			prepareValidation: async () => {
				throw new Error("Not used by mutation tools.");
			},
		});
		const context = {
			sessionID: "schema-contract-session",
			agent: "build",
			directory: workspace,
			messageID: "schema-message",
			callID: "schema-call",
			abort: new AbortController().signal,
		} satisfies ToolContext;
		const managerMutations = [
			"flow_plan_save",
			"flow_plan_amend",
			"flow_plan_approve",
			"flow_run_start",
			"flow_review_start",
			"flow_feature_reset",
			"flow_session_close",
		] as const;
		try {
			for (const name of managerMutations) {
				await tools[name]?.execute(validInputs[name], context);
			}
			expect(cancelled).toEqual(
				managerMutations.map(() => "schema-contract-session"),
			);

			await tools.flow_feature_complete?.execute(
				validInputs.flow_feature_complete,
				context,
			);
			expect(cancelled).toHaveLength(managerMutations.length);

			await tools.flow_feature_complete?.execute(
				validInputs.flow_feature_complete,
				{
					...context,
					agent: "flow-reviewer",
				},
			);
			expect(cancelled).toEqual(
				managerMutations.map(() => "schema-contract-session"),
			);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("keeps guidance as the sole non-request tool", () => {
		const definition = registeredTools.flow_guidance;
		if (!definition) throw new Error("Missing flow_guidance.");
		const schema = z.fromJSONSchema(definition.input);
		expect(Object.keys(definition.input.properties ?? {})).toEqual(["id"]);
		for (const id of FLOW_GUIDANCE_IDS) {
			expect(schema.safeParse({ id }).success).toBe(true);
		}
		expect(schema.safeParse({ id: "flow-test" }).success).toBe(false);
		expect(schema.safeParse({ request: { id: "flow" } }).success).toBe(false);
	});

	test("rejects removed receipt, snapshot, correction, review, and orchestration fields", () => {
		const legacyCases: Array<{
			name: LifecycleToolName;
			field: string;
			input: unknown;
		}> = [
			{
				name: "flow_plan_save",
				field: "finalReviewPolicy",
				input: {
					request: {
						...validInputs.flow_plan_save.request,
						plan: { ...plan, finalReviewPolicy: "detailed" },
					},
				},
			},
			{
				name: "flow_plan_save",
				field: "reviewDepth",
				input: {
					request: {
						...validInputs.flow_plan_save.request,
						plan: {
							...plan,
							features: [{ ...plan.features[0], reviewDepth: "standard" }],
						},
					},
				},
			},
			...[
				"expectedSnapshotId",
				"validationRefs",
				"correctionOfAssignmentId",
				"correctionScopeHint",
				"orchestrationPasses",
			].map((field) => ({
				name: "flow_review_start" as const,
				field,
				input: {
					request: {
						...validInputs.flow_review_start.request,
						[field]: field === "validationRefs" ? [] : "legacy",
					},
				},
			})),
		];

		for (const legacy of legacyCases) {
			expectParity(legacy.name, legacy.input, false);
		}

		const forbidden = new Set([
			"expectedSnapshotId",
			"validationRefs",
			"correctionOfAssignmentId",
			"correctionScopeHint",
			"reviewDepth",
			"finalReviewPolicy",
			"orchestrationPasses",
		]);
		for (const name of LIFECYCLE_TOOL_NAMES) {
			const names = collectPropertyNames(emittedHostSchema(name));
			for (const field of forbidden)
				expect(names.has(field), `${name}.${field}`).toBe(false);
		}
	});
});
