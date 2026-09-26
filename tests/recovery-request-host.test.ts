import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost } from "../evals/harness.js";
import {
	createRequestBudget,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import packageJson from "../package.json" with { type: "json" };
import { authorizePaidRun } from "../scripts/paid-budget.js";

const smoke = process.env.FLOW_REQUEST_BUDGET_SMOKE === "1" ? test : test.skip;
for (const managerModel of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const)
	smoke(
		`real OpenCode meters ${managerModel} OAuth retries with simulated credentials`,
		async () => {
			const root = await mkdtemp(join(tmpdir(), "budget-host-"));
			let host: EvalHost | undefined;
			const previous = process.env.FLOW_EVAL_AUTHORIZATION;
			try {
				const directory = join(root, "budget");
				const authorization = await createRequestBudget(directory, {
					schemaVersion: 1,
					origin: "simulation",
					purpose: "no inference host integration",
					maxRequests: 2,
					maxMicroUsd: 10000,
					expiresAt: new Date(Date.now() + 120000).toISOString(),
					models: [
						{
							model: managerModel,
							reservationMicroUsd: 5000,
							basis: { kind: "simulation" },
						},
					],
				});
				const dispatch = join(root, "dispatch");
				await authorizePaidRun(dispatch, {
					schemaVersion: 1,
					purpose: "Simulated host only",
					models: [managerModel],
					maxDispatches: 1,
					expiresAt: new Date(Date.now() + 120000).toISOString(),
				});
				process.env.FLOW_EVAL_AUTHORIZATION = dispatch;
				const toolchain = currentBunToolchain(packageJson.packageManager);
				host = await EvalHost.start({
					toolchain: {
						...toolchain,
						environment: {
							PATH: toolchain.environment.PATH,
						},
					},
					packageCache: root,
					opencodeVersion: "1.18.31",
					files: { "README.md": "Offline request gate smoke\n" },
					withFlow: false,
					providerCredentials: "disabled",
					ambientConfig: "disabled",
					nativeLlm: false,
					requestBudget: {
						directory,
						authorizationDigest: datasetDigest(authorization),
						managerModel,
					},
					signal: AbortSignal.timeout(90000),
				});
				const installed = await fetch(
					`${host.url}/auth/${managerModel.split("/")[0]}`,
					{
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							type: "oauth",
							access: "simulation-access",
							refresh: "simulation-refresh",
							expires: Date.now() + 3600000,
						}),
					},
				);
				expect(installed.ok).toBe(true);
				const session = await host.createSession("Simulated requests");
				await expect(
					host.runPrompt(session, "Reply OK.", managerModel, {
						quietMs: 100,
						timeoutMs: 20000,
					}),
				).rejects.toThrow();
				const status = await requestBudgetStatus(directory);
				expect(status.consumed).toBe(2);
				expect(status.reservedMicroUsd).toBe(10000);
			} finally {
				if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
				else process.env.FLOW_EVAL_AUTHORIZATION = previous;
				await host?.stop();
				await rm(root, { recursive: true, force: true });
			}
		},
		120000,
	);
