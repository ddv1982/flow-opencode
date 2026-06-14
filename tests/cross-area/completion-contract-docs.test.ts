import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildCompletionRecovery,
	type CompletionRecoveryKind,
} from "../../src/runtime/transitions/recovery";

const repoRoot = join(import.meta.dir, "..", "..");

function readRepoFile(path: string): string {
	return readFileSync(join(repoRoot, path), "utf8");
}

function expectAllTerms(source: string, terms: readonly string[]): void {
	for (const term of terms) {
		expect(source).toContain(term);
	}
}

const completionRecoveryKinds = {
	missing_validation: true,
	failing_validation: true,
	missing_reviewer_decision: true,
	missing_validation_scope: true,
	failing_feature_review: true,
	missing_final_review: true,
	failing_final_review: true,
} satisfies Record<CompletionRecoveryKind, true>;

function completionRecoveryErrorCodes(): string[] {
	const errorCodes = new Set<string>();
	for (const kind of Object.keys(
		completionRecoveryKinds,
	) as CompletionRecoveryKind[]) {
		for (const wasFinalFeature of [false, true] as const) {
			errorCodes.add(
				buildCompletionRecovery("docs-contract", wasFinalFeature, kind)
					.errorCode,
			);
		}
	}
	return [...errorCodes].sort();
}

describe("completion contract documentation", () => {
	test("current-facing docs cover the runtime-owned completion gates", () => {
		const requiredTerms = [
			"validation evidence",
			"validationScope",
			"featureReview",
			"finalReview",
			"strict",
			"reviewer decision",
			"unfinished",
			"target work",
		] as const;

		for (const path of [
			"README.md",
			"docs/maintainer-contract.md",
			"skills/flow/SKILL.md",
		]) {
			expectAllTerms(readRepoFile(path), requiredTerms);
		}
	});

	test("skill references keep recovery and evidence wording aligned", () => {
		expectAllTerms(
			readRepoFile("skills/flow-run/references/validation-rubric.md"),
			["validationScope", "featureReview", "finalReview", "runtime-required"],
		);
		expectAllTerms(
			readRepoFile("skills/flow/references/recovery-playbook.md"),
			completionRecoveryErrorCodes(),
		);
	});

	test("current-facing docs preserve derived signal authority levels", () => {
		expectAllTerms(readRepoFile("README.md"), [
			"Hard gate",
			"Workflow blocker",
			"Advisory diagnostic",
			"blocked_by_context",
			"contextQuality",
			"contextTraceability",
		]);
		expectAllTerms(readRepoFile("docs/maintainer-contract.md"), [
			"Derived Signal Authority",
			"Hard gate",
			"Workflow blocker",
			"Advisory diagnostic",
			"do not persist a separate readiness ledger",
		]);
		for (const path of [
			"skills/flow-plan/SKILL.md",
			"skills/flow-run/SKILL.md",
			"skills/flow-review/SKILL.md",
		]) {
			expectAllTerms(readRepoFile(path), [
				"workflowReadiness.state",
				"blocked_by_",
				"contextQuality",
			]);
		}
	});
});
