import { describe, expect, test } from "bun:test";
import {
	releaseNotesForVersion,
	validateReleaseMetadata,
} from "../scripts/release-metadata.js";

const VERSION = "6.0.0";
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
});
