import { describe, expect, test } from "bun:test";
import { createSession } from "../src/runtime/session";
import {
	applyPlan,
	approvePlan,
	recordReviewerDecision,
	startRun,
} from "../src/runtime/transitions";
import { samplePlan } from "./runtime-test-helpers";

function startedSession(options?: {
	finalReviewPolicy?: "broad" | "detailed";
	strictReview?: boolean;
}) {
	const applied = applyPlan(
		createSession("Build a workflow plugin"),
		options
			? {
					...samplePlan(),
					deliveryPolicy: {
						...(options.finalReviewPolicy
							? { finalReviewPolicy: options.finalReviewPolicy }
							: {}),
						...(options.strictReview !== undefined
							? { strictReview: options.strictReview }
							: {}),
					},
				}
			: samplePlan(),
	);
	expect(applied.ok).toBe(true);
	if (!applied.ok) throw new Error("applyPlan failed");

	const approved = approvePlan(applied.value);
	expect(approved.ok).toBe(true);
	if (!approved.ok) throw new Error("approvePlan failed");

	const started = startRun(approved.value);
	expect(started.ok).toBe(true);
	if (!started.ok) throw new Error("startRun failed");

	return started.value.session;
}

describe("recordReviewerDecision scope validation", () => {
	test("rejects final scope when featureId is provided", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			featureId: "setup-runtime",
			reviewDepth: "detailed",
			reviewedSurfaces: ["shared_surfaces", "validation_evidence"],
			evidenceSummary:
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/setup-runtime.ts"],
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
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("featureId");
		expect(result.message).toContain("must not include");
	});

	test.each([
		undefined,
		"",
		"   ",
	])("requires featureId for feature scope (%p)", (featureId) => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "feature",
			featureId,
			status: "approved",
			summary: "Looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("featureId");
	});

	test("infers execution_gate reviewPurpose for feature scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "feature",
			featureId: "setup-runtime",
			status: "approved",
			summary: "Looks good.",
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.execution.lastReviewerDecision?.reviewPurpose).toBe(
			"execution_gate",
		);
	});

	test("identical reviewer decisions are no-ops but different decisions can re-record", () => {
		const decision = {
			scope: "feature" as const,
			featureId: "setup-runtime",
			status: "approved" as const,
			summary: "Looks good.",
		};
		const first = recordReviewerDecision(startedSession(), decision);
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const duplicate = recordReviewerDecision(first.value, decision);
		expect(duplicate.ok).toBe(true);
		if (!duplicate.ok) return;
		expect(duplicate.value).toBe(first.value);
		expect(duplicate.value.execution.lastReviewerDecision).toBe(
			first.value.execution.lastReviewerDecision,
		);

		const changed = recordReviewerDecision(duplicate.value, {
			...decision,
			status: "needs_fix" as const,
			summary: "Needs one fix.",
			blockingFindings: [{ summary: "Validation evidence is incomplete." }],
		});
		expect(changed.ok).toBe(true);
		if (!changed.ok) return;
		expect(changed.value).not.toBe(duplicate.value);
		expect(changed.value.execution.lastReviewerDecision?.status).toBe(
			"needs_fix",
		);
		expect(changed.value.execution.lastSummary).toBe("Needs one fix.");
	});

	test("rejects mismatched reviewPurpose for final scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			reviewPurpose: "execution_gate",
			reviewDepth: "detailed",
			reviewedSurfaces: ["shared_surfaces", "validation_evidence"],
			evidenceSummary:
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/setup-runtime.ts"],
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
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("reviewPurpose");
	});

	test("requires reviewDepth for final scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			status: "approved",
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("reviewDepth");
	});

	test("rejects final review depth that does not match delivery policy", () => {
		const result = recordReviewerDecision(
			startedSession({ finalReviewPolicy: "broad" }),
			{
				scope: "final",
				reviewDepth: "detailed",
				reviewedSurfaces: ["shared_surfaces", "validation_evidence"],
				evidenceSummary:
					"Checked final cross-feature integration and validation evidence.",
				validationAssessment:
					"Validation coverage and cross-feature interactions were reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/setup-runtime.ts"],
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
				summary: "Final review looks good.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("deliveryPolicy.finalReviewPolicy");
	});

	test("rejects unknown reviewed surfaces for final scope", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			reviewDepth: "detailed",
			reviewedSurfaces: ["validation_evidence", "unknown_surface"],
			evidenceSummary:
				"Checked final cross-feature integration and validation evidence.",
			validationAssessment:
				"Validation coverage and cross-feature interactions were reviewed.",
			evidenceRefs: {
				changedArtifacts: ["src/setup-runtime.ts"],
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
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("known reviewedSurfaces");
	});

	test("ordinary implementation final approval does not require behavior accounting ledgers", () => {
		const result = recordReviewerDecision(startedSession(), {
			scope: "final",
			reviewDepth: "detailed",
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary: "Reviewed shell/game source changes and validation.",
			validationAssessment: "Targeted behavior validation was reviewed.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: ["Checked shell action and game navigation handoff."],
			regressionChecks: ["Checked behavior validation evidence."],
			remainingGaps: [],
			status: "approved",
			summary: "Final review looks good.",
		});

		expect(result.ok).toBe(true);
	});

	test("reordered final review arrays are changed because idempotency is exact normalized payload equality", () => {
		const decision = {
			scope: "final" as const,
			reviewDepth: "detailed" as const,
			reviewedSurfaces: [
				"changed_files",
				"shared_surfaces",
				"validation_evidence",
			],
			evidenceSummary: "Reviewed shell/game source changes and validation.",
			validationAssessment: "Targeted behavior validation was reviewed.",
			evidenceRefs: {
				changedArtifacts: [
					"src/shell/sessionPanels.ts",
					"src/game/navigation.ts",
				],
				validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
			},
			integrationChecks: ["Checked shell action and game navigation handoff."],
			regressionChecks: ["Checked behavior validation evidence."],
			remainingGaps: [],
			status: "approved" as const,
			summary: "Final review looks good.",
		};
		const first = recordReviewerDecision(startedSession(), decision);
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const reordered = recordReviewerDecision(first.value, {
			...decision,
			reviewedSurfaces: [
				"validation_evidence",
				"shared_surfaces",
				"changed_files",
			],
		});

		expect(reordered.ok).toBe(true);
		if (!reordered.ok) return;
		expect(reordered.value).not.toBe(first.value);
		const persistedDecision = reordered.value.execution.lastReviewerDecision;
		expect(persistedDecision?.scope).toBe("final");
		if (persistedDecision?.scope !== "final") return;
		expect(persistedDecision.reviewedSurfaces).toEqual([
			"validation_evidence",
			"shared_surfaces",
			"changed_files",
		]);
	});

	test("explicit strictReview final approval requires review scope ledger accounting", () => {
		const result = recordReviewerDecision(
			startedSession({ strictReview: true }),
			{
				scope: "final",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Reviewed runtime source changes and validation.",
				validationAssessment: "Runtime validation was reviewed.",
				evidenceRefs: {
					changedArtifacts: ["src/runtime/session.ts"],
					validationCommands: ["bun test"],
				},
				integrationChecks: ["Checked runtime integration."],
				regressionChecks: ["Checked runtime regression evidence."],
				remainingGaps: [],
				status: "approved",
				summary: "Final review looks good.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("reviewScopeLedger");
	});

	test("explicit strictReview final approval retains behavior accounting requirements", () => {
		const result = recordReviewerDecision(
			startedSession({ strictReview: true }),
			{
				scope: "final",
				reviewDepth: "detailed",
				reviewedSurfaces: [
					"changed_files",
					"shared_surfaces",
					"validation_evidence",
				],
				evidenceSummary: "Reviewed shell/game source changes and validation.",
				validationAssessment: "Targeted behavior validation was reviewed.",
				evidenceRefs: {
					changedArtifacts: [
						"src/shell/sessionPanels.ts",
						"src/game/navigation.ts",
					],
					validationCommands: ["bun test tests/sessionPanelActions.test.ts"],
				},
				integrationChecks: [
					"Checked shell action and game navigation handoff.",
				],
				regressionChecks: ["Checked behavior validation evidence."],
				remainingGaps: [],
				status: "approved",
				summary: "Final review looks good.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toContain("finalReviewCoverage");
		expect(result.message).toContain(
			"must account for required behavior risk classes",
		);
	});
});
