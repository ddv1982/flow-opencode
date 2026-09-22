import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost } from "../evals/harness.js";
import {
	createEpisodeHostDriver,
	episodeHostIdentity,
} from "../evals/recovery-decisions/episode-host.js";
import {
	recoverEpisodeJournal,
	runEpisode,
} from "../evals/recovery-decisions/episode-runner.js";
import {
	createRequestBudget,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import packageJson from "../package.json" with { type: "json" };
import { authorizePaidRun } from "../scripts/paid-budget.js";
import {
	awaitQuestion,
	operatorRegistration,
} from "./recovery-operator-support.js";

async function runOperatorCli(args: string[]) {
	const child = Bun.spawn(
		[process.execPath, "evals/recovery-decisions/run.ts", ...args],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const timeout = setTimeout(() => child.kill(), 10000);
	try {
		return await child.exited;
	} finally {
		clearTimeout(timeout);
	}
}
const smoke =
	process.env.FLOW_RECOVERY_OPERATOR_SMOKE === "1" ? test : test.skip;
for (const managerModel of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const)
	for (const cancel of [false, true])
		smoke(
			`real ${managerModel} operator episode ${cancel ? "cancels" : "resumes"}`,
			async () => {
				const root = await mkdtemp(join(tmpdir(), "operator-host-"));
				const previous = process.env.FLOW_EVAL_AUTHORIZATION;
				const controller = new AbortController();
				let host: EvalHost | undefined;
				let running: ReturnType<typeof runEpisode> | undefined;
				try {
					const budget = join(root, "budget"),
						directory = join(root, "episode");
					const authorization = await createRequestBudget(budget, {
						schemaVersion: 1,
						origin: "simulation",
						purpose: "Operator resume simulation",
						maxRequests: 12,
						maxMicroUsd: 100000,
						expiresAt: new Date(Date.now() + 180000).toISOString(),
						models: [
							{
								model: managerModel,
								reservationMicroUsd: 5000,
								basis: { kind: "simulation" },
							},
							{
								model: "typesafe/jev-1.13.0",
								reservationMicroUsd: 3000,
								basis: { kind: "simulation" },
							},
						],
					});
					const dispatch = join(root, "dispatch");
					await authorizePaidRun(dispatch, {
						schemaVersion: 1,
						purpose: "Synthetic operator simulation",
						models: [managerModel],
						maxDispatches: 2,
						expiresAt: new Date(Date.now() + 180000).toISOString(),
					});
					process.env.FLOW_EVAL_AUTHORIZATION = dispatch;
					const fixture = {
						task: {
							instruction:
								"Ask the operator which output to write, then follow their answer.",
						},
						files: { "result.txt": "broken\n" },
						generatedDirectories: [".flow"],
						completion: {
							criteria: "The exact operator selected output is written.",
							files: { "result.txt": "fixed\n" },
						},
					};
					const dispatches: {
						session: string;
						model: string;
						kind: string;
						text: string;
					}[] = [];
					const driver = await createEpisodeHostDriver({
						fixture,
						arm: "manager-only",
						manager: { model: managerModel, prompt: "Frozen task" },
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
								managerModel,
							},
							recoveryTreatment: {
								origin: "simulation",
								arm: "manager-only",
								script: { kind: "operator-resume-v1" },
							},
						},
						async hostFactory(options) {
							host = await EvalHost.start(options);
							const active = host;
							return {
								project: active.project,
								artifactIdentity: active.artifactIdentity,
								artifactVerification: active.artifactVerification,
								createSession: active.createSession.bind(active),
								stop: active.stop.bind(active),
								escalationQuestion: active.escalationQuestion.bind(active),
								async runCommand(session, command, args, model) {
									dispatches.push({
										session,
										model,
										kind: "command",
										text: args,
									});
									return active.runCommand(session, command, args, model, {
										quietMs: 200,
										timeoutMs: 45000,
										stalledMs: 15000,
									});
								},
								async runPrompt(session, text, model) {
									dispatches.push({ session, model, kind: "prompt", text });
									return active.runPrompt(session, text, model, {
										quietMs: 200,
										timeoutMs: 45000,
										stalledMs: 15000,
									});
								},
							};
						},
					});
					const registration = await operatorRegistration(
						driver,
						episodeHostIdentity(fixture),
						90000,
						managerModel,
					);
					running = runEpisode({
						registration,
						episodeId: "one",
						arm: "manager-only",
						outputDirectory: directory,
						recordedBy: "simulation-test",
						origin: "simulation",
						driver,
						signal: controller.signal,
					});
					const current = await awaitQuestion(
						directory,
						AbortSignal.timeout(60000),
					);
					expect(
						current.request.question.calls[0]?.input.questions[0]?.question,
					).toBe("Which output should I write?");
					expect(current.request.question.calls[0]?.callId).toStartWith(
						"call-",
					);
					const header = JSON.parse(
						await readFile(join(directory, "header.json"), "utf8"),
					);
					expect(header.artifactVerification).toEqual({
						manifestDigest: datasetDigest(driver.expectedHostArtifacts),
						method:
							process.platform === "linux"
								? "copied-files-and-linux-process"
								: "copied-files-and-direct-spawn",
					});
					expect(header.expectedHostArtifacts.packageCache).toBeNull();
					const before = await requestBudgetStatus(budget);
					if (cancel) controller.abort();
					else {
						const questionPath = join(root, "question.json"),
							replyPath = join(root, "reply.json");
						expect(
							await runOperatorCli([
								"episode-read-question",
								directory,
								questionPath,
							]),
						).toBe(0);
						expect(JSON.parse(await readFile(questionPath, "utf8"))).toEqual(
							current,
						);
						await writeFile(
							replyPath,
							JSON.stringify({
								requestDigest: current.digest,
								text: "Write fixed followed by a newline.",
								recordedBy: "simulation-operator",
								attribution: "unverified",
							}),
						);
						expect(
							await runOperatorCli([
								"episode-submit-reply",
								directory,
								replyPath,
							]),
						).toBe(0);
					}
					const result = await running;
					if (!result) throw new Error("Missing episode result");
					expect(result.observation.result).toEqual({
						kind: "terminal",
						outcome: cancel ? "cancelled" : "completed",
					});
					expect(result.observation.interruptions).toBe(cancel ? 0 : 1);
					expect(await recoverEpisodeJournal(registration, directory)).toEqual(
						result,
					);
					expect(dispatches.map((item) => item.kind)).toEqual(
						cancel ? ["command"] : ["command", "prompt"],
					);
					expect(new Set(dispatches.map((item) => item.session)).size).toBe(1);
					expect(new Set(dispatches.map((item) => item.model))).toEqual(
						new Set([managerModel]),
					);
					const status = await requestBudgetStatus(budget);
					const claims = await Promise.all(
						(await readdir(budget))
							.filter((name) => name.startsWith("request-"))
							.map(async (name) =>
								JSON.parse(await readFile(join(budget, name), "utf8")),
							),
					);
					expect(claims.every((claim) => claim.model === managerModel)).toBe(
						true,
					);
					expect(status.reservedMicroUsd).toBe(claims.length * 5000);
					if (cancel) expect(status.consumed).toBe(before.consumed);
					else {
						expect(status.consumed).toBeGreaterThan(before.consumed);
						expect(dispatches[1]?.text).toBe(
							"Write fixed followed by a newline.",
						);
					}
				} finally {
					controller.abort();
					await running?.catch(() => {});
					await host?.stop();
					if (previous === undefined)
						delete process.env.FLOW_EVAL_AUTHORIZATION;
					else process.env.FLOW_EVAL_AUTHORIZATION = previous;
					await rm(root, { recursive: true, force: true });
				}
			},
			180000,
		);
