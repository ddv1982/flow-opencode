import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bunToolchainFor } from "../evals/bun-toolchain.js";
import {
	carryProviderCredentials,
	EvalHost,
	syncProviderCredentialsBack,
} from "../evals/harness.js";
import { captureHostArtifacts } from "../evals/host-artifacts.js";
import {
	createRequestBudget,
	type EpisodeReservationScope,
	requestBudgetStatus,
} from "../evals/recovery-decisions/request-budget.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import {
	ExperimentalLiveProfile,
	SimulationTreatmentSchema,
} from "../evals/recovery-decisions/treatment.js";

const root = process.argv[2];
const mode = process.argv[3];
assert(root && mode);
const source = join(root, "data", "opencode", "auth.json");
await mkdir(dirname(source), { recursive: true });
const initial = {
	openai: {
		type: "oauth",
		access: "old-openai",
		refresh: "r-openai",
		expires: 0,
	},
	xai: { type: "oauth", access: "old-xai", refresh: "r-xai", expires: 0 },
	unrelated: { type: "api", key: "unrelated-test-key" },
};
await writeFile(source, JSON.stringify(initial));
if (mode === "credentials") {
	for (const provider of ["openai", "xai"] as const) {
		const paths = await carryProviderCredentials(
			join(root, `child-${provider}`),
			provider,
		);
		assert(paths);
		assert.deepEqual(JSON.parse(await readFile(paths.target, "utf8")), {
			[provider]: initial[provider],
		});
		assert.deepEqual(JSON.parse(paths.snapshot ?? "null"), {
			[provider]: initial[provider],
		});
		await writeFile(
			paths.target,
			JSON.stringify({
				[provider]: { ...initial[provider], access: `rotated-${provider}` },
				intruder: { key: "never-copy" },
			}),
		);
		await syncProviderCredentialsBack(paths);
		const rotated = JSON.parse(await readFile(source, "utf8"));
		assert.equal(rotated[provider].access, `rotated-${provider}`);
		assert.deepEqual(rotated.unrelated, initial.unrelated);
		assert.equal(rotated.intruder, undefined);
		const logout = await carryProviderCredentials(
			join(root, `logout-${provider}`),
			provider,
		);
		assert(logout);
		await writeFile(logout.target, "{}");
		await syncProviderCredentialsBack(logout);
		assert.equal(
			JSON.parse(await readFile(source, "utf8"))[provider],
			undefined,
		);
		await writeFile(source, JSON.stringify(initial));
		await writeFile(
			paths.target,
			JSON.stringify({ [provider]: { type: "oauth", access: "new" } }),
		);
		await writeFile(source, "malformed-private-store");
		await assert.rejects(
			syncProviderCredentialsBack(paths),
			/Invalid provider credential store/,
		);
		assert.equal(await readFile(source, "utf8"), "malformed-private-store");
		await assert.rejects(
			carryProviderCredentials(join(root, `malformed-${provider}`), provider),
			/Selected provider credentials unavailable/,
		);
		await rm(source);
		const missing = await carryProviderCredentials(
			join(root, `missing-${provider}`),
			provider,
		);
		assert(missing && missing.snapshot === null);
		await writeFile(
			missing.target,
			JSON.stringify({ [provider]: initial[provider], intruder: {} }),
		);
		await syncProviderCredentialsBack(missing);
		assert.deepEqual(JSON.parse(await readFile(source, "utf8")), {
			[provider]: initial[provider],
		});
		await writeFile(source, JSON.stringify(initial));
	}
	console.log(JSON.stringify({ mode, ok: true }));
	process.exit(0);
}
const toolchain = bunToolchainFor({
	executable: process.execPath,
	actualVersion: Bun.version,
	packageManager: `bun@${Bun.version}`,
	environment: {
		PATH: "/usr/bin:/bin",
		TYPESAFE_API_KEY: "synthetic-host-jev-key",
	},
});
const bundle = await Bun.build({
	entrypoints: [
		fileURLToPath(
			new URL(
				"../evals/recovery-decisions/live-treatment-plugin.ts",
				import.meta.url,
			),
		),
	],
	target: "bun",
	format: "esm",
	minify: false,
});
assert(bundle.success && bundle.outputs.length === 1 && bundle.outputs[0]);
const bundleBytes = new Uint8Array(await bundle.outputs[0].arrayBuffer());
const frozenTreatmentBundle = {
	bytes: bundleBytes,
	sha256: createHash("sha256").update(bundleBytes).digest("hex"),
};
const records = [];
for (const managerModel of ["openai/gpt-5.6-terra", "xai/grok-4.6"] as const) {
	for (const arm of ["manager-only", "manager-plus-jev"] as const) {
		const directory = join(root, `${managerModel.split("/")[0]}-${arm}`);
		const scope: EpisodeReservationScope = {
			executionId: randomUUID(),
			registrationDigest: "a".repeat(64),
			episodeId: "native-startup",
			arm,
			harnessDigest: "b".repeat(64),
		};
		const authorization = await createRequestBudget(directory, {
			schemaVersion: 1,
			origin: "live",
			purpose: "Synthetic startup fixture. No inference authorization.",
			maxRequests: 1,
			maxMicroUsd: 3000,
			expiresAt: new Date(Date.now() + 300000).toISOString(),
			models: (arm === "manager-plus-jev"
				? [managerModel, "typesafe/jev-1.13.0"]
				: [managerModel]
			).map((model) => ({
				model,
				reservationMicroUsd: 3000,
				basis: {
					kind: "reviewed-upper-bound",
					reviewedBy: "synthetic-test-only",
					evidenceDigest: "c".repeat(64),
				},
			})),
		});
		const options: Parameters<typeof EvalHost.start>[0] = {
			toolchain,
			frozenTreatmentBundle,
			packageCache: root,
			opencodeVersion: "1.18.31",
			files: { "result.txt": "unchanged\n" },
			providerCredentials: "disabled",
			recoveryTreatment: { origin: "live", arm },
			requestBudget: {
				directory,
				authorizationDigest: datasetDigest(authorization),
				managerModel,
				scope,
			},
			ambientConfig: "disabled",
			reviewerEnvironment: "disabled",
			nativeLlm: false,
		};
		if (mode === "admission") {
			assert(options.requestBudget);
			await assert.rejects(
				EvalHost.start({
					...options,
					frozenTreatmentBundle: {
						...frozenTreatmentBundle,
						sha256: "0".repeat(64),
					},
				}),
				/Frozen treatment bundle differs from registration/,
			);
			const { providerCredentials: _policy, ...missingPolicy } = options;
			await assert.rejects(
				EvalHost.start(missingPolicy),
				/explicit provider credential policy/,
			);
			if (arm === "manager-plus-jev")
				await assert.rejects(
					EvalHost.start({
						...options,
						toolchain: { ...toolchain, environment: { PATH: "/usr/bin:/bin" } },
					}),
					/credential unavailable/,
				);
			await assert.rejects(
				EvalHost.start({
					...options,
					requestBudget: {
						...options.requestBudget,
						scope: {
							...scope,
							arm: arm === "manager-only" ? "manager-plus-jev" : "manager-only",
						},
					},
				}),
				/arm differs/,
			);
			const { scope: _scope, ...unscoped } = options.requestBudget;
			await assert.rejects(
				EvalHost.start({ ...options, requestBudget: unscoped }),
			);
			await assert.rejects(
				EvalHost.start({ ...options, withFlow: false }),
				/requires Flow/,
			);
			assert.throws(() =>
				SimulationTreatmentSchema.parse({ origin: "live", arm }),
			);
			const invalidTreatment = {
				origin: "live" as const,
				arm,
				script: { kind: "operator-resume-v1" },
			};
			await assert.rejects(
				EvalHost.start({ ...options, recoveryTreatment: invalidTreatment }),
			);
			assert.equal((await requestBudgetStatus(directory)).consumed, 0);
			continue;
		}
		const executable = process.argv[4];
		assert(executable);
		const identity = await captureHostArtifacts({
			paths: {
				bun: process.execPath,
				opencode: executable,
				packageCache: null,
			},
			bunVersion: Bun.version,
			opencodeVersion: "1.18.31",
		});
		const host = await EvalHost.start({
			...options,
			frozenArtifacts: { opencodeExecutable: executable, identity },
			signal: AbortSignal.timeout(60000),
		});
		const scratch = dirname(host.project);
		let pid = 0;
		try {
			const configText = await readFile(
				join(host.project, "opencode.json"),
				"utf8",
			);
			const config = JSON.parse(configText);
			assert.equal(config.plugin.length, 1);
			const [entry, args] = config.plugin[0];
			assert.equal(args.origin, "live");
			assert.equal(args.treatment, undefined);
			assert.equal(args.budget.scope.arm, arm);
			assert.equal(args.budget.managerModel, managerModel);
			assert(!configText.includes("synthetic-host-jev-key"));
			const readyText = await readFile(
				join(scratch, "treatment-ready.json"),
				"utf8",
			);
			const ready = JSON.parse(readyText);
			const budget = JSON.parse(
				await readFile(join(scratch, "budget-ready.json"), "utf8"),
			);
			assert.equal(ready.origin, "live");
			assert.equal(ready.arm, arm);
			assert.equal(ready.qualification, "experimental-evaluation");
			assert.equal(ready.scopeDigest, datasetDigest(scope));
			assert.equal(
				ready.profileDigest,
				arm === "manager-plus-jev"
					? datasetDigest(ExperimentalLiveProfile)
					: null,
			);
			assert.equal(ready.pluginEntrySha256, frozenTreatmentBundle.sha256);
			assert.equal(
				ready.pluginEntrySha256,
				createHash("sha256")
					.update(await readFile(fileURLToPath(entry)))
					.digest("hex"),
			);
			assert.equal(budget.origin, "live");
			assert.equal(budget.scriptDigest, null);
			assert.equal(budget.pid, ready.pid);
			assert.equal(budget.authorizationDigest, datasetDigest(authorization));
			assert.equal(budget.scopeDigest, datasetDigest(scope));
			assert(!readyText.includes("synthetic-host-jev-key"));
			pid = ready.pid;
			if (process.platform === "linux") {
				const environment = (
					await readFile(`/proc/${pid}/environ`, "utf8")
				).split("\0");
				assert.equal(
					environment.includes("TYPESAFE_API_KEY=synthetic-host-jev-key"),
					arm === "manager-plus-jev",
				);
			}
			try {
				const auth = JSON.parse(
					await readFile(
						join(scratch, "home", ".local", "share", "opencode", "auth.json"),
						"utf8",
					),
				);
				assert.deepEqual(auth, {});
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;
			}
			assert.equal((await requestBudgetStatus(directory)).consumed, 0);
			assert.deepEqual(host.artifactIdentity, identity);
			records.push({
				managerModel,
				arm,
				ready,
				budget,
				identity,
				zeroClaims: true,
			});
		} finally {
			await host.stop();
		}
		await assert.rejects(readFile(join(scratch, "treatment-ready.json")), {
			code: "ENOENT",
		});
		assert.throws(() => process.kill(pid, 0));
		assert.deepEqual(JSON.parse(await readFile(source, "utf8")), initial);
	}
}
if (mode === "native")
	await writeFile(
		join(root, "report.json"),
		JSON.stringify(
			{ kind: "native-live-startup-no-inference", records },
			null,
			2,
		),
	);
console.log(JSON.stringify({ mode, ok: true, hosts: records.length }));
