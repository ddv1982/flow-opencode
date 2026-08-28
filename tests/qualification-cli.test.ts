import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { canonicalJson } from "../evals/canonical-json.js";
import {
	deriveConformanceOutcome,
	retainedInstructions,
	retainedReportActors,
} from "../evals/conformance-evidence.js";
import {
	pseudonymizeEvalIds,
	pseudonymousEvalId,
	RetainedScenarioEvidenceSchema,
	scenarioGradeInput,
} from "../evals/grader-input.js";
import { packPlugin } from "../evals/harness.js";
import {
	evaluatorIdentity,
	inspectArtifact,
	instructionDelivery,
} from "../evals/provenance.js";
import { readQualificationBundle } from "../evals/qualification-bundle.js";
import {
	releaseCatalog,
	releaseGraderBundle,
	releaseHostConfigSha256,
	releaseScenarioCatalog,
} from "../evals/release-policy.js";
import { replayCassette } from "../evals/replay.js";
import { createReportStore } from "../evals/report-store.js";
import { campaignPlanFor, releaseScenarios } from "../evals/run.js";
import { SCENARIOS } from "../evals/scenarios.js";
import packageJson from "../package.json" with { type: "json" };
import { prepareCanary, recordCanary } from "../scripts/eval-canary.js";
import { assuranceProjection } from "../src/application/delivery.js";
import { SessionSchema } from "../src/application/schema.js";
import { operationInputDigest } from "../src/domain/operation.js";

const CASSETTES = {
	"happy-path": "happy-path--opencode_claude-sonnet-5--2.json",
	"plan-only-stops": "plan-only-stops--openai_gpt-5.6-sol--1.json",
	"goal-change-refused": "goal-change-refused--openai_gpt-5.6-sol--3.json",
	"continuation-accepted":
		"continuation-accepted--fixture_hand-written--1.json",
	"failing-gate-blocks":
		"failing-gate-blocks--opencode_claude-sonnet-5--1.json",
	"resumes-after-interruption":
		"resumes-after-interruption--opencode_claude-sonnet-5--3.json",
	"unprovable-claim-refused": "unprovable-claim-refused--xai_grok-4.5--1.json",
	"skipped-case-named-binding":
		"skipped-case-named-binding--fixture_hand-written--1.json",
} as const;

const FIXED_ROLES = [
	"report",
	"catalog",
	"policy",
	"plan",
	"completion",
	"expected-provenance",
	"decision",
	"artifact",
	"canary-record",
	"canary-installation",
	"canary-session",
	"canary-transcript",
] as const;

function repairedCanarySession() {
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
	const closureOperation = session.operations.find(
		(operation) => operation.id === session.closure.operationId,
	);
	if (!closureOperation)
		throw new Error("Canary closure operation is missing.");
	closureOperation.inputDigest = operationInputDigest({
		operationId: session.closure.operationId,
		expectedRevision: session.closure.recordedRevision - 1,
		sessionId: session.id,
		kind: session.closure.kind,
		summary: session.closure.summary,
	});
	return SessionSchema.parse(session);
}

function retainedReplayOutcome(
	outcome: Awaited<ReturnType<typeof replayCassette>>["outcome"],
) {
	const retained = structuredClone(outcome);
	for (const call of [...retained.flowCalls, ...retained.allCalls]) {
		Reflect.deleteProperty(call, "recordedStatus");
	}
	return retained;
}

function canaryTranscript(input: {
	readonly fixture: string;
	readonly packageVersion: string;
	readonly pluginEntrySha256: string;
	readonly session: ReturnType<typeof repairedCanarySession>;
}) {
	const call = (tool: string, output: unknown = {}) => ({
		type: "tool",
		tool,
		state: { status: "completed", input: {}, output },
	});
	return {
		info: { directory: input.fixture, version: "1.18.6" },
		messages: [
			{
				info: {
					role: "assistant",
					agent: "build",
					providerID: "fixture-provider",
					modelID: "fixture-manager",
					sessionID: "ses_manager1",
				},
				parts: [
					call("flow_status", {
						workflowData: {
							runtimeIdentity: {
								packageVersion: input.packageVersion,
								pluginEntrySha256: input.pluginEntrySha256,
							},
						},
					}),
					call("flow_plan_save"),
					call("flow_validation_start"),
					call("flow_review_start"),
					{
						type: "tool",
						tool: "task",
						state: {
							status: "completed",
							input: { subagent_type: "flow-reviewer" },
							output: {},
							metadata: {
								model: {
									providerID: "fixture-provider",
									modelID: "fixture-reviewer",
								},
								parentSessionId: "ses_manager1",
								sessionId: "ses_reviewer1",
							},
						},
					},
					call("flow_session_close", {
						workflowData: {
							delivery: { assurance: assuranceProjection(input.session) },
						},
					}),
				],
			},
			{
				info: {
					role: "assistant",
					agent: "flow-reviewer",
					providerID: "fixture-provider",
					modelID: "fixture-reviewer",
					sessionID: "ses_reviewer1",
				},
				parts: [],
			},
		],
	};
}

