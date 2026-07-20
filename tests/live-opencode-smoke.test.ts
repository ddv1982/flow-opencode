import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

// This test deliberately proves only the host boundary. Domain and persistence
// behavior belongs in fast deterministic tests; the live smoke verifies that a
// packed release loads in a real OpenCode process with the intended commands
// and reviewer isolation.
const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const PINNED_OPENCODE_VERSION =
	packageJson.devDependencies["@opencode-ai/plugin"];
const OPENCODE_VERSION =
	process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim() || PINNED_OPENCODE_VERSION;
const STARTUP_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 120_000;

const EXPECTED_COMMANDS = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
] as const;

const EXPECTED_TOOLS = [
	"flow_feature_complete",
	"flow_feature_reset",
	"flow_guidance",
	"flow_plan_approve",
	"flow_plan_save",
	"flow_review_start",
	"flow_run_start",
	"flow_session_close",
	"flow_status",
	"flow_validation_start",
] as const;

type PermissionRule = {
	permission: string;
	pattern: string;
	action: "ask" | "allow" | "deny";
};

type ResolvedAgent = {
	name: string;
	permission?: PermissionRule[];
};

function wildcardMatches(input: string, pattern: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replaceAll("*", ".*")
		.replaceAll("?", ".");
	return new RegExp(`^${expression}$`, "s").test(input);
}

function permissionFor(
	rules: readonly PermissionRule[],
	permission: string,
): PermissionRule["action"] {
	for (let index = rules.length - 1; index >= 0; index -= 1) {
		const rule = rules[index];
		if (
			rule &&
			wildcardMatches(permission, rule.permission) &&
			wildcardMatches("*", rule.pattern)
		) {
			return rule.action;
		}
	}
	return "ask";
}

async function fetchJson(url: string, timeout = REQUEST_TIMEOUT_MS) {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
	if (!response.ok) {
		throw new Error(
			`GET ${url} failed with ${response.status}: ${await response.text()}`,
		);
	}
	return response.json();
}

async function waitForHealth(baseUrl: string): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const health = (await fetchJson(`${baseUrl}/global/health`, 3_000)) as {
				healthy?: boolean;
			};
			if (health.healthy) return;
		} catch {
			// The process is still starting.
		}
		await Bun.sleep(500);
	}
	throw new Error(`OpenCode did not become healthy at ${baseUrl}.`);
}

async function availablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Could not reserve a local port.");
	}
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function stopServer(server: ChildProcess): Promise<void> {
	if (server.exitCode !== null) return;
	server.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((resolve) => server.once("exit", () => resolve())),
		Bun.sleep(2_000).then(() => {
			if (server.exitCode === null) server.kill("SIGKILL");
		}),
	]);
}

