import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { semanticInvariantById } from "../../src/runtime/domain";

const repoRoot = join(import.meta.dir, "..", "..");

function readRepoFile(path: string): string {
	return readFileSync(join(repoRoot, path), "utf8");
}

function expectAllTerms(source: string, terms: readonly string[]): void {
	for (const term of terms) {
		expect(source).toContain(term);
	}
}

describe("completion contract documentation", () => {
	test("current-facing docs cover the runtime-owned completion gates", () => {
		const completionGate = semanticInvariantById(
			"completion.gates.required_order",
		);
		expect(completionGate?.semanticClaim).toContain("validation evidence");
		expect(completionGate?.semanticClaim).toContain("featureReview");
		expect(completionGate?.semanticClaim).toContain("finalReview");

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
			[
				"missing_targeted_validation",
				"missing_broad_validation",
				"failing_feature_review",
				"failing_final_review",
				"missing_final_review_payload",
			],
		);
	});
});
