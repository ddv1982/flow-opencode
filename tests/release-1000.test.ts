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
import { ModelIdentitySchema } from "../evals/report-identities.js";

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

test("OpenAI-only 10.0.0 keeps every delivery and autonomous case", () => {
	const catalog = releaseCatalog("10.0.0");
	expect(catalog).toEqual(releaseCatalog("9.6.0"));
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
	expect(catalog.map((row) => row.minProviders)).toEqual(Array(17).fill(1));
	assertReleaseModels([manager], "10.0.0");
	const cells = releaseCellsFor([manager], "10.0.0");
	expect(cells.filter((cell) => cell.schedule === "primary")).toHaveLength(72);
	expect(
		cells.filter((cell) => cell.schedule === "environment-reserve"),
	).toHaveLength(17);
	for (const cell of cells) expect(cell.reviewerModel).toEqual(manager);
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

test("OpenAI-only 10.0.0 admits only the complete canonical direct identity", () => {
	expect(() => assertReleaseModels([manager], "10.0.0")).not.toThrow();
	for (const forged of [
		alternate,
		{ ...manager, routeProvider: "other" },
		{ ...manager, model: "gpt-6-sol" },
		{ ...manager, family: "other-family" },
		{ ...manager, gateway: "proxy" },
		{ ...manager, revision: "preview" },
		{ ...manager, variant: "fast" },
		{ ...manager, unexpected: true },
	]) {
		expect(() => assertReleaseModels([forged], "10.0.0")).toThrow(
			"canonical direct-route identity",
		);
	}
	for (const models of [[], [manager, alternate], [manager, manager]])
		expect(() => assertReleaseModels(models, "10.0.0")).toThrow(
			"exactly openai/gpt-6.1-sol",
		);
});

test("OpenAI-only exceptions keep later releases on two providers", () => {
	for (const version of ["10.0.3", "10.1.0", "11.0.0"]) {
		expect(releaseCatalog(version).map((row) => row.minProviders)).toEqual(
			Array(20).fill(2),
		);
		expect(() => assertReleaseModels([manager], version)).toThrow("exactly 2");
		expect(() =>
			assertReleaseModels(
				[manager, { ...alternate, routeProvider: "openai" }],
				version,
			),
		).toThrow("distinct route providers");
		assertReleaseModels([manager, alternate], version);
		const cells = releaseCellsFor([manager, alternate], version);
		expect(cells.filter((cell) => cell.schedule === "primary")).toHaveLength(
			162,
		);
		expect(
			cells.filter((cell) => cell.schedule === "environment-reserve"),
		).toHaveLength(40);
		expect(releaseReviewerModel(version, alternate)).toEqual(alternate);
		expect(releaseReviewerModel(version)).toBeNull();
		expect(releasePolicySha256(version)).toBe(
			"sha256:64a9ab9be09cf3505746ffe0b9c1c1ed1d4746921a34f931784310cf9b9ae445",
		);
	}
});

test("OpenAI-only 10.0.0 resolves its reviewer pin before generic manager fallback", () => {
	expect(releaseReviewerModel("10.0.0")).toEqual(manager);
	expect(releaseReviewerModel("10.0.0", manager)).toEqual(manager);
	expect(releaseReviewerModel("10.0.0", alternate)).toEqual(manager);
});

test("external release identities require every canonical field", () => {
	const { routeProvider: _provider, ...missingProvider } = manager;
	const { gateway: _gateway, ...missingGateway } = manager;
	const { family: _family, ...missingFamily } = manager;
	const { model: _model, ...missingModel } = manager;
	const { revision: _revision, ...missingRevision } = manager;
	for (const input of [
		missingProvider,
		missingGateway,
		missingFamily,
		missingModel,
		missingRevision,
	])
		expect(ModelIdentitySchema.safeParse(input).success).toBe(false);
});
