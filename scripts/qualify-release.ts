#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	deriveReleaseDecision,
	type ExpectedActorProvenance,
	type ReleaseDecision,
	type ReleaseExpectedProvenance,
} from "../evals/analysis.js";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import type { ValidatedCaseCatalog } from "../evals/catalog.js";
import { evaluatorIdentity, inspectArtifact } from "../evals/provenance.js";
import {
	assertExactReleaseCatalog,
	RELEASE_ANALYSIS_SHA256,
	RELEASE_POLICY_SHA256,
	releaseCatalog,
	releaseCellsFor,
	releaseGraderBundle,
	releaseHostConfigSha256,
	releaseMinimumProviders,
	releaseRandomizationSeed,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import {
	type ArtifactIdentity,
	type EvaluatorIdentity,
	type ModelIdentity,
	parseReport,
	type ValidatedReport,
} from "../evals/report.js";
import { SCENARIOS } from "../evals/scenarios.js";
import {
	type CanaryRecord,
	canaryRecordIssue as verifyCanaryRecord,
} from "./eval-canary.js";
import { canaryRecordIssue } from "./release-metadata.js";

export type DecisionRecord = {
	readonly schemaVersion: 1;
	readonly reportId: string;
	readonly verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";
	readonly reportSha256: string;
	readonly artifactSha256: string;
	readonly evaluatorSha256: string;
	readonly catalogSha256: string;
	readonly policySha256: string;
	readonly actorSha256: string;
	readonly analyzerSha256: string;
	readonly expectedProvenanceSha256: string;
	readonly decisionInputSha256: string;
	readonly canarySha256: string | null;
	readonly artifact: ArtifactIdentity;
	readonly reasons: readonly string[];
};

function sameJson(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function assertFrozenReleasePlan(report: ValidatedReport): void {
	const models: ModelIdentity[] = [];
	for (const cell of report.plan.cells) {
		if (
			cell.managerModel &&
			!models.some((model) => sameJson(model, cell.managerModel))
		) {
			models.push(cell.managerModel);
		}
	}
	if (
		models.length !== releaseMinimumProviders() ||
		new Set(models.map((model) => model.routeProvider)).size !== models.length
	) {
		throw new Error(
			"Release plan must schedule exactly two models on distinct route providers.",
		);
	}
	const expected = releaseCellsFor(models);
	if (!sameJson(report.plan.cells, expected)) {
		throw new Error(
			"Release plan does not contain the canonical 76-cell grid.",
		);
	}
	const expectedSeed = releaseRandomizationSeed(models);
	if (
		report.plan.planId !== "flow-v2-primary-matrix" ||
		report.plan.randomizationSeed !== expectedSeed ||
		report.plan.abortPolicy.retry !== "never" ||
		report.plan.abortPolicy.maxReplacementBlocks !== 0 ||
		report.plan.stoppingRule.kind !== "fixed-attempts" ||
		report.plan.stoppingRule.count !== expected.length ||
		report.plan.budget.maxAttempts !== expected.length ||
		report.plan.budget.maxUsd !== null ||
		report.plan.budget.unknownCostPolicy !== "token-wall-clock-bounds" ||
		report.plan.budget.maxOutputTokens !== expected.length * 200_000 ||
		report.plan.budget.maxWallClockMs !== expected.length * 20 * 60_000 ||
		report.plan.analysis.kind !== "rate" ||
		report.plan.analysis.primaryOutcome !== "conformance-pass" ||
		report.plan.analysis.versionSha256 !== RELEASE_ANALYSIS_SHA256
	) {
		throw new Error("Release plan controls differ from repository policy.");
	}
}

function canonicalEvaluator(artifact: ArtifactIdentity): EvaluatorIdentity {
	return evaluatorIdentity({
		sourceCommit: artifact.sourceCommit,
		caseCatalog: releaseScenarioCatalog(SCENARIOS),
		policyCatalog: releaseCatalog(),
		graderBundle: releaseGraderBundle(join(import.meta.dir, "..")),
	});
}

export function expectedProvenanceFor(
	report: ValidatedReport,
	artifact: ArtifactIdentity,
	evaluator: EvaluatorIdentity,
): ReleaseExpectedProvenance {
	const cells = new Map(report.plan.cells.map((cell) => [cell.cellId, cell]));
	return {
		kind: "release",
		artifact,
		evaluator,
		attempts: report.attempts.map((attempt) => {
			const model = cells.get(attempt.cellId)?.managerModel;
			if (!model)
				throw new Error(`Release cell ${attempt.cellId} has no model.`);
			return {
				cellId: attempt.cellId,
				hostConfigSha256: releaseHostConfigSha256({
					packageVersion: artifact.packageVersion,
					model,
				}),
				actors: attempt.actors.map(
					(actor): ExpectedActorProvenance => ({
						role: actor.role,
						requestedModel: actor.requestedModel,
						actualModel:
							actor.actualModel.kind === "observed"
								? { kind: "observed", value: actor.actualModel.value }
								: {
										kind: "allow-unobserved",
										value: actor.requestedModel,
										reason: actor.actualModel.reason,
									},
					}),
				),
				instructions: attempt.instructions,
			};
		}),
	};
}

export function qualifyV2(input: {
	readonly reportInput: unknown;
	readonly catalogInput: unknown;
	readonly artifact: ArtifactIdentity;
	readonly canary?: CanaryRecord | null;
}): {
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
	readonly decision: ReleaseDecision;
	readonly expected: ReleaseExpectedProvenance;
	readonly canary: CanaryRecord | null;
} {
	const catalog = assertExactReleaseCatalog(input.catalogInput);
	const parsed = parseReport(input.reportInput, catalog);
	if (!parsed.ok) {
		throw new Error(
			`Invalid v2 report: ${parsed.issues
				.map((issue) => `${issue.path} ${issue.message}`)
				.join("; ")}`,
		);
	}
	assertFrozenReleasePlan(parsed.value);
	const measuredArtifact = parsed.value.attempts[0]?.artifact;
	if (!measuredArtifact || "kind" in measuredArtifact) {
		throw new Error("A v2 qualification report requires a Flow artifact.");
	}
	const evaluator = canonicalEvaluator(measuredArtifact);
	for (const attempt of parsed.value.attempts) {
		if (!sameJson(attempt.evaluator, evaluator)) {
			throw new Error(
				`Attempt ${attempt.attemptId} evaluator does not match repository release authority.`,
			);
		}
	}
	const expected = expectedProvenanceFor(
		parsed.value,
		measuredArtifact,
		evaluator,
	);
	const expectedHostConfigs = new Map(
		expected.attempts.map((attempt) => [
			attempt.cellId,
			attempt.hostConfigSha256,
		]),
	);
	for (const attempt of parsed.value.attempts) {
		if (attempt.hostConfigSha256 !== expectedHostConfigs.get(attempt.cellId)) {
			throw new Error(
				`Attempt ${attempt.attemptId} host configuration does not match repository release policy.`,
			);
		}
	}
	if (input.canary) {
		const issue = canaryRecordIssue(
			input.artifact.packageVersion,
			input.canary,
			input.artifact,
		);
		if (issue) throw new Error(issue);
	}
	return {
		report: parsed.value,
		catalog,
		expected,
		decision: deriveReleaseDecision({
			report: parsed.value,
			catalog,
			expected,
			promotionArtifact: input.artifact,
		}),
		canary: input.canary ?? null,
	};
}

export function decisionRecordFor(input: {
	readonly report: ValidatedReport;
	readonly catalog: ValidatedCaseCatalog;
	readonly expected: ReleaseExpectedProvenance;
	readonly decision: ReleaseDecision;
	readonly canarySha256?: string | null;
}): DecisionRecord {
	const reportSha256 = canonicalSha256("flow-decision-report-v1", input.report);
	const artifactSha256 = canonicalSha256(
		"flow-decision-artifact-v1",
		input.expected.artifact,
	);
	const evaluatorSha256 = canonicalSha256(
		"flow-decision-evaluator-v1",
		input.expected.evaluator,
	);
	const catalogSha256 = canonicalSha256(
		"flow-decision-catalog-v1",
		input.catalog,
	);
	const policySha256 = RELEASE_POLICY_SHA256;
	const actorSha256 = canonicalSha256(
		"flow-decision-actors-v1",
		input.expected.attempts.map((attempt) => ({
			cellId: attempt.cellId,
			actors: attempt.actors,
		})),
	);
	const analyzerSha256 = canonicalSha256("flow-decision-analyzer-v1", {
		module: "evals/analysis.ts",
		decisionSchemaVersion: 1,
	});
	const expectedProvenanceSha256 = canonicalSha256(
		"flow-decision-expected-provenance-v1",
		input.expected,
	);
	const decisionInputSha256 = canonicalSha256("flow-decision-input-v1", {
		reportSha256,
		artifactSha256,
		evaluatorSha256,
		catalogSha256,
		policySha256,
		actorSha256,
		analyzerSha256,
		expectedProvenanceSha256,
		canarySha256: input.canarySha256 ?? null,
	});
	return {
		schemaVersion: 1,
		reportId: input.report.reportId,
		verdict: input.decision.verdict,
		reportSha256,
		artifactSha256,
		evaluatorSha256,
		catalogSha256,
		policySha256,
		actorSha256,
		analyzerSha256,
		expectedProvenanceSha256,
		canarySha256: input.canarySha256 ?? null,
		decisionInputSha256,
		artifact: input.expected.artifact,
		reasons: input.decision.reasons.map((reason) => reason.message),
	};
}

export async function writeDecisionRecord(input: {
	readonly record: DecisionRecord;
	readonly directory: string;
}): Promise<string> {
	await mkdir(input.directory, { recursive: true });
	const suffix = input.record.canarySha256
		? `-canary-${input.record.canarySha256.slice("sha256:".length, "sha256:".length + 12)}`
		: "";
	const path = join(input.directory, `${input.record.reportId}${suffix}.json`);
	const bytes = canonicalJson(input.record);
	try {
		await writeFile(path, bytes, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if ((await readFile(path, "utf8")) !== bytes) {
			throw new Error(`Immutable decision record conflicts: ${path}`);
		}
	}
	return path;
}

const USAGE =
	"Usage: bun run qualify -- --report <v2-report.json> --catalog <catalog.json> --artifact <artifact.tgz> [--canary <canary.json>] [--decisions-dir <dir>]";

function requiredOption(
	options: Readonly<Record<string, string>>,
	name: string,
): string {
	const value = options[name];
	if (!value) throw new Error(USAGE);
	return value;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const options: Record<string, string> = {};
	const allowed = new Set([
		"--report",
		"--catalog",
		"--artifact",
		"--canary",
		"--decisions-dir",
	]);
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const value = args[index + 1];
		if (!option || !allowed.has(option)) throw new Error(USAGE);
		if (!value || value.startsWith("--")) {
			throw new Error(`${option} requires a value.`);
		}
		options[option] = value;
	}
	const reportPath = requiredOption(options, "--report");
	const catalogPath = requiredOption(options, "--catalog");
	const artifactPath = requiredOption(options, "--artifact");
	const artifact = await inspectArtifact({
		repositoryRoot: join(import.meta.dir, ".."),
		tarballPath: artifactPath,
	});
	const canaryPath = options["--canary"];
	const canary = canaryPath
		? (JSON.parse(await readFile(canaryPath, "utf8")) as CanaryRecord)
		: null;
	if (canary && canaryPath) {
		const issue = await verifyCanaryRecord({
			version: artifact.packageVersion,
			record: canary,
			expectedArtifact: artifact,
			directory: dirname(canaryPath),
		});
		if (issue) throw new Error(issue);
	}
	const result = qualifyV2({
		reportInput: JSON.parse(await readFile(reportPath, "utf8")),
		catalogInput: JSON.parse(await readFile(catalogPath, "utf8")),
		artifact,
		canary,
	});
	const record = decisionRecordFor({
		...result,
		canarySha256: result.canary?.recordSha256 ?? null,
	});
	const path = await writeDecisionRecord({
		record,
		directory:
			options["--decisions-dir"] ??
			join(import.meta.dir, "..", "evals", "decisions"),
	});
	process.stdout.write(`${record.verdict}: ${path}\n`);
	if (record.verdict !== "VERIFIED") process.exitCode = 1;
}

if (import.meta.main) await main();
