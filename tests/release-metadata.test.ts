import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import { evaluatorIdentity } from "../evals/provenance.js";
import {
	RELEASE_POLICY_SHA256,
	releaseCatalog,
	releaseGraderBundle,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import { SCENARIOS } from "../evals/scenarios.js";
import type { CanaryRecord } from "../scripts/eval-canary.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_DERIVATION_VERSION,
	canaryRecordSha256,
	deriveCanaryResult,
} from "../scripts/eval-canary.js";
import {
	assertQualificationBundle,
	assertStrictReleaseEvidence,
	canaryRecordIssue,
	isMajorRelease,
	qualificationRecordIssue,
	releaseEvidenceSummary,
	releaseNotesForVersion,
	validateReleaseMetadata,
} from "../scripts/release-metadata.js";
import { assuranceProjection } from "../src/application/delivery.js";
import { SessionSchema } from "../src/application/schema.js";
import { operationInputDigest } from "../src/domain/operation.js";

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
const CANARY_NOW = new Date("2026-08-26T00:00:00.000Z");
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const bytesDigest = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
const canarySession = (() => {
	const session = JSON.parse(
		readFileSync(
			join(import.meta.dir, "../evals/canary/artifacts/8.1.2-session.json"),
			"utf8",
		),
	) as {
		id: string;
		closure: {
			kind: "completed";
			summary: string;
			operationId: string;
			recordedRevision: number;
		};
		operations: Array<{ id: string; inputDigest: string }>;
		runs: Array<{
			validations: Array<{
				observedAssertions?: Array<{ status: string }>;
			}>;
		}>;
	};
	for (const run of session.runs) {
		for (const validation of run.validations) {
			for (const assertion of validation.observedAssertions ?? []) {
				assertion.status = "passed";
			}
		}
	}
	const operation = session.operations.find(
		(candidate) => candidate.id === session.closure.operationId,
	);
	if (!operation) throw new Error("Canary closure operation is missing.");
	operation.inputDigest = operationInputDigest({
		operationId: session.closure.operationId,
		expectedRevision: session.closure.recordedRevision - 1,
		sessionId: session.id,
		kind: session.closure.kind,
		summary: session.closure.summary,
	});
	return SessionSchema.parse(session);
})();
const canaryTranscript = (packageVersion: string) => ({
	info: { directory: "<flow-eval-workspace>", version: "1.18.6" },
	messages: [
		{
			info: {
				role: "assistant",
				agent: "build",
				providerID: "openai",
				modelID: "test",
				sessionID: "id_aaaaaaaaaaaaaaaa",
			},
			parts: [
				...[
					"flow_status",
					"flow_plan_save",
					"flow_validation_start",
					"flow_review_start",
				].map((tool) => ({
					type: "tool",
					tool,
					state: {
						status: "completed",
						input: {},
						output:
							tool === "flow_status"
								? {
										workflowData: {
											runtimeIdentity: {
												packageVersion,
												pluginEntrySha256: digest("5"),
											},
										},
									}
								: {},
					},
				})),
				{
					type: "tool",
					tool: "task",
					state: {
						status: "completed",
						input: { subagent_type: "flow-reviewer" },
						output: {},
						metadata: {
							model: { providerID: "openai", modelID: "test" },
							parentSessionId: "id_aaaaaaaaaaaaaaaa",
							sessionId: "id_bbbbbbbbbbbbbbbb",
						},
					},
				},
				{
					type: "tool",
					tool: "flow_session_close",
					state: {
						status: "completed",
						input: {},
						output: {
							workflowData: {
								delivery: {
									assurance: {
										conclusion: "completion-supported",
										checks: assuranceProjection(canarySession).checks,
									},
								},
							},
						},
					},
				},
			],
		},
		{
			info: {
				role: "assistant",
				agent: "flow-reviewer",
				providerID: "openai",
				modelID: "test",
				sessionID: "id_bbbbbbbbbbbbbbbb",
			},
			parts: [],
		},
	],
});
const artifact = (packageVersion: string) => ({
	packageVersion,
	sourceCommit: "commit",
	sourceTreeSha256: digest("a"),
	tarballSha256: digest("b"),
	unpackedManifestSha256: digest("c"),
});

