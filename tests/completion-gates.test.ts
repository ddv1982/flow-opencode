import { describe, expect, test } from "bun:test";
import { buildSessionMutationAction } from "../src/runtime/application/session-actions";
import type { ReviewScopeRecoveryDetails } from "../src/runtime/domain/review-scope-accounting";
import type { Session, WorkerResult } from "../src/runtime/schema";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	completeRun,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import { validateSuccessfulCompletion } from "../src/runtime/transitions/shared";
import {
	createApprovedFinalReviewerDecision,
	createFinalReviewPayload,
} from "./final-review-fixtures";
import { samplePlan } from "./runtime-test-helpers";

function createStartedSession(options?: {
	finalFeature?: boolean;
	finalReviewPolicy?: "broad" | "detailed";
	goalMode?: "implementation" | "review" | "review_and_fix";
	strictReview?: boolean;
	reviewerDecision?: Session["execution"]["lastReviewerDecision"];
}): {
	session: Session;
	featureId: string;
	wasFinalFeature: boolean;
} {
	const finalFeature = options?.finalFeature ?? false;
	const basePlan = samplePlan();
	const plan = finalFeature
		? {
				...basePlan,
				...(options?.goalMode ? { goalMode: options.goalMode } : {}),
				completionPolicy: {
					minCompletedFeatures: 1,
				},
				deliveryPolicy:
					options?.finalReviewPolicy || options?.strictReview
						? {
								...(options?.finalReviewPolicy
									? { finalReviewPolicy: options.finalReviewPolicy }
									: {}),
								...(options?.strictReview ? { strictReview: true } : {}),
							}
						: undefined,
				features: [basePlan.features[0]],
			}
		: {
				...basePlan,
				...(options?.goalMode ? { goalMode: options.goalMode } : {}),
			};

	const applied = applyPlan(
		createSession("Build a workflow plugin"),
		plan,
		options?.goalMode === "review_and_fix"
			? { reviewFindings: [knownReviewFinding()] }
			: undefined,
	);
	expect(applied.ok).toBe(true);
	if (!applied.ok) {
		throw new Error("Expected plan apply to succeed in test setup.");
	}

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) {
		throw new Error("Expected plan approval to succeed in test setup.");
	}

	const started = startRun(approved.value);
	expect(started.ok).toBe(true);
	if (!started.ok) {
		throw new Error("Expected run start to succeed in test setup.");
	}

	const featureId = started.value.session.execution.activeFeatureId;
	if (!featureId) {
		throw new Error("Expected an active feature in test setup.");
	}

	const session = options?.reviewerDecision
		? (() => {
				const reviewed = recordReviewerDecision(
					started.value.session,
					options.reviewerDecision,
				);
				if (!reviewed.ok) {
					throw new Error(
						`Expected reviewer decision to record successfully in test setup: ${reviewed.message}`,
					);
				}
				return reviewed.value;
			})()
		: started.value.session;

	return {
		session,
		featureId,
		wasFinalFeature: finalFeature,
	};
}

function approvedFeatureDecision(
	featureId = "setup-runtime",
): Extract<
	NonNullable<Session["execution"]["lastReviewerDecision"]>,
	{ scope: "feature" }
> {
	return {
		scope: "feature",
		featureId,
		status: "approved",
		summary: "Looks good.",
		blockingFindings: [],
		followUps: [],
		suggestedValidation: [],
	};
}

function approvedFinalDecision(): Extract<
	NonNullable<Session["execution"]["lastReviewerDecision"]>,
	{ scope: "final" }
> {
	return createApprovedFinalReviewerDecision();
}

function knownReviewFinding(findingRef = "review: known defect") {
	return {
		findingRef,
		summary: "Existing review finding targeted for remediation.",
		sourceRefs: ["audit#known-defect", "src/runtime/session.ts"],
	};
}

function createWorkerResult(
	featureId: string,
	overrides: Partial<WorkerResult> = {},
): WorkerResult {
	const result = {
		contractVersion: "1",
		status: "ok",
		summary: "Completed runtime setup.",
		artifactsChanged: [{ path: "src/runtime/session.ts" }],
		validationRun: [
			{
				command: "bun test",
				status: "passed",
				summary: "Runtime tests passed.",
			},
		],
		validationScope: "targeted",
		reviewIterations: 1,
		decisions: [],
		nextStep: "Run the next feature.",
		outcome: { kind: "completed" },
		featureResult: {
			featureId,
			verificationStatus: "passed",
		},
		featureReview: {
			status: "passed",
			summary: "Looks good.",
			blockingFindings: [],
		},
		...overrides,
	} as WorkerResult;

	return result;
}

function closedReviewFindingClosure(
	overrides: Partial<
		NonNullable<WorkerResult["reviewFindingClosures"]>[number]
	> = {},
): NonNullable<WorkerResult["reviewFindingClosures"]>[number] {
	return {
		findingRef: "review: navigation failure was swallowed",
		status: "closed",
		fixRefs: ["src/game/navigation.ts:42"],
		testRefs: ["tests/fullFlowSmoke.ts:123"],
		validationRefs: ["bun test"],
		residualRisk: "No known residual risk.",
		...overrides,
	};
}

function scopeLedgerEntry(
	scopeId = "file_target:src/runtime/session.ts",
	overrides: Partial<
		NonNullable<WorkerResult["reviewScopeLedger"]>[number]
	> = {},
): NonNullable<WorkerResult["reviewScopeLedger"]>[number] {
	return {
		scopeId,
		status: "reviewed_no_findings",
		evidenceRefs: [scopeId.replace("file_target:", "")],
		validationRefs: ["bun test"],
		residualRisk: "No known residual risk for this declared review scope.",
		...overrides,
	};
}

function scopeLedgerForTargets(
	targets: readonly string[],
	overrides?: Record<
		string,
		Partial<NonNullable<WorkerResult["reviewScopeLedger"]>[number]>
	>,
): NonNullable<WorkerResult["reviewScopeLedger"]> {
	return targets.map((target) =>
		scopeLedgerEntry(`file_target:${target}`, overrides?.[target] ?? {}),
	);
}

