import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalSha256 } from "../evals/canonical-json.js";
import {
	evaluatorIdentity,
	inspectArtifact,
	samePackedArtifact,
} from "../evals/provenance.js";
import {
	RELEASE_POLICY_SHA256,
	releaseCatalog,
	releaseGraderBundle,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import {
	type ArtifactIdentity,
	ArtifactIdentitySchema,
} from "../evals/report.js";
import { SCENARIOS } from "../evals/scenarios.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_DERIVATION_VERSION,
	type CanaryRecord,
	canaryRecordSha256,
	parseCanaryRecord,
	canaryRecordIssue as verifyCanaryRecord,
} from "./eval-canary.js";

export function canaryRecordIssue(
	version: string,
	record: unknown,
	expectedArtifact: ArtifactIdentity,
	expectedTag = `v${version}`,
	now = new Date(),
): string | null {
	if (!record || typeof record !== "object" || Array.isArray(record))
		return `no canary record exists for ${version}`;
	const entry = record as Partial<CanaryRecord>;
	if (entry.schemaVersion !== 1 || entry.status !== "passed")
		return `the canary for ${version} is not a passed v1 record`;
	if (entry.derivationVersion !== CANARY_DERIVATION_VERSION)
		return `the canary record for ${version} is not evidence-derived`;
	if (entry.releaseTag !== expectedTag)
		return `the canary tag ${String(entry.releaseTag)} does not match ${expectedTag}`;
	const parsed = parseCanaryRecord(record);
	if (!parsed.ok) return `the canary record for ${version} is invalid`;
	if (!samePackedArtifact(parsed.value.artifact, expectedArtifact))
		return `the canary artifact does not match the rebuilt artifact for ${version}`;
	const { recordSha256: _recordSha256, ...recordWithoutHash } = parsed.value;
	if (parsed.value.recordSha256 !== canaryRecordSha256(recordWithoutHash))
		return `the canary record for ${version} has an invalid digest`;
	if (
		entry.artifactSha256 !== artifactIdentitySha256(parsed.value.artifact) ||
		entry.checklistVersion !== CANARY_CHECKLIST_VERSION ||
		entry.checklistSha256 !== CANARY_CHECKLIST_SHA256 ||
		Object.values(entry.checks ?? {}).length === 0 ||
		Object.values(entry.checks ?? {}).some((passed) => !passed)
	)
		return `the canary checklist for ${version} is incomplete or failed`;
	if (
		typeof entry.operator !== "string" ||
		entry.operator.trim() === "" ||
		typeof entry.hostConfigSha256 !== "string" ||
		!/^sha256:[a-f0-9]{64}$/.test(entry.hostConfigSha256) ||
		!Array.isArray(entry.actors) ||
		entry.actors.length === 0
	)
		return `the canary for ${version} is missing operator, host, or actor evidence`;
	const recorded = Date.parse(entry.recordedAt ?? "");
	const expires = Date.parse(entry.expiresAt ?? "");
	if (
		!Number.isFinite(recorded) ||
		!Number.isFinite(expires) ||
		recorded >= expires
	)
		return `the canary timestamps for ${version} are invalid`;
	if (recorded > now.getTime())
		return `the canary for ${version} is future-dated`;
	if (expires <= now.getTime()) return `the canary for ${version} is stale`;
	for (const artifact of [
		entry.artifacts?.session,
		entry.artifacts?.transcript,
	]) {
		if (
			!artifact ||
			typeof artifact.path !== "string" ||
			artifact.path.startsWith("/") ||
			artifact.path.split("/").includes("..") ||
			!/^sha256:[a-f0-9]{64}$/.test(artifact.sha256) ||
			!Number.isSafeInteger(artifact.bytes) ||
			artifact.bytes < 0
		)
			return `the canary redacted artifacts for ${version} are invalid`;
	}
	return null;
}

export type ReleaseMetadataInput = {
	packageVersion: string;
	tag?: string | undefined;
	changelog: string;
};

export type ReleaseMetadataResult = {
	releaseNotes: string;
};

