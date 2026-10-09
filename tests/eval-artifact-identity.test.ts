import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tarballSha256, unpackedManifestSha256 } from "../evals/provenance.js";

const moduleUrl = (name: string) =>
	pathToFileURL(join(import.meta.dir, "..", name)).href;
const tarballFlag = "--expected-tarball-sha256";
const manifestFlag = "--expected-manifest-sha256";
let workspace: string;
let approved: string;
let restricted: string;
let expectedTarball: string;
let expectedManifest: string;

async function packFixture(mode: number, name: string): Promise<string> {
	const root = join(workspace, name);
	await mkdir(join(root, "dist"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "artifact-admission-fixture",
			version: "1.0.0",
			files: ["dist/index.js"],
		}),
	);
	await writeFile(
		join(root, "dist", "index.js"),
		"export const fixture = true;\n",
	);
	await chmod(join(root, "dist", "index.js"), mode);
	const packed = spawnSync(
		process.execPath,
		["pm", "pack", "--destination", root],
		{
			cwd: root,
			env: { PATH: process.env.PATH, HOME: root },
			encoding: "utf8",
		},
	);
	if (packed.status !== 0) throw new Error(packed.stderr);
	return join(root, "artifact-admission-fixture-1.0.0.tgz");
}

beforeAll(async () => {
	workspace = await mkdtemp(join(tmpdir(), "flow-artifact-admission-"));
	approved = await packFixture(0o644, "approved");
	restricted = await packFixture(0o600, "restricted");
	expectedTarball = await tarballSha256(approved);
	expectedManifest = await unpackedManifestSha256(approved);
});
afterAll(async () => {
	await rm(workspace, { recursive: true, force: true });
});