describe("completion gates", () => {
	test.each([
		{
			name: "missing validation evidence",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationRun: [] }),
			expectedErrorCode: "missing_validation_evidence",
		},
		{
			name: "failing validation",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationRun: [
						{
							command: "bun test",
							status: "failed",
							summary: "Runtime tests failed.",
						},
					],
				}),
			expectedErrorCode: "failing_validation",
		},
		{
			name: "missing reviewer decision",
			setup: () => createStartedSession(),
			worker: (featureId: string) => createWorkerResult(featureId),
			expectedErrorCode: "missing_feature_reviewer_decision",
		},
		{
			name: "review-and-fix completion missing closure ledger",
			setup: () =>
				createStartedSession({
					goalMode: "review_and_fix",
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) => createWorkerResult(featureId),
			expectedErrorCode: "missing_review_finding_closure",
		},
		{
			name: "review-and-fix closed finding missing fix evidence",
			setup: () =>
				createStartedSession({
					goalMode: "review_and_fix",
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					reviewFindingClosures: [closedReviewFindingClosure({ fixRefs: [] })],
				}),
			expectedErrorCode: "missing_review_finding_closure",
		},
		{
			name: "review-and-fix closure references unrecorded validation",
			setup: () =>
				createStartedSession({
					goalMode: "review_and_fix",
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					reviewFindingClosures: [
						closedReviewFindingClosure({
							validationRefs: ["bun run validate"],
						}),
					],
				}),
			expectedErrorCode: "missing_review_finding_closure",
		},
		{
			name: "review-and-fix cannot complete with unresolved closure status",
			setup: () =>
				createStartedSession({
					goalMode: "review_and_fix",
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					reviewFindingClosures: [
						closedReviewFindingClosure({
							status: "partially_closed",
							residualRisk: "Ordering coverage still needs stronger evidence.",
						}),
					],
				}),
			expectedErrorCode: "missing_review_finding_closure",
		},
		{
			name: "review-and-fix closure ledger satisfies completion gate",
			expectedOk: true,
			setup: () =>
				createStartedSession({
					goalMode: "review_and_fix",
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					reviewFindingClosures: [closedReviewFindingClosure()],
					reviewScopeLedger: [
						scopeLedgerEntry("file_target:src/runtime/session.ts", {
							status: "finding_closed",
							findingRefs: ["review: navigation failure was swallowed"],
						}),
					],
				}),
		},
		{
			name: "lite lane final completion still requires a recorded final reviewer decision",
			expectedOk: false,
			setup: () => {
				const basePlan = samplePlan();
				const liteFeature = basePlan.features[0];
				if (!liteFeature) {
					throw new Error("Missing lite feature fixture.");
				}

				const applied = applyPlan(createSession("Ship a tiny fix"), {
					...basePlan,
					features: [liteFeature],
				});
				expect(applied.ok).toBe(true);
				if (!applied.ok) {
					throw new Error("Expected plan apply to succeed in test setup.");
				}

				const approved = approvePlan(applied.value);
				expect(approved.ok).toBe(true);
				if (!approved.ok) {
					throw new Error("Expected plan approval to succeed in test setup.");
				}

				const started = startRun(approved.value);
				expect(started.ok).toBe(true);
				if (!started.ok) {
					throw new Error("Expected run start to succeed in test setup.");
				}

				const featureId = started.value.session.execution.activeFeatureId;
				if (!featureId) {
					throw new Error("Expected an active feature in test setup.");
				}

				return {
					session: started.value.session,
					featureId,
					wasFinalFeature: true,
				};
			},
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
					finalReview: createFinalReviewPayload(),
				}),
			expectedErrorCode: "missing_final_reviewer_decision",
		},
		{
			name: "missing targeted validation scope on non-final feature",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationScope: "broad" }),
			expectedErrorCode: "missing_targeted_validation",
		},
		{
			name: "failing feature review",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					featureReview: {
						status: "failed",
						summary: "Blocking issues remain.",
						blockingFindings: [{ summary: "A blocking issue remains." }],
					},
				}),
			expectedErrorCode: "failing_feature_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "failing optional final review on non-final feature",
			setup: () =>
				createStartedSession({
					reviewerDecision: approvedFeatureDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					finalReview: createFinalReviewPayload({
						status: "failed",
						summary: "Repo validation failed.",
						blockingFindings: [{ summary: "Repo-wide issue remains." }],
					}),
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "missing broad scope on final feature",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) => createWorkerResult(featureId),
			expectedErrorCode: "missing_broad_validation",
		},
		{
			name: "missing final review on final feature",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, { validationScope: "broad" }),
			expectedErrorCode: "missing_final_review_payload",
		},
		{
			name: "required final review not passing",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
					finalReview: createFinalReviewPayload({
						status: "failed",
						summary: "Repo-wide validation is blocked.",
						blockingFindings: [
							{ summary: "A blocking repo-wide issue remains." },
						],
					}),
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final review depth must match delivery policy",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					finalReviewPolicy: "broad",
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewDepth: "broad",
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					validationScope: "broad",
					finalReview: createFinalReviewPayload({
						summary: "Detailed final review looks good.",
					}),
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final reviewer decision must cover derived docs and prompt surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: approvedFinalDecision(),
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "./docs/development.md" }],
					validationScope: "broad",
					finalReview: {
						reviewDepth: "detailed",
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"docs_and_prompts",
						],
						evidenceSummary:
							"Reviewed changed docs and prompt surfaces together with validation evidence.",
						validationAssessment:
							"Validation coverage and changed docs/prompt surfaces were reviewed.",
						evidenceRefs: {
							changedArtifacts: ["docs/development.md"],
							validationCommands: ["bun test"],
						},
						integrationChecks: [
							"Checked that prompt-facing guidance still matches runtime behavior.",
						],
						regressionChecks: [
							"Checked that the docs surface stays aligned with runtime review policy.",
						],
						remainingGaps: [],
						status: "passed",
						summary: "Final review looks good.",
						blockingFindings: [],
					},
				}),
			expectedErrorCode: "missing_final_reviewer_decision",
		},
		{
			name: "final review payload must cover derived docs and prompt surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"docs_and_prompts",
						],
						evidenceRefs: {
							changedArtifacts: ["docs/development.md"],
							validationCommands: ["bun test"],
						},
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "./docs/development.md" }],
					validationScope: "broad",
					finalReview: createFinalReviewPayload({
						evidenceSummary:
							"Reviewed final runtime state and validation evidence.",
						integrationChecks: [
							"Checked that prompt-facing guidance still matches runtime behavior.",
						],
						regressionChecks: [
							"Checked that the runtime change does not regress existing review behavior.",
						],
					}),
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
		{
			name: "final review payload must cover derived colocated test surfaces",
			setup: () =>
				createStartedSession({
					finalFeature: true,
					reviewerDecision: {
						...approvedFinalDecision(),
						reviewedSurfaces: [
							"changed_files",
							"shared_surfaces",
							"validation_evidence",
							"tests",
						],
						evidenceRefs: {
							changedArtifacts: ["src/runtime/session.test.ts"],
							validationCommands: ["bun test"],
						},
					},
				}),
			worker: (featureId: string) =>
				createWorkerResult(featureId, {
					artifactsChanged: [{ path: "src/runtime/session.test.ts" }],
					validationScope: "broad",
					finalReview: createFinalReviewPayload({
						evidenceSummary:
							"Reviewed runtime changes and validation evidence.",
						integrationChecks: [
							"Checked that final runtime behavior stays coherent.",
						],
						regressionChecks: [
							"Checked that the runtime change does not regress existing review behavior.",
						],
					}),
				}),
			expectedErrorCode: "failing_final_review",
			expectedNextCommand: "/flow-reset feature setup-runtime",
		},
	])("validates $name", ({
		setup,
		worker,
		expectedErrorCode,
		expectedNextCommand,
		expectedOk,
	}) => {
		const { session, featureId, wasFinalFeature } = setup();
		const result = validateSuccessfulCompletion(
			session,
			worker(featureId),
			featureId,
			wasFinalFeature,
		);

		expect(result.ok).toBe(expectedOk ?? false);
		if (result.ok) {
			return;
		}

		expect(result.recovery?.errorCode).toBe(expectedErrorCode);
		if (expectedNextCommand) {
			expect(result.recovery?.nextCommand).toBe(expectedNextCommand);
		}
	});

	test("non-strict final review rejects supplied behavior evidence with needs_fix", () => {
		const { session, featureId } = createStartedSession({
			finalFeature: true,
			reviewerDecision: approvedFinalDecision(),
		});
		const result = validateSuccessfulCompletion(
			session,
			createWorkerResult(featureId, {
				validationScope: "broad",
				finalReview: createFinalReviewPayload({
					behaviorChecks: [
						{
							riskClass: "state_commit_rollback",
							result: "needs_fix",
							invariant:
								"Final completion must not approve known state rollback defects.",
							entrypointRefs: [],
							stateOwnerRefs: [],
							lifecycleOwnerRefs: [],
							failurePath:
								"A known rollback defect is still unresolved after validation.",
							testEvidenceRefs: [],
							validationRefs: [],
						},
					],
				}),
			}),
			featureId,
			true,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.recovery?.errorCode).toBe("failing_final_review");
			expect(result.message).toContain(
				"behaviorChecks[0] cannot use result needs_fix in an approved/passing final review",
			);
		}
	});

	test("non-strict final review rejects supplied behavior evidence with invalid refs", () => {
		const { session, featureId } = createStartedSession({
			finalFeature: true,
			reviewerDecision: approvedFinalDecision(),
		});
		const result = validateSuccessfulCompletion(
			session,
			createWorkerResult(featureId, {
				validationScope: "broad",
				finalReview: createFinalReviewPayload({
					behaviorChecks: [
						{
							riskClass: "state_commit_rollback",
							result: "passed",
							invariant:
								"Final completion only approves grounded behavior evidence.",
							entrypointRefs: ["../secret"],
							stateOwnerRefs: [],
							lifecycleOwnerRefs: [],
							failurePath:
								"Ungrounded or unrecorded evidence cannot prove the final path.",
							testEvidenceRefs: [],
							validationRefs: ["bun run missing"],
						},
					],
				}),
			}),
			featureId,
			true,
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.recovery?.errorCode).toBe("failing_final_review");
			expect(result.message).toContain(
				"behaviorChecks[0].entrypointRefs includes '../secret', which is not a safe relative path reference",
			);
			expect(result.message).toContain(
				"behaviorChecks[0].validationRefs includes 'bun run missing', which was not recorded in validationRun",
			);
		}
	});

	test("completeRun does not persist ok worker history when success gates reject the payload", () => {
		const { session, featureId } = createStartedSession({
			reviewerDecision: approvedFeatureDecision(),
		});
		const result = completeRun(
			session,
			createWorkerResult(featureId, { validationScope: "broad" }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.recovery?.errorCode).toBe("missing_targeted_validation");
			expect(result.session).toBeUndefined();
		}
		expect(session.execution.history).toHaveLength(0);
	});

	test("review-scope accounting recovery returns declared scopes and ledger examples", () => {
		const declaredTargets = [
			"src/runtime/session.ts",
			"src/adapters/opencode/tools.ts",
		];
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
			features: [
				{
					...basePlan.features[0],
					fileTargets: declaredTargets,
				},
			],
		};
		const closedFindingRef = "review: scoped runtime defect";
		const applied = applyPlan(createSession("Review runtime scope"), plan, {
			reviewFindings: [knownReviewFinding(closedFindingRef)],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const result = validateSuccessfulCompletion(
			started.value.session,
			createWorkerResult(featureId, {
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: closedFindingRef }),
				],
				reviewScopeLedger: [
					{
						scopeId: "audit:pointer-only-practice-controls",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						residualRisk: "No known residual risk.",
					},
				],
			}),
			featureId,
			false,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.recovery?.errorCode).toBe("missing_review_scope_accounting");
		const details = result.recovery?.details?.reviewScopeLedger as
			| ReviewScopeRecoveryDetails
			| undefined;
		expect(details?.declaredScopes.map((scope) => scope.scopeId)).toEqual([
			"file_target:src/runtime/session.ts",
			"file_target:src/adapters/opencode/tools.ts",
		]);
		expect(details?.evidenceCandidates.changedArtifacts).toContain(
			"src/runtime/session.ts",
		);
		expect(details?.exampleReviewScopeLedgerPurpose).toBe("scaffold_only");
		expect(
			details?.exampleReviewScopeLedger.map((entry) => entry.scopeId),
		).toEqual([
			"file_target:src/runtime/session.ts",
			"file_target:src/adapters/opencode/tools.ts",
		]);
		expect(details?.exampleReviewScopeLedger[0]?.evidenceRefs).toContain(
			"src/runtime/session.ts",
		);
		expect(details?.exampleReviewScopeLedger[0]?.residualRisk).toContain(
			"Example scaffold only",
		);
		expect(details?.evidenceCandidates.closedFindingRefs).toEqual([
			closedFindingRef,
		]);
		expect(
			details?.exampleReviewScopeLedger.every(
				(entry) =>
					entry.status === "reviewed_no_findings" &&
					entry.findingRefs === undefined,
			),
		).toBe(true);
		expect(details?.notes.join("\n")).toContain(
			"Closed finding refs are candidates only",
		);
		expect(details?.notes.join("\n")).toContain("do not replay unchanged");
	});

	test("worker completion rejects blind review-scope recovery scaffold replay", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/runtime/session.ts"],
				},
			],
		};
		const applied = applyPlan(createSession("Review runtime scaffold"), plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;
		const reviewed = recordReviewerDecision(
			started.value.session,
			approvedFeatureDecision(featureId),
		);
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const baseWorker = createWorkerResult(featureId, {
			artifactsChanged: [{ path: "src/runtime/session.ts" }],
		});
		const missingScope = validateSuccessfulCompletion(
			reviewed.value,
			{
				...baseWorker,
				reviewScopeLedger: [
					{
						scopeId: "audit:pointer-only-practice-controls",
						status: "reviewed_no_findings",
						evidenceRefs: ["src/runtime/session.ts"],
						residualRisk: "No known residual risk.",
					},
				],
			},
			featureId,
			false,
		);
		expect(missingScope.ok).toBe(false);
		if (missingScope.ok) return;
		const details = missingScope.recovery?.details?.reviewScopeLedger as
			| ReviewScopeRecoveryDetails
			| undefined;
		expect(details?.exampleReviewScopeLedgerPurpose).toBe("scaffold_only");
		expect(details?.exampleReviewScopeLedger).toHaveLength(1);
		if (!details) return;

		const blindReplay = validateSuccessfulCompletion(
			reviewed.value,
			{
				...baseWorker,
				reviewScopeLedger: details.exampleReviewScopeLedger,
			},
			featureId,
			false,
		);
		expect(blindReplay.ok).toBe(false);
		if (!blindReplay.ok) {
			expect(blindReplay.message).toContain("uses scaffold placeholder");
		}

		const repaired = validateSuccessfulCompletion(
			reviewed.value,
			{
				...baseWorker,
				reviewScopeLedger: details.exampleReviewScopeLedger.map((entry) => ({
					...entry,
					residualRisk:
						"No known residual risk after reviewing this declared scope.",
				})),
			},
			featureId,
			false,
		);
		expect(repaired.ok).toBe(true);
	});

	test("final reviewer review-scope failures return recovery details", () => {
		const { session } = createStartedSession({
			finalFeature: true,
			goalMode: "review",
		});
		const result = recordReviewerDecision(session, {
			...approvedFinalDecision(),
			reviewScopeLedger: [
				{
					scopeId: "audit:pointer-only-practice-controls",
					status: "reviewed_no_findings",
					evidenceRefs: ["src/runtime/session.ts"],
					residualRisk: "No known residual risk.",
				},
			],
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.recovery?.errorCode).toBe("missing_review_scope_accounting");
		const details = result.recovery?.details?.reviewScopeLedger as
			| ReviewScopeRecoveryDetails
			| undefined;
		expect(details?.declaredScopes.map((scope) => scope.scopeId)).toContain(
			"file_target:src/runtime/session.ts",
		);
		expect(details?.exampleReviewScopeLedgerPurpose).toBe("scaffold_only");
	});

	test("broad review-and-fix final completion requires every declared review scope target", () => {
		const declaredTargets = [
			"src/runtime/session.ts",
			"src/runtime/transitions/execution.ts",
			"src/adapters/opencode/tools.ts",
		];
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: declaredTargets,
				},
			],
		};
		const applied = applyPlan(
			createSession("Review the runtime and adapter surfaces"),
			plan,
			{
				reviewFindings: [
					knownReviewFinding("review: navigation failure was swallowed"),
				],
			},
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const finalScopeLedger = scopeLedgerForTargets(declaredTargets, {
			"src/runtime/session.ts": {
				status: "finding_closed",
				findingRefs: ["review: navigation failure was swallowed"],
			},
		});
		const reviewed = recordReviewerDecision(started.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: finalScopeLedger,
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const workerBase = createWorkerResult(featureId, {
			validationScope: "broad",
			reviewFindingClosures: [closedReviewFindingClosure()],
			finalReview: createFinalReviewPayload(),
		});
		const partial = validateSuccessfulCompletion(
			reviewed.value,
			{
				...workerBase,
				reviewScopeLedger: [
					scopeLedgerEntry("file_target:src/runtime/session.ts", {
						status: "finding_closed",
						findingRefs: ["review: navigation failure was swallowed"],
					}),
				],
			},
			featureId,
			true,
		);
		expect(partial.ok).toBe(false);
		if (!partial.ok) {
			expect(partial.recovery?.errorCode).toBe(
				"missing_review_scope_accounting",
			);
			expect(partial.message).toContain(
				"file_target:src/runtime/transitions/execution.ts",
			);
		}

		const failedAttempt = completeRun(reviewed.value, {
			...workerBase,
			reviewScopeLedger: finalScopeLedger,
			finalReview: undefined,
		});
		expect(failedAttempt.ok).toBe(false);
		if (!failedAttempt.ok) {
			expect(failedAttempt.recovery?.errorCode).toBe(
				"missing_final_review_payload",
			);
			const retryWithoutFullLedger = validateSuccessfulCompletion(
				failedAttempt.session ?? reviewed.value,
				{
					...workerBase,
					reviewScopeLedger: [
						scopeLedgerEntry("file_target:src/runtime/session.ts", {
							status: "finding_closed",
							findingRefs: ["review: navigation failure was swallowed"],
						}),
					],
				},
				featureId,
				true,
			);
			expect(retryWithoutFullLedger.ok).toBe(false);
			if (!retryWithoutFullLedger.ok) {
				expect(retryWithoutFullLedger.recovery?.errorCode).toBe(
					"missing_review_scope_accounting",
				);
			}
		}

		const reviewerWithUnclosedFinding = recordReviewerDecision(
			started.value.session,
			{
				...approvedFinalDecision(),
				reviewScopeLedger: scopeLedgerForTargets(declaredTargets, {
					"src/runtime/session.ts": {
						status: "finding_closed",
						findingRefs: ["review: unclosed finding"],
					},
				}),
			},
		);
		expect(reviewerWithUnclosedFinding.ok).toBe(true);
		if (reviewerWithUnclosedFinding.ok) {
			const unclosedFindingCompletion = validateSuccessfulCompletion(
				reviewerWithUnclosedFinding.value,
				{
					...workerBase,
					reviewScopeLedger: finalScopeLedger,
				},
				featureId,
				true,
			);
			expect(unclosedFindingCompletion.ok).toBe(false);
			if (!unclosedFindingCompletion.ok) {
				expect(unclosedFindingCompletion.message).toContain(
					"review: unclosed finding",
				);
			}
		}

		const complete = validateSuccessfulCompletion(
			reviewed.value,
			{
				...workerBase,
				reviewScopeLedger: finalScopeLedger,
			},
			featureId,
			true,
		);
		expect(complete.ok).toBe(true);
	});

	test("final completion review-scope recovery points at the recorded final reviewer decision", () => {
		const declaredTargets = [
			"src/runtime/session.ts",
			"src/adapters/opencode/tools.ts",
		];
		const closedFindingRef = "review: setup runtime defect";
		const staleFindingRef = "review: stale final reviewer finding";
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: declaredTargets,
				},
			],
		};
		const applied = applyPlan(
			createSession("Review and fix final reviewer accounting"),
			plan,
			{ reviewFindings: [knownReviewFinding(closedFindingRef)] },
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const finalReviewerLedger = scopeLedgerForTargets(declaredTargets, {
			"src/runtime/session.ts": {
				status: "finding_closed",
				findingRefs: [staleFindingRef],
			},
		});
		const reviewed = recordReviewerDecision(started.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: finalReviewerLedger,
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const workerScopeLedger = scopeLedgerForTargets(declaredTargets, {
			"src/runtime/session.ts": {
				status: "finding_closed",
				findingRefs: [closedFindingRef],
			},
		});
		const result = validateSuccessfulCompletion(
			reviewed.value,
			createWorkerResult(featureId, {
				artifactsChanged: [{ path: "src/runtime/session.ts" }],
				validationScope: "broad",
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: closedFindingRef }),
				],
				reviewScopeLedger: workerScopeLedger,
				finalReview: createFinalReviewPayload(),
			}),
			featureId,
			true,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.recovery?.errorCode).toBe("missing_review_scope_accounting");
		expect(result.recovery?.recoveryStage).toBe("record_review");
		expect(result.recovery?.prerequisite).toBe("reviewer_result_required");
		expect(result.recovery?.requiredArtifact).toBe("final_reviewer_decision");
		expect(result.message).toContain(staleFindingRef);

		const details = result.recovery?.details?.reviewScopeLedger as
			| {
					evidenceCandidates: {
						changedArtifacts: string[];
						closedFindingRefs: string[];
					};
					exampleReviewScopeLedger: NonNullable<
						WorkerResult["reviewScopeLedger"]
					>;
			  }
			| undefined;
		expect(details?.evidenceCandidates.changedArtifacts).toEqual([
			"src/runtime/session.ts",
		]);
		expect(details?.evidenceCandidates.changedArtifacts).not.toContain(
			"src/adapters/opencode/tools.ts",
		);
		expect(details?.evidenceCandidates.closedFindingRefs).toEqual([
			closedFindingRef,
		]);
		expect(
			details?.exampleReviewScopeLedger.every(
				(entry) => entry.findingRefs === undefined,
			),
		).toBe(true);
	});

	test("recursive fileTargets globs ground scoped evidence", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/**/*.ts"],
				},
				basePlan.features[1],
			],
		};
		const applied = applyPlan(
			createSession("Review recursive TypeScript scope"),
			plan,
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const reviewed = recordReviewerDecision(
			started.value.session,
			approvedFeatureDecision(featureId),
		);
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const completed = completeRun(
			reviewed.value,
			createWorkerResult(featureId, {
				artifactsChanged: [
					{ path: "src/index.ts" },
					{ path: "src/runtime/session.ts" },
				],
				reviewScopeLedger: [
					scopeLedgerEntry("file_target:src/**/*.ts", {
						evidenceRefs: ["src/index.ts", "src/runtime/session.ts"],
					}),
				],
			}),
		);
		expect(completed.ok).toBe(true);
	});

	test("explicit reviewScope adds to fileTargets instead of narrowing final review accounting", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/runtime/session.ts"],
					reviewScope: [
						{
							id: "domain:runtime",
							kind: "domain" as const,
							target: "runtime",
							description: "Review runtime domain behavior.",
						},
					],
				},
			],
		};
		const applied = applyPlan(createSession("Review runtime session"), plan);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;

		const domainLedgerEntry: NonNullable<
			WorkerResult["reviewScopeLedger"]
		>[number] = {
			scopeId: "domain:runtime",
			status: "reviewed_no_findings",
			evidenceRefs: ["src/runtime/session.ts"],
			validationRefs: ["bun test"],
			residualRisk: "No known residual risk.",
		};
		const domainOnlyReview = recordReviewerDecision(started.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: [domainLedgerEntry],
		});
		expect(domainOnlyReview.ok).toBe(false);
		if (!domainOnlyReview.ok) {
			expect(domainOnlyReview.message).toContain(
				"file_target:src/runtime/session.ts",
			);
		}

		const completeReview = recordReviewerDecision(started.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: [
				domainLedgerEntry,
				scopeLedgerEntry("file_target:src/runtime/session.ts"),
			],
		});
		expect(completeReview.ok).toBe(true);
	});

	test("review-and-fix record_planning_context cannot clear planned findings during an active run", () => {
		const firstFindingRef = "review: setup runtime defect";
		const secondFindingRef = "review: execution adapter defect";
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{ ...basePlan.features[0], fileTargets: ["src/runtime/session.ts"] },
			],
		};
		const applied = applyPlan(createSession("Review and fix runtime"), plan, {
			reviewFindings: [
				knownReviewFinding(firstFindingRef),
				knownReviewFinding(secondFindingRef),
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const session = started.value.session;

		const mutate = buildSessionMutationAction("record_planning_context", {
			reviewFindings: [],
		});
		const mutation = mutate.run(session);
		expect(mutation.ok).toBe(false);
		if (!mutation.ok) {
			expect(mutation.message).toContain(
				"cannot remove review_and_fix findings",
			);
		}
		expect(
			session.planning.reviewFindings.map((finding) => finding.findingRef),
		).toEqual([firstFindingRef, secondFindingRef]);
	});

	test("final review-and-fix completion requires every planned finding closure", () => {
		const firstFindingRef = "review: setup runtime defect";
		const secondFindingRef = "review: execution adapter defect";
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: ["src/runtime/session.ts"],
				},
			],
		};
		const applied = applyPlan(createSession("Review and fix runtime"), plan, {
			reviewFindings: [
				knownReviewFinding(firstFindingRef),
				knownReviewFinding(secondFindingRef),
			],
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const finalScopeLedger = scopeLedgerForTargets(["src/runtime/session.ts"], {
			"src/runtime/session.ts": {
				status: "finding_closed",
				findingRefs: [firstFindingRef],
			},
		});
		const reviewed = recordReviewerDecision(started.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: finalScopeLedger,
		});
		expect(reviewed.ok).toBe(true);
		if (!reviewed.ok) return;

		const partialClosure = validateSuccessfulCompletion(
			reviewed.value,
			createWorkerResult(featureId, {
				validationScope: "broad",
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: firstFindingRef }),
				],
				reviewScopeLedger: finalScopeLedger,
				finalReview: createFinalReviewPayload(),
			}),
			featureId,
			true,
		);
		expect(partialClosure.ok).toBe(false);
		if (!partialClosure.ok) {
			expect(partialClosure.recovery?.errorCode).toBe(
				"missing_review_finding_closure",
			);
			expect(partialClosure.message).toContain(secondFindingRef);
		}
	});

	test("final review payload derives behavior risks from declared review scope", () => {
		const declaredTargets = [
			"src/shell/sessionPanels.ts",
			"src/game/navigation.ts",
			"src/scenes/PracticeScene.ts",
			"tests/sessionPanelActions.test.ts",
		];
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			completionPolicy: { minCompletedFeatures: 1 },
			features: [
				{
					...basePlan.features[0],
					fileTargets: declaredTargets,
				},
			],
		};
		const applied = applyPlan(
			createSession("Review soft-focus behavior surface"),
			plan,
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		const started = startRun(approved.value);
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		const featureId = started.value.session.execution.activeFeatureId;
		expect(featureId).toBeTruthy();
		if (!featureId) return;

		const validationCommand = "bun test tests/sessionPanelActions.test.ts";
		const result = validateSuccessfulCompletion(
			started.value.session,
			createWorkerResult(featureId, {
				artifactsChanged: [{ path: "src/shell/sessionPanels.ts" }],
				validationRun: [
					{
						command: validationCommand,
						status: "passed",
						summary: "Session panel tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: scopeLedgerForTargets(
					declaredTargets,
					Object.fromEntries(
						declaredTargets.map((target) => [
							target,
							{ validationRefs: [validationCommand] },
						]),
					),
				),
				finalReview: createFinalReviewPayload({
					reviewedSurfaces: [
						"changed_files",
						"shared_surfaces",
						"validation_evidence",
					],
					evidenceSummary:
						"Reviewed the changed shell surface and declared broad review scope.",
					validationAssessment:
						"Targeted session panel validation was reviewed.",
					evidenceRefs: {
						changedArtifacts: ["src/shell/sessionPanels.ts"],
						validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
					},
					integrationChecks: [
						"Checked declared shell/game/scene review scope.",
					],
					regressionChecks: ["Checked session panel validation evidence."],
					remainingGaps: [],
				}),
			}),
			featureId,
			true,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.recovery?.errorCode).toBe("failing_final_review");
			expect(result.message).toContain(
				"must account for required behavior risk classes: async_event_ordering, lifecycle_reentrancy, state_commit_rollback, test_evidence_authenticity",
			);
		}
	});

	test("multi-feature review-and-fix final reviewer ledger accepts historical closed findings", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
		};
		const applied = applyPlan(
			createSession("Review and fix the runtime and adapter surfaces"),
			plan,
			{ reviewFindings: [knownReviewFinding("review: setup runtime defect")] },
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const firstStarted = startRun(approved.value);
		expect(firstStarted.ok).toBe(true);
		if (!firstStarted.ok) return;
		const firstFeatureId = firstStarted.value.session.execution.activeFeatureId;
		expect(firstFeatureId).toBe("setup-runtime");
		if (!firstFeatureId) return;

		const firstReviewed = recordReviewerDecision(
			firstStarted.value.session,
			approvedFeatureDecision(firstFeatureId),
		);
		expect(firstReviewed.ok).toBe(true);
		if (!firstReviewed.ok) return;
		const firstFindingRef = "review: setup runtime defect";
		const firstCompleted = completeRun(
			firstReviewed.value,
			createWorkerResult(firstFeatureId, {
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: firstFindingRef }),
				],
				reviewScopeLedger: [
					scopeLedgerEntry("file_target:src/runtime/session.ts", {
						status: "finding_closed",
						findingRefs: [firstFindingRef],
					}),
				],
			}),
		);
		expect(firstCompleted.ok).toBe(true);
		if (!firstCompleted.ok) return;

		const secondStarted = startRun(firstCompleted.value);
		expect(secondStarted.ok).toBe(true);
		if (!secondStarted.ok) return;
		const secondFeatureId =
			secondStarted.value.session.execution.activeFeatureId;
		expect(secondFeatureId).toBe("execute-feature");
		if (!secondFeatureId) return;

		const secondFindingRef = "review: execution adapter defect";
		const finalScopeLedger = [
			scopeLedgerEntry("file_target:src/runtime/session.ts", {
				status: "finding_closed",
				findingRefs: [firstFindingRef],
			}),
			scopeLedgerEntry("file_target:src/adapters/opencode/tools.ts", {
				status: "finding_closed",
				findingRefs: [secondFindingRef],
			}),
		];
		const finalReviewed = recordReviewerDecision(secondStarted.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: finalScopeLedger,
		});
		expect(finalReviewed.ok).toBe(true);
		if (!finalReviewed.ok) return;

		const finalCompleted = completeRun(
			finalReviewed.value,
			createWorkerResult(secondFeatureId, {
				validationScope: "broad",
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: secondFindingRef }),
				],
				reviewScopeLedger: finalScopeLedger,
				finalReview: createFinalReviewPayload(),
			}),
		);
		expect(finalCompleted.ok).toBe(true);
	});

	test("incomplete historical review-scope ledgers do not satisfy final accounting", () => {
		const firstTargets = [
			"src/runtime/session.ts",
			"src/runtime/transitions/execution.ts",
		];
		const secondTarget = "src/adapters/opencode/tools.ts";
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review" as const,
			features: [
				{
					...basePlan.features[0],
					fileTargets: firstTargets,
				},
				{
					...basePlan.features[1],
					fileTargets: [secondTarget],
				},
			],
		};
		const applied = applyPlan(
			createSession("Review historical scope accounting"),
			plan,
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const firstStarted = startRun(approved.value);
		expect(firstStarted.ok).toBe(true);
		if (!firstStarted.ok) return;
		const firstFeatureId = firstStarted.value.session.execution.activeFeatureId;
		expect(firstFeatureId).toBeTruthy();
		if (!firstFeatureId) return;

		const firstReviewed = recordReviewerDecision(
			firstStarted.value.session,
			approvedFeatureDecision(firstFeatureId),
		);
		expect(firstReviewed.ok).toBe(true);
		if (!firstReviewed.ok) return;
		const firstCompleted = completeRun(
			firstReviewed.value,
			createWorkerResult(firstFeatureId, {
				reviewScopeLedger: scopeLedgerForTargets(firstTargets),
			}),
		);
		expect(firstCompleted.ok).toBe(true);
		if (!firstCompleted.ok) return;

		const legacySession: Session = {
			...firstCompleted.value,
			execution: {
				...firstCompleted.value.execution,
				history: firstCompleted.value.execution.history.map((entry) =>
					entry.featureId === firstFeatureId
						? {
								...entry,
								reviewScopeLedger: [
									scopeLedgerEntry("file_target:src/runtime/session.ts"),
								],
							}
						: entry,
				),
			},
		};

		const secondStarted = startRun(legacySession);
		expect(secondStarted.ok).toBe(true);
		if (!secondStarted.ok) return;
		const secondFeatureId =
			secondStarted.value.session.execution.activeFeatureId;
		expect(secondFeatureId).toBeTruthy();
		if (!secondFeatureId) return;

		const finalReviewed = recordReviewerDecision(secondStarted.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: scopeLedgerForTargets([...firstTargets, secondTarget]),
		});
		expect(finalReviewed.ok).toBe(true);
		if (!finalReviewed.ok) return;

		const finalCompleted = completeRun(
			finalReviewed.value,
			createWorkerResult(secondFeatureId, {
				artifactsChanged: [{ path: secondTarget }],
				validationScope: "broad",
				reviewScopeLedger: scopeLedgerForTargets([
					"src/runtime/transitions/execution.ts",
					secondTarget,
				]),
				finalReview: createFinalReviewPayload(),
			}),
		);
		expect(finalCompleted.ok).toBe(false);
		if (!finalCompleted.ok) {
			expect(finalCompleted.message).toContain(
				"file_target:src/runtime/session.ts",
			);
		}
	});

	test("failed historical review-and-fix attempts do not satisfy final finding-closed scope", () => {
		const basePlan = samplePlan();
		const plan = {
			...basePlan,
			goalMode: "review_and_fix" as const,
		};
		const applied = applyPlan(
			createSession("Review and fix the runtime and adapter surfaces"),
			plan,
			{ reviewFindings: [knownReviewFinding("review: failed attempt only")] },
		);
		expect(applied.ok).toBe(true);
		if (!applied.ok) return;
		const approved = approvePlan(applied.value);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;

		const firstStarted = startRun(approved.value);
		expect(firstStarted.ok).toBe(true);
		if (!firstStarted.ok) return;
		const firstFeatureId = firstStarted.value.session.execution.activeFeatureId;
		expect(firstFeatureId).toBe("setup-runtime");
		if (!firstFeatureId) return;

		const firstReviewed = recordReviewerDecision(
			firstStarted.value.session,
			approvedFeatureDecision(firstFeatureId),
		);
		expect(firstReviewed.ok).toBe(true);
		if (!firstReviewed.ok) return;
		const failedFindingRef = "review: failed attempt only";
		const failedAttempt = completeRun(
			firstReviewed.value,
			createWorkerResult(firstFeatureId, {
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: failedFindingRef }),
				],
				reviewScopeLedger: [
					scopeLedgerEntry("file_target:src/runtime/session.ts", {
						status: "finding_closed",
						findingRefs: [failedFindingRef],
					}),
				],
				featureReview: {
					status: "failed",
					summary: "Still has blocking review issues.",
					blockingFindings: [{ summary: "Review issue remains." }],
				},
			}),
		);
		expect(failedAttempt.ok).toBe(false);
		if (!failedAttempt.ok) {
			expect(failedAttempt.session).toBeUndefined();
		}

		const successfulFindingRef = "review: successful setup fix";
		const firstCompleted = completeRun(
			firstReviewed.value,
			createWorkerResult(firstFeatureId, {
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: successfulFindingRef }),
				],
				reviewScopeLedger: [
					scopeLedgerEntry("file_target:src/runtime/session.ts", {
						status: "finding_closed",
						findingRefs: [successfulFindingRef],
					}),
				],
			}),
		);
		expect(firstCompleted.ok).toBe(true);
		if (!firstCompleted.ok) return;

		const secondStarted = startRun(firstCompleted.value);
		expect(secondStarted.ok).toBe(true);
		if (!secondStarted.ok) return;
		const secondFeatureId =
			secondStarted.value.session.execution.activeFeatureId;
		expect(secondFeatureId).toBe("execute-feature");
		if (!secondFeatureId) return;

		const secondFindingRef = "review: execution adapter defect";
		const workerScopeLedger = [
			scopeLedgerEntry("file_target:src/runtime/session.ts", {
				status: "finding_closed",
				findingRefs: [successfulFindingRef],
			}),
			scopeLedgerEntry("file_target:src/adapters/opencode/tools.ts", {
				status: "finding_closed",
				findingRefs: [secondFindingRef],
			}),
		];
		const finalReviewed = recordReviewerDecision(secondStarted.value.session, {
			...approvedFinalDecision(),
			reviewScopeLedger: [
				scopeLedgerEntry("file_target:src/runtime/session.ts", {
					status: "finding_closed",
					findingRefs: [failedFindingRef],
				}),
				scopeLedgerEntry("file_target:src/adapters/opencode/tools.ts", {
					status: "finding_closed",
					findingRefs: [secondFindingRef],
				}),
			],
		});
		expect(finalReviewed.ok).toBe(true);
		if (!finalReviewed.ok) return;

		const finalCompleted = completeRun(
			finalReviewed.value,
			createWorkerResult(secondFeatureId, {
				validationScope: "broad",
				reviewFindingClosures: [
					closedReviewFindingClosure({ findingRef: secondFindingRef }),
				],
				reviewScopeLedger: workerScopeLedger,
				finalReview: createFinalReviewPayload(),
			}),
		);
		expect(finalCompleted.ok).toBe(false);
		if (!finalCompleted.ok) {
			expect(finalCompleted.message).toContain(failedFindingRef);
		}
	});

	test("final completion enforces behavior accounting for risk-triggered final reviews", () => {
		const behaviorChecks = [
			{
				riskClass: "async_event_ordering" as const,
				result: "passed" as const,
				invariant: "Latest panel action wins after deferred navigation.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: [],
				failurePath: "Earlier deferred click overrides later user intent.",
				testEvidenceRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "lifecycle_reentrancy" as const,
				result: "passed" as const,
				invariant: "Scene startup is not double-registered on re-entry.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath: "Panel re-entry registers duplicate scene callbacks.",
				testEvidenceRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "state_commit_rollback" as const,
				result: "passed" as const,
				invariant: "Navigation state commits after scene startup succeeds.",
				entrypointRefs: ["src/shell/sessionPanels.ts"],
				stateOwnerRefs: ["src/game/navigation.ts"],
				lifecycleOwnerRefs: ["src/scenes/PracticeScene.ts"],
				failurePath: "State commits before scene startup throws.",
				testEvidenceRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
			{
				riskClass: "test_evidence_authenticity" as const,
				result: "passed" as const,
				invariant:
					"The test evidence exercises ordering and rollback behavior.",
				entrypointRefs: ["tests/sessionPanelActions.test.ts"],
				stateOwnerRefs: [],
				lifecycleOwnerRefs: [],
				failurePath: "Generic validation would miss stale action ordering.",
				testEvidenceRefs: ["tests/sessionPanelActions.test.ts"],
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			},
		];
		const validationCoverage = [
			{
				command: "bun test tests/sessionPanelActions.test.ts",
				behaviorClasses: [
					"async_event_ordering" as const,
					"lifecycle_reentrancy" as const,
					"state_commit_rollback" as const,
					"test_evidence_authenticity" as const,
				],
				proves: [
					"Panel ordering, lifecycle, rollback, and test evidence coverage.",
				],
				gaps: [],
				testEvidenceRefs: ["tests/sessionPanelActions.test.ts"],
			},
		];
		const riskyReviewFields: Pick<
			NonNullable<WorkerResult["finalReview"]>,
			| "reviewedSurfaces"
			| "evidenceSummary"
			| "validationAssessment"
			| "evidenceRefs"
			| "integrationChecks"
			| "regressionChecks"
			| "remainingGaps"
		> = {
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
				"tests",
			],
			evidenceSummary:
				"Checked panel, navigation, scene, and validation evidence.",
			validationAssessment:
				"Targeted behavior validation was mapped to checked invariants.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
					"src/scenes/PracticeScene.ts",
					"tests/sessionPanelActions.test.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: [
				"Checked panel action, navigation state, and scene lifecycle integration.",
			],
			regressionChecks: ["Checked the behavior regression evidence."],
			remainingGaps: [],
		};
		const riskyReviewScopeLedger: NonNullable<
			WorkerResult["reviewScopeLedger"]
		> = [
			scopeLedgerEntry("file_target:src/runtime/session.ts", {
				validationRefs: ["bun test tests/sessionPanelActions.test.ts"],
			}),
		];

		const rejected = createStartedSession({
			finalFeature: true,
		});
		const missingBehavior = validateSuccessfulCompletion(
			rejected.session,
			createWorkerResult(rejected.featureId, {
				artifactsChanged: riskyReviewFields.evidenceRefs.changedArtifacts.map(
					(path) => ({ path }),
				),
				validationRun: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						status: "passed",
						summary: "Behavior tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: riskyReviewScopeLedger,
				finalReview: createFinalReviewPayload(riskyReviewFields),
			}),
			rejected.featureId,
			rejected.wasFinalFeature,
		);
		expect(missingBehavior.ok).toBe(false);
		if (!missingBehavior.ok) {
			expect(missingBehavior.recovery?.errorCode).toBe(
				"missing_final_reviewer_decision",
			);
		}

		const reviewerCompleteWorkerMissing = createStartedSession({
			finalFeature: true,
			strictReview: true,
			reviewerDecision: createApprovedFinalReviewerDecision({
				...riskyReviewFields,
				reviewScopeLedger: riskyReviewScopeLedger,
				behaviorChecks,
				validationCoverage,
			}),
		});
		const workerMissingBehavior = validateSuccessfulCompletion(
			reviewerCompleteWorkerMissing.session,
			createWorkerResult(reviewerCompleteWorkerMissing.featureId, {
				artifactsChanged: riskyReviewFields.evidenceRefs.changedArtifacts.map(
					(path) => ({ path }),
				),
				validationRun: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						status: "passed",
						summary: "Behavior tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: riskyReviewScopeLedger,
				finalReview: createFinalReviewPayload(riskyReviewFields),
			}),
			reviewerCompleteWorkerMissing.featureId,
			reviewerCompleteWorkerMissing.wasFinalFeature,
		);
		expect(workerMissingBehavior.ok).toBe(false);
		if (!workerMissingBehavior.ok) {
			expect(workerMissingBehavior.recovery?.errorCode).toBe(
				"failing_final_review",
			);
		}

		const reviewerMissingWorkerComplete = createStartedSession({
			finalFeature: true,
		});
		const reviewerMissingBehavior = validateSuccessfulCompletion(
			reviewerMissingWorkerComplete.session,
			createWorkerResult(reviewerMissingWorkerComplete.featureId, {
				artifactsChanged: riskyReviewFields.evidenceRefs.changedArtifacts.map(
					(path) => ({ path }),
				),
				validationRun: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						status: "passed",
						summary: "Behavior tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: riskyReviewScopeLedger,
				finalReview: createFinalReviewPayload({
					...riskyReviewFields,
					behaviorChecks,
					validationCoverage,
				}),
			}),
			reviewerMissingWorkerComplete.featureId,
			reviewerMissingWorkerComplete.wasFinalFeature,
		);
		expect(reviewerMissingBehavior.ok).toBe(false);
		if (!reviewerMissingBehavior.ok) {
			expect(reviewerMissingBehavior.recovery?.errorCode).toBe(
				"missing_final_reviewer_decision",
			);
		}

		const accepted = createStartedSession({
			finalFeature: true,
			strictReview: true,
			reviewerDecision: createApprovedFinalReviewerDecision({
				...riskyReviewFields,
				reviewScopeLedger: riskyReviewScopeLedger,
				behaviorChecks,
				validationCoverage,
			}),
		});
		const completed = validateSuccessfulCompletion(
			accepted.session,
			createWorkerResult(accepted.featureId, {
				artifactsChanged: riskyReviewFields.evidenceRefs.changedArtifacts.map(
					(path) => ({ path }),
				),
				validationRun: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						status: "passed",
						summary: "Behavior tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: riskyReviewScopeLedger,
				finalReview: createFinalReviewPayload({
					...riskyReviewFields,
					behaviorChecks,
					validationCoverage,
				}),
			}),
			accepted.featureId,
			accepted.wasFinalFeature,
		);
		if (!completed.ok) {
			throw new Error(completed.message);
		}
		expect(completed.ok).toBe(true);

		const sharedGap =
			"Concurrent click interleaving remains unproven by providerless tests.";
		const gapBehaviorChecks = behaviorChecks.map((check) => ({
			...check,
			result: "gap_recorded" as const,
			remainingGap: sharedGap,
		}));
		const [firstValidationCoverage] = validationCoverage;
		expect(firstValidationCoverage).toBeDefined();
		if (!firstValidationCoverage) return;
		const gapValidationCoverage = [
			{
				...firstValidationCoverage,
				proves: [],
				gaps: [sharedGap],
			},
		];
		const gapAccepted = createStartedSession({
			finalFeature: true,
			strictReview: true,
			reviewerDecision: createApprovedFinalReviewerDecision({
				...riskyReviewFields,
				reviewScopeLedger: riskyReviewScopeLedger,
				remainingGaps: [sharedGap],
				suggestedValidation: [
					"Add an interleaving test that races two panel actions.",
				],
				behaviorChecks: gapBehaviorChecks,
				validationCoverage: gapValidationCoverage,
			}),
		});
		const gapCompleted = validateSuccessfulCompletion(
			gapAccepted.session,
			createWorkerResult(gapAccepted.featureId, {
				artifactsChanged: riskyReviewFields.evidenceRefs.changedArtifacts.map(
					(path) => ({ path }),
				),
				validationRun: [
					{
						command: "bun test tests/sessionPanelActions.test.ts",
						status: "passed",
						summary: "Behavior tests passed.",
					},
				],
				validationScope: "broad",
				reviewScopeLedger: riskyReviewScopeLedger,
				finalReview: createFinalReviewPayload({
					...riskyReviewFields,
					remainingGaps: [sharedGap],
					suggestedValidation: [
						"Add an interleaving test that races two panel actions.",
					],
					behaviorChecks: gapBehaviorChecks,
					validationCoverage: gapValidationCoverage,
				}),
			}),
			gapAccepted.featureId,
			gapAccepted.wasFinalFeature,
		);
		expect(gapCompleted.ok).toBe(true);
	});

	test.each([
		{
			name: "feature-scope reviewer decision does not satisfy final-feature gate",
			reviewerDecision: {
				...approvedFeatureDecision(),
				summary: "Feature looks good.",
			},
			expectedOk: false,
		},
		{
			name: "final-scope reviewer decision satisfies final-feature gate",
			reviewerDecision: {
				...approvedFinalDecision(),
				summary: "Final review looks good.",
			},
			expectedOk: true,
		},
	])("$name", ({ reviewerDecision, expectedOk }) => {
		const { session, featureId, wasFinalFeature } = createStartedSession({
			finalFeature: true,
			reviewerDecision,
		});
		const result = validateSuccessfulCompletion(
			session,
			createWorkerResult(featureId, {
				validationScope: "broad",
				finalReview: createFinalReviewPayload({
					summary: "Repo-wide validation is clean.",
				}),
			}),
			featureId,
			wasFinalFeature,
		);

		expect(result.ok).toBe(expectedOk);
		if (!expectedOk) {
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.recovery?.errorCode).toBe(
					"missing_final_reviewer_decision",
				);
			}
		}
	});
});
