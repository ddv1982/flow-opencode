import {
	FlowFeatureCompleteToolSchema,
	FlowReviewStartSchema,
	FlowSessionCloseSchema,
	FlowStatusSchema,
} from "../../src/application/flow-service.js";

const SNAPSHOT_ID = `sha256:${"a".repeat(64)}`;
const OUTPUT_DIGEST = `sha256:${"c".repeat(64)}`;
const ARTIFACT_DIGEST = `sha256:${"d".repeat(64)}`;

const guard = {
	operationId: "review-lifecycle-operation",
	expectedRevision: 3,
	expectedSnapshotId: SNAPSHOT_ID,
	featureId: "domain-rewrite",
} as const;

const validation = {
	command: "bun test tests/domain",
	summary: "Domain tests passed.",
	startedAt: "2026-07-19T08:58:00.000Z",
	completedAt: "2026-07-19T08:59:00.000Z",
	exitCode: 0,
	outputDigest: OUTPUT_DIGEST,
	environmentKeys: [],
} as const;

const assignmentResult = {
	assignmentId: "review-assignment:one",
	verdict: "passed",
	findings: [],
	completedAt: "2026-07-19T09:01:00.000Z",
	terminalDisposition: "submitted",
} as const;

const blockingAssignmentResult = {
	...assignmentResult,
	verdict: "failed",
	findings: [
		{
			taxonomy: "implementation_defect",
			subject: "src/domain/session.ts",
			requirementOrRisk: "run truth must stay isolated",
			evidenceLocator: "src/domain/session.ts:1",
			summary: "Prior-run truth remains applicable.",
			severity: "blocking",
		},
	],
} as const;

function budgetFinding(fill: string) {
	return {
		taxonomy: "advisory" as const,
		subject: fill.repeat(512),
		requirementOrRisk: fill.repeat(2_000),
		evidenceLocator: fill.repeat(2_000),
		summary: fill.repeat(4_000),
		severity: "advisory" as const,
	};
}

const smallMultibyteAssignmentResult = {
	...assignmentResult,
	findings: [
		{
			taxonomy: "advisory",
			subject: "界",
			requirementOrRisk: "Verify UTF-8 accounting.",
			evidenceLocator: "tests/opencode-schema-contract.test.ts",
			summary: "界".repeat(100),
			severity: "advisory",
		},
	],
} as const;

const oversizedAsciiAssignmentResult = {
	...assignmentResult,
	findings: Array.from({ length: 8 }, () => budgetFinding("x")),
};

const oversizedMultibyteAssignmentResult = {
	...assignmentResult,
	findings: Array.from({ length: 3 }, () => budgetFinding("界")),
};

const plan = {
	summary: "Rewrite Flow.",
	overview: "Replace model-authored review identity with assignments.",
	requirements: ["Keep domain behavior host-neutral."],
	decisions: ["Use Session v4."],
	finalReviewPolicy: "detailed",
	features: [
		{
			id: "domain-rewrite",
			title: "Rewrite the domain",
			summary: "Introduce explicit lifecycle identities.",
			reviewDepth: "detailed",
			targets: ["src/domain"],
			validation: ["bun test tests/domain"],
			dependsOn: [],
		},
	],
} as const;

const statusCompact = { request: { view: "compact" } } as const;
const statusDetail = {
	request: { view: "detail", sinceRevision: 2 },
} as const;
const statusExecution = { request: { view: "execution" } } as const;
const statusReviewer = {
	request: {
		view: "reviewer",
		assignmentId: assignmentResult.assignmentId,
	},
} as const;

const featureReviewStart = {
	request: {
		...guard,
		reviewKind: "feature",
		validationScope: "targeted",
		packet: {
			summary: "Review the domain rewrite.",
			riskLenses: ["causal identity"],
		},
		validations: [validation],
	},
} as const;

const finalReviewStart = {
	request: {
		...featureReviewStart.request,
		reviewKind: "final",
		validationScope: "broad",
		featureReview: assignmentResult,
	},
} as const;

