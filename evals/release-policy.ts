import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { parseCaseCatalog, type ValidatedCaseCatalog } from "./catalog.js";
import type { ModelIdentity, ScheduledCell } from "./report.js";
import { type ScenarioStep, scenarioStepCatalog } from "./scenario-steps.js";

const RELEASE_POLICY_INPUT = [
	{
		caseId: "happy-path",
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "plan-only-stops",
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "goal-change-refused",
		caseVersion: 2,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "continuation-accepted",
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "failing-gate-blocks",
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 10,
		minPassRate: 0.9,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "resumes-after-interruption",
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "unprovable-claim-refused",
		caseVersion: 2,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 10,
		minPassRate: 0.9,
		reviewerPromotionRecordSha256: null,
	},
	{
		caseId: "skipped-case-named-binding",
		caseVersion: 2,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 2,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	},
] as const;

const parsed = parseCaseCatalog(RELEASE_POLICY_INPUT);
if (!parsed.ok) throw new Error("Repository release policy is invalid.");
const HISTORICAL_RELEASE_CATALOG = parsed.value;
const inspectionCase = {
	caseId: "inspection-failed-audit-completes",
	caseVersion: 1,
	evidenceClass: "conformance",
	oracle: "durable-state",
	release: "required",
	minProviders: 2,
	minScoredAttempts: 10,
	minPassRate: 0.9,
	reviewerPromotionRecordSha256: null,
} as const;
const standardParsed = parseCaseCatalog([
	...RELEASE_POLICY_INPUT,
	inspectionCase,
]);
if (!standardParsed.ok)
	throw new Error("Repository release policy is invalid.");
const STANDARD_RELEASE_CATALOG = standardParsed.value;

const prospectiveParsed = parseCaseCatalog([
	...RELEASE_POLICY_INPUT,
	inspectionCase,
	...[
		"auto-two-features-evidence",
		"auto-prerequisite-repair",
		"auto-observe-with-required-pass",
	].map((caseId) => ({
		caseId,
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 1,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	})),
]);
if (!prospectiveParsed.ok)
	throw new Error("Prospective release policy is invalid.");
const AUTO_RELEASE_CATALOG = prospectiveParsed.value;

const deliveryParsed = parseCaseCatalog([
	...[
		"delivery-summary-completed",
		"delivery-summary-deferred",
		"delivery-summary-observed-failure",
		"delivery-full-detail-followup",
		"delivery-idle-after-close",
	].map((caseId) => ({
		caseId,
		caseVersion: 1,
		evidenceClass: "conformance",
		oracle: "durable-state",
		release: "required",
		minProviders: 1,
		minScoredAttempts: 3,
		minPassRate: 1,
		reviewerPromotionRecordSha256: null,
	})),
	...AUTO_RELEASE_CATALOG,
]);
if (!deliveryParsed.ok) throw new Error("Delivery release policy is invalid.");
const DELIVERY_RELEASE_CATALOG = deliveryParsed.value;

export type ReleaseProfile = {
	readonly catalog: ValidatedCaseCatalog;
	readonly requiredModels: readonly ModelIdentity[] | null;
};

const openAiOnlyRelease = (
	catalog: ValidatedCaseCatalog,
	model = "gpt-6-sol",
): ReleaseProfile => ({
	catalog: catalog.map((row) => ({ ...row, minProviders: 1 })),
	requiredModels: [
		{
			routeProvider: "openai",
			gateway: null,
			family: model,
			model,
			revision: null,
		},
	],
});

const STANDARD_RELEASE: ReleaseProfile = {
	catalog: STANDARD_RELEASE_CATALOG,
	requiredModels: null,
};

export function releaseProfile(packageVersion: string): ReleaseProfile {
	if (packageVersion === "9.6.0")
		return openAiOnlyRelease(DELIVERY_RELEASE_CATALOG, "gpt-6.1-sol");
	if (packageVersion === "9.5.0")
		return openAiOnlyRelease(AUTO_RELEASE_CATALOG, "gpt-6.1-sol");
	if (packageVersion === "9.4.0")
		return openAiOnlyRelease(AUTO_RELEASE_CATALOG);
	if (packageVersion === "9.1.0" || packageVersion === "9.2.0") {
		return openAiOnlyRelease(HISTORICAL_RELEASE_CATALOG);
	}
	return packageVersion === "9.3.0"
		? openAiOnlyRelease(STANDARD_RELEASE_CATALOG)
		: STANDARD_RELEASE;
}

