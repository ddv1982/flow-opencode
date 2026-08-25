import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256 } from "../evals/canonical-json.js";
import type { CanaryRecord } from "../scripts/eval-canary.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	canaryRecordSha256,
} from "../scripts/eval-canary.js";
import {
	assertQualificationRecord,
	assertStrictReleaseEvidence,
	canaryRecordIssue,
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
const bytesDigest = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
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
	canarySha256: null,
});
function canaryBoundDecision(packageVersion: string, canarySha256: string) {
	const base = decisionRecord(packageVersion);
	return {
		...base,
		canarySha256,
		decisionInputSha256: canonicalSha256("flow-decision-input-v1", {
			reportSha256: base.reportSha256,
			artifactSha256: base.artifactSha256,
			evaluatorSha256: base.evaluatorSha256,
			catalogSha256: base.catalogSha256,
			policySha256: base.policySha256,
			actorSha256: base.actorSha256,
			analyzerSha256: base.analyzerSha256,
			expectedProvenanceSha256: base.expectedProvenanceSha256,
			canarySha256,
		}),
	};
}
function canaryRecord(
	packageVersion: string,
	overrides: Record<string, unknown> = {},
) {
	const base: Omit<CanaryRecord, "recordSha256"> = {
		schemaVersion: 1 as const,
		releaseTag: `v${packageVersion}`,
		status: "passed" as const,
		artifact: artifact(packageVersion),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		artifactSha256: artifactIdentitySha256(artifact(packageVersion)),
		checks: {
			"installs-packed-artifact": true,
			"loads-flow-tools": true,
			"saves-plan": true,
			"captures-validation": true,
			"dispatches-reviewer": true,
			"closes-with-delivery": true,
		},
		operator: "maintainer@example.com",
		recordedAt: "2026-08-25T00:00:00.000Z",
		expiresAt: "2026-08-28T00:00:00.000Z",
		hostConfigSha256: digest("6"),
		actors: [
			{
				role: "manager" as const,
				requestedModel: {
					routeProvider: "openai",
					gateway: null,
					family: "gpt",
					model: "test",
					revision: null,
				},
				actualModel: {
					kind: "observed" as const,
					value: {
						routeProvider: "openai",
						gateway: null,
						family: "gpt",
						model: "test",
						revision: null,
					},
				},
				sessionIds: ["<redacted-id>"],
			},
		],
		artifacts: {
			session: {
				path: "artifacts/session.json",
				sha256: bytesDigest("session"),
				bytes: 7,
			},
			transcript: {
				path: "artifacts/transcript.json",
				sha256: bytesDigest("transcript"),
				bytes: 10,
			},
		},
		...overrides,
	};
	return {
		...base,
		recordSha256: canaryRecordSha256(base),
	};
}
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

	test("refuses every release with no qualification record", async () => {
		const directory = await recordDirectory();
		for (const version of ["7.0.0", "7.1.0", "7.0.1"]) {
			await expect(
				assertQualificationRecord(version, directory),
			).rejects.toThrow(/no exact VERIFIED v2 decision record exists/);
		}
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

	test("requires a fresh passed exact-artifact canary for non-major strict evidence", async () => {
		const decisions = await recordDirectory();
		const canaries = await recordDirectory();
		const version = "8.1.1";
		const expected = artifact(version);
		const canary = canaryRecord(version);
		await mkdir(join(canaries, "artifacts"), { recursive: true });
		await writeFile(join(canaries, "artifacts", "session.json"), "session");
		await writeFile(
			join(canaries, "artifacts", "transcript.json"),
			"transcript",
		);
		await writeFile(join(canaries, `${version}.json`), JSON.stringify(canary));
		await writeFile(
			join(decisions, "report-canary.json"),
			JSON.stringify({
				...canaryBoundDecision(version, canary.recordSha256),
				reportId: "report-canary",
				artifact: expected,
			}),
		);
		await expect(
			assertStrictReleaseEvidence({
				version,
				decisionsDirectory: decisions,
				canaryPath: join(canaries, `${version}.json`),
				expectedArtifact: expected,
			}),
		).resolves.toBeUndefined();
	});

	test("rejects stale, failed, incomplete, and artifact-mismatched canaries", () => {
		const expected = artifact("8.1.1");
		for (const record of [
			canaryRecord("8.1.1", { status: "failed" }),
			canaryRecord("8.1.1", { status: "incomplete" }),
			canaryRecord("8.1.1", {
				recordedAt: "2026-08-20T00:00:00.000Z",
				expiresAt: "2026-08-21T00:00:00.000Z",
			}),
			canaryRecord("8.1.1", { artifact: artifact("8.1.2") }),
		]) {
			expect(canaryRecordIssue("8.1.1", record, expected)).not.toBeNull();
		}
	});

	test("does not accept a null or grafted canary decision", async () => {
		const decisions = await recordDirectory();
		const canaries = await recordDirectory();
		const version = "8.1.1";
		const expected = artifact(version);
		const canary = canaryRecord(version);
		await writeFile(join(canaries, `${version}.json`), JSON.stringify(canary));
		await mkdir(join(canaries, "artifacts"), { recursive: true });
		await writeFile(join(canaries, "artifacts", "session.json"), "session");
		await writeFile(
			join(canaries, "artifacts", "transcript.json"),
			"transcript",
		);
		await writeFile(
			join(decisions, "null.json"),
			JSON.stringify(decisionRecord(version)),
		);
		await writeFile(
			join(decisions, "grafted.json"),
			JSON.stringify({
				...decisionRecord(version),
				reportId: "grafted",
				canarySha256: canary.recordSha256,
			}),
		);
		await expect(
			assertStrictReleaseEvidence({
				version,
				decisionsDirectory: decisions,
				canaryPath: join(canaries, `${version}.json`),
				expectedArtifact: expected,
			}),
		).rejects.toThrow(/canary-bound/);
	});
});
