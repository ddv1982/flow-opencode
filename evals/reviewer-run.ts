#!/usr/bin/env bun

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import { currentBunToolchain } from "./bun-toolchain.js";
import { canonicalSha256 } from "./canonical-json.js";
import { parseCaseCatalog } from "./catalog.js";
import {
	type CommandEnd,
	EvalHost,
	type Outcome,
	packPlugin,
	preparePackageCache,
} from "./harness.js";
import {
	evaluatorIdentity,
	hostConfigSha256,
	inspectArtifact,
	instructionDelivery,
	normalizeRequestedModel,
	redactTranscript,
} from "./provenance.js";
import type {
	ActorIdentity,
	AttemptRecordV2,
	CampaignPlan,
	InstructionDelivery,
	ModelIdentity,
} from "./report.js";
import { campaignPlanSha256 } from "./report.js";
import { createReportStore } from "./report-store.js";
import {
	type DurableReviewerSubmission,
	readDurableReviewerSubmission,
	seedReviewerAssignment,
} from "./reviewer-assignment.js";
import { REVIEWER_CASES, type ReviewerCase } from "./reviewer-cases.js";

const ANALYSIS_DIGEST = canonicalSha256("flow-reviewer-analysis-v1", {
	kind: "reviewer",
	interval: "wilson",
	alpha: 0.05,
});

type Options = {
	readonly model: string;
	readonly limit: number;
};

