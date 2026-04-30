import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	SEMANTIC_COMPLETION_GATE_ORDER,
	SEMANTIC_COMPLETION_POLICY_EXPECTATIONS,
	SEMANTIC_DECISION_GATE_EXPECTATIONS,
	SEMANTIC_INVARIANT_IDS,
	SEMANTIC_INVARIANTS,
	SEMANTIC_RECOVERY_EXPECTATIONS,
	SEMANTIC_REVIEW_SCOPE_EXPECTATIONS,
	SEMANTIC_TOOL_SURFACE_EXPECTATIONS,
	semanticInvariantById,
} from "../../src/runtime/domain";
import type {
	ReviewerDecision,
	Session,
	WorkerResult,
} from "../../src/runtime/schema";
import {
	FlowReviewRecordFeatureArgsSchema,
	FlowReviewRecordFinalArgsSchema,
} from "../../src/runtime/schema";
import { createSession } from "../../src/runtime/session";
import {
	explainSessionState,
	summarizeSession,
} from "../../src/runtime/summary";
import {
	startRun,
	validateSuccessfulCompletion,
} from "../../src/runtime/transitions/execution";
import { applyPlan, approvePlan } from "../../src/runtime/transitions/plan";
import { buildCompletionRecovery } from "../../src/runtime/transitions/recovery";
import type { TransitionResult } from "../../src/runtime/transitions/shared";
import { createTools } from "../../src/tools";
import { cloneSamplePlan } from "../fixtures";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceDefinesSymbol(source: string, symbol: string): boolean {
	const escapedSymbol = escapeRegExp(symbol);
	const patterns = [
		new RegExp(
			String.raw`(?:export\s+(?:async\s+)?function|function)\s+${escapedSymbol}\b`,
		),
		new RegExp(String.raw`(?:export\s+)?const\s+${escapedSymbol}\b`),
		new RegExp(String.raw`(?:export\s+)?type\s+${escapedSymbol}\b`),
		new RegExp(String.raw`export\s*\{[^}]*\b${escapedSymbol}\b[^}]*\}`),
	];

	return patterns.some((pattern) => pattern.test(source));
}

function assertOk<T>(result: TransitionResult<T>): T {
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.value;
}

function createRunningSession(plan = cloneSamplePlan()) {
	const session = createSession("Semantic parity hardening");
	const planning = assertOk(applyPlan(session, plan));
	const approved = assertOk(approvePlan(planning));
	return assertOk(startRun(approved)).session;
}

function approvedReviewerDecision(
	scope: ReviewerDecision["scope"],
	featureId?: string,
): ReviewerDecision {
	if (scope === "final") {
		return {
			scope: "final",
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary:
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/runtime/session.ts"],
				validationCommands: ["bun test"],
			},
			integrationChecks: [
				"Reviewed integration points across the active feature boundary.",
			],
			regressionChecks: [
				"Checked for regressions in shared surfaces and validation evidence.",
			],
			remainingGaps: [],
			status: "approved",
			summary: "Approved.",
			blockingFindings: [],
			followUps: [],
			suggestedValidation: [],
		};
	}

	return {
		scope: "feature",
		featureId: featureId ?? "setup-runtime",
		status: "approved",
		summary: "Approved.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function createBaseWorker(featureId: string): WorkerResult {
	return {
		contractVersion: "1",
		status: "ok",
		summary: "Completed feature.",
		artifactsChanged: [],
		validationRun: [
			{ command: "bun test", status: "passed", summary: "Passed." },
		],
		validationScope: "targeted",
		decisions: [],
		nextStep: "Done.",
		featureResult: { featureId },
		featureReview: {
			status: "passed",
			summary: "Feature review passed.",
			blockingFindings: [],
		},
	};
}

function expectFailureKind(
	result: TransitionResult<void>,
	errorCode: string,
): void {
	if (result.ok) {
		throw new Error(`Expected failure with ${errorCode}, received success.`);
	}
	expect(result.recovery?.errorCode).toBe(errorCode);
}

