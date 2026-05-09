import { describe, expect, test } from "bun:test";
import { ReviewReportSchema } from "../../src/audit/report-schema";
import {
	describeReviewFindingsMutationFailure,
	mergePlanningContext,
} from "../../src/runtime/domain/planning-context";
import {
	EvidencePacketSchema,
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema,
	PlanningContextArgsSchema,
	WorkerResultArgsSchema,
} from "../../src/runtime/schema";
import { createSession } from "../../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../../src/runtime/transitions";
import { samplePlan } from "../runtime-test-helpers";

const sampleEvidencePacket = EvidencePacketSchema.parse({
	id: "packet:planning-context",
	purpose: "planning",
	contextLane: "planning",
	summary: "Selected and excluded context for the implementation plan.",
	sourceRefs: ["src/runtime/schema.ts:386-407"],
	highlights: ["PlanningContextSchema owns planning metadata."],
	selectedContext: ["src/runtime/schema.ts:386-407"],
	excludedContext: ["dist/index.js"],
	codemapSummaries: ["PlanningContextSchema attaches optional packets."],
	sliceSummaries: ["src/runtime/schema.ts:386-407 planning context shape."],
	relationshipHypotheses: [
		"Planning packets should attach without becoming completion gates.",
	],
	ambiguities: ["Packet use is optional until prompt behavior is proven."],
	knownExclusions: ["No event-first persistence migration."],
	alreadyCoveredFindings: ["Stage 0 authority wording is already covered."],
	validationEvidence: [
		{
			command: "bun test tests/runtime/evidence-packets.test.ts",
			status: "passed",
			summary: "Packet schema contract passed.",
		},
	],
});

