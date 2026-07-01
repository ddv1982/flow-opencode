import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";

// Boots a real OpenCode server with the packed tarball installed as a
// plugin and verifies the public Flow surface over the HTTP API. Requires
// an `opencode` binary on PATH and network access for plugin install, so
// it only runs when explicitly requested: FLOW_LIVE_SMOKE=1.
const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const STARTUP_TIMEOUT_MS = 120_000;

const EXPECTED_COMMANDS = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
];
const EXPECTED_AGENTS = [
	"flow-audit-worker",
	"flow-candidate-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
];

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`GET ${url} failed with ${response.status}`);
	}
	return response.json();
}

async function waitForHealth(baseUrl: string, deadline: number): Promise<void> {
	while (Date.now() < deadline) {
		try {
			const health = (await fetchJson(`${baseUrl}/global/health`)) as {
				healthy?: boolean;
			};
			if (health.healthy) return;
		} catch {
			// Server not accepting connections yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`OpenCode server did not become healthy at ${baseUrl}.`);
}

function stopServer(server: ChildProcess): void {
	if (!server.killed) server.kill("SIGTERM");
}

describe.skipIf(!LIVE)("live OpenCode smoke", () => {
	test(
		"packed plugin loads in a real OpenCode server and registers the Flow surface",
		async () => {
			const scratch = join(tmpdir(), `flow-live-smoke-${crypto.randomUUID()}`);
			const home = join(scratch, "home");
			const project = join(scratch, "project");
			await mkdir(home, { recursive: true });
			await mkdir(join(project, ".opencode", "plugins"), { recursive: true });

			const pack = spawnSync("bun", ["pm", "pack", "--destination", scratch], {
				cwd: join(import.meta.dir, ".."),
				encoding: "utf8",
			});
			expect(pack.status).toBe(0);
			const tarball = join(
				scratch,
				`opencode-plugin-flow-${packageJson.version}.tgz`,
			);

			await writeFile(
				join(project, ".opencode", "package.json"),
				`${JSON.stringify(
					{ dependencies: { "opencode-plugin-flow": `file:${tarball}` } },
					null,
					2,
				)}\n`,
				"utf8",
			);
			await writeFile(
				join(project, ".opencode", "plugins", "flow.ts"),
				'export { default } from "opencode-plugin-flow";\n',
				"utf8",
			);
			await writeFile(join(project, "README.md"), "# smoke\n", "utf8");

			const port = 41000 + Math.floor(Math.random() * 1000);
			const baseUrl = `http://127.0.0.1:${port}`;
			const server = spawn(
				"opencode",
				["serve", "--port", String(port), "--hostname", "127.0.0.1"],
				{
					cwd: project,
					env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "" },
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			const serverOutput: string[] = [];
			server.stdout?.on("data", (chunk) => serverOutput.push(String(chunk)));
			server.stderr?.on("data", (chunk) => serverOutput.push(String(chunk)));

			try {
				await waitForHealth(baseUrl, Date.now() + STARTUP_TIMEOUT_MS);

				const commands = (await fetchJson(`${baseUrl}/command`)) as Array<{
					name: string;
				}>;
				const commandNames = commands.map((command) => command.name);
				for (const expected of EXPECTED_COMMANDS) {
					expect(commandNames).toContain(expected);
				}

				const agents = (await fetchJson(`${baseUrl}/agent`)) as Array<{
					name: string;
				}>;
				const agentNames = agents.map((agent) => agent.name);
				for (const expected of EXPECTED_AGENTS) {
					expect(agentNames).toContain(expected);
				}

				// Startup skill sync ran inside the real host process.
				const syncedSkill = await readFile(
					join(home, ".config", "opencode", "skills", "flow", "SKILL.md"),
					"utf8",
				);
				expect(syncedSkill).toContain("flow");
			} catch (error) {
				stopServer(server);
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\nServer output:\n${serverOutput.join("")}`,
				);
			}
			stopServer(server);
		},
		STARTUP_TIMEOUT_MS + 60_000,
	);
});