const targetedCompletion = {
	request: {
		...guard,
		result: {
			kind: "completed",
			summary: "The domain was rewritten.",
			artifactsChanged: [{ path: "src/domain/session.ts" }],
			validationScope: "targeted",
			featureReview: assignmentResult,
		},
	},
} as const;

const broadCompletion = {
	request: {
		...guard,
		result: {
			kind: "completed",
			summary: "The final feature passed broad review.",
			artifactsChanged: [{ path: "src/domain/session.ts" }],
			validationScope: "broad",
			finalReview: assignmentResult,
		},
	},
} as const;

const blockedCompletion = {
	request: {
		...guard,
		result: {
			kind: "blocked",
			summary: "Review found a blocker.",
			review: blockingAssignmentResult,
			resolutionHint: "Repair the stale run binding.",
		},
	},
} as const;

const closeStart = {
	request: {
		mode: "start",
		operationId: "close-session",
		expectedRevision: 5,
		expectedSnapshotId: SNAPSHOT_ID,
		kind: "abandoned",
		summary: "Superseded.",
	},
} as const;

const closeRetry = {
	request: {
		mode: "retry",
		operationId: "close-session",
	},
} as const;

export type LifecycleCriticalOperation =
	| "status"
	| "reviewStart"
	| "featureComplete"
	| "close";
export type LifecycleCriticalToolName =
	| "flow_status"
	| "flow_review_start"
	| "flow_feature_complete"
	| "flow_session_close";

export const LIFECYCLE_APPLICATION_SCHEMAS = {
	status: FlowStatusSchema,
	reviewStart: FlowReviewStartSchema,
	featureComplete: FlowFeatureCompleteToolSchema,
	close: FlowSessionCloseSchema,
} as const;

export const LIFECYCLE_OPERATION_TOOLS: Record<
	LifecycleCriticalOperation,
	LifecycleCriticalToolName
> = {
	status: "flow_status",
	reviewStart: "flow_review_start",
	featureComplete: "flow_feature_complete",
	close: "flow_session_close",
};

export type LifecycleContractCase = {
	name: string;
	operation: LifecycleCriticalOperation;
	input: unknown;
	expected: boolean;
};

function withRequest(
	value: { readonly request: Record<string, unknown> },
	request: Record<string, unknown>,
): { request: Record<string, unknown> } {
	return { ...value, request };
}

function withoutPath(
	value: unknown,
	path: readonly (string | number)[],
): unknown {
	const copy = structuredClone(value) as Record<string | number, unknown>;
	let current: Record<string | number, unknown> = copy;
	for (const segment of path.slice(0, -1)) {
		const next = current[segment];
		if (next === null || typeof next !== "object") return copy;
		current = next as Record<string | number, unknown>;
	}
	const final = path.at(-1);
	if (final !== undefined) delete current[final];
	return copy;
}

const validCases: LifecycleContractCase[] = [
	{
		name: "explicit compact status",
		operation: "status",
		input: statusCompact,
		expected: true,
	},
	{
		name: "detail status delta",
		operation: "status",
		input: statusDetail,
		expected: true,
	},
	{
		name: "execution status",
		operation: "status",
		input: statusExecution,
		expected: true,
	},
	{
		name: "reviewer assignment recovery",
		operation: "status",
		input: statusReviewer,
		expected: true,
	},
	{
		name: "feature review start",
		operation: "reviewStart",
		input: featureReviewStart,
		expected: true,
	},
	{
		name: "final review start",
		operation: "reviewStart",
		input: finalReviewStart,
		expected: true,
	},
	{
		name: "targeted completion",
		operation: "featureComplete",
		input: targetedCompletion,
		expected: true,
	},
	{
		name: "broad final completion",
		operation: "featureComplete",
		input: broadCompletion,
		expected: true,
	},
	{
		name: "blocked completion",
		operation: "featureComplete",
		input: blockedCompletion,
		expected: true,
	},
	{ name: "new close", operation: "close", input: closeStart, expected: true },
	{
		name: "close retry",
		operation: "close",
		input: closeRetry,
		expected: true,
	},
	{
		name: "equal validation timestamps",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			validations: [{ ...validation, completedAt: validation.startedAt }],
		}),
		expected: true,
	},
	{
		name: "multibyte review result within total budget",
		operation: "reviewStart",
		input: withRequest(finalReviewStart, {
			...finalReviewStart.request,
			featureReview: smallMultibyteAssignmentResult,
		}),
		expected: true,
	},
];

