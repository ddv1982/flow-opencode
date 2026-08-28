import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CanaryRecord,
	deriveCanaryResult,
	parseCanaryRecord,
} from "../scripts/eval-canary.js";
import type { ReleaseDecision, ReleaseExpectedProvenance } from "./analysis.js";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import type { ValidatedCaseCatalog } from "./catalog.js";
import {
	deriveConformanceOutcome,
	retainedInstructions,
	retainedReportActors,
} from "./conformance-evidence.js";
import {
	deriveRetainedFailure,
	RetainedScenarioEvidenceSchema,
} from "./grader-input.js";
import {
	inspectArtifact,
	instructionDelivery,
	samePackedArtifact,
} from "./provenance.js";
import { readQualificationBundle } from "./qualification-bundle.js";
import {
	RELEASE_ANALYSIS_SHA256,
	RELEASE_MAX_CAMPAIGN_AGE_MS,
	RELEASE_POLICY_SHA256,
	releaseGraderBundle,
} from "./release-policy.js";
import type { ValidatedReport } from "./report.js";
import { SCENARIOS } from "./scenarios.js";

type BundleFile = Awaited<
	ReturnType<typeof readQualificationBundle>
>["files"][number];
type RegradedDecision = Readonly<{
	verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";
	artifact: Exclude<
		ValidatedReport["attempts"][number]["artifact"],
		{ kind: string }
	>;
	canarySha256: string | null;
	analyzerSha256: string;
	[key: string]: unknown;
}>;
export type QualificationRegradeAuthority = Readonly<{
	qualify(input: {
		reportInput: unknown;
		catalogInput: unknown;
		artifact: RegradedDecision["artifact"];
		canary?: CanaryRecord | null;
	}): {
		report: ValidatedReport;
		catalog: ValidatedCaseCatalog;
		expected: ReleaseExpectedProvenance;
		decision: ReleaseDecision;
		canary: CanaryRecord | null;
	};
	decisionRecord(input: {
		report: ValidatedReport;
		catalog: ValidatedCaseCatalog;
		expected: ReleaseExpectedProvenance;
		decision: ReleaseDecision;
		canarySha256?: string | null;
	}): RegradedDecision;
}>;

function json(file: BundleFile): unknown {
	return JSON.parse(file.bytes.toString("utf8"));
}

function one(
	files: readonly BundleFile[],
	role: BundleFile["ref"]["role"],
	id?: string,
): BundleFile {
	const matches = files.filter(
		(file) => file.ref.role === role && file.ref.id === id,
	);
	if (matches.length !== 1)
		throw new Error(`Qualification bundle role ${role} is not unique.`);
	const match = matches[0];
	if (!match) throw new Error(`Qualification bundle role ${role} is missing.`);
	return match;
}

function digest(bytes: Uint8Array): string {
	return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
}

function verifyCanary(
	files: readonly BundleFile[],
	artifact: ValidatedReport["attempts"][number]["artifact"],
): string {
	if ("kind" in artifact)
		throw new Error("Qualification artifact is unavailable.");
	const parsed = parseCanaryRecord(json(one(files, "canary-record")));
	if (!parsed.ok) throw new Error(parsed.issues.join("; "));
	const record = parsed.value;
	const evidence = [
		[record.artifacts.installation, one(files, "canary-installation")],
		[record.artifacts.session, one(files, "canary-session")],
		[record.artifacts.transcript, one(files, "canary-transcript")],
	] as const;
	for (const [ref, file] of evidence) {
		if (
			!ref ||
			ref.bytes !== file.bytes.byteLength ||
			ref.sha256 !== digest(file.bytes)
		)
			throw new Error("Bundled canary evidence differs from its record.");
	}
	if (
		!samePackedArtifact(record.artifact, artifact) ||
		record.status !== "passed"
	)
		throw new Error("Bundled canary does not match the release artifact.");
	const derived = deriveCanaryResult({
		packageVersion: record.artifact.packageVersion,
		artifactSha256: record.artifactSha256,
		tarballSha256: record.artifact.tarballSha256,
		preparedSha256: record.preparedSha256,
		pluginEntrySha256: record.pluginEntrySha256,
		installation: json(evidence[0][1]),
		session: json(evidence[1][1]),
		transcript: json(evidence[2][1]),
	});
	if (
		derived.status !== record.status ||
		canonicalJson(derived.checks) !== canonicalJson(record.checks) ||
		canonicalJson(derived.actors) !== canonicalJson(record.actors) ||
		derived.hostConfigSha256 !== record.hostConfigSha256
	)
		throw new Error("Bundled canary claims do not reproduce from evidence.");
	return record.recordSha256;
}

