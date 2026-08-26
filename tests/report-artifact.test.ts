import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../evals/canonical-json.js";
import {
	type ArtifactIdentity,
	campaignPlanSha256,
	type EvalReportV2,
} from "../evals/report.js";
import { reportArtifactForCanary } from "../evals/report-artifact.js";
import { prepareCanaryFromReport } from "../scripts/eval-canary.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const model = {
	routeProvider: "provider",
	gateway: null,
	family: "family",
	model: "model",
	revision: null,
};

function report(artifact: ArtifactIdentity): EvalReportV2 {
	const plan: EvalReportV2["plan"] = {
		schemaVersion: 1,
		planId: "plan-1",
		planSha256: digest("0"),
		randomizationSeed: "seed",
		cells: [
			{
				cellId: "cell-1",
				blockId: "block-1",
				caseId: "canary-case",
				caseVersion: 1,
				armToken: null,
				repetition: 0,
				managerModel: null,
				reviewerModel: null,
				schedule: "primary",
			},
		],
		abortPolicy: { retry: "never", maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts", count: 1 },
		analysis: {
			kind: "rate",
			primaryOutcome: "pass",
			versionSha256: digest("1"),
		},
		budget: {
			maxUsd: 1,
			unknownCostPolicy: "stop",
			maxOutputTokens: 10,
			maxWallClockMs: 2_000,
			maxAttempts: 1,
		},
	};
	plan.planSha256 = campaignPlanSha256(plan);
	return {
		schemaVersion: 2,
		reportId: "report-1",
		plan,
		attempts: [
			{
				schemaVersion: 2,
				attemptId: "attempt-1",
				cellId: "cell-1",
				blockId: "block-1",
				caseId: "canary-case",
				caseVersion: 1,
				armToken: null,
				repetition: 0,
				artifact,
				evaluator: {
					sourceCommit: "evaluator-commit",
					caseCatalogSha256: digest("2"),
					policyCatalogSha256: digest("3"),
					graderBundleSha256: digest("4"),
				},
				hostConfigSha256: digest("5"),
				actors: [
					{
						role: "manager",
						requestedModel: model,
						actualModel: { kind: "observed", value: model },
						sessionIds: ["session-1"],
					},
				],
				instructions: [
					{
						source: "command",
						name: "canary",
						sequence: 0,
						sha256: digest("6"),
						bytes: 1,
					},
				],
				transcript: { sha256: digest("7"), artifact: "attempt.json" },
				outcome: {
					kind: "product",
					passed: true,
					endedBy: "quiet",
					issues: [],
					evidence: {
						kind: "conformance",
						falseCompletion: false,
						unsubmittedReviews: 0,
						facts: { durable: true },
					},
				},
				usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
			},
		],
		completion: {
			status: "complete",
			cause: "fixed-target",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: 1,
				outputTokens: 1,
				costUsd: 0,
				wallClockMs: 1_000,
			},
		},
		allocationCommitmentSha256: null,
	};
}

async function run(command: readonly string[], cwd: string): Promise<void> {
	const child = Bun.spawn([...command], { cwd, stderr: "pipe" });
	if ((await child.exited) !== 0) {
		throw new Error(await new Response(child.stderr).text());
	}
}

describe("report artifact handoff", () => {
	test("resolves only the sibling artifact measured by every attempt", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-report-artifact-root-"));
		const campaign = await mkdtemp(
			join(tmpdir(), "flow-report-artifact-campaign-"),
		);
		temporary.push(root, campaign);
		await mkdir(join(root, "dist"), { recursive: true });
		await writeFile(join(root, "dist/index.js"), "export default {}\n");
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "opencode-plugin-flow",
				version: "1.2.3",
				files: ["dist/index.js"],
			}),
		);
		for (const command of [
			["git", "init", "--initial-branch=main"],
			["git", "config", "user.email", "artifact@example.com"],
			["git", "config", "user.name", "Artifact"],
			["git", "add", "-A"],
			["git", "commit", "-m", "fixture"],
		]) {
			await run(command, root);
		}
		await run(["bun", "pm", "pack", "--destination", campaign], root);
		await rename(
			join(campaign, "opencode-plugin-flow-1.2.3.tgz"),
			join(campaign, "artifact.tgz"),
		);
		const { inspectArtifact } = await import("../evals/provenance.js");
		const artifact = await inspectArtifact({
			repositoryRoot: root,
			tarballPath: join(campaign, "artifact.tgz"),
		});
		const catalog = [
			{
				caseId: "canary-case",
				caseVersion: 1,
				evidenceClass: "conformance",
				oracle: "durable-state",
				release: "required",
				minProviders: 1,
				minScoredAttempts: 1,
				minPassRate: 1,
				reviewerPromotionRecordSha256: null,
			},
		];
		await writeFile(join(campaign, "catalog.json"), canonicalJson(catalog));
		await writeFile(
			join(campaign, "report.json"),
			canonicalJson(report(artifact)),
		);

		const resolved = await reportArtifactForCanary({
			repositoryRoot: root,
			reportPath: join(campaign, "report.json"),
		});
		expect(resolved.artifactPath).toBe(join(campaign, "artifact.tgz"));
		expect(await readFile(resolved.artifactPath)).toEqual(
			await readFile(join(campaign, "artifact.tgz")),
		);
		const preparedDirectory = join(campaign, "prepared");
		await prepareCanaryFromReport({
			repositoryRoot: root,
			reportPath: join(campaign, "report.json"),
			outputDirectory: preparedDirectory,
			preparedAt: new Date("2026-08-26T00:00:00.000Z"),
		});
		expect(await readFile(join(preparedDirectory, "artifact.tgz"))).toEqual(
			await readFile(join(campaign, "artifact.tgz")),
		);

		const mismatched = report({ ...artifact, tarballSha256: digest("9") });
		await writeFile(join(campaign, "report.json"), canonicalJson(mismatched));
		await expect(
			reportArtifactForCanary({
				repositoryRoot: root,
				reportPath: join(campaign, "report.json"),
			}),
		).rejects.toThrow(/do not match/);
	});
});
