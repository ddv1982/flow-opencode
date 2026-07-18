import { describe, expect, test } from "bun:test";
import {
	type EvidenceRecord,
	type FeatureId,
	type PlanInput,
	toFeatureId,
	toSessionId,
	type WorkerResult,
} from "../src/domain/session.js";
import {
	applyPlan,
	approvePlan,
	canonicalEvidenceId,
	completeFeature,
	createSession,
	startRun,
	type TransitionEnvironment,
} from "../src/domain/transitions.js";

const fixedEnvironment: TransitionEnvironment = {
	now: () => "2026-07-17T12:00:00.000Z",
	newSessionId: () => toSessionId("session-v5"),
};

const featureId = toFeatureId("domain-rewrite");
const sourceDigest = `sha256:${"c".repeat(64)}`;
const outputDigest = `sha256:${"d".repeat(64)}`;

const plan = {
	summary: "Rewrite the Flow domain.",
	overview: "Use pure, deterministic transitions.",
	requirements: ["Do not import host or filesystem APIs."],
	decisions: ["Inject time and identity."],
	finalReviewPolicy: "detailed" as const,
	features: [
		{
			id: featureId,
			title: "Domain rewrite",
			summary: "Build the v5 state machine.",
			reviewDepth: "detailed" as const,
			targets: ["src/domain"],
			validation: ["bun test tests/domain-transitions.test.ts"],
			dependsOn: [],
		},
	],
};

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error("Expected a successful transition.");
	return result.value;
}

function canonicalEvidence<T extends EvidenceRecord>(record: T): T {
	return { ...record, evidenceId: canonicalEvidenceId(record) };
}