export function releaseReviewerModel(
	packageVersion: string,
): ModelIdentity | null {
	if (packageVersion !== "9.6.0") return null;
	const model = releaseProfile(packageVersion).requiredModels?.[0];
	if (!model) throw new Error("Pinned release reviewer model is absent.");
	return model;
}

export const RELEASE_ANALYSIS_SHA256 = canonicalSha256("flow-v2-analysis-v1", {
	kind: "rate",
	primaryOutcome: "conformance-pass",
});
export const RELEASE_MAX_CAMPAIGN_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const RELEASE_ENVIRONMENT_RESERVES_PER_STRATUM = 1;

export const RELEASE_HOST_POLICY = {
	opencodeVersion: "1.18.31",
	platform: "linux",
	reviewerSteps: null,
} as const;

export function releaseHostPermissions(packageVersion: string) {
	return packageVersion === "9.5.0" || packageVersion === "9.6.0"
		? { external_directory: "deny" as const }
		: undefined;
}

export function releasePolicySha256(packageVersion: string): string {
	const profile = releaseProfile(packageVersion);
	return canonicalSha256("flow-release-policy-v1", {
		catalog: profile.catalog,
		...(profile.requiredModels === null
			? {}
			: { requiredModels: profile.requiredModels }),
		host: {
			...RELEASE_HOST_POLICY,
			...(releaseHostPermissions(packageVersion)
				? { permission: releaseHostPermissions(packageVersion) }
				: {}),
		},
		analysisSha256: RELEASE_ANALYSIS_SHA256,
		environmentReservesPerStratum: RELEASE_ENVIRONMENT_RESERVES_PER_STRATUM,
	});
}

export const RELEASE_POLICY_SHA256 = releasePolicySha256("standard");

export const RELEASE_POLICY_CATALOG_SHA256 = canonicalSha256(
	"flow-evaluator-policy-catalog-v1",
	STANDARD_RELEASE_CATALOG,
);

export function releaseCatalog(
	packageVersion = "standard",
): ValidatedCaseCatalog {
	return releaseProfile(packageVersion).catalog;
}

export function releaseCaseIds(packageVersion = "standard"): readonly string[] {
	return releaseCatalog(packageVersion).map((policy) => policy.caseId);
}

export function releaseAttemptsFor(
	caseId: string,
	packageVersion = "standard",
): number {
	const policy = releaseCatalog(packageVersion).find(
		(item) => item.caseId === caseId,
	);
	if (!policy) throw new Error(`No release policy for ${caseId}.`);
	return policy.minScoredAttempts;
}

export function releaseMinimumProviders(packageVersion = "standard"): number {
	return Math.max(
		...releaseCatalog(packageVersion).map((policy) => policy.minProviders),
	);
}

export function assertReleaseModels(
	models: readonly ModelIdentity[],
	packageVersion: string,
): void {
	const profile = releaseProfile(packageVersion);
	const minimum = releaseMinimumProviders(packageVersion);
	if (
		models.length !== minimum ||
		new Set(models.map((model) => model.routeProvider)).size !== minimum ||
		(profile.requiredModels !== null &&
			canonicalJson(models) !== canonicalJson(profile.requiredModels))
	) {
		throw new Error(
			profile.requiredModels !== null
				? `Release ${packageVersion} requires exactly ${profile.requiredModels.map((model) => `${model.routeProvider}/${model.model}`).join(", ")} with its canonical direct-route identity.`
				: `Release requires exactly ${minimum} models on distinct route providers.`,
		);
	}
}

export function releasePrimaryCellsFor(
	models: readonly ModelIdentity[],
	packageVersion = "standard",
): ScheduledCell[] {
	let slot = 0;
	return models.flatMap((model) =>
		releaseCatalog(packageVersion).flatMap((policy) =>
			Array.from({ length: policy.minScoredAttempts }, (_, repetition) => {
				const block = slot;
				slot += 1;
				const identity = canonicalSha256("flow-v2-cell-v1", {
					model: `${model.routeProvider}/${model.model}`,
					scenario: policy.caseId,
					repetition,
				});
				return {
					cellId: `cell-${identity.slice("sha256:".length)}`,
					blockId: `block-${block}`,
					caseId: policy.caseId,
					caseVersion: policy.caseVersion,
					armToken: null,
					repetition,
					managerModel: model,
					reviewerModel: releaseReviewerModel(packageVersion),
					schedule: "primary" as const,
				};
			}),
		),
	);
}