test("derives a compact provider summary from verified release counts", () => {
	const summary = releaseEvidenceSummary({
		reportId: "report-summary",
		bundleSha256: digest("f"),
		artifact: artifact("8.2.0"),
		canarySha256: digest("e"),
		releaseDecision: {
			verdict: "VERIFIED",
			reasons: [],
			totals: { scheduled: 6, scored: 6, passed: 5 },
			cases: [
				{
					caseId: "case-one",
					caseVersion: 1,
					scheduled: 6,
					scored: 6,
					passed: 5,
					representedProviders: 2,
					providers: [
						{
							provider: "provider-b",
							scheduled: 3,
							scored: 3,
							passed: 2,
							passRate: 2 / 3,
						},
						{
							provider: "provider-a",
							scheduled: 3,
							scored: 3,
							passed: 3,
							passRate: 1,
						},
					],
				},
			],
		},
	});

	expect(summary.verdict).toBe("VERIFIED");
	expect(summary.providers).toEqual([
		{
			provider: "provider-a",
			scheduled: 3,
			scored: 3,
			passed: 3,
			passRate: 1,
		},
		{
			provider: "provider-b",
			scheduled: 3,
			scored: 3,
			passed: 2,
			passRate: 2 / 3,
		},
	]);
	expect(() =>
		releaseEvidenceSummary({
			reportId: "report-summary",
			bundleSha256: digest("f"),
			artifact: artifact("8.2.0"),
			canarySha256: digest("e"),
			releaseDecision: {
				verdict: "NOT VERIFIED",
				reasons: [],
				totals: { scheduled: 0, scored: 0, passed: 0 },
				cases: [],
			},
		}),
	).toThrow("requires a VERIFIED decision");
});
const decisionRecord = (packageVersion: string, verdict = "VERIFIED") => {
	const measuredArtifact = artifact(packageVersion);
	const evaluator = evaluatorIdentity({
		sourceCommit: measuredArtifact.sourceCommit,
		caseCatalog: releaseScenarioCatalog(SCENARIOS),
		policyCatalog: releaseCatalog(),
		graderBundle: releaseGraderBundle(join(import.meta.dir, "..")),
	});
	const base = {
		schemaVersion: 1,
		reportId: "report",
		verdict,
		artifact: measuredArtifact,
		reportSha256: digest("d"),
		artifactSha256: canonicalSha256(
			"flow-decision-artifact-v1",
			measuredArtifact,
		),
		evaluatorSha256: canonicalSha256("flow-decision-evaluator-v1", evaluator),
		catalogSha256: canonicalSha256(
			"flow-decision-catalog-v1",
			releaseCatalog(),
		),
		policySha256: RELEASE_POLICY_SHA256,
		actorSha256: digest("1"),
		analyzerSha256: digest("2"),
		expectedProvenanceSha256: digest("3"),
		canarySha256: null,
	};
	return {
		...base,
		decisionInputSha256: canonicalSha256("flow-decision-input-v1", {
			reportSha256: base.reportSha256,
			artifactSha256: base.artifactSha256,
			evaluatorSha256: base.evaluatorSha256,
			catalogSha256: base.catalogSha256,
			policySha256: base.policySha256,
			actorSha256: base.actorSha256,
			analyzerSha256: base.analyzerSha256,
			expectedProvenanceSha256: base.expectedProvenanceSha256,
			canarySha256: null,
		}),
	};
};
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
	const measuredArtifact = artifact(packageVersion);
	const preparedSha256 = digest("4");
	const pluginEntrySha256 = digest("5");
	const installation = {
		schemaVersion: 1 as const,
		preparedSha256,
		artifactSha256: artifactIdentitySha256(measuredArtifact),
		tarballSha256: measuredArtifact.tarballSha256,
		pluginEntrySha256,
		installedPluginSha256: pluginEntrySha256,
	};
	const derived = deriveCanaryResult({
		packageVersion,
		artifactSha256: artifactIdentitySha256(measuredArtifact),
		tarballSha256: measuredArtifact.tarballSha256,
		preparedSha256,
		pluginEntrySha256,
		installation,
		session: canarySession,
		transcript: canaryTranscript(packageVersion),
	});
	const installationJson = canonicalJson(installation);
	const sessionJson = canonicalJson(canarySession);
	const transcriptJson = canonicalJson(canaryTranscript(packageVersion));
	const base: Omit<CanaryRecord, "recordSha256"> = {
		schemaVersion: 1 as const,
		derivationVersion: CANARY_DERIVATION_VERSION,
		preparedSha256,
		pluginEntrySha256,
		releaseTag: `v${packageVersion}`,
		status: derived.status,
		artifact: measuredArtifact,
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		artifactSha256: artifactIdentitySha256(measuredArtifact),
		checks: derived.checks,
		operator: "maintainer@example.com",
		recordedAt: "2026-08-25T00:00:00.000Z",
		expiresAt: "2026-08-28T00:00:00.000Z",
		hostConfigSha256: derived.hostConfigSha256,
		actors: [...derived.actors],
		artifacts: {
			installation: {
				path: "artifacts/installation.json",
				sha256: bytesDigest(installationJson),
				bytes: Buffer.byteLength(installationJson),
			},
			session: {
				path: "artifacts/session.json",
				sha256: bytesDigest(sessionJson),
				bytes: Buffer.byteLength(sessionJson),
			},
			transcript: {
				path: "artifacts/transcript.json",
				sha256: bytesDigest(transcriptJson),
				bytes: Buffer.byteLength(transcriptJson),
			},
		},
		...overrides,
	};
	return {
		...base,
		recordSha256: canaryRecordSha256(base),
	};
}

