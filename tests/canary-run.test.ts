import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPaidCanary } from "../scripts/canary-run.js";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	preparedCanarySha256,
} from "../scripts/eval-canary.js";
import { authorizePaidRun, paidRunStatus } from "../scripts/paid-budget.js";

const directories: string[] = [];
const previous = process.env.FLOW_EVAL_AUTHORIZATION;
afterEach(async () => {
	if (previous === undefined) delete process.env.FLOW_EVAL_AUTHORIZATION;
	else process.env.FLOW_EVAL_AUTHORIZATION = previous;
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "flow-canary-budget-"));
	directories.push(directory);
	await mkdir(join(directory, "fixture/.opencode/plugins"), {
		recursive: true,
	});
	const hash = (text: string) =>
		`sha256:${createHash("sha256").update(text).digest("hex")}`;
	const artifact = {
		packageVersion: "1.2.3",
		sourceCommit: "fixture",
		sourceTreeSha256: hash("source"),
		tarballSha256: hash("artifact"),
		unpackedManifestSha256: hash("manifest"),
	};
	const base = {
		schemaVersion: 1 as const,
		releaseTag: "v1.2.3",
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion:
			CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: new Date().toISOString(),
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: hash("plugin"),
	};
	await writeFile(
		join(directory, "prepared.json"),
		JSON.stringify({ ...base, sha256: preparedCanarySha256(base) }),
	);
	await writeFile(join(directory, "artifact.tgz"), "artifact");
	await writeFile(
		join(directory, "fixture/.opencode/plugins/flow.js"),
		"plugin",
	);
	await writeFile(join(directory, "prompt.txt"), "Run fixture");
	await authorizePaidRun(directory, {
		schemaVersion: 1,
		purpose: "Fake canary",
		models: ["fake/model"],
		maxDispatches: 1,
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	});
	process.env.FLOW_EVAL_AUTHORIZATION = directory;
	return {
		directory,
		input: {
			prepared: join(directory, "prepared.json"),
			model: "fake/model",
			prompt: join(directory, "prompt.txt"),
		},
	};
}
test("a failed canary launch remains consumed and cannot silently repeat", async () => {
	const { directory, input } = await fixture();
	let launches = 0;
	const launch = async (cwd: string, model: string, prompt: string) => {
		launches++;
		expect(cwd).toBe(join(directory, "fixture"));
		expect(model).toBe("fake/model");
		expect(prompt).toBe("Run fixture");
		return 1;
	};
	expect(await runPaidCanary(input, launch)).toBe(1);
	await expect(runPaidCanary(input, launch)).rejects.toThrow("exhausted");
	expect(launches).toBe(1);
});
test("changed prepared bytes fail before consuming or launching", async () => {
	const { directory, input } = await fixture();
	await writeFile(join(directory, "artifact.tgz"), "changed");
	await expect(
		runPaidCanary(input, async () => {
			throw new Error("LAUNCHED");
		}),
	).rejects.toThrow("bytes changed");
	expect((await paidRunStatus(directory)).consumed).toBe(0);
});