async function runOffline(tarball: string, options: string[]) {
	const root = await mkdtemp(join(workspace, "runner-"));
	for (const args of [
		["init", "--quiet"],
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			"Fixture",
		],
	]) {
		const git = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		if (git.status !== 0) throw new Error(git.stderr);
	}
	await writeFile(join(root, ".gitignore"), "evals/results/\nfake-budget/\n");
	const code = `
import { mock } from "bun:test";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { authorizePaidRun, consumePaidDispatch } from ${JSON.stringify(moduleUrl("scripts/paid-budget.js"))};
import { CampaignCancelled } from ${JSON.stringify(moduleUrl("evals/campaign-stop.js"))};
const root = ${JSON.stringify(root)};
const event = (name) => console.log("\\n@@artifact:" + name);
const model = "fixture/offline";
await authorizePaidRun(join(root, "fake-budget"), { schemaVersion: 1, purpose: "Offline artifact admission test", models: [model], maxDispatches: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() });
process.env.FLOW_EVAL_AUTHORIZATION = join(root, "fake-budget");
globalThis.fetch = () => { event("network"); throw new Error("Offline fixture forbids network."); };
const harness = { ...await import(${JSON.stringify(moduleUrl("evals/harness.js"))}) };
class OfflineHost {
  static async start() { event("host-credential-boundary"); return new OfflineHost(); }
  async catalogModels() { return [model]; }
  async probeModel() { event("probe"); await consumePaidDispatch({ model, kind: "probe" }); throw new CampaignCancelled(130); }
  async stop() { event("cleanup"); }
  async runCommand() { event("workflow"); throw new Error("Workflow is forbidden."); }
}
mock.module(${JSON.stringify(moduleUrl("evals/harness.js"))}, () => ({ ...harness, EvalHost: OfflineHost,
  packPlugin: async (_source, directory) => { event("pack"); const path = join(directory, "artifact.tgz"); await copyFile(${JSON.stringify(tarball)}, path); return path; },
  preparePackageCache: async (_tarball, directory) => { event("cache"); return directory; }
}));
const { runCampaign } = await import(${JSON.stringify(moduleUrl("evals/run.js"))});
try { await runCampaign(new AbortController().signal, ["--model", model, "--scenario", "plan-only-stops", ...${JSON.stringify(options)}], root); }
catch (error) { console.error(error.message); process.exitCode = 2; }
`;
	const child = Bun.spawn([process.execPath, "--eval", code], {
		cwd: root,
		env: {
			PATH: process.env.PATH,
			HOME: join(root, "home"),
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_DATA_HOME: join(root, "data"),
			XDG_CACHE_HOME: join(root, "cache"),
			FLOW_EVAL_NO_AUTH_COPY: "1",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [codeResult, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return {
		code: codeResult,
		stderr,
		events: stdout
			.split("\n")
			.filter((line) => line.startsWith("@@artifact:"))
			.map((line) => line.slice("@@artifact:".length)),
		reservations: (await readdir(join(root, "fake-budget"))).filter((name) =>
			name.startsWith("dispatch-"),
		),
	};
}

function noDispatch(result: Awaited<ReturnType<typeof runOffline>>) {
	expect(result.code).toBe(2);
	expect(result.reservations).toEqual([]);
	for (const event of [
		"cache",
		"host-credential-boundary",
		"probe",
		"workflow",
		"network",
	])
		expect(result.events).not.toContain(event);
}

describe("actual campaign artifact admission before provider access", () => {
	const modeTest = process.platform === "win32" ? test.skip : test;
	modeTest(
		"rejects changed tar modes even when the complete content manifest matches",
		async () => {
			expect(await unpackedManifestSha256(restricted)).toBe(expectedManifest);
			expect(await tarballSha256(restricted)).not.toBe(expectedTarball);
			const result = await runOffline(restricted, [
				tarballFlag,
				expectedTarball,
				manifestFlag,
				expectedManifest,
			]);
			noDispatch(result);
			expect(result.events).toEqual(["pack"]);
			expect(result.stderr).toContain("Artifact identity mismatch");
		},
	);

	test("rejects a wrong full manifest before cache, credentials or dispatch", async () => {
		const result = await runOffline(approved, [
			tarballFlag,
			expectedTarball,
			manifestFlag,
			`sha256:${"0".repeat(64)}`,
		]);
		noDispatch(result);
		expect(result.events).toEqual(["pack"]);
		expect(result.stderr).toContain("Artifact identity mismatch");
	});

	test("enforces hash expectations supplied with equals syntax", async () => {
		const result = await runOffline(approved, [
			`${tarballFlag}=sha256:${"0".repeat(64)}`,
			`${manifestFlag}=${expectedManifest}`,
		]);
		noDispatch(result);
		expect(result.events).toEqual(["pack"]);
		expect(result.stderr).toContain("Artifact identity mismatch");
	});

	for (const flag of [tarballFlag, manifestFlag]) {
		test(`rejects an unpaired ${flag} before build`, async () => {
			const result = await runOffline(approved, [flag, expectedTarball]);
			noDispatch(result);
			expect(result.events).toEqual([]);
			expect(result.stderr).toContain("must be supplied together");
		});
		for (const value of [
			"bad",
			`sha256:${"A".repeat(64)}`,
			`sha256:${"a".repeat(63)}`,
			`sha256:${"a".repeat(64)}\n`,
		]) {
			test(`rejects malformed ${flag} ${JSON.stringify(value)} before build`, async () => {
				const result = await runOffline(approved, [
					tarballFlag,
					flag === tarballFlag ? value : expectedTarball,
					manifestFlag,
					flag === manifestFlag ? value : expectedManifest,
				]);
				noDispatch(result);
				expect(result.events).toEqual([]);
				expect(result.stderr).toContain("lowercase SHA-256");
			});
		}
	}

	for (const flag of [tarballFlag, manifestFlag]) {
		test(`rejects missing ${flag} value before build`, async () => {
			const result = await runOffline(approved, [flag]);
			noDispatch(result);
			expect(result.events).toEqual([]);
			expect(result.stderr).toContain("requires a value");
		});
		test(`rejects repeated ${flag} before build`, async () => {
			const result = await runOffline(approved, [
				tarballFlag,
				expectedTarball,
				manifestFlag,
				expectedManifest,
				flag,
				expectedTarball,
			]);
			noDispatch(result);
			expect(result.events).toEqual([]);
			expect(result.stderr).toContain("may only be supplied once");
		});
	}
	for (const expectation of ["matching", "equals", "absent"]) {
		test(`${expectation} expectation reaches only the fake paid probe boundary`, async () => {
			const result = await runOffline(
				approved,
				expectation === "matching"
					? [tarballFlag, expectedTarball, manifestFlag, expectedManifest]
					: expectation === "equals"
						? [
								`${tarballFlag}=${expectedTarball}`,
								`${manifestFlag}=${expectedManifest}`,
							]
						: [],
			);
			expect(result.events).toEqual([
				"pack",
				"cache",
				"host-credential-boundary",
				"probe",
				"cleanup",
			]);
			expect(result.reservations).toEqual(["dispatch-0.json"]);
			expect(result.stderr).toBe("");
		});
	}
});