function regradeAttempts(
	report: ValidatedReport,
	files: readonly BundleFile[],
): void {
	const sessions = new Set<string>();
	for (const attempt of report.attempts) {
		const retained = json(one(files, "attempt", attempt.attemptId));
		if (canonicalJson(retained) !== canonicalJson(attempt))
			throw new Error(
				`Bundled attempt ${attempt.attemptId} differs from report.`,
			);
		if (!attempt.transcript)
			throw new Error(
				`Bundled attempt ${attempt.attemptId} has no transcript.`,
			);
		const transcript = one(files, "transcript", attempt.attemptId);
		if (digest(transcript.bytes) !== attempt.transcript.sha256)
			throw new Error(
				`Bundled transcript ${attempt.attemptId} has the wrong digest.`,
			);
		const evidence = RetainedScenarioEvidenceSchema.parse(json(transcript));
		const scenario = SCENARIOS.find(({ id }) => id === attempt.caseId);
		const cell = report.plan.cells.find(
			({ cellId }) => cellId === attempt.cellId,
		);
		const manager = attempt.actors.find(({ role }) => role === "manager");
		if (!scenario || !cell?.managerModel)
			throw new Error(
				`Bundled attempt ${attempt.attemptId} is not regradable.`,
			);
		if (
			canonicalJson(evidence.attempt) !==
				canonicalJson({
					attemptId: attempt.attemptId,
					cellId: attempt.cellId,
					caseId: attempt.caseId,
					repetition: attempt.repetition,
					model: cell.managerModel,
				}) ||
			canonicalJson(evidence.usage) !== canonicalJson(attempt.usage)
		)
			throw new Error(`Bundled attempt ${attempt.attemptId} binding differs.`);
		const actors = retainedReportActors(evidence);
		const retainedManager = actors.find(({ role }) => role === "manager");
		const commands = scenario.steps.map((step, sequence) =>
			instructionDelivery({
				source: "command",
				name: step.command,
				sequence,
				text: `/${step.command} ${step.arguments}`.trim(),
			}),
		);
		const guidance = retainedInstructions(evidence).map(
			(instruction, sequence) => ({
				...instruction,
				sequence: commands.length + sequence,
			}),
		);
		if (attempt.outcome.kind === "failure") {
			const derivedFailure = deriveRetainedFailure(evidence);
			const expectedFailure = {
				origin: attempt.outcome.origin,
				code: attempt.outcome.code,
				retryable: attempt.outcome.retryable,
			};
			if (
				(attempt.outcome.origin !== "host" &&
					attempt.outcome.origin !== "provider") ||
				!attempt.outcome.retryable ||
				canonicalJson(derivedFailure) !== canonicalJson(expectedFailure) ||
				canonicalJson(evidence.failure) !== canonicalJson(derivedFailure) ||
				canonicalJson(actors) !== canonicalJson(attempt.actors) ||
				canonicalJson([...commands, ...guidance]) !==
					canonicalJson(attempt.instructions)
			)
				throw new Error(
					`Bundled failure attempt ${attempt.attemptId} does not reproduce.`,
				);
			if (retainedManager) {
				for (const id of retainedManager.sessionIds) {
					if (sessions.has(id))
						throw new Error("Bundled attempts reuse manager evidence.");
					sessions.add(id);
				}
			}
			continue;
		}
		if (!manager || !retainedManager || attempt.outcome.kind !== "product")
			throw new Error(
				`Bundled attempt ${attempt.attemptId} is not a product measurement.`,
			);
		if (
			(evidence.failure !== null && evidence.failure !== undefined) ||
			(evidence.failureObservation !== null &&
				evidence.failureObservation !== undefined)
		)
			throw new Error("Bundled product attempt carries a failure claim.");
		for (const id of retainedManager.sessionIds) {
			if (sessions.has(id))
				throw new Error("Bundled attempts reuse manager evidence.");
			sessions.add(id);
		}
		const outcome = deriveConformanceOutcome({
			evidence,
			check: scenario.check,
			scenarioId: attempt.caseId,
			model: `${evidence.attempt.model.routeProvider}/${evidence.attempt.model.model}`,
			attempt: attempt.repetition + 1,
		});
		if (
			canonicalJson(outcome) !== canonicalJson(attempt.outcome) ||
			canonicalJson(actors) !== canonicalJson(attempt.actors) ||
			canonicalJson([...commands, ...guidance]) !==
				canonicalJson(attempt.instructions)
		)
			throw new Error(`Bundled attempt ${attempt.attemptId} grade differs.`);
	}
	const cost = report.attempts.some((attempt) => attempt.usage.costUsd === null)
		? null
		: report.attempts.reduce(
				(sum, attempt) => sum + (attempt.usage.costUsd ?? 0),
				0,
			);
	const observed = {
		attempts: report.attempts.length,
		outputTokens: report.attempts.reduce(
			(sum, attempt) => sum + attempt.usage.outputTokens,
			0,
		),
		costUsd: cost,
		wallClockMs: Math.max(
			Date.parse(report.completion.finishedAt) -
				Date.parse(report.completion.startedAt),
			...report.attempts.map((attempt) => attempt.usage.durationMs),
		),
	};
	if (canonicalJson(observed) !== canonicalJson(report.completion.observed))
		throw new Error("Bundled completion usage does not reproduce.");
}

