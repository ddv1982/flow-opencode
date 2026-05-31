import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEMANTIC_COMPLETION_GATE_ORDER } from "../../src/runtime/domain";
import {
	COMPLETION_GATE_AUDIT_GUIDANCE,
	COMPLETION_GATE_DOC_MARKDOWN_TABLE,
	COMPLETION_GATE_DOC_ROWS,
	COMPLETION_GATE_PROMPT_GUIDANCE,
} from "../../src/runtime/transitions/completion-gate-projections.generated";
import {
	COMPLETION_GATE_DESCRIPTORS,
	COMPLETION_GATE_IDS,
	COMPLETION_GATE_ORDER,
	COMPLETION_GATES,
	CONDITIONAL_COMPLETION_GATE_ORDER,
	completionGateOrderFor,
	completionRecoveryKindOrderFor,
	REVIEW_AND_FIX_COMPLETION_GATE_ORDER,
	REVIEW_COMPLETION_GATE_ORDER,
	requiredArtifactForCompletionGate,
	STRICT_REVIEW_COMPLETION_GATE_ORDER,
} from "../../src/runtime/transitions/completion-gates";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "../../src/runtime/transitions/recovery";

const ALL_COMPLETION_RECOVERY_KINDS: readonly CompletionRecoveryKind[] = [
	"missing_validation",
	"failing_validation",
	"missing_reviewer_decision",
	"missing_validation_scope",
	"missing_review_closure",
	"missing_review_scope_accounting",
	"failing_feature_review",
	"missing_final_review",
	"failing_final_review",
];

const repoRoot = join(import.meta.dir, "..", "..");

function rowsFor(
	mode: "default" | "strict_review" | "review" | "review_and_fix",
	path: "feature" | "final",
) {
	return COMPLETION_GATE_DOC_ROWS.filter(
		(row) => row.mode === mode && row.path === path,
	);
}