function changelogHeadingVersion(line: string): string | null {
	const bracketed = /^##[\t ]+\[([^\]\r\n]+)\](?:[\t ]+.*)?$/.exec(line);
	if (bracketed?.[1]) return bracketed[1];
	const plain = /^##[\t ]+([^\t \r\n]+)(?:[\t ]+.*)?$/.exec(line);
	return plain?.[1] ?? null;
}

export function releaseNotesForVersion(
	changelog: string,
	version: string,
): string {
	const lines = changelog.replaceAll("\r\n", "\n").split("\n");
	const matchingHeadings = lines.flatMap((line, index) =>
		changelogHeadingVersion(line) === version ? [index] : [],
	);
	if (matchingHeadings.length !== 1) {
		throw new Error(
			matchingHeadings.length === 0
				? `Missing changelog heading for exact version ${version}.`
				: `Changelog contains multiple headings for exact version ${version}.`,
		);
	}
	const start = matchingHeadings[0] as number;
	const nextHeading = lines.findIndex(
		(line, index) => index > start && changelogHeadingVersion(line) !== null,
	);
	const end = nextHeading === -1 ? lines.length : nextHeading;
	return `${lines.slice(start, end).join("\n").trimEnd()}\n`;
}

export function validateReleaseMetadata(
	input: ReleaseMetadataInput,
): ReleaseMetadataResult {
	if (input.tag !== undefined && input.tag !== `v${input.packageVersion}`) {
		throw new Error(
			`Release tag/version mismatch: tag=${input.tag}, package.json=${input.packageVersion}.`,
		);
	}
	const releaseNotes = releaseNotesForVersion(
		input.changelog,
		input.packageVersion,
	);
	return { releaseNotes };
}

/** A major release version is exactly `x.0.0`. */
export function isMajorRelease(version: string): boolean {
	return /^\d+\.0\.0$/.test(version);
}

/**
 * Why a v2 decision record does not qualify this version, or null when it does.
 * The release path accepts only a parsed, three-valued decision whose measured
 * artifact package version is exact and whose verdict is VERIFIED.
 */
