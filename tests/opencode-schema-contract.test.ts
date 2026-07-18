import { describe, expect, test } from "bun:test";
import {
	FlowFeatureCompleteToolSchema,
	FlowFeatureResetSchema,
	FlowPlanSaveSchema,
	FlowRunStartSchema,
	FlowSessionCloseSchema,
	FlowStatusSchema,
} from "../src/application/flow-service.js";
import {
	acceptsFlowHostInput,
	createTools,
	type FlowHostInputOperation,
} from "../src/platform/opencode/tools.js";

const REVIEW_SNAPSHOT_ID = `sha256:${"a".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"c".repeat(64)}`;
const EVIDENCE_ID = `sha256:${"d".repeat(64)}`;

const causalGuard = {
	operationId: "domain-rewrite-completion",
	expectedRevision: 3,
	expectedSnapshotId: REVIEW_SNAPSHOT_ID,
} as const;

const reviewExecution = {
	attemptId: "attempt-1",
	logicalPassId: "feature-review",
	featureId: "domain-rewrite",
	reviewKind: "feature",
	reviewSnapshotId: REVIEW_SNAPSHOT_ID,
	verdict: "passed",
	findings: [],
	startedAt: "2026-07-18T09:00:00.000Z",
	completedAt: "2026-07-18T09:01:00.000Z",
	terminalDisposition: "submitted",
} as const;

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
	...causalGuard,
	featureId: "domain-rewrite",
	summary: "The domain was rewritten.",
	artifactsChanged: [{ path: "src/domain/session.ts" }],
	validations: [
		{
			command: "bun test tests/domain",
			summary: "Domain tests passed.",
			startedAt: "2026-07-18T08:58:00.000Z",
			completedAt: "2026-07-18T08:59:00.000Z",
			exitCode: 0,
			outputDigest: OUTPUT_DIGEST,
			environmentKeys: [],
		},
	],
	validationScope: "targeted",
	featureReviewDepth: "detailed",
	featureReview: {
		status: "passed",
		summary: "The new domain boundary was reviewed.",
		blockingFindings: [],
	},
	reviewExecutions: [reviewExecution],
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
	status: FlowStatusSchema,
	planSave: FlowPlanSaveSchema,
	runStart: FlowRunStartSchema,
	featureComplete: FlowFeatureCompleteToolSchema,
	featureReset: FlowFeatureResetSchema,
	sessionClose: FlowSessionCloseSchema,
} as const;