describe("runtime semantic invariants", () => {
	test("exposes a stable invariant catalog", () => {
		expect(SEMANTIC_INVARIANTS.map((descriptor) => descriptor.id)).toEqual([
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"decision_gate.planning_surface.binding",
			"review.scope.payload_binding",
			"recovery.next_action.binding",
			"tools.canonical_surface.no_raw_wrappers",
		]);
		expect(
			semanticInvariantById("decision_gate.planning_surface.binding")
				?.ownerSummary,
		).toContain("activeDecisionGate");
	});

	test("catalog owner references stay complete and resolvable", () => {
		const repoRoot = join(import.meta.dir, "..", "..");
		const expectedCoverage = {
			"src/runtime/transitions/execution-completion.ts": [
				"validateSuccessfulCompletion",
			],
			"src/runtime/domain/completion.ts": ["summarizeCompletion"],
			"src/runtime/domain/workflow-policy.ts": [
				"targetCompletedFeatureCount",
				"activeDecisionGate",
			],
			"src/runtime/summary.ts": ["explainSessionState", "summarizeSession"],
			"src/runtime/schema.ts": [
				"FlowReviewRecordFeatureArgsSchema",
				"FlowReviewRecordFinalArgsSchema",
			],
			"src/runtime/transitions/recovery.ts": ["buildCompletionRecovery"],
			"src/tools.ts": ["createTools"],
			"src/runtime/constants.ts": ["CANONICAL_RUNTIME_TOOL_NAMES"],
		} as const satisfies Record<string, readonly string[]>;

		const referencedCoverage = new Map<string, Set<string>>();
		for (const descriptor of SEMANTIC_INVARIANTS) {
			for (const reference of descriptor.ownerReferences) {
				const existing =
					referencedCoverage.get(reference.file) ?? new Set<string>();
				for (const symbol of reference.symbols) {
					existing.add(symbol);
				}
				referencedCoverage.set(reference.file, existing);

				const source = readFileSync(join(repoRoot, reference.file), "utf8");
				for (const symbol of reference.symbols) {
					expect(sourceDefinesSymbol(source, symbol)).toBe(true);
				}
			}
		}

		expect(SEMANTIC_INVARIANT_IDS).toEqual([
			"completion.gates.required_order",
			"completion.policy.min_completed_features",
			"decision_gate.planning_surface.binding",
			"review.scope.payload_binding",
			"recovery.next_action.binding",
			"tools.canonical_surface.no_raw_wrappers",
		]);

		for (const [file, symbols] of Object.entries(expectedCoverage)) {
			const referencedSymbols = referencedCoverage.get(file);
			expect(referencedSymbols).toBeDefined();
			for (const symbol of symbols) {
				expect(referencedSymbols?.has(symbol)).toBe(true);
			}
		}
	});

	test("completion.gates.required_order preserves feature-path precedence", () => {
		const session = createRunningSession();
		const featureId = session.execution.activeFeatureId ?? "setup-runtime";
		const worker: WorkerResult = {
			...createBaseWorker(featureId),
			validationRun: [],
			featureReview: {
				status: "failed",
				summary: "Review failed.",
				blockingFindings: [{ summary: "Fix me." }],
			},
		};

		expectFailureKind(
			validateSuccessfulCompletion(session, worker, featureId, false),
			"missing_validation_evidence",
		);

		const withValidation: WorkerResult = {
			...worker,
			validationRun: [
				{ command: "bun test", status: "passed", summary: "Passed." },
			],
			validationScope: undefined,
		};
		expectFailureKind(
			validateSuccessfulCompletion(session, withValidation, featureId, false),
			"missing_feature_reviewer_decision",
		);

		const reviewedSession: Session = {
			...session,
			execution: {
				...session.execution,
				lastReviewerDecision: approvedReviewerDecision("feature", featureId),
			},
		};
		expectFailureKind(
			validateSuccessfulCompletion(
				reviewedSession,
				withValidation,
				featureId,
				false,
			),
			"missing_targeted_validation",
		);

		expect(SEMANTIC_COMPLETION_GATE_ORDER.feature).toEqual([
			"missing_validation",
			"failing_validation",
			"missing_reviewer_decision",
			"missing_validation_scope",
			"failing_feature_review",
			"failing_final_review",
		]);
	});

	test("completion.gates.required_order preserves final-path precedence", () => {
		const plan = cloneSamplePlan();
		plan.completionPolicy = { minCompletedFeatures: 1 };
		const session = createRunningSession(plan);
		const featureId = session.execution.activeFeatureId ?? "setup-runtime";
		const reviewedSession: Session = {
			...session,
			execution: {
				...session.execution,
				lastReviewerDecision: approvedReviewerDecision("final"),
			},
		};
		const worker: WorkerResult = {
			...createBaseWorker(featureId),
			validationScope: "broad",
			featureReview: {
				status: "passed",
				summary: "Feature review passed.",
				blockingFindings: [],
			},
			finalReview: {
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "failed",
				summary: "Final review failed.",
				blockingFindings: [{ summary: "Fix final review." }],
			},
		};

		expectFailureKind(
			validateSuccessfulCompletion(reviewedSession, worker, featureId, true),
			"failing_final_review",
		);

		const withoutFinalReview: WorkerResult = {
			...createBaseWorker(featureId),
			validationScope: "targeted",
			featureReview: {
				status: "passed",
				summary: "Feature review passed.",
				blockingFindings: [],
			},
		};
		expectFailureKind(
			validateSuccessfulCompletion(
				reviewedSession,
				withoutFinalReview,
				featureId,
				true,
			),
			"missing_broad_validation",
		);

		expect(SEMANTIC_COMPLETION_GATE_ORDER.final).toEqual([
			"missing_validation",
			"failing_validation",
			"missing_validation_scope",
			"failing_feature_review",
			"failing_final_review",
			"missing_final_review",
			"missing_reviewer_decision",
		]);
	});

	test("completion.policy.min_completed_features allows completion with pending work", () => {
		const plan = cloneSamplePlan();
		plan.completionPolicy = { minCompletedFeatures: 1 };
		const session = createRunningSession(plan);
		const summary = summarizeSession(session);

		expect(summary.session?.completion).toEqual({
			activeFeatureTriggersSessionCompletion:
				SEMANTIC_COMPLETION_POLICY_EXPECTATIONS.activeFeatureCanTriggerCompletion,
			canCompleteWithPendingFeatures:
				SEMANTIC_COMPLETION_POLICY_EXPECTATIONS.pendingAllowedWhenTargetLessThanTotal,
			completedFeatures: 0,
			remainingBeyondTarget: 1,
			targetCompletedFeatures: 1,
			totalFeatures: 2,
		});
		expect(SEMANTIC_COMPLETION_POLICY_EXPECTATIONS.thresholdStopRule).toBe(
			"ship_when_threshold_met",
		);
	});

	test("decision_gate.planning_surface.binding stays runtime-owned and surfaced", () => {
		const session = createSession("Build semantic parity guards");
		session.planning.decisionLog = [
			{
				question: "Should Flow auto-resolve all planning decisions?",
				decisionMode: "autonomous_choice",
				decisionDomain: "delivery",
				options: [{ label: "Auto-resolve", tradeoffs: ["faster"] }],
				recommendation: "Auto-resolve",
				rationale: ["Safe default exists."],
			},
			{
				question: "Should Flow ship the semantic suite now?",
				decisionMode: "recommend_confirm",
				decisionDomain: "quality",
				options: [
					{ label: "Ship now", tradeoffs: ["faster"] },
					{ label: "Defer", tradeoffs: ["safer"] },
				],
				recommendation: "Defer",
				rationale: ["Needs confirmation before rollout."],
			},
		];

		const summary = summarizeSession(session);
		const guidance = explainSessionState(session);
		expect(summary.session?.decisionGate).toEqual({
			status: "recommend_confirm",
			domain: "quality",
			question: "Should Flow ship the semantic suite now?",
			recommendation: "Defer",
			rationale: ["Needs confirmation before rollout."],
		});
		expect(guidance.category).toBe(
			SEMANTIC_DECISION_GATE_EXPECTATIONS.guidanceCategory,
		);
		expect(guidance.status).toBe(
			SEMANTIC_DECISION_GATE_EXPECTATIONS.pauseModes[0],
		);
		expect(SEMANTIC_DECISION_GATE_EXPECTATIONS.surfaceKeys).toEqual([
			"status",
			"domain",
			"question",
			"recommendation",
			"rationale",
		]);
	});

	test("review.scope.payload_binding rejects cross-scope review payloads", () => {
		expect(
			FlowReviewRecordFeatureArgsSchema.safeParse({
				scope: SEMANTIC_REVIEW_SCOPE_EXPECTATIONS.featureScope,
				featureId: "setup-runtime",
				status: "approved",
				summary: "Approved.",
			}).success,
		).toBe(SEMANTIC_REVIEW_SCOPE_EXPECTATIONS.featureRequiresFeatureId);

		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				scope: SEMANTIC_REVIEW_SCOPE_EXPECTATIONS.finalScope,
				featureId: "setup-runtime",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "approved",
				summary: "Approved.",
			}).success,
		).toBe(false);

		expect(
			FlowReviewRecordFinalArgsSchema.safeParse({
				scope: SEMANTIC_REVIEW_SCOPE_EXPECTATIONS.finalScope,
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: [
					"Reviewed integration points across the active feature boundary.",
				],
				regressionChecks: [
					"Checked for regressions in shared surfaces and validation evidence.",
				],
				remainingGaps: [],
				status: "approved",
				summary: "Approved.",
			}).success,
		).toBe(true);
		expect(SEMANTIC_REVIEW_SCOPE_EXPECTATIONS.finalRejectsFeatureId).toBe(true);
	});

	test("recovery.next_action.binding distinguishes status-only and reset-feature flows", () => {
		for (const kind of SEMANTIC_RECOVERY_EXPECTATIONS.resetFeatureKinds) {
			const recovery = buildCompletionRecovery("setup-runtime", false, kind);
			expect(recovery.nextCommand).toContain(
				SEMANTIC_RECOVERY_EXPECTATIONS.resetCommandPrefix,
			);
			expect(recovery.nextRuntimeTool).toBe(
				SEMANTIC_RECOVERY_EXPECTATIONS.resetRuntimeTool,
			);
		}

		for (const kind of SEMANTIC_RECOVERY_EXPECTATIONS.statusOnlyKinds) {
			const recovery = buildCompletionRecovery(
				"setup-runtime",
				kind === "missing_final_review",
				kind,
			);
			expect(recovery.nextCommand).toBe(
				SEMANTIC_RECOVERY_EXPECTATIONS.statusCommand,
			);
			expect(recovery.nextRuntimeTool).toBeUndefined();
		}
	});

	test("tools.canonical_surface.no_raw_wrappers stays canonical-only", () => {
		const tools = Object.keys(createTools({}));
		for (const toolName of SEMANTIC_TOOL_SURFACE_EXPECTATIONS.canonicalRuntimeToolNames) {
			expect(tools).toContain(toolName);
		}
		expect(
			tools.some((name) =>
				name.includes(SEMANTIC_TOOL_SURFACE_EXPECTATIONS.forbiddenSubstring),
			),
		).toBe(false);
	});
});
