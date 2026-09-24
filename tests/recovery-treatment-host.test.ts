import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost } from "../evals/harness.js";
import {
	createRequestBudget,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import type { RecoveryTreatment } from "../evals/recovery-decisions/treatment.js";
import packageJson from "../package.json" with { type: "json" };
import { authorizePaidRun } from "../scripts/paid-budget.js";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";
import {
	loadSession,
	saveSession,
} from "../src/infrastructure/fs/workspace.js";
import {
	approveSession,
	deterministicEnvironment,
	FEATURE,
	MemorySessionRepository,
	resetFeatureRun,
	startReviewedRun,
	submitReview,
} from "./runtime-test-support.js";

const smoke =
	process.env.FLOW_RECOVERY_TREATMENT_SMOKE === "1" ? test : test.skip;
for (const managerModel of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const)
	for (const scenario of [
		"accepted",
		"control",
		"subthreshold",
		"model-mismatch",
	] as const)
		smoke(
			`real ${managerModel} host guarded reset simulation ${scenario}`,
			async () => {
				const root = await mkdtemp(join(tmpdir(), "treatment-host-"));
				const previous = process.env.FLOW_EVAL_AUTHORIZATION;
				let host: EvalHost | undefined;
				try {
					const directory = join(root, "budget");
					const authorization = await createRequestBudget(directory, {
						schemaVersion: 1,
						origin: "simulation",
						purpose: "Guarded reset simulation",
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
						purpose: "Simulated guarded reset",
						models: [managerModel],
						maxDispatches: 1,
						expiresAt: new Date(Date.now() + 180000).toISOString(),
					});
					process.env.FLOW_EVAL_AUTHORIZATION = dispatch;
					const treatment: RecoveryTreatment = {
						origin: "simulation",
						arm: scenario === "control" ? "manager-only" : "manager-plus-jev",
						script: {
							kind: "guarded-reset-v1",
							outcome:
								scenario === "subthreshold" || scenario === "model-mismatch"
									? scenario
									: "accepted",
						},
					};
					host = await EvalHost.start({
						toolchain: currentBunToolchain(packageJson.packageManager),
						packageCache: root,
						opencodeVersion: "1.18.31",
						files: {
							"parser.ts":
								"export const parse = (value: string) => value.trim();\n",
						},
						withFlow: true,
						providerCredentials: "disabled",
						ambientConfig: "disabled",
						nativeLlm: false,
						requestBudget: {
							directory,
							authorizationDigest: datasetDigest(authorization),
							managerModel,
						},
						recoveryTreatment: treatment,
						signal: AbortSignal.timeout(150000),
					});
					const repository = new MemorySessionRepository();
					repository.sourceDigest = await createFileSourceIdentityProvider(
						host.project,
					).computeSourceDigest();
					const flow = await approveSession(
						repository,
						deterministicEnvironment(),
					);
					for (let i = 0; i < 2; i++) {
						if (i)
							await resetFeatureRun(flow, repository, FEATURE, `reset-${i}`);
						await startReviewedRun(flow, repository, { suffix: `failed-${i}` });
						await submitReview(flow, repository, {
							suffix: `failed-${i}`,
							summary: "Missing null guard",
							verdict: "failed",
							findings: [
								{
									severity: "blocking",
									summary: "Null input crashes",
									evidence: "parser.ts",
									...(i
										? {
												findingId:
													repository.session?.runs[0]?.reviews[0]?.result
														?.findings[0]?.findingId,
											}
										: {}),
								},
							],
						});
					}
					if (!repository.session) throw new Error("Missing fixture session.");
					await saveSession(host.project, repository.session);
					const before = await loadSession(host.project);
					const session = await host.createSession(
						"Seeded simulation recovery",
					);
					const captureDirectory = process.env.FLOW_RECOVERY_TUI_CAPTURE_DIR;
					const captureThisHost =
						captureDirectory &&
						managerModel === "openai/gpt-5.6-terra" &&
						scenario === "model-mismatch";
					if (captureThisHost) {
						await writeFile(
							join(captureDirectory, "capture-ready.json"),
							JSON.stringify({ url: host.url, session, project: host.project }),
						);
						const attached = join(captureDirectory, "capture-attached");
						const deadline = Date.now() + 90_000;
						while (
							!(await Bun.file(attached).exists()) &&
							Date.now() < deadline
						)
							await Bun.sleep(200);
						if (!(await Bun.file(attached).exists()))
							throw new Error("TUI capture did not attach.");
					}
					await host.runCommand(
						session,
						"flow-auto",
						`${scenario === "control" ? "" : "--recovery=delegated --recovery-calls=3 --recovery-usd=0.01 "}Repair the blocked parser within its approved plan.`,
						managerModel,
						{ quietMs: 200, timeoutMs: 45000, stalledMs: 15000 },
					);
					const after = await loadSession(host.project);
					if (scenario === "model-mismatch") {
						const messages = (await fetch(
							`${host.url}/session/${session}/message`,
						).then((response) => response.json())) as Array<{
							parts?: Array<{
								type?: string;
								tool?: string;
								state?: { output?: string };
							}>;
						}>;
						const recovery = messages
							.flatMap((message) => message.parts ?? [])
							.filter(
								(part) =>
									part.type === "tool" &&
									part.tool === "flow_status" &&
									typeof part.state?.output === "string",
							)
							.map((part) => JSON.parse(part.state?.output ?? "{}"))
							.map((result) => result.workflowData?.recovery)
							.find((result) => result?.reason === "model-mismatch");
						expect(recovery).toMatchObject({
							kind: "unavailable",
							reason: "model-mismatch",
							requestedModel: "jev-1.13.0",
							model: "jev-1.14.0",
							selectedCandidateId: null,
						});
						if (recovery) expect(recovery).not.toHaveProperty("recommended");
					}
					const status = await requestBudgetStatus(directory);
					const claims = await Promise.all(
						(await readdir(directory))
							.filter((name) => name.startsWith("request-"))
							.map(async (name) =>
								JSON.parse(await readFile(join(directory, name), "utf8")),
							),
					);
					expect(
						claims.filter((row) => row.model === "typesafe/jev-1.13.0"),
					).toHaveLength(scenario === "control" ? 0 : 1);
					const managerClaims = claims.filter(
						(row) => row.model === managerModel,
					).length;
					const jevClaims = scenario === "control" ? 0 : 1;
					expect(managerClaims).toBeGreaterThanOrEqual(
						scenario === "accepted" ? 4 : 3,
					);
					expect(managerClaims).toBeLessThanOrEqual(8);
					expect(status.consumed).toBe(managerClaims + jevClaims);
					expect(status.reservedMicroUsd).toBe(
						managerClaims * 5000 + jevClaims * 3000,
					);
					if (scenario === "accepted") {
						expect(after?.revision).toBe((before?.revision ?? 0) + 1);
						expect(after?.operations.at(-1)?.id).toStartWith("flow-recovery-");
						expect(after?.runs.at(-2)?.state).toBe("superseded");
						expect(after?.runs.at(-1)?.state).toBe("active");
						expect(after?.runs).toHaveLength((before?.runs.length ?? 0) + 1);
					} else expect(after).toEqual(before);
					if (captureThisHost) {
						const release = join(captureDirectory, "capture-release");
						const deadline = Date.now() + 90_000;
						while (!(await Bun.file(release).exists()) && Date.now() < deadline)
							await Bun.sleep(200);
						if (!(await Bun.file(release).exists()))
							throw new Error("TUI capture release did not arrive.");
					}
				} finally {
					if (previous === undefined)
						delete process.env.FLOW_EVAL_AUTHORIZATION;
					else process.env.FLOW_EVAL_AUTHORIZATION = previous;
					await host?.stop();
					await rm(root, { recursive: true, force: true });
				}
			},
			180000,
		);

for (const managerModel of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const)
	smoke(
		`native ${managerModel} stop revokes delayed simulated Jev advice`,
		async () => {
			const root = await mkdtemp(join(tmpdir(), "treatment-stop-host-"));
			const previous = process.env.FLOW_EVAL_AUTHORIZATION;
			let host: EvalHost | undefined;
			try {
				const directory = join(root, "budget");
				const authorization = await createRequestBudget(directory, {
					schemaVersion: 1,
					origin: "simulation",
					purpose: "Native delayed recovery stop simulation",
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
					purpose: "Native delayed recovery stop simulation",
					models: [managerModel],
					maxDispatches: 2,
					expiresAt: new Date(Date.now() + 180000).toISOString(),
				});
				process.env.FLOW_EVAL_AUTHORIZATION = dispatch;
				host = await EvalHost.start({
					toolchain: currentBunToolchain(packageJson.packageManager),
					packageCache: root,
					opencodeVersion: "1.18.31",
					files: {
						"parser.ts":
							"export const parse = (value: string) => value.trim();\n",
					},
					withFlow: true,
					providerCredentials: "disabled",
					ambientConfig: "disabled",
					nativeLlm: false,
					requestBudget: {
						directory,
						authorizationDigest: datasetDigest(authorization),
						managerModel,
					},
					recoveryTreatment: {
						origin: "simulation",
						arm: "manager-plus-jev",
						script: {
							kind: "guarded-reset-v1",
							outcome: "accepted",
							jevDelayMs: 7000,
						},
					},
					signal: AbortSignal.timeout(150000),
				});
				const repository = new MemorySessionRepository();
				repository.sourceDigest = await createFileSourceIdentityProvider(
					host.project,
				).computeSourceDigest();
				const flow = await approveSession(
					repository,
					deterministicEnvironment(),
				);
				for (let i = 0; i < 2; i++) {
					if (i) await resetFeatureRun(flow, repository, FEATURE, `reset-${i}`);
					await startReviewedRun(flow, repository, { suffix: `failed-${i}` });
					await submitReview(flow, repository, {
						suffix: `failed-${i}`,
						summary: "Missing null guard",
						verdict: "failed",
						findings: [
							{
								severity: "blocking",
								summary: "Null input crashes",
								evidence: "parser.ts",
								...(i
									? {
											findingId:
												repository.session?.runs[0]?.reviews[0]?.result
													?.findings[0]?.findingId,
										}
									: {}),
							},
						],
					});
				}
				if (!repository.session) throw new Error("Missing fixture session.");
				await saveSession(host.project, repository.session);
				const before = await loadSession(host.project);
				const session = await host.createSession("Delayed recovery stop");
				const running = host
					.runCommand(
						session,
						"flow-auto",
						"--recovery=delegated --recovery-calls=3 --recovery-usd=0.01 Repair the blocked parser within its approved plan.",
						managerModel,
						{ quietMs: 200, timeoutMs: 45000, stalledMs: 15000 },
					)
					.catch(() => undefined);
				const deadline = Date.now() + 30000;
				let jevStarted = false;
				let jevClaimedAt = 0;
				while (Date.now() < deadline) {
					const claims = await Promise.all(
						(await readdir(directory))
							.filter((name) => name.startsWith("request-"))
							.map(async (name) =>
								JSON.parse(await readFile(join(directory, name), "utf8")),
							),
					);
					if (claims.some((claim) => claim.model === "typesafe/jev-1.13.0")) {
						jevStarted = true;
						jevClaimedAt = Date.now();
						break;
					}
					await Bun.sleep(50);
				}
				expect(jevStarted).toBe(true);
				await host.runCommand(session, "flow-auto", "stop", managerModel, {
					quietMs: 200,
					timeoutMs: 15000,
					stalledMs: 10000,
				});
				expect(Date.now() - jevClaimedAt).toBeLessThan(7000);
				await running;
				await Bun.sleep(7200);
				expect(await loadSession(host.project)).toEqual(before);
				expect(
					JSON.parse(
						await readFile(
							join(host.project, "..", "simulation-jev-packet.json"),
							"utf8",
						),
					),
				).toMatchObject({
					model: "typesafe/jev-1.13.0",
					sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
				});
				const outcome = await host.outcome([session], 0);
				expect(outcome.flowCalls.map((call) => call.tool)).toContain(
					"flow_status",
				);
				expect(outcome.flowCalls.map((call) => call.tool)).not.toContain(
					"flow_feature_reset",
				);
			} finally {
				if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
				else process.env.FLOW_EVAL_AUTHORIZATION = previous;
				await host?.stop();
				await rm(root, { recursive: true, force: true });
			}
		},
		180000,
	);