const invalidCases: LifecycleContractCase[] = [
	{
		name: "status without request",
		operation: "status",
		input: {},
		expected: false,
	},
	{
		name: "legacy flat status",
		operation: "status",
		input: { view: "compact" },
		expected: false,
	},
	{
		name: "reviewer status without assignment",
		operation: "status",
		input: { request: { view: "reviewer" } },
		expected: false,
	},
	{
		name: "execution status with reviewer field",
		operation: "status",
		input: { request: { view: "execution", assignmentId: "assignment:one" } },
		expected: false,
	},
	{
		name: "compact status with negative revision",
		operation: "status",
		input: { request: { view: "compact", sinceRevision: -1 } },
		expected: false,
	},
	{
		name: "detail status with fractional revision",
		operation: "status",
		input: { request: { view: "detail", sinceRevision: 1.5 } },
		expected: false,
	},
	{
		name: "detail status with unsafe revision",
		operation: "status",
		input: {
			request: { view: "detail", sinceRevision: Number.MAX_SAFE_INTEGER + 1 },
		},
		expected: false,
	},
	{
		name: "status with unknown inner field",
		operation: "status",
		input: { request: { view: "compact", featureId: "domain-rewrite" } },
		expected: false,
	},
	{
		name: "status with unknown discriminator",
		operation: "status",
		input: { request: { view: "summary" } },
		expected: false,
	},
	{
		name: "legacy flat review start",
		operation: "reviewStart",
		input: featureReviewStart.request,
		expected: false,
	},
	{
		name: "final review without prerequisite",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			reviewKind: "final",
			validationScope: "broad",
		}),
		expected: false,
	},
	{
		name: "feature review with prerequisite",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			featureReview: assignmentResult,
		}),
		expected: false,
	},
	{
		name: "feature review with broad scope",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			validationScope: "broad",
		}),
		expected: false,
	},
	{
		name: "final review with targeted scope",
		operation: "reviewStart",
		input: withRequest(finalReviewStart, {
			...finalReviewStart.request,
			validationScope: "targeted",
		}),
		expected: false,
	},
	{
		name: "final review with failed feature prerequisite",
		operation: "reviewStart",
		input: withRequest(finalReviewStart, {
			...finalReviewStart.request,
			featureReview: blockingAssignmentResult,
		}),
		expected: false,
	},
	{
		name: "final review with observed unsubmitted passing prerequisite",
		operation: "reviewStart",
		input: withRequest(finalReviewStart, {
			...finalReviewStart.request,
			featureReview: {
				...assignmentResult,
				terminalDisposition: "observed_unsubmitted",
			},
		}),
		expected: false,
	},
	{
		name: "review start with nonzero validation exit code",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			validations: [{ ...validation, exitCode: 1 }],
		}),
		expected: false,
	},
	{
		name: "review start with reversed validation time",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			validations: [{ ...validation, completedAt: "2026-07-19T08:57:59.000Z" }],
		}),
		expected: false,
	},
	{
		name: "review start with negative artifact length",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			validations: [
				{
					...validation,
					artifactRef: {
						kind: "restricted_evidence_v1",
						digest: ARTIFACT_DIGEST,
						byteLength: -1,
					},
				},
			],
		}),
		expected: false,
	},
	{
		name: "review start with unknown inner field",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			packetHash: SNAPSHOT_ID,
		}),
		expected: false,
	},
	{
		name: "review start with unknown discriminator",
		operation: "reviewStart",
		input: withRequest(featureReviewStart, {
			...featureReviewStart.request,
			reviewKind: "release",
		}),
		expected: false,
	},
	{
		name: "review start with oversized total ASCII review result",
		operation: "reviewStart",
		input: withRequest(finalReviewStart, {
			...finalReviewStart.request,
			featureReview: oversizedAsciiAssignmentResult,
		}),
		expected: false,
	},
	{
		name: "legacy flat targeted completion",
		operation: "featureComplete",
		input: targetedCompletion.request,
		expected: false,
	},
	{
		name: "targeted completion with final result",
		operation: "featureComplete",
		input: withRequest(targetedCompletion, {
			...targetedCompletion.request,
			result: {
				...targetedCompletion.request.result,
				finalReview: assignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "broad completion with feature result",
		operation: "featureComplete",
		input: withRequest(broadCompletion, {
			...broadCompletion.request,
			result: {
				...broadCompletion.request.result,
				featureReview: assignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "targeted completion with failed feature review",
		operation: "featureComplete",
		input: withRequest(targetedCompletion, {
			...targetedCompletion.request,
			result: {
				...targetedCompletion.request.result,
				featureReview: blockingAssignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "targeted completion with passing review carrying a blocker",
		operation: "featureComplete",
		input: withRequest(targetedCompletion, {
			...targetedCompletion.request,
			result: {
				...targetedCompletion.request.result,
				featureReview: {
					...blockingAssignmentResult,
					verdict: "passed",
				},
			},
		}),
		expected: false,
	},
	{
		name: "broad completion with failed final review",
		operation: "featureComplete",
		input: withRequest(broadCompletion, {
			...broadCompletion.request,
			result: {
				...broadCompletion.request.result,
				finalReview: blockingAssignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "blocked completion with validation scope",
		operation: "featureComplete",
		input: withRequest(blockedCompletion, {
			...blockedCompletion.request,
			result: {
				...blockedCompletion.request.result,
				validationScope: "targeted",
			},
		}),
		expected: false,
	},
	{
		name: "blocked completion with passed review",
		operation: "featureComplete",
		input: withRequest(blockedCompletion, {
			...blockedCompletion.request,
			result: {
				...blockedCompletion.request.result,
				review: assignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "failed review result without blocking finding",
		operation: "featureComplete",
		input: withRequest(blockedCompletion, {
			...blockedCompletion.request,
			result: {
				...blockedCompletion.request.result,
				review: {
					...assignmentResult,
					verdict: "failed",
				},
			},
		}),
		expected: false,
	},
	{
		name: "completion with unknown discriminator",
		operation: "featureComplete",
		input: withRequest(targetedCompletion, {
			...targetedCompletion.request,
			result: { ...targetedCompletion.request.result, kind: "finished" },
		}),
		expected: false,
	},
	{
		name: "completion with oversized total multibyte review result",
		operation: "featureComplete",
		input: withRequest(targetedCompletion, {
			...targetedCompletion.request,
			result: {
				...targetedCompletion.request.result,
				featureReview: oversizedMultibyteAssignmentResult,
			},
		}),
		expected: false,
	},
	{
		name: "legacy flat close",
		operation: "close",
		input: closeStart.request,
		expected: false,
	},
	{
		name: "close retry with stale guards",
		operation: "close",
		input: withRequest(closeRetry, {
			...closeRetry.request,
			expectedRevision: 5,
			expectedSnapshotId: SNAPSHOT_ID,
		}),
		expected: false,
	},
	{
		name: "close start with empty summary",
		operation: "close",
		input: withRequest(closeStart, { ...closeStart.request, summary: "" }),
		expected: false,
	},
	{
		name: "close start with unknown inner field",
		operation: "close",
		input: withRequest(closeStart, {
			...closeStart.request,
			featureId: "domain-rewrite",
		}),
		expected: false,
	},
	{
		name: "close with unknown discriminator",
		operation: "close",
		input: withRequest(closeRetry, {
			...closeRetry.request,
			mode: "resume",
		}),
		expected: false,
	},
];

const requiredDeletionSeeds: Array<{
	name: string;
	operation: LifecycleCriticalOperation;
	input: unknown;
	paths: Array<readonly (string | number)[]>;
}> = [
	{
		name: "reviewer status",
		operation: "status",
		input: statusReviewer,
		paths: [["request"], ["request", "view"], ["request", "assignmentId"]],
	},
	{
		name: "feature review start",
		operation: "reviewStart",
		input: featureReviewStart,
		paths: [
			["request"],
			...[
				"operationId",
				"expectedRevision",
				"expectedSnapshotId",
				"featureId",
				"reviewKind",
				"validationScope",
				"packet",
				"validations",
			].map((field) => ["request", field] as const),
			["request", "packet", "summary"],
			...[
				"command",
				"summary",
				"startedAt",
				"completedAt",
				"exitCode",
				"outputDigest",
				"environmentKeys",
			].map((field) => ["request", "validations", 0, field] as const),
		],
	},
	{
		name: "final review start",
		operation: "reviewStart",
		input: finalReviewStart,
		paths: [
			["request", "featureReview"],
			...[
				"assignmentId",
				"verdict",
				"findings",
				"completedAt",
				"terminalDisposition",
			].map((field) => ["request", "featureReview", field] as const),
		],
	},
	{
		name: "targeted completion",
		operation: "featureComplete",
		input: targetedCompletion,
		paths: [
			["request"],
			...[
				"operationId",
				"expectedRevision",
				"expectedSnapshotId",
				"featureId",
				"result",
			].map((field) => ["request", field] as const),
			...["kind", "summary", "validationScope", "featureReview"].map(
				(field) => ["request", "result", field] as const,
			),
			...[
				"assignmentId",
				"verdict",
				"findings",
				"completedAt",
				"terminalDisposition",
			].map((field) => ["request", "result", "featureReview", field] as const),
		],
	},
	{
		name: "broad completion",
		operation: "featureComplete",
		input: broadCompletion,
		paths: [
			...["kind", "summary", "validationScope", "finalReview"].map(
				(field) => ["request", "result", field] as const,
			),
			...[
				"assignmentId",
				"verdict",
				"findings",
				"completedAt",
				"terminalDisposition",
			].map((field) => ["request", "result", "finalReview", field] as const),
		],
	},
	{
		name: "blocked completion",
		operation: "featureComplete",
		input: blockedCompletion,
		paths: [
			...["kind", "summary", "review"].map(
				(field) => ["request", "result", field] as const,
			),
			...[
				"assignmentId",
				"verdict",
				"findings",
				"completedAt",
				"terminalDisposition",
			].map((field) => ["request", "result", "review", field] as const),
		],
	},
	{
		name: "close start",
		operation: "close",
		input: closeStart,
		paths: [
			["request"],
			...[
				"mode",
				"operationId",
				"expectedRevision",
				"expectedSnapshotId",
				"kind",
			].map((field) => ["request", field] as const),
		],
	},
	{
		name: "close retry",
		operation: "close",
		input: closeRetry,
		paths: [
			["request", "mode"],
			["request", "operationId"],
		],
	},
];

const requiredDeletionCases = requiredDeletionSeeds.flatMap((seed) =>
	seed.paths.map(
		(path): LifecycleContractCase => ({
			name: `${seed.name} without ${path.join(".")}`,
			operation: seed.operation,
			input: withoutPath(seed.input, path),
			expected: false,
		}),
	),
);

export const LIFECYCLE_CONTRACT_CASES = [
	...validCases,
	...invalidCases,
	...requiredDeletionCases,
];

export const LIFECYCLE_HOST_FIXTURES = {
	SNAPSHOT_ID,
	assignmentResult,
	blockedCompletion,
	broadCompletion,
	closeRetry,
	closeStart,
	featureReviewStart,
	finalReviewStart,
	guard,
	oversizedAsciiAssignmentResult,
	oversizedMultibyteAssignmentResult,
	plan,
	smallMultibyteAssignmentResult,
	statusCompact,
	statusDetail,
	statusExecution,
	statusReviewer,
	targetedCompletion,
	validation,
} as const;
