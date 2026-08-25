import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertQualificationRecord,
	isMajorRelease,
	qualificationRecordIssue,
	releaseNotesForVersion,
	validateReleaseMetadata,
} from "../scripts/release-metadata.js";

const temporary: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function recordDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "flow-qualification-"));
	temporary.push(directory);
	return directory;
}

const VERSION = "6.0.0";
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const artifact = (packageVersion: string) => ({
	packageVersion,
	sourceCommit: "commit",
	sourceTreeSha256: digest("a"),
	tarballSha256: digest("b"),
	unpackedManifestSha256: digest("c"),
});
const decisionRecord = (packageVersion: string, verdict = "VERIFIED") => ({
	schemaVersion: 1,
	reportId: "report",
	verdict,
	artifact: artifact(packageVersion),
	reportSha256: digest("d"),
	artifactSha256: digest("e"),
	evaluatorSha256: digest("f"),
	catalogSha256: digest("9"),
	policySha256: digest("0"),
	actorSha256: digest("1"),
	analyzerSha256: digest("2"),
	expectedProvenanceSha256: digest("3"),
	decisionInputSha256: digest("4"),
});
const exactChangelog = [
	"# Changelog",
	"",
	"## [6.0.0] - 2026-07-20",
	"",
	"Exact release notes.",
	"",
	"## [5.3.0] - 2026-07-19",
	"",
	"Earlier notes.",
	"",
].join("\n");

describe("release metadata", () => {
	test("returns the exact release section for a matching tag", () => {
		const result = validateReleaseMetadata({
			packageVersion: VERSION,
			tag: `v${VERSION}`,
			changelog: exactChangelog,
		});
		expect(result.releaseNotes).toBe(
			"## [6.0.0] - 2026-07-20\n\nExact release notes.\n",
		);
	});

	test("rejects tag and changelog version mismatches", () => {
		expect(() =>
			validateReleaseMetadata({
				packageVersion: VERSION,
				tag: "v6.0.1",
				changelog: exactChangelog,
			}),
		).toThrow("Release tag/version mismatch");
		expect(() => releaseNotesForVersion(exactChangelog, "6.0.1")).toThrow(
			"Missing changelog heading for exact version 6.0.1",
		);
	});

	test("rejects duplicate exact-version headings", () => {
		expect(() =>
			releaseNotesForVersion(
				`${exactChangelog}\n## [6.0.0] - duplicate\n`,
				VERSION,
			),
		).toThrow("multiple headings for exact version 6.0.0");
	});

	test("gates only the exact x.0.0 shape", () => {
		expect(isMajorRelease("7.0.0")).toBe(true);
		expect(isMajorRelease("7.1.0")).toBe(false);
		expect(isMajorRelease("7.0.1")).toBe(false);
	});

	test("refuses a major release with no qualification record", async () => {
		const directory = await recordDirectory();
		await expect(assertQualificationRecord("7.0.0", directory)).rejects.toThrow(
			/no exact VERIFIED v2 decision record exists/,
		);
		await expect(
			assertQualificationRecord("7.1.0", directory),
		).resolves.toBeUndefined();
		await expect(
			assertQualificationRecord("7.0.1", directory),
		).resolves.toBeUndefined();
	});

	test("accepts only an exact VERIFIED v2 record and refuses mismatches", async () => {
		const directory = await recordDirectory();
		await writeFile(
			join(directory, "report.json"),
			JSON.stringify(decisionRecord("7.0.0")),
		);
		await expect(
			assertQualificationRecord("7.0.0", directory),
		).resolves.toBeUndefined();

		expect(qualificationRecordIssue("8.0.0", null)).toMatch(
			/no qualification record exists for 8\.0\.0/,
		);
		expect(
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("7.0.0"),
			}),
		).toMatch(/artifact names 7\.0\.0, not 8\.0\.0/);
		expect(
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("8.0.0", "NOT VERIFIED"),
			}),
		).toMatch(/not VERIFIED/);
		expect(
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("8.0.0"),
			}),
		).toBeNull();
		expect(
			qualificationRecordIssue("8.0.0", decisionRecord("8.0.0"), {
				...artifact("8.0.0"),
				tarballSha256: digest("9"),
			}),
		).toMatch(/does not match the rebuilt artifact/);
		expect(
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("8.0.0"),
				analyzerSha256: "sha256:short",
			}),
		).toMatch(/missing v2 decision digests/);
	});
});
