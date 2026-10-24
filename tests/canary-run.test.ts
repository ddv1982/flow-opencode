import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../evals/canonical-json.js";
import {
	canaryLaunchEnvironment,
	canaryProviderConfiguration,
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
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "flow-canary-budget-")),
	);
	directories.push(directory);
	const pluginDirectory = join(directory, "fixture/.opencode/plugins/flow");
	await mkdir(pluginDirectory, { recursive: true });
	const hash = (text: string | Uint8Array) =>
		`sha256:${createHash("sha256").update(text).digest("hex")}`;
	const sourcePackage = JSON.stringify({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		dependencies: {},
		devDependencies: { "@opencode/plugin": "2.1.4" },
	});
	const pluginPackage = canonicalJson({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		type: "module",
		exports: { ".": "./index.js", "./tui": "./tui.js" },
		dependencies: { "@opencode/plugin": "2.1.4" },
	});
	const config = canonicalJson({
		plugins: [
			{
				package: "./.opencode/plugins/flow",
				options: { recovery: { mode: "off" } },
			},
		],
		update: "disable",
		share: "disabled",
	});
	await mkdir(join(directory, "package/dist"), { recursive: true });
	for (const [path, bytes] of [
		["package/package.json", sourcePackage],
		["package/dist/index.js", "plugin"],
		["package/dist/tui.js", "tui"],
		["fixture/.opencode/plugins/flow/index.js", "plugin"],
		["fixture/.opencode/plugins/flow/tui.js", "tui"],
		["fixture/.opencode/plugins/flow/package.json", pluginPackage],
		["fixture/opencode.json", config],
	] as const)
		await writeFile(join(directory, path), bytes);
	const packed = Bun.spawn(
		["tar", "-czf", join(directory, "artifact.tgz"), "package"],
		{ cwd: directory, stderr: "pipe" },
	);
	if (await packed.exited)
		throw new Error(await new Response(packed.stderr).text());
	const artifactBytes = await readFile(join(directory, "artifact.tgz"));
	const artifact = {
		packageVersion: "10.0.0",
		sourceCommit: "fixture",
		sourceTreeSha256: hash("source"),
		tarballSha256: hash(artifactBytes),
		unpackedManifestSha256: hash("manifest"),
	};
	const base = {
		schemaVersion: 2 as const,
		releaseTag: "v10.0.0",
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion:
			CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: new Date().toISOString(),
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: hash("plugin"),
		runtime: {
			hostVersion: "2.1.4" as const,
			sourcePackageSha256: hash(sourcePackage),
			tuiEntrySha256: hash("tui"),
			pluginPackageSha256: hash(pluginPackage),
			configSha256: hash(config),
		},
	};
	await writeFile(
		join(directory, "prepared.json"),
		JSON.stringify({ ...base, sha256: preparedCanarySha256(base) }),
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
	).rejects.toThrow("tarball bytes");
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
	).toEqual({
		PWD: "/prepared/fixture",
		FLOW_CANARY_SENTINEL: "retained",
	});
});