export function releaseCellsFor(
	models: readonly ModelIdentity[],
	packageVersion = "standard",
): ScheduledCell[] {
	const primary = releasePrimaryCellsFor(models, packageVersion);
	const reserves = models.flatMap((model) =>
		releaseCatalog(packageVersion).map((policy) => {
			const identity = canonicalSha256("flow-v2-environment-reserve-v1", {
				model: `${model.routeProvider}/${model.model}`,
				scenario: policy.caseId,
				caseVersion: policy.caseVersion,
				repetition: policy.minScoredAttempts,
			});
			const suffix = identity.slice("sha256:".length);
			return {
				cellId: `cell-${suffix}`,
				blockId: `environment-${suffix}`,
				caseId: policy.caseId,
				caseVersion: policy.caseVersion,
				armToken: null,
				repetition: policy.minScoredAttempts,
				managerModel: model,
				reviewerModel: releaseReviewerModel(packageVersion),
				schedule: "environment-reserve" as const,
			};
		}),
	);
	return [...primary, ...reserves];
}

export function releaseRandomizationSeed(
	models: readonly ModelIdentity[],
	packageVersion = "standard",
): string {
	return canonicalSha256("flow-v2-seed-v1", {
		models: models.map((model) => `${model.routeProvider}/${model.model}`),
		scenarios: releaseCaseIds(packageVersion),
		releasePolicySha256: releasePolicySha256(packageVersion),
	});
}

export function releaseHostConfigSha256(input: {
	readonly packageVersion: string;
	readonly model: ModelIdentity;
}): string {
	const model = `${input.model.routeProvider}/${input.model.model}`;
	return canonicalSha256("flow-eval-host-config-v1", {
		opencodeVersion: RELEASE_HOST_POLICY.opencodeVersion,
		plugin: `opencode-plugin-flow@${input.packageVersion}`,
		model,
		reviewerModel: model,
		reviewerSteps: RELEASE_HOST_POLICY.reviewerSteps,
		platform: RELEASE_HOST_POLICY.platform,
		...(releaseHostPermissions(input.packageVersion)
			? { permission: releaseHostPermissions(input.packageVersion) }
			: {}),
	});
}

export function assertReleaseHost(input: {
	readonly packageVersion?: string;
	readonly recoveryApiKeySet?: boolean;
	readonly platform: string;
	readonly opencodeOverride?: string | undefined;
	readonly reviewerModelOverride?: string | undefined;
	readonly reviewerStepsOverride?: string | undefined;
}): void {
	if (input.packageVersion === "9.6.0" && input.recoveryApiKeySet)
		throw new Error(
			"9.6.0 release evaluation requires recovery off; unset TYPESAFE_API_KEY.",
		);
	if (
		input.platform !== RELEASE_HOST_POLICY.platform ||
		input.opencodeOverride?.trim() ||
		input.reviewerModelOverride?.trim() ||
		input.reviewerStepsOverride?.trim()
	) {
		throw new Error(
			"Release eval requires the canonical Linux host with no OpenCode or reviewer overrides.",
		);
	}
}

export function assertReleaseScenarioOrder(
	scenarios: readonly { readonly id: string }[],
	packageVersion = "standard",
): void {
	if (
		scenarios.map((scenario) => scenario.id).join("\u0000") !==
		releaseCaseIds(packageVersion).join("\u0000")
	) {
		throw new Error(
			"Release scenarios do not match repository release policy.",
		);
	}
}

export function assertExactReleaseCatalog(
	input: unknown,
	packageVersion = "standard",
): ValidatedCaseCatalog {
	const supplied = parseCaseCatalog(input);
	const catalog = releaseCatalog(packageVersion);
	if (
		!supplied.ok ||
		canonicalJson(supplied.value) !== canonicalJson(catalog)
	) {
		throw new Error(
			"Persisted catalog does not match repository release policy.",
		);
	}
	return catalog;
}

export function selectReleaseScenarios<
	Scenario extends { readonly id: string },
>(
	scenarios: readonly Scenario[],
	packageVersion = "standard",
): readonly Scenario[] {
	return releaseCaseIds(packageVersion).map((caseId) => {
		const scenario = scenarios.find((candidate) => candidate.id === caseId);
		if (!scenario) throw new Error(`Release scenario ${caseId} is missing.`);
		return scenario;
	});
}

