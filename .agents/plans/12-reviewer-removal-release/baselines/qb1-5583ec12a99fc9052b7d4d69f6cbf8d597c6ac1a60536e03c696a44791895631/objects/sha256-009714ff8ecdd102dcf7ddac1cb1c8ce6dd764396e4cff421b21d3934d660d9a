import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { parseCaseCatalog, type ValidatedCaseCatalog } from "./catalog.js";
import type { ModelIdentity, ScheduledCell } from "./report.js";

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
const RELEASE_CATALOG = parsed.value;

export const RELEASE_ANALYSIS_SHA256 = canonicalSha256("flow-v2-analysis-v1", {
	kind: "rate",
	primaryOutcome: "conformance-pass",
});
export const RELEASE_MAX_CAMPAIGN_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const RELEASE_ENVIRONMENT_RESERVES_PER_STRATUM = 1;

export const RELEASE_HOST_POLICY = {
	opencodeVersion: "1.18.6",
	platform: "linux",
	reviewerSteps: null,
} as const;

export const RELEASE_POLICY_SHA256 = canonicalSha256("flow-release-policy-v1", {
	catalog: RELEASE_CATALOG,
	host: RELEASE_HOST_POLICY,
	analysisSha256: RELEASE_ANALYSIS_SHA256,
	environmentReservesPerStratum: RELEASE_ENVIRONMENT_RESERVES_PER_STRATUM,
});

export const RELEASE_POLICY_CATALOG_SHA256 = canonicalSha256(
	"flow-evaluator-policy-catalog-v1",
	RELEASE_CATALOG,
);

export function releaseCatalog(): ValidatedCaseCatalog {
	return RELEASE_CATALOG;
}

export function releaseCaseIds(): readonly string[] {
	return RELEASE_CATALOG.map((policy) => policy.caseId);
}

export function releaseAttemptsFor(caseId: string): number {
	const policy = RELEASE_CATALOG.find((item) => item.caseId === caseId);
	if (!policy) throw new Error(`No release policy for ${caseId}.`);
	return policy.minScoredAttempts;
}

export function releaseMinimumProviders(): number {
	return Math.max(...RELEASE_CATALOG.map((policy) => policy.minProviders));
}

export function releasePrimaryCellsFor(
	models: readonly ModelIdentity[],
): ScheduledCell[] {
	let slot = 0;
	return models.flatMap((model) =>
		RELEASE_CATALOG.flatMap((policy) =>
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
					reviewerModel: null,
					schedule: "primary" as const,
				};
			}),
		),
	);
}

export function releaseCellsFor(
	models: readonly ModelIdentity[],
): ScheduledCell[] {
	const primary = releasePrimaryCellsFor(models);
	const reserves = models.flatMap((model) =>
		RELEASE_CATALOG.map((policy) => {
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
				reviewerModel: null,
				schedule: "environment-reserve" as const,
			};
		}),
	);
	return [...primary, ...reserves];
}

export function releaseRandomizationSeed(
	models: readonly ModelIdentity[],
): string {
	return canonicalSha256("flow-v2-seed-v1", {
		models: models.map((model) => `${model.routeProvider}/${model.model}`),
		scenarios: releaseCaseIds(),
		releasePolicySha256: RELEASE_POLICY_SHA256,
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
	});
}

export function assertReleaseHost(input: {
	readonly platform: string;
	readonly opencodeOverride?: string | undefined;
	readonly reviewerModelOverride?: string | undefined;
	readonly reviewerStepsOverride?: string | undefined;
}): void {
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
): void {
	if (
		scenarios.map((scenario) => scenario.id).join("\u0000") !==
		releaseCaseIds().join("\u0000")
	) {
		throw new Error(
			"Release scenarios do not match repository release policy.",
		);
	}
}

export function assertExactReleaseCatalog(
	input: unknown,
): ValidatedCaseCatalog {
	const supplied = parseCaseCatalog(input);
	if (
		!supplied.ok ||
		canonicalJson(supplied.value) !== canonicalJson(RELEASE_CATALOG)
	) {
		throw new Error(
			"Persisted catalog does not match repository release policy.",
		);
	}
	return RELEASE_CATALOG;
}

export function selectReleaseScenarios<
	Scenario extends { readonly id: string },
>(scenarios: readonly Scenario[]): readonly Scenario[] {
	return releaseCaseIds().map((caseId) => {
		const scenario = scenarios.find((candidate) => candidate.id === caseId);
		if (!scenario) throw new Error(`Release scenario ${caseId} is missing.`);
		return scenario;
	});
}

export function releaseScenarioCatalog(
	scenarios: readonly {
		readonly id: string;
		readonly files: Readonly<Record<string, string>>;
		readonly steps: readonly {
			readonly command: string;
			readonly arguments: string;
			readonly freshSession?: boolean;
		}[];
	}[],
) {
	return selectReleaseScenarios(scenarios).map((scenario) => ({
		id: scenario.id,
		files: Object.keys(scenario.files).sort(),
		steps: scenario.steps.map((step) => ({
			command: step.command,
			arguments: step.arguments,
			freshSession: step.freshSession === true,
		})),
	}));
}

export function releaseCaseCatalogSha256(
	scenarios: Parameters<typeof releaseScenarioCatalog>[0],
): string {
	return canonicalSha256(
		"flow-evaluator-case-catalog-v1",
		releaseScenarioCatalog(scenarios),
	);
}

export function releaseGraderSourceBundle(repositoryRoot: string) {
	const root = resolve(repositoryRoot);
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
		const source = readFileSync(absolute, "utf8");
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
			const found = choices.find((choice) => existsSync(choice));
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

export function releaseGraderBundle(repositoryRoot: string) {
	return {
		files: releaseGraderSourceBundle(repositoryRoot).files.map(
			({ path, source }) => ({
				path,
				sha256: canonicalSha256("flow-release-grader-file-v1", source),
			}),
		),
	};
}