describe("live OpenCode smoke configuration", () => {
	test("uses the pinned host unless compatibility monitoring overrides it", () => {
		expect(PINNED_OPENCODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		expect(
			process.env.FLOW_OPENCODE_SMOKE_VERSION?.trim()
				? OPENCODE_VERSION
				: PINNED_OPENCODE_VERSION,
		).toBe(OPENCODE_VERSION);
		expect(EXPECTED_COMMANDS).toHaveLength(5);
		expect(EXPECTED_TOOLS).toHaveLength(10);
	});
});

describe.skipIf(!LIVE)(`live OpenCode ${OPENCODE_VERSION} smoke`, () => {
	test(
		"loads the packed plugin and enforces the small public surface",
		async () => {
			const repositoryRoot = join(import.meta.dir, "..");
			const scratch = await mkdtemp(join(tmpdir(), "flow-live-smoke-"));
			const childHome = join(scratch, "home");
			const childCache = join(scratch, "cache");
			const project = join(scratch, "project");
			await mkdir(childHome, { recursive: true });
			await mkdir(join(project, ".opencode"), { recursive: true });

			const build = spawnSync("bun", ["run", "build"], {
				cwd: repositoryRoot,
				encoding: "utf8",
			});
			expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
			const pack = spawnSync("bun", ["pm", "pack", "--destination", scratch], {
				cwd: repositoryRoot,
				encoding: "utf8",
			});
			expect(pack.status, `${pack.stdout}\n${pack.stderr}`).toBe(0);
			const tarball = join(
				scratch,
				`opencode-plugin-flow-${packageJson.version}.tgz`,
			);
			expect((await lstat(tarball)).isFile()).toBe(true);

			// Populate OpenCode's exact-version package cache from the candidate
			// tarball so the documented config exercises these exact package bytes.
			const packageCache = join(
				childCache,
				"opencode",
				"packages",
				`opencode-plugin-flow@${packageJson.version}`,
			);
			await mkdir(packageCache, { recursive: true });
			await writeFile(
				join(packageCache, "package.json"),
				`${JSON.stringify({ dependencies: { "opencode-plugin-flow": `file:${tarball}` } }, null, 2)}\n`,
				"utf8",
			);
			const install = spawnSync("bun", ["install"], {
				cwd: packageCache,
				encoding: "utf8",
			});
			expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);
			await writeFile(
				join(project, "opencode.json"),
				`${JSON.stringify({ plugin: [`opencode-plugin-flow@${packageJson.version}`] }, null, 2)}\n`,
				"utf8",
			);

			const port = await availablePort();
			const baseUrl = `http://127.0.0.1:${port}`;
			const server = spawn(
				"bunx",
				[
					`opencode-ai@${OPENCODE_VERSION}`,
					"serve",
					"--port",
					String(port),
					"--hostname",
					"127.0.0.1",
				],
				{
					cwd: project,
					env: {
						...process.env,
						HOME: childHome,
						OPENCODE_TEST_HOME: childHome,
						XDG_CACHE_HOME: childCache,
						XDG_CONFIG_HOME: join(childHome, ".config"),
						XDG_DATA_HOME: join(childHome, ".local", "share"),
						XDG_STATE_HOME: join(childHome, ".local", "state"),
					},
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			let serverOutput = "";
			server.stdout?.on("data", (chunk) => {
				serverOutput += String(chunk);
			});
			server.stderr?.on("data", (chunk) => {
				serverOutput += String(chunk);
			});

			try {
				await waitForHealth(baseUrl);
				const commands = (await fetchJson(`${baseUrl}/command`)) as Array<{
					name: string;
				}>;
				expect(
					commands
						.map((command) => command.name)
						.filter((name) => name.startsWith("flow-"))
						.sort(),
				).toEqual([...EXPECTED_COMMANDS].sort());

				const toolIds = (await fetchJson(
					`${baseUrl}/experimental/tool/ids`,
				)) as string[];
				expect(
					toolIds.filter((name) => name.startsWith("flow_")).sort(),
				).toEqual([...EXPECTED_TOOLS].sort());

				const agents = (await fetchJson(`${baseUrl}/agent`)) as ResolvedAgent[];
				const flowAgents = agents.filter((agent) =>
					agent.name.startsWith("flow-"),
				);
				expect(flowAgents.map((agent) => agent.name)).toEqual([
					"flow-reviewer",
				]);
				const reviewer = flowAgents[0];
				if (!reviewer) throw new Error("Flow reviewer was not registered.");
				for (const permission of [
					"edit",
					"bash",
					"external_directory",
					"task",
					"flow_plan_save",
					"flow_feature_complete",
				]) {
					expect(permissionFor(reviewer.permission ?? [], permission)).toBe(
						"deny",
					);
				}
				expect(permissionFor(reviewer.permission ?? [], "flow_status")).toBe(
					"allow",
				);
				await expect(lstat(join(project, ".flow"))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} catch (error) {
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\nServer output:\n${serverOutput}`,
				);
			} finally {
				await stopServer(server);
				await rm(scratch, { recursive: true, force: true });
			}
		},
		STARTUP_TIMEOUT_MS + 2 * REQUEST_TIMEOUT_MS,
	);
});