export function releaseScenarioCatalog(
	scenarios: readonly {
		readonly id: string;
		readonly files: Readonly<Record<string, string>>;
		readonly steps: readonly ScenarioStep[];
	}[],
	packageVersion = "standard",
) {
	return selectReleaseScenarios(scenarios, packageVersion).map((scenario) => ({
		id: scenario.id,
		files: Object.keys(scenario.files).sort(),
		steps: scenario.steps.map(scenarioStepCatalog),
	}));
}

export function releaseCaseCatalogSha256(
	scenarios: Parameters<typeof releaseScenarioCatalog>[0],
	packageVersion = "standard",
): string {
	return canonicalSha256(
		"flow-evaluator-case-catalog-v1",
		releaseScenarioCatalog(scenarios, packageVersion),
	);
}

export function releaseGraderSourceBundle(
	repositoryRoot: string,
	revision?: string,
) {
	const root = resolve(repositoryRoot);
	if (revision !== undefined) {
		if (!/^[a-f0-9]{40,64}$/.test(revision))
			throw new Error("Release authority requires an exact commit hash.");
		const commit = spawnSync(
			"git",
			["rev-parse", "--verify", `${revision}^{commit}`],
			{ cwd: root, encoding: "utf8" },
		);
		if (commit.status !== 0 || commit.stdout.trim() !== revision)
			throw new Error("Release authority commit is unavailable.");
	}
	const readSource = (path: string): string | null => {
		const inside = relative(root, resolve(root, path));
		if (isAbsolute(inside) || inside.split(/[\\/]/)[0] === "..")
			throw new Error(`Release grader import escapes the repository: ${path}`);
		if (revision !== undefined) {
			const result = spawnSync("git", ["show", `${revision}:${path}`], {
				cwd: root,
				encoding: "utf8",
				maxBuffer: 16 * 1024 * 1024,
			});
			return result.status === 0 ? result.stdout : null;
		}
		try {
			return readFileSync(resolve(root, path), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	};
	const pending = [
		"evals/run.ts",
		"scripts/qualify-release.ts",
		"evals/qualification-regrade.ts",
	];
	const files = new Map<string, string>();
	const transpiler = new Bun.Transpiler({ loader: "ts" });
	while (pending.length > 0) {
		const path = pending.pop();
		if (!path || files.has(path)) continue;
		const absolute = resolve(root, path);
		const inside = relative(root, absolute);
		if (isAbsolute(inside) || inside.split(/[\\/]/)[0] === "..") {
			throw new Error(`Release grader import escapes the repository: ${path}`);
		}
		const source = readSource(path);
		if (source === null)
			throw new Error(`Release grader source is missing: ${path}`);
		files.set(path, source);
		if (!path.endsWith(".ts") && !path.endsWith(".js")) continue;
		const scanSource = source.startsWith("#!")
			? source.slice(source.indexOf("\n") + 1)
			: source;
		for (const match of scanSource.matchAll(/\bimport\s*\(([^)]*)\)/g)) {
			if (!/^\s*["'][^"']+["']\s*$/.test(match[1] ?? ""))
				throw new Error(`Release grader has a non-literal import: ${path}`);
		}
		const specifiers = transpiler
			.scanImports(scanSource)
			.map((item) => item.path)
			.filter((specifier) => specifier.startsWith("."));
		for (const specifier of specifiers) {
			const candidate = resolve(dirname(absolute), specifier);
			const choices = [
				candidate,
				candidate.replace(/\.js$/, ".ts"),
				`${candidate}.ts`,
			];
			const found = choices.find(
				(choice) =>
					readSource(relative(root, choice).split(sep).join("/")) !== null,
			);
			if (!found) {
				throw new Error(`Release grader import is missing: ${specifier}`);
			}
			pending.push(relative(root, found).split(sep).join("/"));
		}
	}
	return {
		files: [...files]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, source]) => ({ path, source })),
	};
}

export function releaseGraderBundle(repositoryRoot: string, revision?: string) {
	return {
		files: releaseGraderSourceBundle(repositoryRoot, revision).files.map(
			({ path, source }) => ({
				path,
				sha256: canonicalSha256("flow-release-grader-file-v1", source),
			}),
		),
	};
}
