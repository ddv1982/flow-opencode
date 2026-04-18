import { describe, expect, test } from "bun:test";
import { tool } from "@opencode-ai/plugin";
import {
	PlanSchema,
	ReviewerDecisionSchema,
	WorkerResultSchema,
} from "../src/runtime/schema";
import { createTools } from "../src/tools";

type ToolDefinition = {
	args: Record<string, unknown>;
};

type ToolSchemas = Record<
	keyof ReturnType<typeof createTools>,
	ReturnType<typeof tool.schema.object>
>;

type WorkerPayloadLike = {
	contractVersion: string;
	status: string;
	summary: string;
	artifactsChanged: Array<{ path: string; kind?: string | undefined }>;
	validationRun: Array<{ command: string; status: string; summary: string }>;
	validationScope?: string | undefined;
	reviewIterations?: number | undefined;
	decisions: Array<{ summary: string }>;
	nextStep: string;
	outcome?: {
		kind: string;
		category?: string | undefined;
		summary?: string | undefined;
		resolutionHint?: string | undefined;
		retryable?: boolean | undefined;
		autoResolvable?: boolean | undefined;
		needsHuman?: boolean | undefined;
	};
	featureResult: { featureId: string; verificationStatus?: string | undefined };
	featureReview: {
		status: string;
		summary: string;
		blockingFindings: Array<{ summary: string }>;
	};
	finalReview?:
		| {
				status: string;
				summary: string;
				blockingFindings: Array<{ summary: string }>;
		  }
		| undefined;
};

function getToolSchemas() {
	const tools = createTools({}) as unknown as Record<string, ToolDefinition>;

	return Object.fromEntries(
		Object.entries(tools).map(([name, definition]) => [
			name,
			tool.schema.object(definition.args),
		]),
	) as ToolSchemas;
}

function samplePlan() {
	return {
		summary: "Implement a small workflow feature set.",
		overview: "Create one setup feature and one execution feature.",
		requirements: ["Keep state durable", "Keep commands concise"],
		architectureDecisions: [
			"Persist session history under .flow/sessions/<id>",
			"Run one feature per worker invocation",
		],
		features: [
			{
				id: "setup-runtime",
				title: "Create runtime helpers",
				summary: "Add runtime helper files and state persistence.",
				fileTargets: ["src/runtime/session.ts"],
				verification: ["bun test"],
			},
		],
	};
}

function sampleWorkerResult(): WorkerPayloadLike {
	return {
		contractVersion: "1" as const,
		status: "ok" as const,
		summary: "Completed runtime setup.",
		artifactsChanged: [{ path: "src/runtime/session.ts", kind: "updated" }],
		validationRun: [
			{
				command: "bun test",
				status: "passed" as const,
				summary: "Runtime tests passed.",
			},
		],
		validationScope: "targeted" as const,
		reviewIterations: 1,
		decisions: [{ summary: "Kept state transitions explicit." }],
		nextStep: "Run next feature.",
		featureResult: {
			featureId: "setup-runtime",
			verificationStatus: "passed" as const,
		},
		featureReview: {
			status: "passed" as const,
			summary: "Looks good.",
			blockingFindings: [],
		},
	};
}

describe("schema alignment", () => {
	test("plan payloads stay aligned between runtime and tool schemas", () => {
		const schemas = getToolSchemas();
		const validPlan = samplePlan();

		expect(PlanSchema.safeParse(validPlan).success).toBe(true);
		expect(schemas.flow_plan_apply.safeParse({ plan: validPlan }).success).toBe(
			true,
		);

		const invalidFeatureId = {
			...validPlan,
			features: [{ ...validPlan.features[0], id: "Bad Id" }],
		};
		expect(PlanSchema.safeParse(invalidFeatureId).success).toBe(false);
		expect(
			schemas.flow_plan_apply.safeParse({ plan: invalidFeatureId }).success,
		).toBe(false);

		const invalidCompletionPolicy = {
			...validPlan,
			completionPolicy: { minCompletedFeatures: 0 },
		};
		expect(PlanSchema.safeParse(invalidCompletionPolicy).success).toBe(false);
		expect(
			schemas.flow_plan_apply.safeParse({ plan: invalidCompletionPolicy })
				.success,
		).toBe(false);
	});

	test("reviewer decision payloads stay aligned between runtime and tool schemas", () => {
		const schemas = getToolSchemas();
		const validFeatureDecision = {
			scope: "feature" as const,
			featureId: "setup-runtime",
			status: "approved" as const,
			summary: "Looks good.",
			blockingFindings: [{ summary: "None" }],
			followUps: [{ summary: "Proceed", severity: "low" }],
			suggestedValidation: ["bun test"],
		};

		expect(ReviewerDecisionSchema.safeParse(validFeatureDecision).success).toBe(
			true,
		);
		expect(
			schemas.flow_review_record_feature.safeParse(validFeatureDecision)
				.success,
		).toBe(true);

		const invalidStatus = { ...validFeatureDecision, status: "pass" };
		expect(ReviewerDecisionSchema.safeParse(invalidStatus).success).toBe(false);
		expect(
			schemas.flow_review_record_feature.safeParse(invalidStatus).success,
		).toBe(false);
	});

	test("worker shared field constraints stay aligned between runtime and tool schemas", () => {
		const schemas = getToolSchemas();
		const valid = sampleWorkerResult();

		expect(WorkerResultSchema.safeParse(valid).success).toBe(true);
		expect(schemas.flow_run_complete_feature.safeParse(valid).success).toBe(
			true,
		);

		const artifactPathInvalid = structuredClone(valid);
		const artifact = artifactPathInvalid.artifactsChanged[0];
		if (!artifact) {
			throw new Error("Expected an artifact in sampleWorkerResult");
		}
		artifact.path = "";
		expect(WorkerResultSchema.safeParse(artifactPathInvalid).success).toBe(
			false,
		);
		expect(
			schemas.flow_run_complete_feature.safeParse(artifactPathInvalid).success,
		).toBe(false);

		const validationStatusInvalid = structuredClone(valid);
		const validationRun = validationStatusInvalid.validationRun[0];
		if (!validationRun) {
			throw new Error("Expected validationRun entries in sampleWorkerResult");
		}
		validationRun.status = "broken";
		expect(WorkerResultSchema.safeParse(validationStatusInvalid).success).toBe(
			false,
		);
		expect(
			schemas.flow_run_complete_feature.safeParse(validationStatusInvalid)
				.success,
		).toBe(false);

		const featureIdInvalid = structuredClone(valid);
		featureIdInvalid.featureResult.featureId = "Bad Id";
		expect(WorkerResultSchema.safeParse(featureIdInvalid).success).toBe(false);
		expect(
			schemas.flow_run_complete_feature.safeParse(featureIdInvalid).success,
		).toBe(false);

		const findingSummaryInvalid = structuredClone(valid);
		findingSummaryInvalid.featureReview.blockingFindings = [{ summary: "" }];
		expect(WorkerResultSchema.safeParse(findingSummaryInvalid).success).toBe(
			false,
		);
		expect(
			schemas.flow_run_complete_feature.safeParse(findingSummaryInvalid)
				.success,
		).toBe(false);
	});
});
