import { describe, expect, test } from "bun:test";
import {
	FlowFeatureCompleteToolSchema,
	FlowFeatureResetSchema,
	FlowPlanSaveSchema,
	FlowRunStartSchema,
	FlowSessionCloseSchema,
} from "../src/application/flow-service.js";
import {
	acceptsFlowHostInput,
	type FlowHostInputOperation,
} from "../src/platform/opencode/tools.js";

const plan = {
	summary: "Rewrite Flow for v5.",
	overview: "Replace the runtime through explicit architectural seams.",
	requirements: ["Keep domain behavior host-neutral."],
	decisions: ["Use a hard cutover."],
	finalReviewPolicy: "detailed",
	features: [
		{
			id: "domain-rewrite",
			title: "Rewrite the domain",
			summary: "Introduce immutable state and typed transitions.",
			reviewDepth: "detailed",
			targets: ["src/domain"],
			validation: ["bun test tests/domain"],
			dependsOn: [],
		},
	],
} as const;

const validFeatureResult = {
	status: "ok",
	featureId: "domain-rewrite",
	summary: "The domain was rewritten.",
	artifactsChanged: [{ path: "src/domain/session.ts" }],
	validationRun: [
		{
			command: "bun test tests/domain",
			status: "passed",
			summary: "Domain tests passed.",
		},
	],
	validationScope: "targeted",
	featureReviewDepth: "detailed",
	featureReview: {
		status: "passed",
		summary: "The new domain boundary was reviewed.",
		blockingFindings: [],
	},
	orchestrationPasses: [
		{
			id: "domain-review",
			kind: "review",
			candidateEligibility: "unknown",
			decisionFactors: [],
			modes: ["review"],
			workerCount: 1,
			candidateWorkerCount: 0,
			verifierWorkerCount: 0,
			sliceIds: ["domain"],
			dependsOn: [],
			writeScope: "none",
			handoffRefs: [],
			verificationStatus: "passed",
			outcome: "accepted",
		},
	],
} as const;

const coreSchemas = {
	planSave: FlowPlanSaveSchema,
	runStart: FlowRunStartSchema,
	featureComplete: FlowFeatureCompleteToolSchema,
	featureReset: FlowFeatureResetSchema,
	sessionClose: FlowSessionCloseSchema,
} as const;

const fixtures = [
	{
		name: "accepts a complete plan payload",
		schema: "planSave",
		input: { goal: "Ship Flow v5", plan },
		expected: true,
	},
	{
		name: "rejects unknown plan fields",
		schema: "planSave",
		input: { goal: "Ship Flow v5", plan, compatibilityMode: true },
		expected: false,
	},
	{
		name: "rejects malformed feature ids in a plan",
		schema: "planSave",
		input: {
			goal: "Ship Flow v5",
			plan: {
				...plan,
				features: [{ ...plan.features[0], id: "Domain Rewrite" }],
			},
		},
		expected: false,
	},
	{
		name: "rejects removed phase-boundary acknowledgements",
		schema: "runStart",
		input: { featureId: "domain-rewrite", phaseBoundaryAck: true },
		expected: false,
	},
	{
		name: "rejects an empty run feature id",
		schema: "runStart",
		input: { featureId: "" },
		expected: false,
	},
	{
		name: "rejects a non-kebab run feature id",
		schema: "runStart",
		input: { featureId: "Domain Rewrite" },
		expected: false,
	},
	{
		name: "accepts a complete feature result",
		schema: "featureComplete",
		input: validFeatureResult,
		expected: true,
	},
	{
		name: "rejects a completion outcome without an explicit kind",
		schema: "featureComplete",
		input: {
			status: "needs_input",
			featureId: "domain-rewrite",
			summary: "Need operator input.",
			outcome: { summary: "Missing credentials." },
		},
		expected: false,
	},
	{
		name: "rejects impossible orchestration worker counts",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			orchestrationPasses: [
				{
					...validFeatureResult.orchestrationPasses[0],
					workerCount: 0,
					candidateWorkerCount: 1,
				},
			],
		},
		expected: false,
	},
	{
		name: "rejects more than 50 orchestration passes",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			orchestrationPasses: Array.from({ length: 51 }, (_, index) => ({
				...validFeatureResult.orchestrationPasses[0],
				id: `domain-review-${index}`,
			})),
		},
		expected: false,
	},
	{
		name: "rejects unknown review fields",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			featureReview: {
				...validFeatureResult.featureReview,
				legacyApproval: true,
			},
		},
		expected: false,
	},
	{
		name: "accepts a feature reset",
		schema: "featureReset",
		input: { featureId: "domain-rewrite" },
		expected: true,
	},
	{
		name: "rejects a reset without a feature",
		schema: "featureReset",
		input: {},
		expected: false,
	},
	{
		name: "rejects a non-kebab reset feature id",
		schema: "featureReset",
		input: { featureId: "Domain Rewrite" },
		expected: false,
	},
	{
		name: "accepts an abandoned session closure",
		schema: "sessionClose",
		input: { kind: "abandoned", summary: "Superseded by v5." },
		expected: true,
	},
	{
		name: "rejects a legacy session closure kind",
		schema: "sessionClose",
		input: { kind: "cancelled" },
		expected: false,
	},
] as const;

describe("OpenCode transport and core input schema contract", () => {
	for (const fixture of fixtures) {
		test(fixture.name, () => {
			const operation: FlowHostInputOperation = fixture.schema;
			const coreSchema = coreSchemas[operation];
			expect(acceptsFlowHostInput(operation, fixture.input)).toBe(
				fixture.expected,
			);
			expect(coreSchema.safeParse(fixture.input).success).toBe(
				fixture.expected,
			);
		});
	}
});
