// Must-keep UX copy assertions: this suite protects operator-facing resolutionHint phrasing.
// Semantic next-action binding is additionally covered by runtime semantic invariants and may migrate there without removing this UX-copy guard.

import { describe, expect, test } from "bun:test";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "../src/runtime/transitions/recovery";

const cases: Array<[CompletionRecoveryKind, boolean, string]> = [
	[
		"missing_validation",
		false,
		"Run the required validation for the current Flow feature and retry completion with recorded validation evidence.",
	],
	[
		"failing_validation",
		false,
		"Fix the failing validation, rerun the relevant checks, and rerun the current Flow feature.",
	],
	[
		"missing_reviewer_decision",
		false,
		"Record a feature reviewer approval, then rerun the current Flow feature to persist completion.",
	],
	[
		"missing_reviewer_decision",
		true,
		"The active feature is on the session's final completion path. Record a final reviewer approval, then rerun the current Flow feature to persist final completion.",
	],
	[
		"missing_validation_scope",
		false,
		"Run targeted validation for the active feature and retry with validationScope set to 'targeted'.",
	],
	[
		"missing_validation_scope",
		true,
		"The active feature is on the session's final completion path. Run broad repo validation and retry with validationScope set to 'broad'.",
	],
	[
		"missing_final_review",
		true,
		"The active feature is on the session's final completion path. Run the final cross-feature review, include a passing finalReview in the worker result, and rerun the current Flow feature.",
	],
	[
		"failing_feature_review",
		false,
		"Fix the feature review findings, rerun targeted validation, and rerun the current Flow feature.",
	],
	[
		"failing_final_review",
		true,
		"Fix the final review findings, rerun broad validation, and rerun the current Flow feature with a passing finalReview.",
	],
];

describe("recovery resolution hint parity", () => {
	for (const [kind, wasFinal, expected] of cases) {
		test(`${kind} (final=${wasFinal}) has baseline resolutionHint`, () => {
			expect(
				buildCompletionRecovery("feat-1", wasFinal, kind).resolutionHint,
			).toBe(expected);
		});
	}
});