function parseArgs(argv: readonly string[]): Options {
	let model: string | undefined;
	let limit = REVIEWER_CASES.length;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--model" && value) {
			model = value;
			index += 1;
		} else if (flag === "--limit" && value) {
			limit = Number.parseInt(value, 10);
			index += 1;
		} else if (flag === "--help" || flag === "-h") {
			console.log(
				"usage: bun run evals/reviewer-run.ts -- --model provider/model [--limit n]",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown or incomplete argument: ${flag ?? ""}`);
		}
	}
	if (!model) throw new Error("Pass --model provider/model.");
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error("--limit must be a positive integer.");
	}
	return { model, limit: Math.min(limit, REVIEWER_CASES.length) };
}

function requestedModel(modelId: string): ModelIdentity {
	const boundary = modelId.indexOf("/");
	const model = boundary >= 0 ? modelId.slice(boundary + 1) : modelId;
	return normalizeRequestedModel({
		modelId,
		gateway: model.includes("/") ? modelId.slice(0, boundary) : null,
		family: model,
		revision: null,
	});
}

function catalogFor(cases: readonly ReviewerCase[]) {
	return cases.map((entry) => ({
		caseId: entry.caseId,
		caseVersion: entry.caseVersion,
		evidenceClass: "reviewer-only" as const,
		oracle: "fixed-review-label" as const,
		release: "report-only" as const,
		minProviders: 1,
		minScoredAttempts: 1,
		minPassRate: null,
		reviewerPromotionRecordSha256: null,
	}));
}

function planFor(
	cases: readonly ReviewerCase[],
	model: ModelIdentity,
): CampaignPlan {
	const cells = cases.map((entry, index) => ({
		cellId: `cell-${canonicalSha256("flow-reviewer-cell-v1", entry.caseId).slice(7)}`,
		blockId: `block-${index}`,
		caseId: entry.caseId,
		caseVersion: entry.caseVersion,
		armToken: null,
		repetition: 0,
		managerModel: null,
		reviewerModel: model,
		schedule: "primary" as const,
	}));
	const plan = {
		schemaVersion: 1 as const,
		planId: "flow-reviewer-pilot-v1",
		planSha256: `sha256:${"0".repeat(64)}`,
		randomizationSeed: canonicalSha256("flow-reviewer-seed-v1", {
			caseIds: cases.map((entry) => entry.caseId),
			model,
		}),
		cells,
		abortPolicy: { retry: "never" as const, maxReplacementBlocks: 0 },
		stoppingRule: { kind: "fixed-attempts" as const, count: cells.length },
		analysis: {
			kind: "reviewer" as const,
			interval: "wilson" as const,
			alpha: 0.05 as const,
			versionSha256: ANALYSIS_DIGEST,
		},
		budget: {
			maxUsd: null,
			unknownCostPolicy: "token-wall-clock-bounds" as const,
			maxOutputTokens: Math.max(1, cells.length) * 200_000,
			maxWallClockMs: Math.max(1, cells.length) * 20 * 60_000,
			maxAttempts: cells.length,
		},
	};
	plan.planSha256 = campaignPlanSha256(plan);
	return plan;
}

function reportReviewerActor(
	model: ModelIdentity,
	outcome: Outcome,
): ActorIdentity | null {
	const observed = outcome.actors?.find((actor) => actor.role === "reviewer");
	if (!observed || observed.sessionIds.length === 0) return null;
	const actualModel: ActorIdentity["actualModel"] =
		observed.actualModel.kind === "observed"
			? {
					kind: "unobserved",
					reason: `Host observed reviewer providerID=${observed.actualModel.value.providerID} modelID=${observed.actualModel.value.modelID}; full family, gateway, and revision identity is unavailable.`,
				}
			: {
					kind: "unobserved",
					reason: `Reviewer identity unavailable: ${observed.actualModel.reason}.`,
				};
	return {
		role: "reviewer",
		requestedModel: model,
		actualModel,
		sessionIds: [...observed.sessionIds],
	};
}

export function reviewerOutcome(
	entry: ReviewerCase,
	submission: DurableReviewerSubmission,
	endedBy: CommandEnd,
): AttemptRecordV2["outcome"] {
	const verdict = submission.kind === "submitted" ? submission.verdict : null;
	const passed =
		verdict !== null &&
		(entry.truth === "defect" ? verdict === "failed" : verdict === "passed");
	const findings =
		submission.kind === "submitted"
			? submission.findings.map((finding) =>
					[
						finding.severity,
						finding.summary,
						...(finding.evidence ? [finding.evidence] : []),
					]
						.join(": ")
						.slice(0, 4096),
				)
			: [];
	return {
		kind: "product",
		passed,
		endedBy: endedBy === "escalated" ? "user-escalation" : "quiet",
		issues: passed ? [] : ["Reviewer verdict did not match the fixed label."],
		evidence: {
			kind: "reviewer-only",
			truth: entry.truth,
			verdict,
			findings,
			submitted: submission.kind === "submitted",
		},
	};
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const toolchain = currentBunToolchain(packageJson.packageManager);
	const cases = REVIEWER_CASES.slice(0, options.limit);
	const model = requestedModel(options.model);
	const repositoryRoot = join(import.meta.dir, "..");
	const opencodeVersion = packageJson.devDependencies["@opencode-ai/plugin"];
	const packDir = await mkdtemp(join(tmpdir(), "flow-reviewer-pack-"));
	const reportDir = join(repositoryRoot, "evals", "results");
	await mkdir(reportDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const campaignDirectory = join(reportDir, `reviewer-${stamp}.v2`);
	const catalogInput = catalogFor(cases);
	const catalog = parseCatalog(catalogInput);
	const plan = planFor(cases, model);
	const store = createReportStore({ directory: campaignDirectory, catalog });
	await store.initialize(plan);
	await store.writeCatalog(catalog);
	const startedAt = new Date().toISOString();
	try {
		const tarball = await packPlugin(repositoryRoot, packDir, toolchain);
		const artifact = await inspectArtifact({
			repositoryRoot,
			tarballPath: tarball,
		});
		await store.writeArtifact(tarball);
		const evaluator = evaluatorIdentity({
			sourceCommit: artifact.sourceCommit,
			caseCatalog: cases.map((entry) => ({
				caseId: entry.caseId,
				files: entry.files,
			})),
			policyCatalog: catalog,
			graderBundle: { sourceTreeSha256: artifact.sourceTreeSha256 },
		});
		const packageCache = await preparePackageCache(tarball, packDir, toolchain);
		const attempts: AttemptRecordV2[] = [];
		for (const [index, entry] of cases.entries()) {
			const cell = plan.cells[index];
			if (!cell) throw new Error("Reviewer campaign cell is missing.");
			const started = Date.now();
			let host: EvalHost | null = null;
			let attempt: AttemptRecordV2;
			try {
				host = await EvalHost.start({
					toolchain,
					packageCache,
					opencodeVersion,
					files: entry.files,
					reviewerModel: options.model,
				});
				const catalogModels = await host.catalogModels();
				if (!catalogModels.includes(options.model)) {
					throw new Error(
						`Reviewer model ${options.model} is absent from the host catalog.`,
					);
				}
				const seed = await seedReviewerAssignment({
					workspace: host.project,
					fixture: entry,
				});
				const sessionId = await host.createSession("reviewer evaluation");
				const commandEnd = await host.runCommand(
					sessionId,
					"flow-review",
					seed.assignmentId,
					options.model,
				);
				const outcome = await host.outcome([sessionId], Date.now() - started);
				const submission = await readDurableReviewerSubmission({
					workspace: host.project,
					seed,
				});
				const transcript = redactTranscript({
					projectPath: host.project,
					value: { calls: outcome.allCalls, finalText: outcome.finalText },
				});
				const storedTranscript = await store.writeTranscript({
					attemptId: `attempt-${cell.cellId}`,
					text: transcript.text,
				});
				const instructions: InstructionDelivery[] = [
					instructionDelivery({
						source: "command",
						name: "flow-review",
						sequence: 0,
						text: seed.assignmentId,
					}),
				];
				const actor = reportReviewerActor(model, outcome);
				attempt = {
					schemaVersion: 2,
					attemptId: `attempt-${cell.cellId}`,
					cellId: cell.cellId,
					blockId: cell.blockId,
					caseId: cell.caseId,
					caseVersion: cell.caseVersion,
					armToken: null,
					repetition: 0,
					artifact,
					evaluator,
					hostConfigSha256: hostConfigSha256({
						opencodeVersion,
						reviewerModel: options.model,
					}),
					actors: actor ? [actor] : [],
					instructions,
					transcript: {
						sha256: storedTranscript.sha256,
						artifact: storedTranscript.artifact,
					},
					outcome: reviewerOutcome(entry, submission, commandEnd),
					usage: {
						durationMs: outcome.durationMs,
						outputTokens: outcome.tokens.output,
						costUsd: outcome.costUsd,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				attempt = {
					schemaVersion: 2,
					attemptId: `attempt-${cell.cellId}`,
					cellId: cell.cellId,
					blockId: cell.blockId,
					caseId: cell.caseId,
					caseVersion: cell.caseVersion,
					armToken: null,
					repetition: 0,
					artifact,
					evaluator,
					hostConfigSha256: hostConfigSha256({
						opencodeVersion,
						reviewerModel: options.model,
					}),
					actors: [],
					instructions: [],
					transcript: null,
					outcome: {
						kind: "failure",
						origin: "host",
						code: message.slice(0, 512),
						retryable: true,
					},
					usage: {
						durationMs: Date.now() - started,
						outputTokens: 0,
						costUsd: null,
					},
				};
			} finally {
				await host?.stop();
			}
			await store.writeAttempt(attempt);
			attempts.push(attempt);
		}
		const finishedAt = new Date().toISOString();
		const complete = attempts.every(
			(attempt) => attempt.outcome.kind === "product",
		);
		const costUsd = attempts.some((attempt) => attempt.usage.costUsd === null)
			? null
			: attempts.reduce(
					(total, attempt) => total + (attempt.usage.costUsd ?? 0),
					0,
				);
		await store.finalize({
			reportId: `flow-reviewer-${stamp}`,
			completion: {
				status: complete ? "complete" : "stopped",
				cause: complete ? "fixed-target" : "host",
				startedAt,
				finishedAt,
				activatedReserveCellIds: [],
				observed: {
					attempts: attempts.length,
					outputTokens: attempts.reduce(
						(total, attempt) => total + attempt.usage.outputTokens,
						0,
					),
					costUsd,
					wallClockMs: Math.max(
						Date.parse(finishedAt) - Date.parse(startedAt),
						...attempts.map((attempt) => attempt.usage.durationMs),
					),
				},
			},
			allocationCommitmentSha256: null,
		});
		console.log(
			`Reviewer V2 report: ${join(campaignDirectory, "report.json")}`,
		);
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}
}

function parseCatalog(input: unknown) {
	const parsed = parseCaseCatalog(input);
	if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
	return parsed.value;
}

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