test.skipIf(process.platform === "win32")(
	"default canary server startup excludes ambient TypeSafe credentials",
	async () => {
		const { directory, input } = await fixture();
		const executable = join(directory, "npm");
		const record = join(directory, "child-environment.txt");
		await writeFile(
			executable,
			'#!/usr/bin/env node\nif (process.argv.includes("--version")) { console.log("opencode v2.1.4"); process.exit(0); }\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.FLOW_CANARY_RECORD, [process.env.TYPESAFE_API_KEY ? "present" : "absent", process.env.FLOW_EVAL_AUTHORIZATION ? "present" : "absent", process.env.FLOW_CANARY_SENTINEL, process.env.PWD, process.cwd(), JSON.stringify(process.argv.slice(2)), ""].join("\\n"));\n',
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
			await expect(runPaidCanary(input)).rejects.toThrow(
				"server exited before readiness",
			);
			expect(await readFile(record, "utf8")).toBe(
				`absent\nabsent\nretained\n${join(directory, "fixture")}\n${join(directory, "fixture")}\n${JSON.stringify(["exec", "--yes", "--package=@opencode/cli@2.1.4", "--", "opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"])}\n`,
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

for (const path of ["index.js", "tui.js", "package.json"] as const)
	test(`changed prepared ${path} fails before dispatch consumption`, async () => {
		const { directory, input } = await fixture();
		await writeFile(
			join(directory, "fixture/.opencode/plugins/flow", path),
			"mutated",
		);
		await expect(
			runPaidCanary(input, async () => {
				throw new Error("LAUNCHED");
			}),
		).rejects.toThrow(/bytes/);
		expect((await paidRunStatus(directory)).consumed).toBe(0);
	});
test("changed prepared config fails before dispatch consumption", async () => {
	const { directory, input } = await fixture();
	await writeFile(join(directory, "fixture/opencode.json"), "{}");
	await expect(
		runPaidCanary(input, async () => {
			throw new Error("LAUNCHED");
		}),
	).rejects.toThrow("installation bytes changed");
	expect((await paidRunStatus(directory)).consumed).toBe(0);
});
test("unapproved host override is refused before dispatch consumption", async () => {
	const { directory, input } = await fixture();
	const previous = process.env.FLOW_EVAL_OPENCODE_VERSION;
	try {
		process.env.FLOW_EVAL_OPENCODE_VERSION = "2.1.5";
		await expect(
			runPaidCanary(input, async () => {
				throw new Error("LAUNCHED");
			}),
		).rejects.toThrow("host override");
		expect((await paidRunStatus(directory)).consumed).toBe(0);
	} finally {
		if (previous === undefined) delete process.env.FLOW_EVAL_OPENCODE_VERSION;
		else process.env.FLOW_EVAL_OPENCODE_VERSION = previous;
	}
});
test("historical preparation remains readable but cannot launch an active canary", async () => {
	const { directory, input } = await fixture();
	const original = JSON.parse(await readFile(input.prepared, "utf8"));
	const { runtime: _runtime, sha256: _sha, ...base } = original;
	base.schemaVersion = 1;
	base.artifact.packageVersion = "9.6.0";
	base.releaseTag = "v9.6.0";
	base.artifactSha256 = artifactIdentitySha256(base.artifact);
	await writeFile(
		input.prepared,
		JSON.stringify({ ...base, sha256: preparedCanarySha256(base) }),
	);
	await expect(
		runPaidCanary(input, async () => {
			throw new Error("LAUNCHED");
		}),
	).rejects.toThrow("native OpenCode v2 preparation");
	expect((await paidRunStatus(directory)).consumed).toBe(0);
});
for (const failure of ["setup", "version"] as const)
	test(`failed default ${failure} remains consumed without starting a model run`, async () => {
		const { directory, input } = await fixture();
		const executable = join(directory, "npm");
		await writeFile(
			executable,
			`#!/usr/bin/env node\nif (process.argv.includes("install")) process.exit(${failure === "setup" ? 12 : 0});\nif (process.argv.includes("--version")) { console.log("opencode v1.18.31"); process.exit(0); }\nprocess.exit(99);\n`,
		);
		await chmod(executable, 0o755);
		const previous = process.env.PATH;
		try {
			process.env.PATH = `${directory}:${previous ?? ""}`;
			await expect(runPaidCanary(input)).rejects.toThrow(
				failure === "setup" ? /Command failed/ : /pinned host version/,
			);
			expect((await paidRunStatus(directory)).consumed).toBe(1);
			await expect(runPaidCanary(input)).rejects.toThrow("exhausted");
		} finally {
			if (previous === undefined) delete process.env.PATH;
			else process.env.PATH = previous;
		}
	});

test("canary launch removes ambient host controls while preserving provider API access", () => {
	expect(
		canaryLaunchEnvironment("/prepared/fixture", {
			FLOW_EVAL_NATIVE_AUTH: "/ambient/connection.json",
			OPENCODE_CONFIG: "/ambient/config.json",
			OPENCODE_CONFIG_DIR: "/ambient/opencode",
			OPENCODE_CONFIG_CONTENT: '{"plugins":["ambient-plugin"]}',
			OPENCODE_FLOW_REVIEWER_MODEL: "unapproved/model",
			OPENCODE_FLOW_REVIEWER_VARIANT: "max",
			OPENCODE_EXPERIMENTAL_WEBSOCKETS: "true",
			OPENCODE_EXPERIMENTAL_NATIVE_LLM: "true",
			OPENCODE_SERVER_PASSWORD: "synthetic-server-password",
			NODE_OPTIONS: "--import /ambient/hook.js",
			NODE_PATH: "/ambient/modules",
			BUN_OPTIONS: "--preload /ambient/hook.js",
			BUN_PRELOAD: "/ambient/hook.js",
			OPENAI_API_KEY: "synthetic-openai",
			ANTHROPIC_API_KEY: "synthetic-anthropic",
			OPENCODE_API_KEY: "synthetic-opencode",
			AZURE_OPENAI_API_KEY: "synthetic-azure",
			PATH: "/toolchain/bin",
		}),
	).toEqual({
		PWD: "/prepared/fixture",
		OPENAI_API_KEY: "synthetic-openai",
		ANTHROPIC_API_KEY: "synthetic-anthropic",
		OPENCODE_API_KEY: "synthetic-opencode",
		AZURE_OPENAI_API_KEY: "synthetic-azure",
		PATH: "/toolchain/bin",
	});
});

test("canary provider configuration uses the native HTTP transport setting for the approved route", () => {
	expect(
		canaryProviderConfiguration({ providerID: "openai", id: "approved-model" }),
	).toEqual({
		providers: {
			openai: {
				settings: { transport: "http" },
				models: {
					"approved-model": {
						settings: { transport: "http" },
						variants: [{ id: "default", settings: { transport: "http" } }],
					},
				},
			},
		},
	});
});
