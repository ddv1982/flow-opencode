import { readFile, writeFile } from "node:fs/promises";

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