test("qualifies and seals a complete exact-artifact campaign through the CLI", async () => {
	const repositoryRoot = join(import.meta.dir, "..");
	const temporary = await mkdtemp(join(tmpdir(), "flow-qualification-cli-"));
	try {
		const artifactPath = await packPlugin(
			repositoryRoot,
			temporary,
			currentBunToolchain(packageJson.packageManager),
		);
		const artifact = await inspectArtifact({
			repositoryRoot,
			tarballPath: artifactPath,
		});
		const scenarios = releaseScenarios();
		const models = ["fixture-alpha/model-a", "fixture-beta/model-b"];
		const plan = campaignPlanFor({
			models,
			scenarios,
			sampling: { kind: "release" },
			opencodeVersion: "1.18.6",
		});
		const evaluator = evaluatorIdentity({
			sourceCommit: artifact.sourceCommit,
			caseCatalog: releaseScenarioCatalog(scenarios),
			policyCatalog: releaseCatalog(),
			graderBundle: releaseGraderBundle(repositoryRoot),
		});
		const campaignDirectory = join(temporary, "campaign");
		const store = createReportStore({
			directory: campaignDirectory,
			catalog: releaseCatalog(),
		});
		await store.initialize(plan);
		await store.writeCatalog(releaseCatalog());
		await store.writeArtifact(artifactPath);

		const replayedByScenario = new Map<
			string,
			Awaited<ReturnType<typeof replayCassette>>
		>();
		for (const scenario of scenarios) {
			const name = CASSETTES[scenario.id as keyof typeof CASSETTES];
			if (!name) throw new Error(`No cassette fixture for ${scenario.id}.`);
			const cassette = JSON.parse(
				await readFile(
					join(repositoryRoot, "evals", "cassettes", name),
					"utf8",
				),
			);
			const replayed = await replayCassette(cassette);
			expect(replayed.divergences, scenario.id).toEqual([]);
			expect(scenario.check(replayed.outcome), scenario.id).toEqual([]);
			replayedByScenario.set(scenario.id, replayed);
		}

		for (const cell of plan.cells) {
			const scenario = SCENARIOS.find(({ id }) => id === cell.caseId);
			const replayed = replayedByScenario.get(cell.caseId);
			const model = cell.managerModel;
			if (!scenario || !replayed || !model) {
				throw new Error(`Incomplete fixture for ${cell.cellId}.`);
			}
			const evidence = RetainedScenarioEvidenceSchema.parse({
				schemaVersion: 1,
				attempt: {
					attemptId: `attempt-${cell.cellId}`,
					cellId: cell.cellId,
					caseId: cell.caseId,
					repetition: cell.repetition,
					model,
				},
				actors: ["manager", "reviewer"].map((role, actorIndex) => ({
					role,
					sessionIds: [pseudonymousEvalId(`session:${cell.cellId}-${role}`)],
					actualModel: {
						kind: "observed",
						value: {
							providerID: model.routeProvider,
							modelID: `${model.model}-${actorIndex}`,
						},
					},
					requestedModelId: `${model.routeProvider}/${model.model}`,
					requestedModel: model,
				})),
				guidanceLoads: [],
				gradeInput: pseudonymizeEvalIds(
					scenarioGradeInput(retainedReplayOutcome(replayed.outcome)),
				),
				usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
			});
			const attemptId = `attempt-${cell.cellId}`;
			const transcript = await store.writeTranscript({
				attemptId,
				text: canonicalJson(evidence),
			});
			const commands = scenario.steps.map((step, sequence) =>
				instructionDelivery({
					source: "command",
					name: step.command,
					sequence,
					text: `/${step.command} ${step.arguments}`.trim(),
				}),
			);
			await store.writeAttempt({
				schemaVersion: 2,
				attemptId,
				cellId: cell.cellId,
				blockId: cell.blockId,
				caseId: cell.caseId,
				caseVersion: cell.caseVersion,
				armToken: cell.armToken,
				repetition: cell.repetition,
				artifact,
				evaluator,
				hostConfigSha256: releaseHostConfigSha256({
					packageVersion: artifact.packageVersion,
					model,
				}),
				actors: retainedReportActors(evidence),
				instructions: [...commands, ...retainedInstructions(evidence)],
				transcript,
				outcome: deriveConformanceOutcome({
					evidence,
					check: scenario.check,
					scenarioId: scenario.id,
					model: `${model.routeProvider}/${model.model}`,
					attempt: cell.repetition + 1,
				}),
				usage: { durationMs: 1, outputTokens: 1, costUsd: 0 },
			});
		}

		const completion = {
			status: "complete" as const,
			cause: "fixed-target" as const,
			startedAt: "2026-08-28T00:00:00.000Z",
			finishedAt: "2026-08-28T00:00:01.000Z",
			activatedReserveCellIds: [],
			observed: {
				attempts: plan.cells.length,
				outputTokens: plan.cells.length,
				costUsd: 0,
				wallClockMs: 1_000,
			},
		};
		const report = await store.finalize({
			reportId: "qualification-cli-positive",
			completion,
			allocationCommitmentSha256: null,
		});
		expect(report.attempts).toHaveLength(76);

		const preparedDirectory = join(temporary, "prepared-canary");
		await mkdir(preparedDirectory, { recursive: true });
		const recordedAt = new Date();
		const prepared = await prepareCanary({
			repositoryRoot,
			artifactPath,
			expectedArtifact: artifact,
			outputDirectory: preparedDirectory,
			preparedAt: recordedAt,
		});
		const session = repairedCanarySession();
		const canaryRoot = join(temporary, "canary-root");
		const canary = await recordCanary({
			repositoryRoot: canaryRoot,
			prepared,
			preparedDirectory,
			operator: "qualification-test",
			session,
			transcript: canaryTranscript({
				fixture: join(preparedDirectory, "fixture"),
				packageVersion: artifact.packageVersion,
				pluginEntrySha256: prepared.pluginEntrySha256,
				session,
			}),
			recordedAt,
		});
		expect(canary.record.status).toBe("passed");

		const bundlesDirectory = join(temporary, "bundles");
		const qualified = Bun.spawn(
			[
				"bun",
				"run",
				"qualify",
				"--",
				"--campaign-dir",
				campaignDirectory,
				"--canary",
				canary.path,
				"--bundles-dir",
				bundlesDirectory,
			],
			{ cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(qualified.stdout).text(),
			new Response(qualified.stderr).text(),
			qualified.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(stdout).toContain("VERIFIED:");
		const bundlePath = stdout.trim().slice("VERIFIED: ".length);
		const bundle = await readQualificationBundle(bundlePath);
		expect(bundle.manifest.verdict).toBe("VERIFIED");
		expect(bundle.manifest.packageVersion).toBe(packageJson.version);
		for (const role of FIXED_ROLES) {
			expect(
				bundle.files.filter(({ ref }) => ref.role === role && !ref.id),
				role,
			).toHaveLength(1);
		}
		const attempts = bundle.files.filter(({ ref }) => ref.role === "attempt");
		const transcripts = bundle.files.filter(
			({ ref }) => ref.role === "transcript",
		);
		expect(attempts).toHaveLength(76);
		expect(transcripts).toHaveLength(76);
		expect(attempts.map(({ ref }) => ref.id).sort()).toEqual(
			transcripts.map(({ ref }) => ref.id).sort(),
		);
		const authority = bundle.files
			.filter(({ ref }) => ref.role === "authority-source")
			.map(({ ref }) => ref.id)
			.sort();
		expect(authority).toEqual(
			releaseGraderBundle(repositoryRoot)
				.files.map(({ path }) => path)
				.sort(),
		);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 120_000);