describe("v5 domain transitions", () => {
	test("createSession is deterministic when its environment is deterministic", () => {
		const first = createSession("Ship Flow v5", fixedEnvironment);
		const second = createSession("Ship Flow v5", fixedEnvironment);

		expect(first).toEqual(second);
		expect(first.version).toBe(3);
		expect(String(first.id)).toBe("session-v5");
		expect(first.timestamps).toEqual({
			createdAt: "2026-07-17T12:00:00.000Z",
			updatedAt: "2026-07-17T12:00:00.000Z",
			completedAt: null,
		});
	});

	test("plan, approval, run, and completion leave prior states immutable", () => {
		const created = createSession("Ship Flow v5", fixedEnvironment);
		const planned = unwrap(applyPlan(created, plan, fixedEnvironment));
		const approved = unwrap(approvePlan(planned, fixedEnvironment));
		const running = unwrap(
			startRun(approved, fixedEnvironment, featureId),
		).session;

		expect(created.plan).toBeNull();
		expect(planned.approval).toBe("pending");
		expect(approved.activeFeatureId).toBeNull();
		expect(running.activeFeatureId).toBe(featureId);

		const worker: WorkerResult = {
			status: "ok",
			operationId: "complete-domain-rewrite",
			expectedRevision: running.causal.revision,
			expectedSnapshotId: running.causal.snapshotId,
			featureId,
			summary: "Domain rewrite complete.",
			artifactsChanged: [{ path: "src/domain/transitions.ts" }],
			validationRun: [
				{
					command: "bun test tests/domain-transitions.test.ts",
					status: "passed",
					summary: "Domain checks passed.",
				},
			],
			validationScope: "broad",
			featureReviewDepth: "detailed",
			featureReview: {
				status: "passed",
				summary: "Pure transition behavior reviewed.",
				blockingFindings: [],
			},
			finalReview: {
				status: "passed",
				summary: "Full plan reviewed.",
				blockingFindings: [],
				reviewDepth: "detailed",
			},
			reviewExecutions: [
				{
					attemptId: "domain-feature-review-1",
					logicalPassId: "domain-feature-review",
					featureId,
					reviewKind: "feature",
					reviewSnapshotId: `sha256:${"a".repeat(64)}`,
					verdict: "passed",
					findings: [],
					startedAt: "2026-07-17T11:55:00.000Z",
					completedAt: "2026-07-17T11:56:00.000Z",
					terminalDisposition: "submitted",
				},
				{
					attemptId: "domain-final-review-1",
					logicalPassId: "domain-final-review",
					featureId,
					reviewKind: "final",
					reviewSnapshotId: `sha256:${"b".repeat(64)}`,
					verdict: "passed",
					findings: [],
					startedAt: "2026-07-17T11:57:00.000Z",
					completedAt: "2026-07-17T11:58:00.000Z",
					terminalDisposition: "submitted",
				},
			],
			evidence: [
				canonicalEvidence({
					kind: "validation",
					evidenceId: "",
					snapshotId: running.causal.snapshotId,
					sourceDigest,
					commandClass: "test",
					startedAt: "2026-07-17T11:53:00.000Z",
					completedAt: "2026-07-17T11:54:00.000Z",
					exitCode: 0,
					outputDigest,
					environmentKeys: ["CI"],
				}),
				canonicalEvidence({
					kind: "review",
					evidenceId: "",
					snapshotId: running.causal.snapshotId,
					sourceDigest,
					attemptId: "domain-feature-review-1",
					packetDigest: `sha256:${"a".repeat(64)}`,
					startedAt: "2026-07-17T11:55:00.000Z",
					completedAt: "2026-07-17T11:56:00.000Z",
				}),
				canonicalEvidence({
					kind: "review",
					evidenceId: "",
					snapshotId: running.causal.snapshotId,
					sourceDigest,
					attemptId: "domain-final-review-1",
					packetDigest: `sha256:${"b".repeat(64)}`,
					startedAt: "2026-07-17T11:57:00.000Z",
					completedAt: "2026-07-17T11:58:00.000Z",
				}),
			],
			orchestrationPasses: [],
		};
		const completed = unwrap(
			completeFeature(running, worker, fixedEnvironment),
		);

		expect(running.status).toBe("running");
		expect(running.plan?.features[0]?.status).toBe("in_progress");
		expect(completed.status).toBe("completed");
		expect(completed.plan?.features[0]?.status).toBe("completed");

		worker.artifactsChanged.push({ path: "src/mutated-after-transition.ts" });
		const [validationRun] = worker.validationRun;
		if (!validationRun) throw new Error("Expected validation evidence.");
		validationRun.summary = "mutated after transition";
		worker.featureReview.blockingFindings.push({
			summary: "mutated after transition",
			severity: "advisory",
		});
		const recorded = completed.history.at(-1);
		expect(recorded?.artifactsChanged).toEqual([
			{ path: "src/domain/transitions.ts" },
		]);
		expect(recorded?.validationRun[0]?.summary).toBe("Domain checks passed.");
		expect(recorded?.featureReview?.blockingFindings).toEqual([]);
	});

	test("failed completion records one mutation timestamp", () => {
		const created = createSession("Record failure time", fixedEnvironment);
		const planned = unwrap(applyPlan(created, plan, fixedEnvironment));
		const approved = unwrap(approvePlan(planned, fixedEnvironment));
		const running = unwrap(
			startRun(approved, fixedEnvironment, featureId),
		).session;
		const failedAt = "2026-07-17T12:01:00.000Z";
		const failed = completeFeature(
			running,
			{
				status: "ok",
				operationId: "reject-missing-validation",
				expectedRevision: running.causal.revision,
				expectedSnapshotId: running.causal.snapshotId,
				featureId,
				summary: "Missing validation.",
				artifactsChanged: [],
				validationRun: [],
				validationScope: "broad",
				featureReviewDepth: "detailed",
				featureReview: {
					status: "passed",
					summary: "Review passed.",
					blockingFindings: [],
				},
				reviewExecutions: [
					{
						attemptId: "domain-validation-gate-review-1",
						logicalPassId: "domain-feature-review",
						featureId,
						reviewKind: "feature",
						reviewSnapshotId: `sha256:${"a".repeat(64)}`,
						verdict: "passed",
						findings: [],
						startedAt: "2026-07-17T11:55:00.000Z",
						completedAt: "2026-07-17T11:56:00.000Z",
						terminalDisposition: "submitted",
					},
				],
				evidence: [
					canonicalEvidence({
						kind: "review",
						evidenceId: "",
						snapshotId: running.causal.snapshotId,
						sourceDigest,
						attemptId: "domain-validation-gate-review-1",
						packetDigest: `sha256:${"a".repeat(64)}`,
						startedAt: "2026-07-17T11:55:00.000Z",
						completedAt: "2026-07-17T11:56:00.000Z",
					}),
				],
				orchestrationPasses: [],
			},
			{ ...fixedEnvironment, now: () => failedAt },
		);

		expect(failed.ok).toBe(false);
		if (failed.ok || !failed.session) {
			throw new Error("Expected completion failure state.");
		}
		expect(failed.session.lastError?.recordedAt).toBe(failedAt);
		expect(failed.session.timestamps.updatedAt).toBe(failedAt);
		expect(running.timestamps.updatedAt).toBe("2026-07-17T12:00:00.000Z");
	});

	test("copies caller-owned plan collections into domain state", () => {
		const created = createSession("Own plan state", fixedEnvironment);
		const [sourceFeature] = plan.features;
		if (!sourceFeature) throw new Error("Expected a plan feature.");
		const mutableRequirements = [...plan.requirements];
		const mutableDecisions = [...plan.decisions];
		const mutableTargets = [...sourceFeature.targets];
		const mutableValidation = [...sourceFeature.validation];
		const mutableDependencies: FeatureId[] = [...sourceFeature.dependsOn];
		const mutablePlan: PlanInput = {
			...plan,
			requirements: mutableRequirements,
			decisions: mutableDecisions,
			features: [
				{
					...sourceFeature,
					targets: mutableTargets,
					validation: mutableValidation,
					dependsOn: mutableDependencies,
				},
			],
		};
		const planned = unwrap(applyPlan(created, mutablePlan, fixedEnvironment));

		mutableRequirements.push("mutated after transition");
		mutableDecisions.push("mutated after transition");
		mutableTargets.push("src/mutated.ts");
		mutableValidation.push("mutated validation");
		mutableDependencies.push(toFeatureId("mutated-dependency"));

		expect(planned.plan?.requirements).toEqual(plan.requirements);
		expect(planned.plan?.decisions).toEqual(plan.decisions);
		expect(planned.plan?.features[0]?.targets).toEqual(
			plan.features[0]?.targets,
		);
		expect(planned.plan?.features[0]?.validation).toEqual(
			plan.features[0]?.validation,
		);
		expect(planned.plan?.features[0]?.dependsOn).toEqual(
			plan.features[0]?.dependsOn,
		);
	});

	test("rejects cyclic plans without mutating the session", () => {
		const created = createSession("Reject a cycle", fixedEnvironment);
		const [onlyFeature] = plan.features;
		if (!onlyFeature) throw new Error("The test plan must contain a feature.");
		const cyclic = {
			...plan,
			features: [{ ...onlyFeature, dependsOn: [featureId] }],
		};
		const result = applyPlan(created, cyclic, fixedEnvironment);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected plan rejection.");
		expect(result.message).toContain("itself");
		expect(created.plan).toBeNull();
	});
});