const fixtures = [
	{
		name: "accepts compact status by default",
		schema: "status",
		input: {},
		expected: true,
	},
	{
		name: "accepts execution status without a caller feature selection",
		schema: "status",
		input: { view: "execution" },
		expected: true,
	},
	{
		name: "rejects caller-selected execution features",
		schema: "status",
		input: { view: "execution", featureId: "domain-rewrite" },
		expected: false,
	},
	{
		name: "rejects reviewer-only fields on strict execution input",
		schema: "status",
		input: {
			view: "execution",
			reviewKind: "feature",
			packetHash: REVIEW_SNAPSHOT_ID,
		},
		expected: false,
	},
	{
		name: "accepts a guarded reviewer projection request",
		schema: "status",
		input: {
			view: "reviewer",
			featureId: "domain-rewrite",
			reviewKind: "feature",
			packetHash: REVIEW_SNAPSHOT_ID,
			evidenceRefs: [EVIDENCE_ID],
			expectedRevision: 3,
			expectedSnapshotId: REVIEW_SNAPSHOT_ID,
		},
		expected: true,
	},
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
		name: "rejects a whitespace-only completion summary",
		schema: "featureComplete",
		input: { ...validFeatureResult, summary: "   " },
		expected: false,
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
		name: "passes impossible optional orchestration telemetry to application isolation",
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
		expected: true,
	},
	{
		name: "passes over-limit optional orchestration telemetry to application isolation",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			orchestrationPasses: Array.from({ length: 51 }, (_, index) => ({
				...validFeatureResult.orchestrationPasses[0],
				id: `domain-review-${index}`,
			})),
		},
		expected: true,
	},
	{
		name: "accepts strict review execution evidence without a caller fingerprint",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			reviewExecutions: [reviewExecution],
		},
		expected: true,
	},
	{
		name: "rejects a passed review that was observed but never submitted",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			reviewExecutions: [
				{
					...reviewExecution,
					terminalDisposition: "observed_unsubmitted",
				},
			],
		},
		expected: false,
	},
	{
		name: "rejects caller-fabricated review finding fingerprints",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			reviewExecutions: [
				{
					...reviewExecution,
					verdict: "failed",
					findings: [
						{
							taxonomy: "implementation_defect",
							subject: "src/domain/session.ts",
							requirementOrRisk: "Attempts must remain append-only.",
							evidenceLocator: "src/domain/session.ts:100",
							summary: "Attempt evidence can be overwritten.",
							severity: "blocking",
							fingerprint: `finding-v1-${"b".repeat(32)}`,
						},
					],
				},
			],
		},
		expected: false,
	},
	{
		name: "rejects non-digest review snapshot identities",
		schema: "featureComplete",
		input: {
			...validFeatureResult,
			reviewExecutions: [
				{ ...reviewExecution, reviewSnapshotId: "review-snapshot-latest" },
			],
		},
		expected: false,
	},
	{
		name: "rejects unknown non-telemetry completion fields",
		schema: "featureComplete",
		input: { ...validFeatureResult, legacyApproval: true },
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
		input: { ...causalGuard, featureId: "domain-rewrite" },
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
		input: {
			...causalGuard,
			kind: "abandoned",
			summary: "Superseded by v5.",
		},
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

	test("registers the execution status view on the host tool", () => {
		const registered = createTools({}).flow_status;
		expect(registered).toBeDefined();
		if (!registered) throw new Error("Expected flow_status tool.");
		const view = registered.args.view as
			| { safeParse(value: unknown): { success: boolean } }
			| undefined;
		expect(view?.safeParse("execution").success).toBe(true);
	});

	test("registers only the public completion envelope fields", () => {
		const registered = createTools({}).flow_feature_complete;
		expect(registered).toBeDefined();
		if (!registered) throw new Error("Expected flow_feature_complete tool.");
		expect(Object.keys(registered.args).sort()).toEqual(
			[
				"artifactsChanged",
				"expectedRevision",
				"expectedSnapshotId",
				"featureId",
				"featureReview",
				"featureReviewDepth",
				"finalReview",
				"operationId",
				"orchestrationPasses",
				"outcome",
				"reviewExecutions",
				"status",
				"summary",
				"validationScope",
				"validations",
			].sort(),
		);
		for (const serverOwned of [
			"sourceDigest",
			"snapshotId",
			"evidenceId",
			"evidence",
			"validationRun",
			"commandClass",
		]) {
			expect(registered.args).not.toHaveProperty(serverOwned);
		}
	});

	test("host envelope defers status-dependent required fields to the authoritative application union", () => {
		const { validations: _omitted, ...missingConditionalField } =
			validFeatureResult;
		expect(
			acceptsFlowHostInput("featureComplete", missingConditionalField),
		).toBe(true);
		expect(
			FlowFeatureCompleteToolSchema.safeParse(missingConditionalField).success,
		).toBe(false);
	});

	test("application union enforces one aggregate derived-evidence budget", () => {
		const overAggregateLimit = {
			...validFeatureResult,
			validations: Array.from({ length: 51 }, (_, index) => ({
				...validFeatureResult.validations[0],
				command: `bun test tests/domain-${index}`,
			})),
			reviewExecutions: Array.from({ length: 50 }, (_, index) => ({
				...reviewExecution,
				attemptId: `attempt-${index + 1}`,
			})),
		};
		expect(acceptsFlowHostInput("featureComplete", overAggregateLimit)).toBe(
			true,
		);
		const parsed = FlowFeatureCompleteToolSchema.safeParse(overAggregateLimit);
		expect(parsed.success).toBe(false);
		if (parsed.success) throw new Error("Expected aggregate limit rejection.");
		expect(parsed.error.issues[0]?.message).toContain(
			"at most 100 evidence records",
		);
	});
});
