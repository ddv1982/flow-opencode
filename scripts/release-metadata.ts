import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../evals/canonical-json.js";
import { inspectArtifact } from "../evals/provenance.js";
import type { ArtifactIdentity } from "../evals/report.js";

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
		decisionInputSha256?: unknown;
	};
	if (entry.schemaVersion !== 1 || typeof entry.reportId !== "string") {
		return `the qualification record for ${version} is not a v2 decision record`;
	}
	if (entry.artifact?.packageVersion !== version) {
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
		expectedArtifact &&
		canonicalJson(entry.artifact) !== canonicalJson(expectedArtifact)
	) {
		return `the qualification artifact does not match the rebuilt artifact for ${version}`;
	}
	return null;
}

export async function assertQualificationRecord(
	version: string,
	directory = join("evals", "decisions"),
	expectedArtifact?: ArtifactIdentity,
): Promise<void> {
	if (!isMajorRelease(version)) return;
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
			`Major release ${version} cannot proceed: no exact VERIFIED v2 decision record exists. Run \`bun run qualify -- --report <report> --catalog <catalog> --artifact <artifact>\` and commit the decision.`,
		);
	}
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
	await assertQualificationRecord(
		packageMetadata.version,
		undefined,
		expectedArtifact,
	);
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