export function qualificationRecordIssue(
	version: string,
	record: unknown,
	expectedArtifact?: ArtifactIdentity,
	expectedCanarySha256?: string,
): string | null {
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return `no qualification record exists for ${version}`;
	}
	const entry = record as {
		schemaVersion?: unknown;
		reportId?: unknown;
		verdict?: unknown;
		artifact?: ArtifactIdentity | null;
		reportSha256?: unknown;
		artifactSha256?: unknown;
		evaluatorSha256?: unknown;
		catalogSha256?: unknown;
		policySha256?: unknown;
		actorSha256?: unknown;
		analyzerSha256?: unknown;
		expectedProvenanceSha256?: unknown;
		canarySha256?: unknown;
		decisionInputSha256?: unknown;
	};
	if (entry.schemaVersion !== 1 || typeof entry.reportId !== "string") {
		return `the qualification record for ${version} is not a v2 decision record`;
	}
	const parsedArtifact = ArtifactIdentitySchema.safeParse(entry.artifact);
	if (!parsedArtifact.success) {
		return `the qualification artifact for ${version} is invalid`;
	}
	if (parsedArtifact.data.packageVersion !== version) {
		return `the qualification artifact names ${String(entry.artifact?.packageVersion)}, not ${version}`;
	}
	if (entry.verdict !== "VERIFIED") {
		return `the qualification record for ${version} has verdict ${String(entry.verdict)}, not VERIFIED`;
	}
	const digests = [
		entry.reportSha256,
		entry.artifactSha256,
		entry.evaluatorSha256,
		entry.catalogSha256,
		entry.policySha256,
		entry.actorSha256,
		entry.analyzerSha256,
		entry.expectedProvenanceSha256,
		entry.decisionInputSha256,
	];
	if (
		!digests.every(
			(digest) =>
				typeof digest === "string" && /^sha256:[a-f0-9]{64}$/.test(digest),
		)
	) {
		return `the qualification record for ${version} is missing v2 decision digests`;
	}
	if (
		entry.artifactSha256 !==
		canonicalSha256("flow-decision-artifact-v1", parsedArtifact.data)
	) {
		return `the qualification artifact digest for ${version} is invalid`;
	}
	const expectedCatalogSha256 = canonicalSha256(
		"flow-decision-catalog-v1",
		releaseCatalog(),
	);
	if (entry.catalogSha256 !== expectedCatalogSha256) {
		return `the qualification catalog digest for ${version} is not current repository policy`;
	}
	if (entry.policySha256 !== RELEASE_POLICY_SHA256) {
		return `the qualification policy digest for ${version} is not current repository policy`;
	}
	const expectedEvaluator = evaluatorIdentity({
		sourceCommit: parsedArtifact.data.sourceCommit,
		caseCatalog: releaseScenarioCatalog(SCENARIOS),
		policyCatalog: releaseCatalog(),
		graderBundle: releaseGraderBundle(join(import.meta.dir, "..")),
	});
	if (
		entry.evaluatorSha256 !==
		canonicalSha256("flow-decision-evaluator-v1", expectedEvaluator)
	) {
		return `the qualification evaluator digest for ${version} is not current repository authority`;
	}
	if (
		expectedArtifact &&
		!samePackedArtifact(parsedArtifact.data, expectedArtifact)
	) {
		return `the qualification artifact does not match the rebuilt artifact for ${version}`;
	}
	const expectedDecisionInput = canonicalSha256("flow-decision-input-v1", {
		reportSha256: entry.reportSha256,
		artifactSha256: entry.artifactSha256,
		evaluatorSha256: entry.evaluatorSha256,
		catalogSha256: entry.catalogSha256,
		policySha256: entry.policySha256,
		actorSha256: entry.actorSha256,
		analyzerSha256: entry.analyzerSha256,
		expectedProvenanceSha256: entry.expectedProvenanceSha256,
		canarySha256: entry.canarySha256 ?? null,
	});
	if (entry.decisionInputSha256 !== expectedDecisionInput) {
		return `the qualification decision input digest for ${version} is invalid`;
	}
	if (expectedCanarySha256 !== undefined) {
		if (entry.canarySha256 !== expectedCanarySha256)
			return `the qualification record for ${version} is not bound to the exact canary`;
	}
	return null;
}

export async function assertQualificationRecord(
	version: string,
	directory = join("evals", "decisions"),
	expectedArtifact?: ArtifactIdentity,
): Promise<void> {
	let records: unknown[] = [];
	try {
		const { readdir } = await import("node:fs/promises");
		records = await Promise.all(
			(await readdir(directory))
				.filter((name) => name.endsWith(".json"))
				.map(async (name) =>
					JSON.parse(await readFile(join(directory, name), "utf8")),
				),
		);
	} catch {
		records = [];
	}
	if (
		!records.some(
			(record) =>
				qualificationRecordIssue(version, record, expectedArtifact) === null,
		)
	) {
		throw new Error(
			`Release ${version} cannot proceed: no exact VERIFIED v2 decision record exists. Run \`bun run qualify -- --campaign-dir <campaign> --canary <record>\` and commit the sealed bundle.`,
		);
	}
}

