import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost, packPlugin, preparePackageCache } from "../evals/harness.js";
import { evalReviewerConfiguration } from "../evals/run.js";
import packageJson from "../package.json" with { type: "json" };

test("eval reviewer configuration keeps provenance and tuple options aligned", () => {
	expect(
		evalReviewerConfiguration("manager/model", {
			OPENCODE_FLOW_REVIEWER_MODEL: " reviewer/model ",
			OPENCODE_FLOW_REVIEWER_STEPS: "80",
		}),
	).toEqual({
		requestedModel: "reviewer/model",
		requestedSteps: 80,
		pluginOptions: { model: "reviewer/model", steps: 80 },
	});
	expect(evalReviewerConfiguration("manager/model", {})).toEqual({
		requestedModel: "manager/model",
		requestedSteps: null,
		pluginOptions: null,
	});
});

test("eval host writes reviewer model through native plugin tuple options", async () => {
	const repositoryRoot = join(import.meta.dir, "..");
	const toolchain = currentBunToolchain(packageJson.packageManager);
	const scratch = await mkdtemp(join(tmpdir(), "flow-eval-host-config-test-"));
	const previous = process.env.FLOW_EVAL_NO_AUTH_COPY;
	process.env.FLOW_EVAL_NO_AUTH_COPY = "1";
	let host: EvalHost | null = null;
	try {
		const tarball = await packPlugin(repositoryRoot, scratch, toolchain);
		const packageCache = await preparePackageCache(tarball, scratch, toolchain);
		host = await EvalHost.start({
			toolchain,
			packageCache,
			opencodeVersion: packageJson.devDependencies["@opencode-ai/plugin"],
			files: { "package.json": '{"name":"eval-host-config-test"}\n' },
			reviewer: { model: "provider/reviewer", steps: 80 },
			// Let startup own cancellation/cleanup before the outer test expires.
			signal: AbortSignal.timeout(180_000),
		});

		expect(
			JSON.parse(await readFile(join(host.project, "opencode.json"), "utf8")),
		).toEqual({
			$schema: "https://opencode.ai/config.json",
			plugin: [
				[
					`opencode-plugin-flow@${packageJson.version}`,
					{ reviewer: { model: "provider/reviewer", steps: 80 } },
				],
			],
		});
	} finally {
		try {
			await host?.stop();
		} finally {
			if (previous === undefined) delete process.env.FLOW_EVAL_NO_AUTH_COPY;
			else process.env.FLOW_EVAL_NO_AUTH_COPY = previous;
			await rm(scratch, { recursive: true, force: true });
		}
	}
	// The host already permits 180s startup; allow packaging and cleanup as well.
}, 240_000);

test.skipIf(process.platform !== "linux")(
	"ordinary eval host does not pass ambient TypeSafe credentials to OpenCode",
	async () => {
		const toolchain = currentBunToolchain(packageJson.packageManager);
		const prior = process.env.FLOW_EVAL_NO_AUTH_COPY;
		process.env.FLOW_EVAL_NO_AUTH_COPY = "1";
		let host: EvalHost | null = null;
		try {
			host = await EvalHost.start({
				toolchain: {
					...toolchain,
					environment: {
						...toolchain.environment,
						TYPESAFE_API_KEY: "synthetic-not-real",
						FLOW_EVAL_SENTINEL: "retained",
					},
				},
				packageCache: "",
				withFlow: false,
				opencodeVersion: packageJson.devDependencies["@opencode-ai/plugin"],
				ambientConfig: "disabled",
				providerCredentials: "disabled",
				files: { "package.json": '{"name":"eval-host-credential-test"}\n' },
				signal: AbortSignal.timeout(120_000),
			});
			const server = Reflect.get(host, "server") as { pid?: number };
			if (!server.pid) throw new Error("OpenCode server has no pid");
			const entries = (await readFile(`/proc/${server.pid}/environ`, "utf8"))
				.split("\0")
				.map((entry) => entry.split("=", 1)[0]);
			expect(entries.includes("TYPESAFE_API_KEY")).toBe(false);
			expect(entries.includes("FLOW_EVAL_SENTINEL")).toBe(true);
		} finally {
			await host?.stop();
			if (prior === undefined) delete process.env.FLOW_EVAL_NO_AUTH_COPY;
			else process.env.FLOW_EVAL_NO_AUTH_COPY = prior;
		}
	},
	150_000,
);
