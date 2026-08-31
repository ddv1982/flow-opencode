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
	const scratch = await mkdtemp(join(tmpdir(), "flow-eval-host-config-test-"));
	const toolchain = currentBunToolchain(packageJson.packageManager);
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
		await host?.stop();
		if (previous === undefined) delete process.env.FLOW_EVAL_NO_AUTH_COPY;
		else process.env.FLOW_EVAL_NO_AUTH_COPY = previous;
		await rm(scratch, { recursive: true, force: true });
	}
}, 30_000);
