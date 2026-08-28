#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	deriveReleaseDecision,
	type ExpectedActorProvenance,
	type ReleaseDecision,
	type ReleaseExpectedProvenance,
} from "../evals/analysis.js";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import type { ValidatedCaseCatalog } from "../evals/catalog.js";
import {
	deriveConformanceOutcome,
	retainedInstructions,
	retainedReportActors,
} from "../evals/conformance-evidence.js";
import { RetainedScenarioEvidenceSchema } from "../evals/grader-input.js";
import {
	evaluatorIdentity,
	inspectArtifact,
	instructionDelivery,
	samePackedArtifact,
} from "../evals/provenance.js";
import {
	listStableQualificationDirectory,
	type QualificationBundleFile,
	readStableQualificationInput,
	writeQualificationBundle,
} from "../evals/qualification-bundle.js";
import {
	assertExactReleaseCatalog,
	RELEASE_ANALYSIS_SHA256,
	RELEASE_POLICY_SHA256,
	releaseCatalog,
	releaseCellsFor,
	releaseGraderBundle,
	releaseGraderSourceBundle,
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
import {
	reportStoreAttemptFileName,
	reportStoreCellFileName,
} from "../evals/report-store.js";
import { SCENARIOS } from "../evals/scenarios.js";
import {
	type CanaryRecord,
	parseCanaryRecord,
	canaryRecordIssue as verifyCanaryRecord,
} from "./eval-canary.js";

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

export function assertCampaignEvidenceLayout(input: {
	readonly attempts: readonly Readonly<{
		attemptId: string;
		cellId: string;
		transcript: { readonly artifact: string } | null;
	}>[];
	readonly attemptFiles: readonly Readonly<{
		name: string;
		attemptId: string;
	}>[];
	readonly transcriptFiles: readonly string[];
}): void {
	if (
		input.attemptFiles.length !== input.attempts.length ||
		new Set(input.attemptFiles.map(({ attemptId }) => attemptId)).size !==
			input.attemptFiles.length
	) {
		throw new Error("Campaign attempt ledger is incomplete or duplicated.");
	}
	const filesByAttempt = new Map(
		input.attemptFiles.map((file) => [file.attemptId, file]),
	);
	const expectedTranscripts = input.attempts.map((attempt) => {
		const retained = filesByAttempt.get(attempt.attemptId);
		if (
			retained?.name !== reportStoreCellFileName(attempt.cellId) ||
			attempt.transcript?.artifact !==
				`transcripts/${reportStoreAttemptFileName(attempt.attemptId)}`
		) {
			throw new Error(
				`Campaign attempt ${attempt.attemptId} has a noncanonical evidence path.`,
			);
		}
		return reportStoreAttemptFileName(attempt.attemptId);
	});
	if (
		new Set(expectedTranscripts).size !== input.attempts.length ||
		canonicalJson([...expectedTranscripts].sort()) !==
			canonicalJson([...input.transcriptFiles].sort())
	) {
		throw new Error(
			"Campaign transcript ledger is incomplete, duplicated, or noncanonical.",
		);
	}
}

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
		if (
			input.canary.status !== "passed" ||
			input.canary.artifact.packageVersion !== input.artifact.packageVersion ||
			!samePackedArtifact(input.canary.artifact, input.artifact)
		)
			throw new Error("Canary does not match the exact qualifying artifact.");
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
		decisionSchemaVersion: 1,
		graderBundle: releaseGraderBundle(join(import.meta.dir, "..")),
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

const USAGE =
	"Usage: bun run qualify -- --campaign-dir <v2-campaign> --canary <canary.json> [--bundles-dir <dir>]";

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
	const allowed = new Set(["--campaign-dir", "--canary", "--bundles-dir"]);
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const value = args[index + 1];
		if (!option || !allowed.has(option)) throw new Error(USAGE);
		if (!value || value.startsWith("--")) {
			throw new Error(`${option} requires a value.`);
		}
		options[option] = value;
	}
	const campaignDirectory = requiredOption(options, "--campaign-dir");
	const canaryPath = requiredOption(options, "--canary");
	const repositoryRoot = join(import.meta.dir, "..");
	const [reportBytes, catalogBytes, planBytes, completionBytes, artifactBytes] =
		await Promise.all([
			readStableQualificationInput(campaignDirectory, "report.json"),
			readStableQualificationInput(campaignDirectory, "catalog.json"),
			readStableQualificationInput(campaignDirectory, "plan.json"),
			readStableQualificationInput(campaignDirectory, "completion.json"),
			readStableQualificationInput(campaignDirectory, "artifact.tgz"),
		]);
	const snapshot = await mkdtemp(
		join(tmpdir(), "flow-qualification-artifact-"),
	);
	const artifactPath = join(snapshot, "artifact.tgz");
	await writeFile(artifactPath, artifactBytes);
	let artifact: ArtifactIdentity;
	try {
		artifact = await inspectArtifact({
			repositoryRoot,
			tarballPath: artifactPath,
		});
	} finally {
		await rm(snapshot, { recursive: true, force: true });
	}
	const canaryDirectory = dirname(canaryPath);
	const canaryBytes = await readStableQualificationInput(
		canaryDirectory,
		basename(canaryPath),
	);
	const parsedCanary = parseCanaryRecord(
		JSON.parse(canaryBytes.toString("utf8")),
	);
	if (!parsedCanary.ok) throw new Error(parsedCanary.issues.join("; "));
	const canary = parsedCanary.value;
	const canaryIssue = await verifyCanaryRecord({
		version: artifact.packageVersion,
		record: canary,
		expectedArtifact: artifact,
		directory: canaryDirectory,
	});
	if (canaryIssue) throw new Error(canaryIssue);
	const result = qualifyV2({
		reportInput: JSON.parse(reportBytes.toString("utf8")),
		catalogInput: JSON.parse(catalogBytes.toString("utf8")),
		artifact,
		canary,
	});
	if (result.decision.verdict !== "VERIFIED")
		throw new Error(`Qualification verdict is ${result.decision.verdict}.`);
	if (
		canonicalJson(JSON.parse(planBytes.toString("utf8"))) !==
			canonicalJson(result.report.plan) ||
		canonicalJson(JSON.parse(completionBytes.toString("utf8"))) !==
			canonicalJson(result.report.completion)
	) {
		throw new Error("Campaign plan or completion does not match the report.");
	}
	const record = decisionRecordFor({
		...result,
		canarySha256: canary.recordSha256,
	});
	const attemptNames = await listStableQualificationDirectory(
		campaignDirectory,
		"attempts",
	);
	const attemptFiles = await Promise.all(
		attemptNames.map(async (name) => {
			const bytes = await readStableQualificationInput(
				campaignDirectory,
				join("attempts", name),
			);
			const value = JSON.parse(bytes.toString("utf8")) as unknown;
			const attemptId =
				value && typeof value === "object" && "attemptId" in value
					? (value as { attemptId?: unknown }).attemptId
					: null;
			if (typeof attemptId !== "string")
				throw new Error("Campaign attempt file has no attemptId.");
			return {
				name,
				bytes,
				value,
				attemptId,
			};
		}),
	);
	const attempts = new Map(
		attemptFiles.map((entry) => [entry.attemptId, entry] as const),
	);
	const listedTranscripts = await listStableQualificationDirectory(
		campaignDirectory,
		"transcripts",
	);
	assertCampaignEvidenceLayout({
		attempts: result.report.attempts,
		attemptFiles,
		transcriptFiles: listedTranscripts,
	});
	const files: QualificationBundleFile[] = [];
	const managerSessions = new Set<string>();
	for (const attempt of result.report.attempts) {
		const retained = attempts.get(attempt.attemptId);
		if (!retained || canonicalJson(retained.value) !== canonicalJson(attempt))
			throw new Error(
				`Campaign attempt ${attempt.attemptId} does not match report.`,
			);
		if (!attempt.transcript)
			throw new Error(
				`Attempt ${attempt.attemptId} has no retained transcript.`,
			);
		const transcriptPath = attempt.transcript.artifact;
		const transcriptBytes = await readStableQualificationInput(
			campaignDirectory,
			transcriptPath,
		);
		const transcriptSha256 = `sha256:${new Bun.CryptoHasher("sha256")
			.update(transcriptBytes)
			.digest("hex")}`;
		if (transcriptSha256 !== attempt.transcript.sha256)
			throw new Error(
				`Attempt ${attempt.attemptId} transcript digest differs.`,
			);
		const evidence = RetainedScenarioEvidenceSchema.parse(
			JSON.parse(transcriptBytes.toString("utf8")),
		);
		const scenario = SCENARIOS.find(({ id }) => id === attempt.caseId);
		if (!scenario) throw new Error(`Scenario ${attempt.caseId} is missing.`);
		if (attempt.outcome.kind !== "product")
			throw new Error(
				`Attempt ${attempt.attemptId} is not regradable product evidence.`,
			);
		const manager = attempt.actors.find(({ role }) => role === "manager");
		if (!manager)
			throw new Error(`Attempt ${attempt.attemptId} has no manager actor.`);
		if (
			canonicalJson(evidence.attempt) !==
				canonicalJson({
					attemptId: attempt.attemptId,
					cellId: attempt.cellId,
					caseId: attempt.caseId,
					repetition: attempt.repetition,
					model: manager.requestedModel,
				}) ||
			canonicalJson(evidence.usage) !== canonicalJson(attempt.usage)
		) {
			throw new Error(`Attempt ${attempt.attemptId} retained binding differs.`);
		}
		const retainedActors = retainedReportActors(evidence);
		const retainedManager = retainedActors.find(
			({ role }) => role === "manager",
		);
		if (!retainedManager || retainedManager.sessionIds.length === 0)
			throw new Error(
				`Attempt ${attempt.attemptId} has no retained manager session.`,
			);
		for (const sessionId of retainedManager.sessionIds) {
			if (managerSessions.has(sessionId))
				throw new Error("Campaign attempts reuse a manager session identity.");
			managerSessions.add(sessionId);
		}
		const outcome = deriveConformanceOutcome({
			evidence,
			check: scenario.check,
			scenarioId: attempt.caseId,
			model: `${manager.requestedModel.routeProvider}/${manager.requestedModel.model}`,
			attempt: attempt.repetition + 1,
		});
		const commandInstructions = scenario.steps.map((step, sequence) =>
			instructionDelivery({
				source: "command",
				name: step.command,
				sequence,
				text: `/${step.command} ${step.arguments}`.trim(),
			}),
		);
		const guidanceInstructions = retainedInstructions(evidence).map(
			(instruction, sequence) => ({
				...instruction,
				sequence: commandInstructions.length + sequence,
			}),
		);
		if (
			canonicalJson(outcome) !== canonicalJson(attempt.outcome) ||
			canonicalJson(retainedActors) !== canonicalJson(attempt.actors) ||
			canonicalJson([...commandInstructions, ...guidanceInstructions]) !==
				canonicalJson(attempt.instructions)
		) {
			throw new Error(
				`Attempt ${attempt.attemptId} does not reproduce its grade.`,
			);
		}
		files.push(
			{
				role: "attempt",
				id: attempt.attemptId,
				mediaType: "application/json",
				bytes: retained.bytes,
			},
			{
				role: "transcript",
				id: attempt.attemptId,
				mediaType: "application/json",
				bytes: transcriptBytes,
			},
		);
	}
	const completionCost = result.report.attempts.some(
		(attempt) => attempt.usage.costUsd === null,
	)
		? null
		: result.report.attempts.reduce(
				(sum, attempt) => sum + (attempt.usage.costUsd ?? 0),
				0,
			);
	const expectedObserved = {
		attempts: result.report.attempts.length,
		outputTokens: result.report.attempts.reduce(
			(sum, attempt) => sum + attempt.usage.outputTokens,
			0,
		),
		costUsd: completionCost,
		wallClockMs: Math.max(
			Date.parse(result.report.completion.finishedAt) -
				Date.parse(result.report.completion.startedAt),
			...result.report.attempts.map((attempt) => attempt.usage.durationMs),
		),
	};
	if (
		canonicalJson(expectedObserved) !==
		canonicalJson(result.report.completion.observed)
	) {
		throw new Error(
			"Campaign completion usage does not reproduce attempt evidence.",
		);
	}
	const canaryRefs = [
		canary.artifacts.installation,
		canary.artifacts.session,
		canary.artifacts.transcript,
	];
	if (canaryRefs.some((ref) => ref === null))
		throw new Error("Passed canary evidence is incomplete.");
	const canaryEvidence = await Promise.all(
		canaryRefs.map(async (ref) => {
			if (!ref) throw new Error("Passed canary evidence is incomplete.");
			const bytes = await readStableQualificationInput(
				canaryDirectory,
				ref.path,
			);
			const digest = `sha256:${new Bun.CryptoHasher("sha256")
				.update(bytes)
				.digest("hex")}`;
			if (bytes.byteLength !== ref.bytes || digest !== ref.sha256)
				throw new Error("Bundled canary evidence differs from its record.");
			return bytes;
		}),
	);
	const graderSource = releaseGraderSourceBundle(repositoryRoot);
	const [canaryInstallation, canarySession, canaryTranscript] = canaryEvidence;
	if (!canaryInstallation || !canarySession || !canaryTranscript)
		throw new Error("Passed canary evidence is incomplete.");
	const retainedGraderBundle = {
		files: graderSource.files.map(({ path, source }) => ({
			path,
			sha256: canonicalSha256("flow-release-grader-file-v1", source),
		})),
	};
	if (
		result.expected.evaluator.graderBundleSha256 !==
			canonicalSha256(
				"flow-evaluator-grader-bundle-v1",
				retainedGraderBundle,
			) ||
		record.analyzerSha256 !==
			canonicalSha256("flow-decision-analyzer-v1", {
				decisionSchemaVersion: 1,
				graderBundle: retainedGraderBundle,
			})
	) {
		throw new Error("Retained grader source changed during qualification.");
	}
	const policy = {
		schemaVersion: 1,
		policySha256: RELEASE_POLICY_SHA256,
		analysisSha256: RELEASE_ANALYSIS_SHA256,
		graderBundle: retainedGraderBundle,
		analyzerSha256: record.analyzerSha256,
	};
	files.push(
		{ role: "report", mediaType: "application/json", bytes: reportBytes },
		{ role: "catalog", mediaType: "application/json", bytes: catalogBytes },
		{
			role: "policy",
			mediaType: "application/json",
			bytes: Buffer.from(canonicalJson(policy)),
		},
		{ role: "plan", mediaType: "application/json", bytes: planBytes },
		{
			role: "completion",
			mediaType: "application/json",
			bytes: completionBytes,
		},
		{
			role: "expected-provenance",
			mediaType: "application/json",
			bytes: Buffer.from(canonicalJson(result.expected)),
		},
		{
			role: "decision",
			mediaType: "application/json",
			bytes: Buffer.from(canonicalJson(record)),
		},
		{ role: "artifact", mediaType: "application/gzip", bytes: artifactBytes },
		{
			role: "canary-record",
			mediaType: "application/json",
			bytes: canaryBytes,
		},
		{
			role: "canary-installation",
			mediaType: "application/json",
			bytes: canaryInstallation,
		},
		{
			role: "canary-session",
			mediaType: "application/json",
			bytes: canarySession,
		},
		{
			role: "canary-transcript",
			mediaType: "application/json",
			bytes: canaryTranscript,
		},
		...graderSource.files.map(({ path, source }) => ({
			role: "authority-source" as const,
			id: path,
			mediaType: "text/typescript" as const,
			bytes: Buffer.from(source),
		})),
	);
	const bundle = await writeQualificationBundle({
		input: {
			reportId: result.report.reportId,
			packageVersion: artifact.packageVersion,
			verdict: record.verdict,
			files,
		},
		outputRoot:
			options["--bundles-dir"] ??
			join(repositoryRoot, "evals", "qualification", "bundles"),
	});
	process.stdout.write(`${record.verdict}: ${bundle.path}\n`);
}

if (import.meta.main) await main();