export async function regradeQualificationBundle(input: {
	readonly path: string;
	readonly repositoryRoot: string;
	readonly authority: QualificationRegradeAuthority;
	readonly now?: Date;
}): Promise<{
	readonly decision: RegradedDecision;
	readonly bundleSha256: string;
}> {
	const bundle = await readQualificationBundle(input.path);
	const files = bundle.files;
	const reportInput = json(one(files, "report"));
	const catalogInput = json(one(files, "catalog"));
	const planStored = json(one(files, "plan"));
	const completionStored = json(one(files, "completion"));
	const policy = json(one(files, "policy")) as Record<string, unknown>;
	const expectedStored = json(one(files, "expected-provenance"));
	const decisionStored = json(one(files, "decision"));
	const bundledGrader = {
		files: files
			.filter(({ ref }) => ref.role === "authority-source")
			.map(({ ref, bytes }) => ({
				path: ref.id,
				sha256: canonicalSha256(
					"flow-release-grader-file-v1",
					bytes.toString("utf8"),
				),
			}))
			.sort((left, right) =>
				String(left.path).localeCompare(String(right.path)),
			),
	};
	if (
		policy.policySha256 !== RELEASE_POLICY_SHA256 ||
		policy.analysisSha256 !== RELEASE_ANALYSIS_SHA256 ||
		canonicalJson(policy.graderBundle) !== canonicalJson(bundledGrader) ||
		canonicalJson(policy.graderBundle) !==
			canonicalJson(releaseGraderBundle(input.repositoryRoot))
	)
		throw new Error("Bundled release authority does not match the verifier.");
	const temporary = await mkdtemp(join(tmpdir(), "flow-bundle-regrade-"));
	const artifactPath = join(temporary, "artifact.tgz");
	try {
		await writeFile(artifactPath, one(files, "artifact").bytes);
		const artifact = await inspectArtifact({
			repositoryRoot: input.repositoryRoot,
			tarballPath: artifactPath,
		});
		const prelim = input.authority.qualify({
			reportInput,
			catalogInput,
			artifact,
		});
		const firstAttempt = prelim.report.attempts.at(0);
		if (!firstAttempt) throw new Error("Bundled report has no attempts.");
		const canarySha256 = verifyCanary(files, firstAttempt.artifact);
		const parsedCanary = parseCanaryRecord(json(one(files, "canary-record")));
		if (!parsedCanary.ok) throw new Error(parsedCanary.issues.join("; "));
		const result = input.authority.qualify({
			reportInput,
			catalogInput,
			artifact,
			canary: parsedCanary.value,
		});
		const now = (input.now ?? new Date()).getTime();
		const campaignFinished = Date.parse(result.report.completion.finishedAt);
		const canaryRecorded = Date.parse(parsedCanary.value.recordedAt);
		if (
			campaignFinished > canaryRecorded ||
			canaryRecorded > now ||
			campaignFinished > now ||
			now - campaignFinished > RELEASE_MAX_CAMPAIGN_AGE_MS
		)
			throw new Error("Bundled campaign and canary freshness is invalid.");
		if (
			canonicalJson(planStored) !== canonicalJson(result.report.plan) ||
			canonicalJson(completionStored) !==
				canonicalJson(result.report.completion)
		)
			throw new Error("Bundled plan or completion differs from the report.");
		regradeAttempts(result.report, files);
		if (canonicalJson(result.expected) !== canonicalJson(expectedStored))
			throw new Error("Bundled expected provenance does not reproduce.");
		const decision = input.authority.decisionRecord({
			...result,
			canarySha256,
		});
		if (
			decision.verdict !== "VERIFIED" ||
			canonicalJson(decision) !== canonicalJson(decisionStored)
		)
			throw new Error("Bundled decision does not reproduce.");
		if (
			bundle.manifest.reportId !== result.report.reportId ||
			bundle.manifest.packageVersion !== artifact.packageVersion ||
			bundle.manifest.verdict !== decision.verdict ||
			policy.analyzerSha256 !== decision.analyzerSha256
		)
			throw new Error(
				"Bundled manifest or analyzer identity does not reproduce.",
			);
		return { decision, bundleSha256: bundle.manifest.bundleSha256 };
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
