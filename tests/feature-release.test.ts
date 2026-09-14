import { expect, test } from "bun:test";
import patch from "../evals/qualification/patches/8.3.1.json" with {
	type: "json",
};
import {
	assertOfflineFeatureScope,
	OFFLINE_FEATURE_BASELINE,
	OFFLINE_FEATURES,
	type OfflineFeature,
	offlineFeature,
	offlineFeatureSchema,
} from "../scripts/feature-release.js";
import { verifyReleaseEvidence } from "../scripts/release.js";

function fixture(entry: OfflineFeature) {
	const entries = Object.fromEntries(
		entry.files.map((path) => [
			path,
			`100644 blob ${"a".repeat(40)}\t${path}\n`,
		]),
	);
	return {
		entry,
		changedPaths: [
			...entry.files,
			"scripts/feature-release.ts",
			"docs/release-qualification.md",
		],
		guidance: entry.guidance.map((path) => ({
			path,
			sha256: patch.guidance[0]?.sha256 ?? `sha256:${"0".repeat(64)}`,
			rationale: "Reviewed guidance clarification.",
		})),
		baselinePackage: {
			version: OFFLINE_FEATURE_BASELINE,
			name: "flow",
			dependencies: { test: "1" },
		},
		package: {
			version: entry.version,
			name: "flow",
			dependencies: { test: "1" },
		},
		reviewedEntries: entries,
		candidateEntries: { ...entries },
	};
}

test("every authorized feature measures against the one fully qualified baseline", () => {
	expect(OFFLINE_FEATURE_BASELINE).toBe("8.3.0");
	expect(OFFLINE_FEATURES.length).toBeGreaterThan(0);
	// An offline release must never become the baseline for the next one.
	expect(
		OFFLINE_FEATURES.some(
			(entry) => entry.version === OFFLINE_FEATURE_BASELINE,
		),
	).toBe(false);
	// One entry per version and per feature, so selection cannot be ambiguous.
	expect(new Set(OFFLINE_FEATURES.map((entry) => entry.version)).size).toBe(
		OFFLINE_FEATURES.length,
	);
	expect(new Set(OFFLINE_FEATURES.map((entry) => entry.feature)).size).toBe(
		OFFLINE_FEATURES.length,
	);
	for (const entry of OFFLINE_FEATURES) {
		expect(entry.guidance.every((path) => entry.files.includes(path))).toBe(
			true,
		);
		expect(new Set(entry.guidance).size).toBe(entry.guidance.length);
		expect(new Set(entry.files).size).toBe(entry.files.length);
	}
});

for (const entry of OFFLINE_FEATURES) {
	test(`accepts the frozen ${entry.feature} scope but not arbitrary runtime changes`, () => {
		const f = fixture(entry);
		expect(() => assertOfflineFeatureScope(f)).not.toThrow();
		for (const path of [
			"src/domain/session.ts",
			"src/infrastructure/persistence.ts",
			"skills/flow-review/SKILL.md",
			"bun.lock",
			"tsconfig.json",
		]) {
			expect(() =>
				assertOfflineFeatureScope({
					...f,
					changedPaths: [...f.changedPaths, path],
				}),
			).toThrow("Full qualification");
		}
	});

	test(`${entry.feature} guidance must name each changed guide exactly once`, () => {
		const f = fixture(entry);
		const first = entry.guidance[0];
		if (!first) throw new Error("Fixture needs a guidance path.");
		const duplicated = f.guidance.map((approval) => ({
			...approval,
			path: first,
		}));
		// Duplicates are the only bypass attempt that clears the schema.
		if (entry.guidance.length > 1)
			expect(() =>
				assertOfflineFeatureScope({ ...f, guidance: duplicated }),
			).toThrow("Duplicate guidance approval");
		expect(() => assertOfflineFeatureScope({ ...f, guidance: [] })).toThrow(
			"Full qualification",
		);
		for (const omitted of entry.guidance)
			expect(() =>
				assertOfflineFeatureScope({
					...f,
					guidance: f.guidance.filter((approval) => approval.path !== omitted),
				}),
			).toThrow("Full qualification");
	});

	test(`pins every reviewed ${entry.feature} file's content and mode`, () => {
		for (const path of entry.files) {
			const f = fixture(entry);
			for (const replacement of [
				"",
				`100755 blob ${"a".repeat(40)}\t${path}\n`,
				`100644 blob ${"b".repeat(40)}\t${path}\n`,
			]) {
				expect(() =>
					assertOfflineFeatureScope({
						...f,
						candidateEntries: { ...f.candidateEntries, [path]: replacement },
					}),
				).toThrow("reviewed feature code");
			}
		}
	});

	test(`${entry.feature} allows no dependency change or reuse for another release`, () => {
		const f = fixture(entry);
		expect(() =>
			assertOfflineFeatureScope({
				...f,
				package: { ...f.package, dependencies: { test: "2" } },
			}),
		).toThrow("dependencies");
		for (const version of ["8.4.1", "9.0.0", "8.6.0"])
			expect(() =>
				assertOfflineFeatureScope({ ...f, package: { ...f.package, version } }),
			).toThrow(`only covers ${entry.version}`);
		for (const version of ["8.3.1", "8.4.0", "8.5.0"].filter(
			(candidate) => candidate !== OFFLINE_FEATURE_BASELINE,
		))
			expect(() =>
				assertOfflineFeatureScope({
					...f,
					baselinePackage: { ...f.baselinePackage, version },
				}),
			).toThrow("fully qualified");
	});

	test(`${entry.feature} record cannot choose another feature or reviewed commit`, () => {
		const record = {
			...patch,
			kind: "reviewed-offline-feature",
			version: entry.version,
			feature: entry.feature,
			reviewedCommit: entry.reviewedCommit,
		};
		const schema = offlineFeatureSchema(entry);
		expect(schema.safeParse(record).success).toBe(true);
		for (const changes of [
			{ feature: "anything" },
			{ reviewedCommit: "a".repeat(40) },
			{ version: "8.9.9" },
			{
				guidance: [
					{ ...patch.guidance[0], path: "skills/flow-review/SKILL.md" },
				],
			},
		])
			expect(schema.safeParse({ ...record, ...changes }).success).toBe(false);
	});
}

test("only an authorized version and feature pair selects an exception", () => {
	for (const entry of OFFLINE_FEATURES)
		expect(
			offlineFeature({ version: entry.version, feature: entry.feature }),
		).toBe(entry);
	for (const pair of [
		{ version: "8.6.0", feature: "planning-models-v1" },
		{ version: "8.5.0", feature: "reviewer-picker-v1" },
		{ version: "8.4.0", feature: "planning-models-v1" },
		{ version: "8.5.1", feature: "planning-models-v1" },
		{ version: OFFLINE_FEATURE_BASELINE, feature: "reviewer-picker-v1" },
	])
		expect(() => offlineFeature(pair)).toThrow("No reviewed offline feature");
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
