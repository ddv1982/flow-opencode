import { expect, test } from "bun:test";
import historical from "../.agents/plans/18-opencode-v2/historical-policy-baseline.json" with {
	type: "json",
};
import {
	assertReleaseHost,
	assertReleaseModels,
	releaseCatalog,
	releaseCellsFor,
	releaseGraderSourceBundle,
	releaseHostConfigSha256,
	releaseHostPermissions,
	releaseHostPolicy,
	releasePolicySha256,
	releaseReviewerModel,
} from "../evals/release-policy.js";
import type { ModelIdentity } from "../evals/report.js";

const manager: ModelIdentity = {
	routeProvider: "openai",
	gateway: null,
	family: "gpt-6.1-sol",
	model: "gpt-6.1-sol",
	revision: null,
};
const alternate: ModelIdentity = {
	routeProvider: "xai",
	gateway: null,
	family: "grok-4.7",
	model: "grok-4.7",
	revision: null,
};

test("OpenCode 2 release keeps every delivery and autonomous case on two providers", () => {
	const catalog = releaseCatalog("10.0.0");
	expect(catalog.map((row) => row.caseId)).toEqual([
		"delivery-summary-completed",
		"delivery-summary-deferred",
		"delivery-summary-observed-failure",
		"delivery-full-detail-followup",
		"delivery-idle-after-close",
		"happy-path",
		"plan-only-stops",
		"goal-change-refused",
		"continuation-accepted",
		"failing-gate-blocks",
		"resumes-after-interruption",
		"unprovable-claim-refused",
		"skipped-case-named-binding",
		"inspection-failed-audit-completes",
		"auto-two-features-evidence",
		"auto-prerequisite-repair",
		"auto-observe-with-required-pass",
	]);
	expect(catalog.map((row) => row.minProviders)).toEqual(Array(17).fill(2));
	expect(() => assertReleaseModels([manager], "10.0.0")).toThrow(
		"exactly 2 models on distinct route providers",
	);
	expect(() =>
		assertReleaseModels(
			[manager, { ...alternate, routeProvider: "openai" }],
			"10.0.0",
		),
	).toThrow("distinct route providers");
	assertReleaseModels([manager, alternate], "10.0.0");
	const cells = releaseCellsFor([manager, alternate], "10.0.0");
	expect(cells.filter((cell) => cell.schedule === "primary")).toHaveLength(144);
	expect(
		cells.filter((cell) => cell.schedule === "environment-reserve"),
	).toHaveLength(34);
	for (const cell of cells)
		expect(cell.reviewerModel).toEqual(cell.managerModel);
	expect(releaseReviewerModel("10.0.0", alternate)).toEqual(alternate);
});

test("prospective host policy pins OpenCode 2 and refuses recovery or host overrides", () => {
	for (const version of ["10.0.0", "10.1.0", "11.0.0"]) {
		expect(releaseHostPolicy(version)).toEqual({
			opencodeVersion: "2.1.4",
			platform: "linux",
			reviewerSteps: null,
			ambientConfig: "disabled",
			transport: "http",
		});
		expect(releaseHostPermissions(version)).toEqual([
			{ action: "external_directory", resource: "*", effect: "deny" },
		]);
		expect(() =>
			assertReleaseHost({
				packageVersion: version,
				platform: "linux",
				recoveryApiKeySet: true,
			}),
		).toThrow("unset TYPESAFE_API_KEY");
		expect(() =>
			assertReleaseHost({
				packageVersion: version,
				platform: "linux",
				opencodeOverride: "2.1.5",
			}),
		).toThrow("canonical Linux host");
		expect(() =>
			assertReleaseHost({
				packageVersion: version,
				platform: "linux",
				reviewerVariantOverride: "max",
			}),
		).toThrow("reviewer");
		assertReleaseHost({ packageVersion: version, platform: "linux" });
	}
});

test("retained 9.x host and policy identities survive the OpenCode 2 migration", () => {
	for (const [packageVersion, hashes] of Object.entries(historical)) {
		expect(releaseHostPolicy(packageVersion).opencodeVersion).toBe("1.18.31");
		expect(releasePolicySha256(packageVersion)).toBe(hashes.policy);
		expect(releaseHostConfigSha256({ packageVersion, model: manager })).toBe(
			hashes.host,
		);
	}
});

test("the release evaluator seals the ordinary control transport adapter", () => {
	const files = releaseGraderSourceBundle(process.cwd()).files.map(
		(file) => file.path,
	);
	expect(files).toContain("evals/http-transport-plugin.ts");
	expect(files).toContain("src/platform/opencode/http-transport.ts");
});
