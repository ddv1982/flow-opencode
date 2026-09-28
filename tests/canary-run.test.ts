import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	canaryLaunchEnvironment,
	runPaidCanary,
} from "../scripts/canary-run.js";
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

test("canary launch environment points PWD at the fixture", () => {
	expect(
		canaryLaunchEnvironment("/prepared/fixture", {
			PWD: "/old/repository",
			FLOW_EVAL_AUTHORIZATION: "/private/ledger",
			TYPESAFE_API_KEY: "synthetic-not-real",
			FLOW_CANARY_SENTINEL: "retained",
		}),
	).toEqual({ PWD: "/prepared/fixture", FLOW_CANARY_SENTINEL: "retained" });
});

test.skipIf(process.platform === "win32")(
	"default canary launch excludes ambient TypeSafe credentials",
	async () => {
		const { directory, input } = await fixture();
		const executable = join(directory, "opencode");
		const record = join(directory, "child-environment.txt");
		await writeFile(
			executable,
			'#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.FLOW_CANARY_RECORD, [process.env.TYPESAFE_API_KEY ? "present" : "absent", process.env.FLOW_EVAL_AUTHORIZATION ? "present" : "absent", process.env.FLOW_CANARY_SENTINEL, process.env.PWD, process.cwd(), ""].join("\\n"));\n',
		);
		await chmod(executable, 0o755);
		const original = {
			path: process.env.PATH,
			pwd: process.env.PWD,
			key: process.env.TYPESAFE_API_KEY,
			sentinel: process.env.FLOW_CANARY_SENTINEL,
			record: process.env.FLOW_CANARY_RECORD,
		};
		try {
			process.env.PATH = `${directory}:${original.path ?? ""}`;
			process.env.PWD = directory;
			process.env.TYPESAFE_API_KEY = "synthetic-not-real";
			process.env.FLOW_CANARY_SENTINEL = "retained";
			process.env.FLOW_CANARY_RECORD = record;
			expect(await runPaidCanary(input)).toBe(0);
			expect(await readFile(record, "utf8")).toBe(
				`absent\nabsent\nretained\n${join(directory, "fixture")}\n${join(directory, "fixture")}\n`,
			);
			expect((await paidRunStatus(directory)).consumed).toBe(1);
		} finally {
			for (const [name, value] of Object.entries({
				PATH: original.path,
				PWD: original.pwd,
				TYPESAFE_API_KEY: original.key,
				FLOW_CANARY_SENTINEL: original.sentinel,
				FLOW_CANARY_RECORD: original.record,
			})) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	},
);
