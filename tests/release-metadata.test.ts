import { describe, expect, test } from "bun:test";
import {
	releaseNotesForVersion,
	validateReleaseMetadata,
} from "../scripts/release-metadata.js";

const VERSION = "5.2.2";
const exactChangelog = [
	"# Changelog",
	"",
	"## [5.2.2] - 2026-07-19",
	"",
	"Exact release notes.",
	"",
	"## [5.2.0] - 2026-07-18",
	"",
	"Earlier notes.",
	"",
].join("\n");

function metadata(changelog = exactChangelog) {
	return {
		packageVersion: VERSION,
		tag: `v${VERSION}`,
		changelog,
		installDocuments: [
			{
				path: "README.md",
				content: `opencode plugin opencode-plugin-flow@${VERSION} --global`,
			},
		],
	};
}

describe("release metadata", () => {
	test("accepts the exact tag, changelog heading, and install pin", () => {
		const result = validateReleaseMetadata(metadata());
		expect(result.pinnedInstallVersions).toEqual([VERSION]);
		expect(result.releaseNotes).toBe(
			"## [5.2.2] - 2026-07-19\n\nExact release notes.\n",
		);
	});

	test("accepts @latest as the user-facing convergence installer", () => {
		const result = validateReleaseMetadata({
			...metadata(),
			installDocuments: [
				{
					path: "README.md",
					content:
						"npx -y opencode-plugin-flow@latest install --project /tmp/project --scope global",
				},
			],
		});
		expect(result.pinnedInstallVersions).toEqual([]);
	});

	for (const falsePositive of ["5x2x2", "5.2.20", "5.2.2-beta"]) {
		test(`rejects near-match changelog heading ${falsePositive}`, () => {
			expect(() =>
				releaseNotesForVersion(
					exactChangelog.replace("[5.2.2]", `[${falsePositive}]`),
					VERSION,
				),
			).toThrow(`Missing changelog heading for exact version ${VERSION}.`);
		});
	}

	test("rejects a tag or install pin that is not exactly the package version", () => {
		expect(() =>
			validateReleaseMetadata({ ...metadata(), tag: "v5.2.20" }),
		).toThrow("Release tag/version mismatch");
		expect(() =>
			validateReleaseMetadata({
				...metadata(),
				installDocuments: [
					{
						path: "README.md",
						content: "opencode plugin opencode-plugin-flow@5.2.2-beta --global",
					},
				],
			}),
		).toThrow("README.md pins opencode-plugin-flow@5.2.2-beta");
	});

	for (const suffix of ["_extra", "/extra", ".postfix"]) {
		test(`rejects an install-pin prefix followed by ${suffix}`, () => {
			expect(() =>
				validateReleaseMetadata({
					...metadata(),
					installDocuments: [
						{
							path: "README.md",
							content: `opencode plugin opencode-plugin-flow@${VERSION}${suffix} --global`,
						},
					],
				}),
			).toThrow(`README.md pins opencode-plugin-flow@${VERSION}${suffix}`);
		});
	}
});
