import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost, type ObservedToolCall } from "../evals/harness.js";
import { JevConfiguration } from "../evals/recovery-decisions/campaign.js";
import {
	createEpisodeHostDriver,
	episodeHostIdentity,
} from "../evals/recovery-decisions/episode-host.js";
import {
	type EpisodeDriver,
	recoverEpisodeJournal,
	runEpisode,
} from "../evals/recovery-decisions/episode-runner.js";
import {
	type EpisodeArmEvidence,
	registerEpisodes,
	reportEpisodes,
} from "../evals/recovery-decisions/episodes.js";
import {
	createRequestBudget,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import packageJson from "../package.json" with { type: "json" };
import { writeExclusive } from "../scripts/lib/exclusive-json.js";
import { authorizePaidRun } from "../scripts/paid-budget.js";
import {
	currentRun,
	type FeatureRun,
	type SessionClosure,
} from "../src/domain/session.js";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";
import { loadSession } from "../src/infrastructure/fs/workspace.js";
import { frozenCampaignFixture } from "./recovery-campaign-support.js";
import { awaitQuestion } from "./recovery-operator-support.js";

const arms = ["manager-only", "manager-plus-jev"] as const;
const managers = ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const;
type WorkflowRecoveryEvidence = {
	blockedRunId: string;
	blockedRunState: FeatureRun["state"] | null;
	currentRunId: string | null;
	currentRunState: FeatureRun["state"] | null;
	closureKind: SessionClosure["kind"] | null;
};
const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const readJson = async (path: string) =>
	JSON.parse(await readFile(path, "utf8"));
async function retain(root: string, file: string, value: unknown) {
	await writeExclusive(join(root, file), value);
	const readback = await readJson(join(root, file));
	expect(readback).toEqual(value);
	return { file, sha256: sha256(await readFile(join(root, file))) };
}
async function claims(directory: string) {
	return Promise.all(
		(await readdir(directory))
			.filter((name) => name.startsWith("request-"))
			.sort()
			.map((name) => readJson(join(directory, name))),
	);
}
async function cli(args: string[]) {
	const child = Bun.spawn(
		[process.execPath, "evals/recovery-decisions/run.ts", ...args],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const timeout = setTimeout(() => child.kill(), 10000);
	try {
		expect(await child.exited).toBe(0);
	} finally {
		clearTimeout(timeout);
	}
}

test("blocked campaign fixture has repeatable frozen session bytes", async () => {
	const one = await frozenCampaignFixture(),
		two = await frozenCampaignFixture();
	expect(one).toEqual(two);
	expect(one.session.runs.at(-1)?.state).toBe("blocked");
	expect(one.session.runs).toHaveLength(2);
	const blockedFeature = one.session.plan?.features.find(
		(feature) => feature.id === one.session.runs.at(-1)?.featureId,
	);
	expect(blockedFeature?.id).toBe("parser");
	expect(blockedFeature?.targets).toContain("parser.ts");
	expect(blockedFeature?.targets).toContain("result.txt");
});

const smoke =
	process.env.FLOW_RECOVERY_CAMPAIGN_SMOKE === "1" ? test : test.skip;
const SMOKE_TIMEOUT_MS = 420_000;
const AUTHORIZATION_HEADROOM_MS = 180_000;
smoke(
	"paired native campaigns score Flow recovery after operator resumption",
	async () => {
		const requested = process.env.FLOW_RECOVERY_CAMPAIGN_OUTPUT;
		const root =
			requested ?? (await mkdtemp(join(tmpdir(), "flow-paired-campaign-")));
		if (requested) await mkdir(root, { mode: 0o700 });
		console.log(`Paired simulation evidence: ${root}`);
		const previous = process.env.FLOW_EVAL_AUTHORIZATION;
		const frozen = await frozenCampaignFixture();
		const fixtureFile = await retain(root, "fixture.json", frozen);
		const sources = Object.fromEntries(
			await Promise.all(
				[
					"tests/recovery-campaign-host.test.ts",
					"tests/recovery-campaign-support.ts",
					"tests/runtime-test-support.ts",
					"tests/recovery-operator-support.ts",
				].map(async (path) => [path, sha256(await readFile(path))]),
			),
		);
		const proofs = [];
		try {
			for (const model of managers) {
				const directory = join(root, model.split("/")[0] ?? "unknown");
				await mkdir(directory, { mode: 0o700 });
				const budget = join(directory, "budget"),
					dispatch = join(directory, "dispatch");
				const expiresAt = new Date(
					Date.now() + SMOKE_TIMEOUT_MS + AUTHORIZATION_HEADROOM_MS,
				).toISOString();
				const authorization = await createRequestBudget(budget, {
					schemaVersion: 1,
					origin: "simulation",
					purpose: "Paired recovery operator simulation",
					maxRequests: 25,
					maxMicroUsd: 123000,
					expiresAt,
					models: [
						{ model, reservationMicroUsd: 5000, basis: { kind: "simulation" } },
						{
							model: "typesafe/jev-1.13.0",
							reservationMicroUsd: 3000,
							basis: { kind: "simulation" },
						},
					],
				});
				await authorizePaidRun(dispatch, {
					schemaVersion: 1,
					purpose: "Paired simulation dispatches",
					models: [model],
					maxDispatches: 4,
					expiresAt,
				});
				process.env.FLOW_EVAL_AUTHORIZATION = dispatch;
				const drivers: EpisodeDriver[] = [];
				const evidenceFiles: { file: string; sha256: string }[] = [];
				const identities: unknown[] = [];
				for (const arm of arms) {
					let host: EvalHost | undefined;
					let observedSourceDigest: string | undefined;
					let preparedInitialState: unknown;
					let beforeQuestion:
						| {
								session: Awaited<ReturnType<typeof loadSession>>;
								calls: readonly ObservedToolCall[];
						  }
						| undefined;
					const dispatches: {
						kind: string;
						session: string;
						model: string;
						text: string;
					}[] = [];
					const base = await createEpisodeHostDriver({
						fixture: frozen.fixture,
						arm,
						manager: { model, prompt: "Frozen task" },
						operator: { kind: "file-mailbox-v1", maxInterventions: 1 },
						host: {
							toolchain: currentBunToolchain(packageJson.packageManager),
							packageCache: root,
							opencodeVersion: "1.18.31",
							opencodeExecutable:
								process.env.FLOW_RECOVERY_OPENCODE_EXECUTABLE ??
								Bun.which("opencode") ??
								"",
							providerCredentials: "disabled",
							requestBudget: {
								directory: budget,
								authorizationDigest: datasetDigest(authorization),
								managerModel: model,
							},
							recoveryTreatment: {
								origin: "simulation",
								arm,
								script: { kind: "recovery-operator-v1" },
							},
						},
						async hostFactory(options) {
							host = await EvalHost.start(options);
							const active = host;
							try {
								observedSourceDigest = await createFileSourceIdentityProvider(
									active.project,
								).computeSourceDigest();
								expect(observedSourceDigest).toBe(frozen.sourceDigest);
								expect(await loadSession(active.project)).toEqual(
									frozen.session,
								);
							} catch (error) {
								await active.stop();
								throw error;
							}
							return {
								project: active.project,
								artifactIdentity: active.artifactIdentity,
								artifactVerification: active.artifactVerification,
								createSession: active.createSession.bind(active),
								stop: active.stop.bind(active),
								escalationQuestion: active.escalationQuestion.bind(active),
								async runCommand(session, command, text, manager) {
									dispatches.push({
										kind: "command",
										session,
										model: manager,
										text,
									});
									const end = await active.runCommand(
										session,
										command,
										text,
										manager,
										{ quietMs: 200, timeoutMs: 60000, stalledMs: 15000 },
									);
									expect(end).toBe("escalated");
									beforeQuestion = {
										session: await loadSession(active.project),
										calls: (await active.outcome([session], 0)).allCalls,
									};
									const proposal = beforeQuestion.calls.find(
										(call) =>
											call.tool === "flow_status" &&
											"recoveryProposal" in call.input,
									);
									const recovery = (
										proposal?.output as {
											workflowData?: {
												recovery?: {
													recommended?: { request?: { operationId: string } };
												};
											};
										}
									)?.workflowData?.recovery;
									const resets = beforeQuestion.calls.filter(
										(call) => call.tool === "flow_feature_reset",
									);
									if (arm === "manager-plus-jev") {
										const operationId =
											recovery?.recommended?.request?.operationId;
										expect(operationId).toStartWith("flow-recovery-");
										expect(resets).toHaveLength(1);
										expect(resets[0]?.input).toMatchObject({
											request: { operationId },
										});
										expect(resets[0]?.status).toBe("completed");
										expect(beforeQuestion.session?.operations.at(-1)?.id).toBe(
											operationId,
										);
										expect(beforeQuestion.session?.revision).toBe(
											frozen.session.revision + 1,
										);
										expect(beforeQuestion.session?.runs.at(-2)?.state).toBe(
											"superseded",
										);
										expect(beforeQuestion.session?.runs.at(-1)?.state).toBe(
											"active",
										);
										expect(beforeQuestion.session?.runs).toHaveLength(
											frozen.session.runs.length + 1,
										);
										expect(
											beforeQuestion.calls.findIndex(
												(call) => call.tool === "flow_feature_reset",
											),
										).toBeLessThan(
											beforeQuestion.calls.findIndex(
												(call) => call.tool === "question",
											),
										);
									} else {
										expect(recovery?.recommended).toBeUndefined();
										expect(resets).toHaveLength(0);
										expect(beforeQuestion.session).toEqual(frozen.session);
									}
									return end;
								},
								async runPrompt(session, text, manager) {
									dispatches.push({
										kind: "prompt",
										session,
										model: manager,
										text,
									});
									return active.runPrompt(session, text, manager, {
										quietMs: 200,
										timeoutMs: 60000,
										stalledMs: 15000,
									});
								},
							};
						},
					});
					const driver: EpisodeDriver = {
						...base,
						harnessDigest: datasetDigest({
							base: base.harnessDigest,
							sources,
							scenario: "paired-recovery-operator-v1",
						}),
						async prepare(signal, scope) {
							const prepared = await base.prepare(signal, scope);
							identities.push(prepared.initialState);
							preparedInitialState = prepared.initialState;
							return prepared;
						},
						async evaluate(criteria, signal) {
							const completion = await base.evaluate(criteria, signal);
							if (!host || !beforeQuestion)
								throw new Error("Missing simulation recovery observation.");
							const finalSession = await loadSession(host.project);
							expect(finalSession).toEqual(beforeQuestion.session);
							const blockedRun = frozen.session.runs.at(-1);
							if (!blockedRun) throw new Error("Missing frozen blocked run.");
							const latestRun = finalSession
								? currentRun(finalSession, blockedRun.featureId)
								: null;
							const workflow: WorkflowRecoveryEvidence = {
								blockedRunId: blockedRun.id,
								blockedRunState:
									finalSession?.runs.find((run) => run.id === blockedRun.id)
										?.state ?? null,
								currentRunId: latestRun?.id ?? null,
								currentRunState: latestRun?.state ?? null,
								closureKind: finalSession?.closure?.kind ?? null,
							};
							const workflowMet =
								workflow.blockedRunState === "superseded" &&
								workflow.currentRunId !== null &&
								workflow.currentRunId !== workflow.blockedRunId &&
								workflow.currentRunState === "completed" &&
								workflow.closureKind === "completed";
							expect(dispatches.map((row) => row.kind)).toEqual([
								"command",
								"prompt",
							]);
							expect(new Set(dispatches.map((row) => row.session)).size).toBe(
								1,
							);
							expect(new Set(dispatches.map((row) => row.model))).toEqual(
								new Set([model]),
							);
							expect(dispatches[1]?.text).toBe(
								"Write fixed followed by a newline.",
							);
							const evidence = {
								origin: "simulation",
								attribution: "test-observed",
								initialSessionDigest: datasetDigest(frozen.session),
								observedSourceDigest,
								initialStateDigest: datasetDigest(preparedInitialState),
								beforeQuestion,
								finalSession,
								dispatches,
								completion: completion.evidence,
								workflow,
							};
							evidenceFiles.push(
								await retain(directory, `${arm}-recovery.json`, evidence),
							);
							return { met: completion.met && workflowMet, evidence };
						},
					};
					drivers.push(driver);
				}
				const [managerDriver, jevDriver] = drivers;
				if (!managerDriver || !jevDriver)
					throw new Error("Missing paired drivers.");
				expect(managerDriver.harnessDigest).not.toBe(jevDriver.harnessDigest);
				const identity = episodeHostIdentity(frozen.fixture);
				const registration = await registerEpisodes({
					schemaVersion: 1,
					split: "calibration",
					calibrationEvidenceDigest: null,
					episodes: [
						{
							id: "recovery-operator",
							taskDigest: datasetDigest(identity.task),
							initialStateDigest: datasetDigest(identity.initialState),
							completionCriteria: identity.completionCriteria,
							sourceReference: "frozen-blocked-parser-v1",
							independenceGroupId: "one-scripted-scenario",
						},
					],
					arms: {
						managerOnly: {
							model,
							prompt: "Frozen task",
							harnessDigest: managerDriver.harnessDigest,
						},
						managerPlusJev: {
							model,
							prompt: "Frozen task",
							harnessDigest: jevDriver.harnessDigest,
							jev: JevConfiguration,
						},
					},
					execution: {
						timeoutMs: 120000,
						resetProtocol:
							"Fresh isolated host with identical declared frozen files including blocked Flow session",
					},
					inference: {
						method: "paired-bootstrap-percentile-v1",
						seed: 42,
						resamples: 2000,
						confidence: 0.95,
					},
				});
				evidenceFiles.push(
					await retain(directory, "registration.json", registration),
				);
				const armEvidence: EpisodeArmEvidence[] = [];
				for (const [index, arm] of arms.entries()) {
					const driver = drivers[index];
					if (!driver) throw new Error("Missing registered arm driver.");
					const episodeDirectory = join(directory, arm);
					const controller = new AbortController();
					const running = runEpisode({
						registration,
						episodeId: "recovery-operator",
						arm,
						outputDirectory: episodeDirectory,
						recordedBy: "simulation-test",
						origin: "simulation",
						driver,
						signal: controller.signal,
					});
					const settled = running.finally(() => controller.abort());
					const respond = async () => {
						const current = await awaitQuestion(
							episodeDirectory,
							AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
						);
						expect(
							current.request.question.calls[0]?.input.questions[0]?.question,
						).toBe("Which output should I write?");
						const questionPath = join(directory, `${arm}-question.json`),
							replyPath = join(directory, `${arm}-reply.json`);
						await cli([
							"episode-read-question",
							episodeDirectory,
							questionPath,
						]);
						expect(await readJson(questionPath)).toEqual(current);
						await writeExclusive(replyPath, {
							requestDigest: current.digest,
							text: "Write fixed followed by a newline.",
							recordedBy: "simulation-operator",
							attribution: "unverified",
						});
						await cli(["episode-submit-reply", episodeDirectory, replyPath]);
					};
					const responding = respond().catch((error) => {
						controller.abort();
						throw error;
					});
					try {
						const [result] = await Promise.all([settled, responding]);
						if (!result) throw new Error("Missing recovered episode result.");
						const recovered = await recoverEpisodeJournal(
							registration,
							episodeDirectory,
						);
						expect(recovered).toEqual(result);
						expect(recovered.observation.result).toEqual({
							kind: "terminal",
							outcome: "failed",
						});
						const observedRecovery = await readJson(
							join(directory, `${arm}-recovery.json`),
						);
						expect(
							observedRecovery.completion.checks.map(
								(check: { met: boolean }) => check.met,
							),
						).toEqual([true, true]);
						expect(observedRecovery.workflow).toMatchObject({
							blockedRunState:
								arm === "manager-only" ? "blocked" : "superseded",
							currentRunState: arm === "manager-only" ? "blocked" : "active",
							closureKind: null,
						});
						expect(recovered.observation.interruptions).toBe(1);
						expect(recovered.observation.reservedUsd).toBe(
							arm === "manager-only" ? 0.025 : 0.033,
						);
						expect(recovered.observation.safetyReview).toBeNull();
						expect(recovered.observation.unsafeAcceptedActions).toBeNull();
						expect(recovered.observation.forbiddenMutations).toBeNull();
						expect(recovered.observation.activeRuntimeMs).toBeGreaterThan(0);
						expect(recovered.observation.humanWaitMs).toBeGreaterThan(0);
						const header = await readJson(
							join(episodeDirectory, "header.json"),
						);
						expect(header.artifactVerification.manifestDigest).toBe(
							datasetDigest(driver.expectedHostArtifacts),
						);
						expect(header.expectedHostArtifacts.packageCache).toBeNull();
						const completion = await readJson(
							join(episodeDirectory, "completion.json"),
						);
						evidenceFiles.push({
							file: `${arm}/completion.json`,
							sha256: sha256(
								await readFile(join(episodeDirectory, "completion.json")),
							),
						});
						expect(completion.evidenceDigest).toBe(
							datasetDigest(observedRecovery),
						);
						const reconciliation = recovered.receipt.events.find(
							(event) => event.kind === "reservation-reconciliation",
						);
						if (reconciliation?.kind !== "reservation-reconciliation")
							throw new Error("Missing reservation reconciliation.");
						const armClaims = reconciliation.reconciliation.claims;
						expect(armClaims).toEqual(
							(await claims(budget)).filter(
								(row) =>
									datasetDigest(row.scope) ===
									datasetDigest(recovered.receipt.reservationScope),
							),
						);
						expect(
							armClaims.filter((row) => row.model === "typesafe/jev-1.13.0"),
						).toHaveLength(arm === "manager-plus-jev" ? 1 : 0);
						expect(
							armClaims.filter((row) => row.model === model).length,
						).toBeGreaterThanOrEqual(5);
						expect(
							armClaims.filter((row) => row.model === model).length,
						).toBeLessThanOrEqual(12);
						evidenceFiles.push(
							await retain(directory, `${arm}-claims.json`, armClaims),
						);
						const evidence: EpisodeArmEvidence = {
							schemaVersion: 1,
							qualification: "inconclusive",
							registrationDigest: datasetDigest(registration),
							arm,
							armDigest: datasetDigest(
								arm === "manager-only"
									? registration.protocol.arms.managerOnly
									: registration.protocol.arms.managerPlusJev,
							),
							origin: { kind: "simulation" },
							observations: [recovered.observation],
						};
						armEvidence.push(evidence);
						evidenceFiles.push(
							await retain(directory, `${arm}-evidence.json`, evidence),
						);
					} finally {
						controller.abort();
						await Promise.allSettled([settled, responding]);
						await driver.stop();
					}
				}
				expect(identities).toEqual([
					identity.initialState,
					identity.initialState,
				]);
				const status = await requestBudgetStatus(budget),
					allClaims = await claims(budget);
				expect(status.consumed).toBe(allClaims.length);
				expect(status.reservedMicroUsd).toBe(
					allClaims.reduce(
						(sum, row) => sum + (row.model === model ? 5000 : 3000),
						0,
					),
				);
				evidenceFiles.push(
					await retain(directory, "budget-status.json", status),
				);
				const report = await reportEpisodes(
					registration,
					armEvidence[0],
					armEvidence[1],
				);
				expect(report.qualification).toBe("inconclusive");
				expect(report.diagnostics.declaredLiveTerminalPairs).toBe(0);
				expect(report.arms.manager.completed).toBe(0);
				expect(report.arms.jev.completed).toBe(0);
				expect(report.arms.manager.reservedUsd.mean).toBe(0.025);
				expect(report.arms.jev.reservedUsd.mean).toBe(0.033);
				evidenceFiles.push(await retain(directory, "report.json", report));
				expect(
					await reportEpisodes(
						await readJson(join(directory, "registration.json")),
						await readJson(join(directory, "manager-only-evidence.json")),
						await readJson(join(directory, "manager-plus-jev-evidence.json")),
					),
				).toEqual(report);
				for (const file of evidenceFiles)
					expect(sha256(await readFile(join(directory, file.file)))).toBe(
						file.sha256,
					);
				proofs.push({
					model,
					directory: model.split("/")[0],
					registrationDigest: datasetDigest(registration),
					journals: arms.map((arm, index) => ({
						directory: arm,
						receiptDigest: armEvidence[index]?.observations[0]?.receiptDigest,
					})),
					files: evidenceFiles,
				});
			}
			expect(sha256(await readFile(join(root, fixtureFile.file)))).toBe(
				fixtureFile.sha256,
			);
			await retain(root, "complete.json", {
				schemaVersion: 1,
				origin: "simulation",
				qualification: "inconclusive",
				attribution: "test-observed",
				fixture: fixtureFile,
				sources,
				managers: proofs,
			});
		} finally {
			if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
			else process.env.FLOW_EVAL_AUTHORIZATION = previous;
		}
	},
	SMOKE_TIMEOUT_MS,
);
