import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	adaptSanitizedHostObservation,
	buildHarnessResourceReport,
	canEnableHarnessEnforcement,
	canonicalHarnessFindingDecisions,
	canonicalHarnessRefutedCandidates,
	harnessFixturePrivacyIssues,
	parseHarnessResourceFixture,
	resolvePromotedHarnessRollout,
} from "../src/application/harness/resource-report.js";
import { FlowHostObservationRegistry } from "../src/platform/opencode/observation.js";

const fixturePath = resolve("tests/fixtures/harness/full-repo-audit-v1.json");

async function fixture() {
	return JSON.parse(await readFile(fixturePath, "utf8"));
}

function digest(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function runCli(...args: string[]) {
	const process = Bun.spawn(
		["bun", "run", "scripts/harness-resource-report.ts", ...args],
		{ cwd: resolve("."), stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("harness resource report", () => {
	test("validates the privacy-safe control and keeps unavailable metrics null", async () => {
		const parsed = parseHarnessResourceFixture(await fixture());
		const control = parsed.observations[0];
		expect(control?.variant).toBe("control");
		expect(control?.sessionCount.value).toBe(11);
		expect(control?.toolCallCount.value).toBe(962);
		expect(control?.readCallCount.value).toBe(711);
		expect(control?.childSessionCount).toEqual({
			value: null,
			provenance: "unavailable",
		});
		expect(control?.quality?.findingDecisions).toHaveLength(47);
		expect(control?.quality?.refutedCandidateIDs).toHaveLength(3);
		expect(harnessFixturePrivacyIssues(parsed)).toEqual([]);
	});

	test("recomputes per-finding and refuted-candidate digests", async () => {
		const parsed = parseHarnessResourceFixture(await fixture());
		const quality = parsed.observations[0]?.quality;
		expect(quality).not.toBeNull();
		if (!quality) throw new Error("Expected control quality.");
		expect(
			digest(canonicalHarnessFindingDecisions(quality.findingDecisions)),
		).toBe(quality.findingDecisionDigest);
		expect(
			digest(canonicalHarnessRefutedCandidates(quality.refutedCandidateIDs)),
		).toBe(quality.refutedCandidateDigest);
	});

	test("reports candidates as unavailable until same-corpus canaries exist", async () => {
		const report = buildHarnessResourceReport(await fixture());
		expect(report).toEqual({
			schemaVersion: 1,
			caseID: "full-repo-audit-v1",
			controlStatus: "observed",
			gates: [
				{
					variant: "standard",
					status: "unavailable",
					reasons: ["A same-corpus observed candidate is not available."],
				},
				{
					variant: "assurance",
					status: "unavailable",
					reasons: ["A same-corpus observed candidate is not available."],
				},
			],
		});
		expect(canEnableHarnessEnforcement(report, "standard")).toBe(false);
		expect(canEnableHarnessEnforcement(report, "assurance")).toBe(false);
		expect(
			resolvePromotedHarnessRollout({
				report,
				variant: "standard",
				requested: "enforce",
			}),
		).toBe("observe");
	});

	test("rejects unavailable-as-zero and private payloads", async () => {
		const raw = await fixture();
		raw.observations[1].readCallCount = {
			value: 0,
			provenance: "unavailable",
		};
		expect(() => parseHarnessResourceFixture(raw)).toThrow(
			"Unavailable harness metrics must use null",
		);

		const privatePayload = await fixture();
		privatePayload.extra = "/Users/person/private";
		expect(harnessFixturePrivacyIssues(privatePayload)).toEqual([
			"Harness fixture contains a forbidden absolute Unix path.",
		]);
		expect(() => parseHarnessResourceFixture(privatePayload)).toThrow();
	});

	test("adapts a sanitized live report without carrying raw host data", async () => {
		const registry = new FlowHostObservationRegistry({ signatureSalt: "test" });
		registry.observeChatMessage({
			sessionID: "private-session",
			agent: "worker",
		});
		registry.observeEvent({
			type: "message.updated",
			properties: {
				info: {
					id: "private-message",
					sessionID: "private-session",
					role: "assistant",
					providerID: "provider",
					modelID: "model",
					cost: 0,
					tokens: {
						input: 100,
						output: 10,
						reasoning: 0,
						cache: { read: 40, write: 0 },
					},
				},
			},
		});
		registry.observeToolBefore(
			{ tool: "read", sessionID: "private-session", callID: "private-call" },
			{ args: { path: "/Users/person/private.ts" } },
		);
		const report = registry.snapshot("private-session");
		if (!report) throw new Error("Expected host observation report.");
		const control = parseHarnessResourceFixture(await fixture())
			.observations[0];
		if (!control) throw new Error("Expected control observation.");
		const adapted = adaptSanitizedHostObservation({
			variant: "standard",
			sourceRevisionKey: control.sourceRevisionKey,
			modelConfigurationKey: control.modelConfigurationKey,
			report,
			quality: null,
		});
		expect(adapted).toMatchObject({
			variant: "standard",
			status: "unavailable",
			sessionCount: { value: 1, provenance: "host_observed" },
			toolCallCount: { value: 1, provenance: "host_observed" },
			readCallCount: { value: 1, provenance: "host_observed" },
			uncachedInputTokens: { value: 60, provenance: "host_observed" },
			quality: null,
		});
		const serialized = JSON.stringify(adapted);
		expect(serialized).not.toContain("private-session");
		expect(serialized).not.toContain("private-call");
		expect(serialized).not.toContain("private.ts");
		const candidateFixture = await fixture();
		candidateFixture.observations[1] = adapted;
		expect(
			parseHarnessResourceFixture(candidateFixture).observations[1],
		).toEqual(adapted);

		const overflowed = adaptSanitizedHostObservation({
			variant: "standard",
			sourceRevisionKey: control.sourceRevisionKey,
			modelConfigurationKey: control.modelConfigurationKey,
			report: {
				...report,
				overflow: { ...report.overflow, readSignatures: 1 },
			},
			quality: null,
		});
		expect(overflowed.uniqueReadCount).toEqual({
			value: null,
			provenance: "unavailable",
		});
	});

	test("requires hashed correctness parity, clean closure, and lower work", async () => {
		const raw = await fixture();
		const control = raw.observations[0];
		const standard = raw.observations[1];
		standard.status = "observed";
		standard.quality = {
			...control.quality,
			remediationContradictionCount: 0,
			workflowClosedCleanly: true,
		};
		standard.sessionCount = { value: 8, provenance: "host_observed" };
		standard.toolCallCount = { value: 700, provenance: "host_observed" };
		standard.readCallCount = { value: 500, provenance: "host_observed" };
		let report = buildHarnessResourceReport(raw);
		expect(report.gates[0]).toEqual({
			variant: "standard",
			status: "pass",
			reasons: [],
		});
		expect(canEnableHarnessEnforcement(report, "standard")).toBe(true);
		expect(canEnableHarnessEnforcement(report, "assurance")).toBe(false);
		expect(
			resolvePromotedHarnessRollout({
				report,
				variant: "standard",
				requested: "enforce",
			}),
		).toBe("enforce");
		expect(
			resolvePromotedHarnessRollout({
				report,
				variant: "assurance",
				requested: "enforce",
			}),
		).toBe("observe");

		standard.toolCallCount = { value: 1_000, provenance: "host_observed" };
		report = buildHarnessResourceReport(raw);
		expect(report.gates[0]?.status).toBe("fail");
		expect(report.gates[0]?.reasons).toContain(
			"Candidate increased comparable observed work: toolCallCount.",
		);
		standard.toolCallCount = { value: 700, provenance: "host_observed" };

		standard.quality.findingDecisionDigest = `sha256:${"0".repeat(64)}`;
		standard.quality.refutedCandidateDigest = `sha256:${"1".repeat(64)}`;
		report = buildHarnessResourceReport(raw);
		expect(report.gates[0]?.status).toBe("fail");
		expect(report.gates[0]?.reasons).toContain(
			"Candidate changed the independently labeled finding decisions.",
		);
		expect(report.gates[0]?.reasons).toContain(
			"Candidate changed the independently labeled refutations.",
		);
		expect(canEnableHarnessEnforcement(report, "standard")).toBe(false);
	});

	test("rejects changed opaque decisions even when aggregate counts match", async () => {
		const raw = await fixture();
		const control = raw.observations[0];
		const standard = raw.observations[1];
		const findingDecisions = structuredClone(control.quality.findingDecisions);
		findingDecisions[0].decision = "partially_supported";
		findingDecisions[40].decision = "fully_supported";
		const refutedCandidateIDs = [
			...control.quality.refutedCandidateIDs.slice(0, 2),
			"case-refuted-candidate-004",
		];
		standard.status = "observed";
		standard.quality = {
			...structuredClone(control.quality),
			findingDecisions,
			refutedCandidateIDs,
			findingDecisionDigest: digest(
				canonicalHarnessFindingDecisions(findingDecisions),
			),
			refutedCandidateDigest: digest(
				canonicalHarnessRefutedCandidates(refutedCandidateIDs),
			),
			remediationContradictionCount: 0,
			workflowClosedCleanly: true,
		};
		standard.toolCallCount = { value: 700, provenance: "host_observed" };
		const gate = buildHarnessResourceReport(raw).gates[0];
		expect(gate?.status).toBe("fail");
		expect(gate?.reasons).toContain(
			"Candidate changed the independently labeled finding decisions.",
		);
		expect(gate?.reasons).toContain(
			"Candidate changed the independently labeled refutations.",
		);
	});

	test("uses strict CLI arguments and fails required fail or unavailable gates", async () => {
		const concise = await runCli("--fixture", fixturePath);
		expect(concise.exitCode).toBe(0);
		expect(concise.stdout).toBe(
			"full-repo-audit-v1 control=observed standard=unavailable assurance=unavailable\n",
		);
		expect(concise.stderr).toBe("");

		const json = await runCli("--fixture", fixturePath, "--json");
		expect(json.exitCode).toBe(0);
		expect(JSON.parse(json.stdout).caseID).toBe("full-repo-audit-v1");

		const required = await runCli(
			"--fixture",
			fixturePath,
			"--require",
			"standard",
		);
		expect(required.exitCode).toBe(1);
		expect(required.stdout).toContain("standard=unavailable");

		const temporaryDirectory = await mkdtemp(join(tmpdir(), "flow-harness-"));
		try {
			const failingFixture = await fixture();
			const control = failingFixture.observations[0];
			failingFixture.observations[1] = {
				...structuredClone(control),
				variant: "standard",
				toolCallCount: { value: 700, provenance: "host_observed" },
			};
			const failingPath = join(temporaryDirectory, "fixture.json");
			await writeFile(failingPath, JSON.stringify(failingFixture), "utf8");
			const failing = await runCli(
				"--fixture",
				failingPath,
				"--require",
				"standard",
				"--json",
			);
			expect(failing.exitCode).toBe(1);
			expect(JSON.parse(failing.stdout).gates[0].status).toBe("fail");
		} finally {
			await rm(temporaryDirectory, { recursive: true, force: true });
		}

		const unknown = await runCli("--fixture", fixturePath, "--unknown");
		expect(unknown.exitCode).toBe(2);
		expect(unknown.stderr).toContain("Unknown argument");

		const conflicting = await runCli(
			"--fixture",
			fixturePath,
			"--json",
			"--json",
		);
		expect(conflicting.exitCode).toBe(2);
		expect(conflicting.stderr).toContain("Conflicting --json");
	});
});