export async function assertStrictReleaseEvidence(input: {
	readonly version: string;
	readonly decisionsDirectory?: string;
	readonly canaryPath: string;
	readonly expectedArtifact: ArtifactIdentity;
	readonly tag?: string;
	readonly now?: Date;
}): Promise<void> {
	const tag = input.tag ?? `v${input.version}`;
	const canary = JSON.parse(
		await readFile(input.canaryPath, "utf8"),
	) as unknown;
	const canaryIssue = canaryRecordIssue(
		input.version,
		canary,
		input.expectedArtifact,
		tag,
		input.now,
	);
	if (canaryIssue) throw new Error(canaryIssue);
	const evidenceIssue = await verifyCanaryRecord({
		version: input.version,
		record: canary,
		expectedArtifact: input.expectedArtifact,
		directory: dirname(input.canaryPath),
		...(input.now ? { now: input.now } : {}),
	});
	if (evidenceIssue) throw new Error(evidenceIssue);
	const canaryHash = (canary as CanaryRecord).recordSha256;
	let records: unknown[] = [];
	try {
		const { readdir } = await import("node:fs/promises");
		records = await Promise.all(
			(await readdir(input.decisionsDirectory ?? join("evals", "decisions")))
				.filter((name) => name.endsWith(".json"))
				.map(async (name) =>
					JSON.parse(
						await readFile(
							join(
								input.decisionsDirectory ?? join("evals", "decisions"),
								name,
							),
							"utf8",
						),
					),
				),
		);
	} catch {
		records = [];
	}
	const match = records.find((record) => {
		const entry = record as {
			readonly reportSha256?: unknown;
			readonly artifactSha256?: unknown;
			readonly evaluatorSha256?: unknown;
			readonly catalogSha256?: unknown;
			readonly policySha256?: unknown;
			readonly actorSha256?: unknown;
			readonly analyzerSha256?: unknown;
			readonly expectedProvenanceSha256?: unknown;
			readonly canarySha256?: unknown;
			readonly decisionInputSha256?: unknown;
		};
		const decisionInputSha256 = canonicalSha256("flow-decision-input-v1", {
			reportSha256: entry.reportSha256,
			artifactSha256: entry.artifactSha256,
			evaluatorSha256: entry.evaluatorSha256,
			catalogSha256: entry.catalogSha256,
			policySha256: entry.policySha256,
			actorSha256: entry.actorSha256,
			analyzerSha256: entry.analyzerSha256,
			expectedProvenanceSha256: entry.expectedProvenanceSha256,
			canarySha256: canaryHash,
		});
		return (
			entry.canarySha256 === canaryHash &&
			entry.decisionInputSha256 === decisionInputSha256 &&
			qualificationRecordIssue(
				input.version,
				record,
				input.expectedArtifact,
				canaryHash,
			) === null
		);
	});
	if (!match)
		throw new Error(
			`Release ${input.version} cannot proceed: no exact VERIFIED canary-bound v2 decision record exists.`,
		);
}

function optionValue(
	args: readonly string[],
	index: number,
	option: string,
): string {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} requires a value.`);
	}
	return value;
}

async function main(args: readonly string[]): Promise<void> {
	let tag: string | undefined;
	let notesFile: string | undefined;
	let artifactPath: string | undefined;
	let canaryPath: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case "--tag":
				tag = optionValue(args, index, argument);
				index += 1;
				break;
			case "--notes-file":
				notesFile = optionValue(args, index, argument);
				index += 1;
				break;
			case "--artifact":
				artifactPath = optionValue(args, index, argument);
				index += 1;
				break;
			case "--canary":
				canaryPath = optionValue(args, index, argument);
				index += 1;
				break;
			default:
				throw new Error(`Unknown option: ${argument}`);
		}
	}
	const packageMetadata = JSON.parse(
		await readFile("package.json", "utf8"),
	) as {
		version?: unknown;
	};
	if (typeof packageMetadata.version !== "string") {
		throw new Error("package.json must contain a string version.");
	}
	const result = validateReleaseMetadata({
		packageVersion: packageMetadata.version,
		...(tag ? { tag } : {}),
		changelog: await readFile("CHANGELOG.md", "utf8"),
	});
	const expectedArtifact = artifactPath
		? await inspectArtifact({
				repositoryRoot: join(import.meta.dir, ".."),
				tarballPath: artifactPath,
			})
		: undefined;
	if (artifactPath && tag) {
		if (!canaryPath)
			throw new Error("Strict tag release metadata requires --canary.");
		if (!expectedArtifact)
			throw new Error("Strict tag release metadata requires an artifact.");
		await assertStrictReleaseEvidence({
			version: packageMetadata.version,
			tag,
			canaryPath,
			expectedArtifact,
		});
	} else if (artifactPath) {
		process.stdout.write(
			`INCONCLUSIVE: rebuilt artifact ${packageMetadata.version} has no strict tag evidence.\n`,
		);
		if (notesFile) await writeFile(notesFile, result.releaseNotes, "utf8");
		return;
	}
	if (notesFile) await writeFile(notesFile, result.releaseNotes, "utf8");
	process.stdout.write(
		`Release metadata matches ${packageMetadata.version}.\n`,
	);
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