async function writeCanaryEvidence(
	directory: string,
	packageVersion: string,
): Promise<void> {
	const measuredArtifact = artifact(packageVersion);
	const installation = {
		schemaVersion: 1,
		preparedSha256: digest("4"),
		artifactSha256: artifactIdentitySha256(measuredArtifact),
		tarballSha256: measuredArtifact.tarballSha256,
		pluginEntrySha256: digest("5"),
		installedPluginSha256: digest("5"),
	};
	await mkdir(join(directory, "artifacts"), { recursive: true });
	await Promise.all([
		writeFile(
			join(directory, "artifacts", "installation.json"),
			canonicalJson(installation),
		),
		writeFile(
			join(directory, "artifacts", "session.json"),
			canonicalJson(canarySession),
		),
		writeFile(
			join(directory, "artifacts", "transcript.json"),
			canonicalJson(canaryTranscript(packageVersion)),
		),
	]);
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
				assertQualificationBundle({ version, directory }),
			).rejects.toThrow(/no sealed qualification bundle/);
		}
	});

	test("refuses a digest-only decision as release authority", async () => {
		const directory = await recordDirectory();
		await writeFile(
			join(directory, "report.json"),
			JSON.stringify(decisionRecord("7.0.0")),
		);
		await expect(
			assertQualificationBundle({ version: "7.0.0", directory }),
		).rejects.toThrow(/no sealed qualification bundle/);

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
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("8.0.0"),
				artifactSha256: digest("e"),
			}),
		).toMatch(/artifact digest/);
		for (const field of [
			"catalogSha256",
			"policySha256",
			"evaluatorSha256",
		] as const) {
			expect(
				qualificationRecordIssue("8.0.0", {
					...decisionRecord("8.0.0"),
					[field]: digest("e"),
				}),
			).toMatch(/not current repository/);
		}
		expect(
			qualificationRecordIssue("8.0.0", {
				...decisionRecord("8.0.0"),
				decisionInputSha256: digest("e"),
			}),
		).toMatch(/decision input digest/);
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

	test("requires a regradable bundle beyond a fresh exact-artifact canary", async () => {
		const decisions = await recordDirectory();
		const canaries = await recordDirectory();
		const version = "8.1.1";
		const recorded = artifact(version);
		const expected = {
			...recorded,
			sourceCommit: "tag-commit-after-evidence",
			sourceTreeSha256: digest("8"),
		};
		const canary = canaryRecord(version);
		await writeCanaryEvidence(canaries, version);
		await writeFile(join(canaries, `${version}.json`), JSON.stringify(canary));
		await writeFile(
			join(decisions, "report-canary.json"),
			JSON.stringify({
				...canaryBoundDecision(version, canary.recordSha256),
				reportId: "report-canary",
				artifact: recorded,
			}),
		);
		await expect(
			assertStrictReleaseEvidence({
				version,
				bundlesDirectory: decisions,
				canaryPath: join(canaries, `${version}.json`),
				expectedArtifact: expected,
				now: CANARY_NOW,
			}),
		).rejects.toThrow(/no sealed qualification bundle/);
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

	test("rejects the historical caller-attested canary format", () => {
		const legacy = { ...canaryRecord("8.1.2"), derivationVersion: undefined };
		expect(
			canaryRecordIssue(
				"8.1.2",
				legacy,
				artifact("8.1.2"),
				"v8.1.2",
				CANARY_NOW,
			),
		).toMatch(/not evidence-derived/);
	});

	test("does not accept a null or grafted canary decision", async () => {
		const decisions = await recordDirectory();
		const canaries = await recordDirectory();
		const version = "8.1.1";
		const expected = artifact(version);
		const canary = canaryRecord(version);
		await writeFile(join(canaries, `${version}.json`), JSON.stringify(canary));
		await writeCanaryEvidence(canaries, version);
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
				bundlesDirectory: decisions,
				canaryPath: join(canaries, `${version}.json`),
				expectedArtifact: expected,
				now: CANARY_NOW,
			}),
		).rejects.toThrow(/no sealed qualification bundle/);
	});
});
