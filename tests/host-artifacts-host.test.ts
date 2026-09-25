import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost, packPlugin, preparePackageCache } from "../evals/harness.js";
import { artifactTree, captureHostArtifacts } from "../evals/host-artifacts.js";
import { datasetDigest } from "../evals/recovery-decisions/schema.js";
import packageJson from "../package.json" with { type: "json" };

const smoke = process.env.FLOW_HOST_ARTIFACT_SMOKE === "1" ? test : test.skip;
smoke(
	"native host verifies actual packed cache and blocks drift before a dispatch",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "artifact-host-"));
		let host: EvalHost | undefined;
		const previous = process.env.FLOW_EVAL_AUTHORIZATION;
		delete process.env.FLOW_EVAL_AUTHORIZATION;
		try {
			const current = currentBunToolchain(packageJson.packageManager);
			const toolchain = {
				...current,
				environment: {
					PATH: current.environment.PATH,
					HOME: current.environment.HOME,
				},
			};
			const tarball = await packPlugin(process.cwd(), root, toolchain);
			const packageCache = await preparePackageCache(tarball, root, toolchain);
			const opencodeExecutable =
				process.env.FLOW_RECOVERY_OPENCODE_EXECUTABLE ??
				Bun.which("opencode") ??
				"";
			const identity = await captureHostArtifacts({
				paths: {
					bun: toolchain.executable,
					opencode: opencodeExecutable,
					packageCache,
				},
				bunVersion: toolchain.actualVersion,
				opencodeVersion: "1.18.31",
			});
			host = await EvalHost.start({
				toolchain,
				packageCache,
				packageVersion: packageJson.version,
				opencodeVersion: "1.18.31",
				frozenArtifacts: { opencodeExecutable, identity },
				files: { "result.txt": "unchanged\n" },
				providerCredentials: "disabled",
				ambientConfig: "disabled",
				reviewerEnvironment: "disabled",
				nativeLlm: false,
				signal: AbortSignal.timeout(120000),
			});
			expect(host.artifactIdentity).toEqual(identity);
			expect(host.artifactVerification).toEqual({
				manifestDigest: datasetDigest(identity),
				method:
					process.platform === "linux"
						? "copied-files-and-linux-process"
						: "copied-files-and-direct-spawn",
			});
			const copiedCache = join(
				dirname(host.project),
				"cache",
				"opencode",
				"packages",
				`opencode-plugin-flow@${packageJson.version}`,
			);
			expect(await artifactTree(copiedCache)).toEqual(
				identity.packageCache ?? [],
			);
			const session = await host.createSession("No inference byte drift check");
			await writeFile(
				join(
					copiedCache,
					"node_modules",
					"opencode-plugin-flow",
					"dist",
					"index.js",
				),
				"throw new Error('changed bytes');\n",
			);
			await expect(
				host.runPrompt(
					session,
					"This must never dispatch.",
					"openai/gpt-5.6-terra",
				),
			).rejects.toThrow("artifact bytes changed");
			let probeDispatches = 0;
			await expect(
				host.probeModel("openai/gpt-5.6-terra", {
					onDispatch() {
						probeDispatches++;
					},
				}),
			).rejects.toThrow("artifact bytes changed");
			expect(probeDispatches).toBe(0);
			expect(process.env.FLOW_EVAL_AUTHORIZATION).toBeUndefined();
		} finally {
			if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
			else process.env.FLOW_EVAL_AUTHORIZATION = previous;
			await host?.stop();
			await rm(root, { recursive: true, force: true });
		}
	},
	150000,
);
