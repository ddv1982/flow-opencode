import { describe, expect, test } from "bun:test";
import {
	ExecutionHistoryEntrySchema,
	SessionSchema,
} from "../src/application/schema.js";
import {
	type ReviewAssignment,
	type ReviewExecutionFindingInput,
	toFeatureId,
	toSessionId,
} from "../src/domain/session.js";
import { validateSessionInvariants } from "../src/domain/session-invariants.js";
import {
	applyPlan,
	approvePlan,
	canonicalLogicalReviewPassId,
	canonicalReviewAttemptId,
	canonicalReviewPacketDigest,
	canonicalValidationCommandDigest,
	createSession,
	stableReviewFindingFingerprint,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";

const environment: TransitionEnvironment = {
	now: () => "2026-07-18T10:00:00.000Z",
	newSessionId: () => toSessionId("review-lifecycle-session"),
};

const featureId = toFeatureId("review-lifecycle");

const finding: ReviewExecutionFindingInput = {
	taxonomy: "implementation_defect",
	subject: "src/domain/transitions.ts",
	requirementOrRisk: "completion must fail closed",
	evidenceLocator: "src/domain/transitions.ts:808",
	summary: "Completion can bypass a failed review.",
	severity: "blocking",
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

describe("Session v4 review lifecycle", () => {
	test("starts with only native run-scoped review state", () => {
		const session = createSession("Check host capability", environment);

		expect(session.version).toBe(4);
		expect(session.budget.observedReviewWorkers).toEqual({
			source: "unavailable",
			reconciliationStatus: "unreconciled",
			observedExecutionCount: null,
		});
		expect(session.budget.failedReviewAttemptsByFeatureRun).toEqual({});
		expect(session.budget).not.toHaveProperty("failedReviewAttemptsByFeature");
		expect(session.reviewAssignments).toEqual([]);
	});

	test("rejects deprecated persisted outcome variants", () => {
		const entry = {
			featureRunId: "feature-run:review-lifecycle",
			featureId: "review-lifecycle",
			status: "blocked",
			summary: "Review blocked.",
			recordedAt: "2026-07-18T10:00:00.000Z",
			artifactsChanged: [],
			validationScope: "targeted",
			validationEvidenceRefs: [`sha256:${"a".repeat(64)}`],
			reviewAssignmentIds: ["review-assignment:review-lifecycle"],
			orchestrationPasses: [],
			outcome: { kind: "blocked", summary: "Review blocked." },
		};
		expect(ExecutionHistoryEntrySchema.safeParse(entry).success).toBe(true);
		for (const kind of ["needs_input", "replan_required"]) {
			expect(
				ExecutionHistoryEntrySchema.safeParse({
					...entry,
					outcome: { kind, summary: "Deprecated state." },
				}).success,
			).toBe(false);
		}
		expect(
			ExecutionHistoryEntrySchema.safeParse({
				...entry,
				status: "needs_input",
			}).success,
		).toBe(false);
		for (const deprecated of [
			{ validationRun: [] },
			{ featureReviewDepth: "standard" },
			{
				featureReview: {
					status: "passed",
					summary: "Deprecated duplicate.",
					blockingFindings: [],
				},
			},
		]) {
			expect(
				ExecutionHistoryEntrySchema.safeParse({ ...entry, ...deprecated })
					.success,
			).toBe(false);
		}
	});

	test("fingerprints only normalized taxonomy, subject, risk, and evidence", () => {
		const baseline = stableReviewFindingFingerprint(finding);
		const presentationOnlyChange = stableReviewFindingFingerprint({
			...finding,
			subject: "  SRC/DOMAIN/TRANSITIONS.TS  ",
			requirementOrRisk: "completion   must fail closed",
			evidenceLocator: " SRC/DOMAIN/TRANSITIONS.TS:808 ",
			summary: "Different prose and attempt time are irrelevant.",
			severity: "advisory",
		});

		expect(presentationOnlyChange).toBe(baseline);
		expect(
			stableReviewFindingFingerprint({
				...finding,
				taxonomy: "evidence_gap",
			}),
		).not.toBe(baseline);
	});

	test("matches independent digest and finding-fingerprint golden vectors", () => {
		expect(canonicalValidationCommandDigest("abc")).toBe(
			"sha256:33e06c9f83f000fa49137c43206cdd7372b272abf39040a91e6111adaaf09255",
		);
		expect(canonicalValidationCommandDigest("  bun test — café 🚀  ")).toBe(
			"sha256:1edb70a72aae0ffe6e4c2e4c0ad4eea10dd6013756df3b253a1f1df15d84d2e2",
		);
		expect(stableReviewFindingFingerprint(finding)).toBe(
			"finding-v1-1ae5019e799ab914e3db3d0f60af77cb",
		);
	});

	test("rejects duplicate pending assignments for one run and review kind", () => {
		const planned = unwrap(
			applyPlan(
				createSession("Reject ambiguous pending review", environment),
				{
					summary: "Pending review invariant",
					overview: "Keep one recoverable assignment per run and kind.",
					features: [
						{
							id: featureId,
							title: "Pending assignment",
							summary: "Reject ambiguous persisted review ownership.",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const running = unwrap(startRun(approved, environment, featureId)).session;
		if (!running.activeFeatureRunId) {
			throw new Error("Expected an active feature run.");
		}
		const pendingAssignment = (id: string): ReviewAssignment => {
			const identity = {
				featureRunId:
					running.activeFeatureRunId as ReviewAssignment["featureRunId"],
				featureId,
				reviewKind: "feature" as const,
				validationScope: "targeted" as const,
				validationEvidenceRefs: [`sha256:${"a".repeat(64)}`],
				sourceDigest: `sha256:${"b".repeat(64)}`,
				packetSummary: "Review the active feature.",
				riskLenses: [],
				prerequisite: null,
			};
			return {
				id,
				operationId: `start-${id}`,
				...identity,
				packetDigest: canonicalReviewPacketDigest(identity),
				attemptId: canonicalReviewAttemptId(id),
				logicalPassId: canonicalLogicalReviewPassId(
					running.activeFeatureRunId as ReviewAssignment["featureRunId"],
					"feature",
				),
				startedAt: environment.now(),
				requiredDepth: "standard",
				status: "pending",
				completedAt: null,
				invalidatedAt: null,
				invalidationReason: null,
			};
		};
		const corrupted = {
			...running,
			reviewAssignments: [
				pendingAssignment("review-assignment:first"),
				pendingAssignment("review-assignment:second"),
			],
		};

		expect(validateSessionInvariants(corrupted)).toContain(
			"multiple pending feature review assignments",
		);
		expect(SessionSchema.safeParse(corrupted).success).toBe(false);
	});

	test("keeps the active final feature in progress until assignment completion", () => {
		const planned = unwrap(
			applyPlan(
				createSession("Exercise review assignments", environment),
				{
					summary: "Review lifecycle",
					overview: "Use runtime-owned review assignments.",
					features: [
						{
							id: featureId,
							title: "Review lifecycle",
							summary: "Add truthful retry semantics.",
							reviewDepth: "standard",
						},
					],
				},
				environment,
			),
		);
		const approved = unwrap(approvePlan(planned, environment));
		const running = unwrap(startRun(approved, environment, featureId)).session;

		expect(running.status).toBe("running");
		expect(running.activeFeatureId).toBe(featureId);
		expect(running.activeFeatureRunId).not.toBeNull();
		expect(running.plan?.features[0]?.status).toBe("in_progress");
		expect(running.reviewAssignments).toEqual([]);
	});
});