describe("completion gate descriptors", () => {
	test("registers every recovery-backed completion gate once", () => {
		expect(COMPLETION_GATE_IDS).toEqual([
			"validation_evidence",
			"validation_passed",
			"review_finding_closure",
			"review_scope_accounting",
			"reviewer_decision",
			"validation_scope",
			"feature_review",
			"final_review_payload",
			"final_review_passed",
		]);

		expect(COMPLETION_GATES.map((gate) => gate.id)).toEqual(
			COMPLETION_GATE_IDS,
		);
		expect(COMPLETION_GATES.map((gate) => gate.recoveryKind).sort()).toEqual(
			[...ALL_COMPLETION_RECOVERY_KINDS].sort(),
		);
	});

	test("drives semantic gate order without replacing runtime enforcement", () => {
		expect(COMPLETION_GATE_ORDER.feature).toEqual([
			"validation_evidence",
			"validation_passed",
			"validation_scope",
			"feature_review",
			"final_review_passed",
		]);
		expect(COMPLETION_GATE_ORDER.final).toEqual([
			"validation_evidence",
			"validation_passed",
			"validation_scope",
			"feature_review",
			"final_review_passed",
			"final_review_payload",
		]);
		expect(STRICT_REVIEW_COMPLETION_GATE_ORDER).toEqual(
			REVIEW_COMPLETION_GATE_ORDER,
		);
		expect(REVIEW_COMPLETION_GATE_ORDER.feature).toEqual([
			"validation_evidence",
			"validation_passed",
			"review_scope_accounting",
			"reviewer_decision",
			"validation_scope",
			"feature_review",
			"final_review_passed",
		]);
		expect(REVIEW_COMPLETION_GATE_ORDER.final).toEqual([
			"validation_evidence",
			"validation_passed",
			"review_scope_accounting",
			"validation_scope",
			"feature_review",
			"final_review_passed",
			"final_review_payload",
			"reviewer_decision",
		]);
		expect(REVIEW_AND_FIX_COMPLETION_GATE_ORDER.feature).toEqual([
			"validation_evidence",
			"validation_passed",
			"review_finding_closure",
			"review_scope_accounting",
			"reviewer_decision",
			"validation_scope",
			"feature_review",
			"final_review_passed",
		]);
		expect(REVIEW_AND_FIX_COMPLETION_GATE_ORDER.final).toEqual([
			"validation_evidence",
			"validation_passed",
			"review_finding_closure",
			"review_scope_accounting",
			"validation_scope",
			"feature_review",
			"final_review_passed",
			"final_review_payload",
			"reviewer_decision",
		]);
		expect(CONDITIONAL_COMPLETION_GATE_ORDER.strictReview).toEqual(
			STRICT_REVIEW_COMPLETION_GATE_ORDER,
		);
		expect(CONDITIONAL_COMPLETION_GATE_ORDER.review).toEqual(
			REVIEW_COMPLETION_GATE_ORDER,
		);
		expect(CONDITIONAL_COMPLETION_GATE_ORDER.reviewAndFix).toEqual(
			REVIEW_AND_FIX_COMPLETION_GATE_ORDER,
		);
		expect(completionGateOrderFor("feature", { strictReview: true })).toEqual(
			STRICT_REVIEW_COMPLETION_GATE_ORDER.feature,
		);
		expect(completionGateOrderFor("feature", { review: true })).toEqual(
			REVIEW_COMPLETION_GATE_ORDER.feature,
		);
		expect(completionGateOrderFor("feature", { reviewAndFix: true })).toEqual(
			REVIEW_AND_FIX_COMPLETION_GATE_ORDER.feature,
		);
		expect(
			completionRecoveryKindOrderFor("final", { reviewAndFix: true }),
		).toEqual([
			"missing_validation",
			"failing_validation",
			"missing_review_closure",
			"missing_review_scope_accounting",
			"missing_validation_scope",
			"failing_feature_review",
			"failing_final_review",
			"missing_final_review",
			"missing_reviewer_decision",
		]);
		expect(SEMANTIC_COMPLETION_GATE_ORDER.feature).toEqual(
			completionRecoveryKindOrderFor("feature"),
		);
		expect(SEMANTIC_COMPLETION_GATE_ORDER.final).toEqual(
			completionRecoveryKindOrderFor("final"),
		);
	});

	test("keeps descriptor recovery artifacts aligned with runtime recovery metadata", () => {
		for (const gate of COMPLETION_GATES) {
			for (const path of ["feature", "final"] as const) {
				if (!gate.appliesTo.includes(path)) {
					continue;
				}

				const recovery = buildCompletionRecovery(
					"setup-runtime",
					path === "final",
					gate.recoveryKind,
				);
				const actualArtifact: string | undefined = recovery.requiredArtifact;
				expect(actualArtifact).toBe(
					requiredArtifactForCompletionGate(gate, path),
				);
			}
		}

		const reviewAndFixGate = COMPLETION_GATE_DESCRIPTORS.review_finding_closure;
		expect(
			buildCompletionRecovery(
				"setup-runtime",
				false,
				reviewAndFixGate.recoveryKind,
			).requiredArtifact,
		).toBe("review_finding_closure_ledger");
	});

	test("keeps renderable gate metadata non-empty for prompt/docs projection", () => {
		for (const gate of COMPLETION_GATES) {
			expect(gate.operatorHint.length).toBeGreaterThan(20);
			expect(gate.renderableText.length).toBeGreaterThan(20);
			expect(gate.invariantIds.length).toBeGreaterThan(0);
		}
	});

	test("projects prompt/docs/audit guidance from descriptor-owned orders", () => {
		expect(rowsFor("default", "feature").map((row) => row.gateId)).toEqual([
			...COMPLETION_GATE_ORDER.feature,
		]);
		expect(rowsFor("default", "final").map((row) => row.gateId)).toEqual([
			...COMPLETION_GATE_ORDER.final,
		]);
		expect(
			rowsFor("strict_review", "feature").map((row) => row.gateId),
		).toEqual([...STRICT_REVIEW_COMPLETION_GATE_ORDER.feature]);
		expect(rowsFor("strict_review", "final").map((row) => row.gateId)).toEqual([
			...STRICT_REVIEW_COMPLETION_GATE_ORDER.final,
		]);
		expect(rowsFor("review", "feature").map((row) => row.gateId)).toEqual([
			...REVIEW_COMPLETION_GATE_ORDER.feature,
		]);
		expect(rowsFor("review", "final").map((row) => row.gateId)).toEqual([
			...REVIEW_COMPLETION_GATE_ORDER.final,
		]);
		expect(
			rowsFor("review_and_fix", "feature").map((row) => row.gateId),
		).toEqual([...REVIEW_AND_FIX_COMPLETION_GATE_ORDER.feature]);
		expect(rowsFor("review_and_fix", "final").map((row) => row.gateId)).toEqual(
			[...REVIEW_AND_FIX_COMPLETION_GATE_ORDER.final],
		);
		expect(COMPLETION_GATE_DOC_ROWS.length).toBe(
			COMPLETION_GATE_ORDER.feature.length +
				COMPLETION_GATE_ORDER.final.length +
				STRICT_REVIEW_COMPLETION_GATE_ORDER.feature.length +
				STRICT_REVIEW_COMPLETION_GATE_ORDER.final.length +
				REVIEW_COMPLETION_GATE_ORDER.feature.length +
				REVIEW_COMPLETION_GATE_ORDER.final.length +
				REVIEW_AND_FIX_COMPLETION_GATE_ORDER.feature.length +
				REVIEW_AND_FIX_COMPLETION_GATE_ORDER.final.length,
		);
		expect(COMPLETION_GATE_DOC_ROWS[0]).toMatchObject({
			mode: "default",
			path: "feature",
			step: 1,
			gateId: "validation_evidence",
			recoveryKind: "missing_validation",
		});
		expect(COMPLETION_GATE_PROMPT_GUIDANCE).toContain(
			"Feature completion gates (default):",
		);
		expect(COMPLETION_GATE_PROMPT_GUIDANCE).toContain(
			"Final completion gates (strict_review):",
		);
		expect(COMPLETION_GATE_PROMPT_GUIDANCE).toContain(
			"Final completion gates (review):",
		);
		expect(COMPLETION_GATE_PROMPT_GUIDANCE).toContain(
			"Final completion gates (review_and_fix):",
		);
		expect(COMPLETION_GATE_AUDIT_GUIDANCE).toContain(
			"Audit parity lens — final path (default):",
		);
		expect(COMPLETION_GATE_AUDIT_GUIDANCE).toContain(
			"Audit parity lens — final path (strict_review):",
		);
		expect(COMPLETION_GATE_AUDIT_GUIDANCE).toContain(
			"Audit parity lens — feature path (review_and_fix):",
		);
		expect(COMPLETION_GATE_AUDIT_GUIDANCE).toContain("review_finding_closure");
	});

	test("keeps architecture docs completion-gate table descriptor-verified", () => {
		const architectureDoc = readFileSync(
			join(repoRoot, "docs/architecture/role-protocol-projections.md"),
			"utf8",
		);
		const match = architectureDoc.match(
			/<!-- completion-gate-doc-table:start -->\n([\s\S]*?)\n<!-- completion-gate-doc-table:end -->/,
		);
		expect(match).not.toBeNull();
		expect(match?.[1]).toBe(COMPLETION_GATE_DOC_MARKDOWN_TABLE);
	});
});
