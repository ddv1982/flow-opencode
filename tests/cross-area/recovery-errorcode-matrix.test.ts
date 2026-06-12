import { describe, expect, test } from "bun:test";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "../../src/runtime/transitions/recovery";

describe("cross-area recovery errorCode matrix", () => {
	test("assigns a stable errorCode to every completion recovery kind", () => {
		const kinds: CompletionRecoveryKind[] = [
			"missing_validation",
			"failing_validation",
			"missing_reviewer_decision",
			"missing_validation_scope",
			"failing_feature_review",
			"missing_final_review",
			"failing_final_review",
		];
		const expectations = new Map<
			`${CompletionRecoveryKind}:${boolean}`,
			string
		>([
			["missing_validation:false", "missing_validation_evidence"],
			["missing_validation:true", "missing_validation_evidence"],
			["failing_validation:false", "failing_validation"],
			["failing_validation:true", "failing_validation"],
			["missing_reviewer_decision:false", "missing_feature_reviewer_decision"],
			["missing_reviewer_decision:true", "missing_final_reviewer_decision"],
			["missing_validation_scope:false", "missing_targeted_validation"],
			["missing_validation_scope:true", "missing_broad_validation"],
			["failing_feature_review:false", "failing_feature_review"],
			["failing_feature_review:true", "failing_feature_review"],
			["missing_final_review:false", "missing_final_review_payload"],
			["missing_final_review:true", "missing_final_review_payload"],
			["failing_final_review:false", "failing_final_review"],
			["failing_final_review:true", "failing_final_review"],
		]);

		for (const wasFinalFeature of [false, true] as const) {
			for (const kind of kinds) {
				const recovery = buildCompletionRecovery(
					"setup-runtime",
					wasFinalFeature,
					kind,
				);
				const expected = expectations.get(`${kind}:${wasFinalFeature}`);
				if (!expected) {
					throw new Error(`Missing expected errorCode for ${kind}`);
				}
				expect(recovery.errorCode).toBe(expected);
			}
		}
	});
});
