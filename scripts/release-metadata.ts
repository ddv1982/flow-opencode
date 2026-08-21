import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
 * Why a qualification record does not qualify this version, or null when it
 * does. The record is a checklist with a filename, not a proof: a human can
 * write one by hand. The point is that a major tag is refused without one, so
 * skipping the qualification run has to show up in the release diff.
 */
export function qualificationRecordIssue(
	version: string,
	record: unknown,
): string | null {
	const entry = record as { version?: unknown; verdict?: unknown } | null;
	if (!entry || typeof entry !== "object") {
		return `no qualification record exists for ${version}`;
	}
	if (entry.version !== version) {
		return `the qualification record names ${String(entry.version)}, not ${version}`;
	}
	if (entry.verdict !== "QUALIFIED") {
		return `the qualification record for ${version} has verdict ${String(entry.verdict)}, not QUALIFIED`;
	}
	return null;
}

export async function assertQualificationRecord(
	version: string,
	directory = join("evals", "qualification"),
): Promise<void> {
	if (!isMajorRelease(version)) return;
	let record: unknown = null;
	try {
		record = JSON.parse(
			await readFile(join(directory, `${version}.json`), "utf8"),
		);
	} catch {
		record = null;
	}
	const issue = qualificationRecordIssue(version, record);
	if (issue) {
		throw new Error(
			`Major release ${version} cannot proceed: ${issue}. Run \`bun run qualify -- --record ${version}\` against a qualifying report and commit the record.`,
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
	await assertQualificationRecord(packageMetadata.version);
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
