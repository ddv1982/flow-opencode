import { expect, test } from "bun:test";
import patch from "../evals/qualification/patches/8.3.1.json" with {
	type: "json",
};
import {
	assertReviewerPickerScope,
	REVIEWER_PICKER_COMMIT,
	REVIEWER_PICKER_FILES,
	ReviewerPickerReleaseSchema,
} from "../scripts/feature-release.js";
import { verifyReleaseEvidence } from "../scripts/release.js";

function fixture() {
	const entries = Object.fromEntries(
		REVIEWER_PICKER_FILES.map((path) => [
			path,
			`100644 blob ${"a".repeat(40)}\t${path}\n`,
		]),
	);
	return {
		changedPaths: [
			...REVIEWER_PICKER_FILES,
			"scripts/feature-release.ts",
			"docs/release-qualification.md",
		],
		guidance: patch.guidance as [
			{ path: "skills/flow-run/SKILL.md"; sha256: string; rationale: string },
		],
		baselinePackage: {
			version: "8.3.0",
			name: "flow",
			dependencies: { test: "1" },
		},
		package: { version: "8.4.0", name: "flow", dependencies: { test: "1" } },
		reviewedEntries: entries,
		candidateEntries: { ...entries },
	};
}

test("accepts the frozen picker scope but not arbitrary runtime changes", () => {
	const f = fixture();
	expect(() => assertReviewerPickerScope(f)).not.toThrow();
	for (const path of [
		"src/domain/session.ts",
		"src/infrastructure/persistence.ts",
		"skills/flow-review/SKILL.md",
		"bun.lock",
		"tsconfig.json",
	]) {
		expect(() =>
			assertReviewerPickerScope({
				...f,
				changedPaths: [...f.changedPaths, path],
			}),
		).toThrow("Full qualification");
	}
});

test("pins every reviewed file's content and mode including packaging and prior guidance", () => {
	for (const path of REVIEWER_PICKER_FILES) {
		const f = fixture();
		for (const replacement of [
			"",
			`100755 blob ${"a".repeat(40)}\t${path}\n`,
			`100644 blob ${"b".repeat(40)}\t${path}\n`,
		]) {
			expect(() =>
				assertReviewerPickerScope({
					...f,
					candidateEntries: { ...f.candidateEntries, [path]: replacement },
				}),
			).toThrow("reviewed picker code");
		}
	}
});

test("does not allow dependency changes or reuse for another release", () => {
	const f = fixture();
	expect(() =>
		assertReviewerPickerScope({
			...f,
			package: { ...f.package, dependencies: { test: "2" } },
		}),
	).toThrow("dependencies");
	for (const version of ["8.4.1", "8.5.0", "9.0.0"])
		expect(() =>
			assertReviewerPickerScope({ ...f, package: { ...f.package, version } }),
		).toThrow("only covers 8.4.0");
	expect(() =>
		assertReviewerPickerScope({
			...f,
			baselinePackage: { ...f.baselinePackage, version: "8.3.1" },
		}),
	).toThrow("fully qualified");
});

test("record cannot choose another feature or reviewed commit", () => {
	const record = {
		...patch,
		kind: "reviewed-offline-feature",
		version: "8.4.0",
		feature: "reviewer-picker-v1",
		reviewedCommit: REVIEWER_PICKER_COMMIT,
	};
	expect(ReviewerPickerReleaseSchema.safeParse(record).success).toBe(true);
	for (const changes of [
		{ feature: "anything" },
		{ reviewedCommit: "a".repeat(40) },
		{ version: "8.4.1" },
	])
		expect(
			ReviewerPickerReleaseSchema.safeParse({ ...record, ...changes }).success,
		).toBe(false);
});

test("publication refuses conflicting qualification paths before accessing evidence", async () => {
	await expect(
		verifyReleaseEvidence({
			version: "8.4.0",
			canaryPath: "unused",
			patch: "unused",
			feature: "unused",
			expectedArtifact: patch.baseline.artifact,
		}),
	).rejects.toThrow("Conflicting qualification");
});