describe("shared evidence packet primitives", () => {
	test("parses read-only packet metadata with exact sources and context boundaries", () => {
		const packet = EvidencePacketSchema.parse(sampleEvidencePacket);

		expect(packet.id).toBe("packet:planning-context");
		expect(packet.purpose).toBe("planning");
		expect(packet.contextLane).toBe("planning");
		expect(packet.sourceRefs?.[0]).toBe("src/runtime/schema.ts:386-407");
		// Schema-level readonly enforces top-level immutability for parsed packet objects.
		expect(Object.isFrozen(packet)).toBe(true);
		expect(packet.highlights).toEqual([
			"PlanningContextSchema owns planning metadata.",
		]);
		expect(packet.validationEvidence?.[0]?.command).toBe(
			"bun test tests/runtime/evidence-packets.test.ts",
		);
	});

	test("rejects obsolete nested source objects", () => {
		expect(
			EvidencePacketSchema.safeParse({
				id: "packet:obsolete-source-shape",
				summary: "Bad nested source shape.",
				sources: [
					{
						reference: "src/runtime/schema.ts",
					},
				],
			}).success,
		).toBe(false);
	});

	test("planning context accepts packet attachments without widening plan payloads", () => {
		const parsedPlanning = PlanningContextArgsSchema.parse({
			evidencePackets: [sampleEvidencePacket],
		});
		expect(parsedPlanning.evidencePackets?.[0]?.id).toBe(
			"packet:planning-context",
		);

		const session = createSession("Build a workflow plugin", {
			evidencePackets: parsedPlanning.evidencePackets,
		});
		const applied = applyPlan(session, samplePlan(), {
			evidencePackets: [
				{
					...sampleEvidencePacket,
					id: "packet:plan-apply",
				},
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		expect(
			applied.value.planning.evidencePackets?.map((packet) => packet.id),
		).toEqual(["packet:planning-context", "packet:plan-apply"]);

		const updated = applyPlan(applied.value, samplePlan(), {
			evidencePackets: [
				{
					id: "packet:plan-apply",
					summary: "Updated packet summary from plan apply.",
					sourceRefs: ["src/runtime/domain/planning-context.ts:40-43"],
					selectedContext: ["src/runtime/domain/planning-context.ts:40-43"],
					excludedContext: [],
				},
			],
		});
		expect(updated.ok).toBe(true);
		if (!updated.ok) return;
		expect(
			updated.value.planning.evidencePackets?.map((packet) => packet.id),
		).toEqual(["packet:planning-context", "packet:plan-apply"]);
		expect(updated.value.planning.evidencePackets?.[1]?.summary).toBe(
			"Updated packet summary from plan apply.",
		);
		expect(updated.value.planning.evidencePackets?.[1]?.sourceRefs).toEqual([
			"src/runtime/domain/planning-context.ts:40-43",
		]);
		expect(
			updated.value.planning.evidencePackets?.[1]?.selectedContext,
		).toEqual(["src/runtime/domain/planning-context.ts:40-43"]);
		expect(
			updated.value.planning.evidencePackets?.[1]?.excludedContext,
		).toEqual([]);
	});

	test("mergePlanningContext preserves accumulated context and refreshes packets by id", () => {
		const merged = mergePlanningContext(
			{
				repoProfile: ["runtime package"],
				packageManagerAmbiguous: false,
				research: ["existing research"],
				decisionLog: [
					{
						question: "Should this pause?",
						decisionMode: "human_required",
						decisionDomain: "architecture",
						options: [{ label: "Pause", tradeoffs: ["safe"] }],
						recommendation: "Pause",
						rationale: ["Needs operator decision."],
					},
				],
				replanLog: [],
				reviewFindings: [],
				evidencePackets: [sampleEvidencePacket],
			},
			{
				repoProfile: ["runtime package", "prompt package"],
				packageManagerAmbiguous: true,
				research: ["existing research", "new research"],
				decisionLog: [],
				evidencePackets: [
					{
						id: sampleEvidencePacket.id,
						summary: "Refreshed planning evidence.",
					},
					{
						...sampleEvidencePacket,
						id: "packet:execution-context",
						contextLane: "execution",
					},
				],
			},
		);

		expect(merged.repoProfile).toEqual(["runtime package", "prompt package"]);
		expect(merged.packageManagerAmbiguous).toBe(true);
		expect(merged.research).toEqual(["existing research", "new research"]);
		expect(merged.evidencePackets?.map((packet) => packet.id)).toEqual([
			"packet:planning-context",
			"packet:execution-context",
		]);
		expect(merged.decisionLog).toEqual([]);
		expect(merged.evidencePackets?.[0]?.summary).toBe(
			"Refreshed planning evidence.",
		);
		expect(merged.evidencePackets?.[0]?.sourceRefs).toBeUndefined();
		expect(merged.evidencePackets?.[0]?.selectedContext).toBeUndefined();
	});

	test("describeReviewFindingsMutationFailure allows clear when no review_and_fix plan is active", () => {
		const session = createSession("Build a workflow plugin", {
			reviewFindings: [
				{
					findingRef: "review: stale finding",
					summary: "Previously recorded finding.",
					sourceRefs: ["audit#old"],
				},
			],
		});
		expect(
			describeReviewFindingsMutationFailure(session, { reviewFindings: [] }),
		).toBeNull();
	});

	test("describeReviewFindingsMutationFailure rejects removal and allows additive updates in review_and_fix", () => {
		const session = createSession("Build a workflow plugin", {
			reviewFindings: [
				{
					findingRef: "review: stale finding",
					summary: "Previously recorded finding.",
					sourceRefs: ["audit#old"],
				},
			],
		});
		session.plan = {
			...samplePlan(),
			goalMode: "review_and_fix",
		};

		expect(
			describeReviewFindingsMutationFailure(session, { reviewFindings: [] }),
		).toContain("cannot remove review_and_fix findings");
		expect(
			describeReviewFindingsMutationFailure(session, {
				reviewFindings: [
					{
						findingRef: "review: stale finding",
						summary: "Retained",
						sourceRefs: ["audit#old"],
					},
					{
						findingRef: "review: newly added finding",
						summary: "New",
						sourceRefs: ["audit#new"],
					},
				],
			}),
		).toBeNull();
	});

	test("mergePlanningContext lets an explicit empty reviewFindings refresh clear stale findings", () => {
		const merged = mergePlanningContext(
			{
				repoProfile: [],
				packageManagerAmbiguous: false,
				research: [],
				decisionLog: [],
				replanLog: [],
				reviewFindings: [
					{
						findingRef: "review: stale finding",
						summary: "Previously recorded finding.",
						sourceRefs: ["audit#old"],
					},
				],
			},
			{ reviewFindings: [] },
		);

		expect(merged.reviewFindings).toEqual([]);
	});

	test("final review and reviewer decision payloads can carry packet metadata", () => {
		const workerResult = WorkerResultArgsSchema.parse({
			contractVersion: "1",
			status: "ok",
			summary: "Completed feature safely.",
			artifactsChanged: [{ path: "src/runtime/schema.ts" }],
			validationRun: [
				{
					command: "bun test tests/runtime/evidence-packets.test.ts",
					status: "passed",
					summary: "Packet contract passed.",
				},
			],
			decisions: [],
			evidencePackets: [
				{
					id: sampleEvidencePacket.id,
					purpose: sampleEvidencePacket.purpose,
					contextLane: "execution",
					summary: sampleEvidencePacket.summary,
					sourceRefs: sampleEvidencePacket.sourceRefs,
				},
			],
			nextStep: "Request final review.",
			featureResult: { featureId: "setup-runtime" },
			featureReview: {
				status: "passed",
				summary: "Feature review passed.",
				blockingFindings: [],
			},
			finalReview: {
				status: "passed",
				reviewDepth: "detailed",
				reviewedSurfaces: ["changed_files", "validation_evidence"],
				evidenceSummary: "Reviewed packet schema changes.",
				validationAssessment: "Targeted tests passed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/schema.ts"],
					validationCommands: [
						"bun test tests/runtime/evidence-packets.test.ts",
					],
				},
				evidencePackets: [{ ...sampleEvidencePacket, purpose: "review" }],
				summary: "Final review passed.",
				blockingFindings: [],
			},
		});
		expect(workerResult.evidencePackets?.[0]?.contextLane).toBe("execution");
		expect(workerResult.finalReview?.evidencePackets?.[0]?.purpose).toBe(
			"review",
		);

		const featureDecision = FlowReviewRecordFeatureArgsSchema.parse({
			scope: "feature",
			featureId: "setup-runtime",
			reviewPurpose: "execution_gate",
			status: "approved",
			summary: "Feature reviewer approved.",
			blockingFindings: [],
			evidencePackets: [
				{
					id: sampleEvidencePacket.id,
					purpose: "review",
					contextLane: "review",
					summary: sampleEvidencePacket.summary,
					sourceRefs: sampleEvidencePacket.sourceRefs,
				},
			],
		});
		expect(featureDecision.evidencePackets?.[0]?.contextLane).toBe("review");

		const decision = FlowReviewRecordFinalArgsSchema.parse({
			scope: "final",
			reviewPurpose: "completion_gate",
			reviewDepth: "detailed",
			status: "approved",
			summary: "Final reviewer approved.",
			blockingFindings: [],
			reviewedSurfaces: [
				"changed_files",
				"validation_evidence",
				"shared_surfaces",
			],
			evidenceSummary: "Reviewed packet schema changes.",
			validationAssessment: "Targeted tests passed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/schema.ts"],
				validationCommands: ["bun test tests/runtime/evidence-packets.test.ts"],
			},
			integrationChecks: [
				"Checked packet attachment across planning and review surfaces.",
			],
			regressionChecks: ["Checked packet schema contract coverage."],
			evidencePackets: [{ ...sampleEvidencePacket, purpose: "review" }],
		});
		expect(decision.evidencePackets?.[0]?.selectedContext).toEqual([
			"src/runtime/schema.ts:386-407",
		]);

		const applied = applyPlan(
			createSession("Build a workflow plugin"),
			samplePlan(),
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const recorded = recordReviewerDecision(started.value.session, decision);
		expect(recorded.ok).toBe(true);
		if (!recorded.ok) return;
		expect(
			recorded.value.execution.lastReviewerDecision?.scope === "final" &&
				recorded.value.execution.lastReviewerDecision.evidencePackets?.[0]?.id,
		).toBe("packet:planning-context");
	});

	test("audit reports can attach packet metadata without replacing ledgers", () => {
		const report = ReviewReportSchema.parse({
			requestedDepth: "deep_audit",
			achievedDepth: "deep_audit",
			repoSummary: "Repo summary.",
			overallVerdict: "No blocker found.",
			discoveredSurfaces: [
				{
					name: "Runtime schema",
					category: "source_runtime",
					reviewStatus: "directly_reviewed",
					evidence: ["src/runtime/schema.ts"],
				},
			],
			evidencePackets: [{ ...sampleEvidencePacket, purpose: "audit" }],
			validationRun: [],
			findings: [],
		});

		expect(report.evidencePackets?.[0]?.purpose).toBe("audit");
		const auditPacketWithNotRun = ReviewReportSchema.parse({
			...report,
			evidencePackets: [
				{
					...sampleEvidencePacket,
					purpose: "audit",
					validationEvidence: [
						{
							command: "not_run",
							status: "not_run",
							summary: "No validation evidence was available.",
						},
					],
				},
			],
		});
		expect(
			auditPacketWithNotRun.evidencePackets?.[0]?.validationEvidence?.[0]
				?.status,
		).toBe("not_run");
		expect(report.discoveredSurfaces[0]?.evidence).toEqual([
			"src/runtime/schema.ts",
		]);
	});

	test("audit report behavior checks and coverage commands must be grounded in validationRun", () => {
		const base = {
			requestedDepth: "deep_audit" as const,
			achievedDepth: "deep_audit" as const,
			repoSummary: "Repo summary.",
			overallVerdict: "No blocker found.",
			discoveredSurfaces: [
				{
					name: "Runtime schema",
					category: "source_runtime" as const,
					reviewStatus: "directly_reviewed" as const,
					evidence: ["src/runtime/schema.ts"],
				},
			],
			findings: [],
		};

		expect(
			ReviewReportSchema.safeParse({
				...base,
				validationRun: [
					{
						command: "bun test tests/runtime/evidence-packets.test.ts",
						status: "passed",
						summary: "Targeted audit tests passed.",
					},
				],
				behaviorChecks: [
					{
						riskClass: "test_evidence_authenticity",
						result: "needs_fix",
						invariant: "Validation exposes a behavior gap needing follow-up.",
						entrypointRefs: ["src/runtime/schema.ts"],
						stateOwnerRefs: [],
						lifecycleOwnerRefs: [],
						failurePath:
							"Observed gap requires a fix before confidence increases.",
						testEvidenceRefs: [],
						validationRefs: ["bun test tests/runtime/evidence-packets.test.ts"],
					},
				],
				validationCoverage: [
					{
						command: "bun test tests/runtime/evidence-packets.test.ts",
						behaviorClasses: ["test_evidence_authenticity"],
						proves: [],
						gaps: ["Behavior regression still reproduces."],
						testEvidenceRefs: [],
					},
				],
			}).success,
		).toBe(true);

		expect(
			ReviewReportSchema.safeParse({
				...base,
				validationRun: [],
				behaviorChecks: [
					{
						riskClass: "test_evidence_authenticity",
						result: "not_applicable",
						invariant: "No behavior-risk assertion claimed.",
						entrypointRefs: ["src/runtime/schema.ts"],
						stateOwnerRefs: [],
						lifecycleOwnerRefs: [],
						failurePath: "No validation-backed behavior claim.",
						testEvidenceRefs: [],
						validationRefs: ["bun test tests/runtime/evidence-packets.test.ts"],
					},
				],
				validationCoverage: [],
			}).success,
		).toBe(false);

		expect(
			ReviewReportSchema.safeParse({
				...base,
				validationRun: [
					{
						command: "bun test tests/runtime/evidence-packets.test.ts",
						status: "passed",
						summary: "Targeted audit tests passed.",
					},
				],
				behaviorChecks: [],
				validationCoverage: [
					{
						command: "bun test tests/runtime/final-review-contracts.test.ts",
						behaviorClasses: ["test_evidence_authenticity"],
						proves: [],
						gaps: [],
						testEvidenceRefs: [],
					},
				],
			}).success,
		).toBe(false);
	});
});
