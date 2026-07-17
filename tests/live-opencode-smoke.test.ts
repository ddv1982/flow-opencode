import { describe, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

// Boots a real OpenCode server with the packed tarball installed as a
// plugin and verifies the public Flow surface over the HTTP API. It boots the
// exact OpenCode version paired with the pinned plugin dev dependency through
// bunx by default. Scheduled compatibility monitoring overrides the package
// spec with FLOW_OPENCODE_SMOKE_VERSION=latest. The test requires network
// access, so it only runs when explicitly requested: FLOW_LIVE_SMOKE=1.
const LIVE = process.env.FLOW_LIVE_SMOKE === "1";
const PINNED_OPENCODE_VERSION =
	packageJson.devDependencies["@opencode-ai/plugin"];

function resolveOpenCodeVersion(override: string | undefined): string {
	return override?.trim() || PINNED_OPENCODE_VERSION;
}

const OPENCODE_VERSION = resolveOpenCodeVersion(
	process.env.FLOW_OPENCODE_SMOKE_VERSION,
);
// The server reports healthy before plugins finish loading, and the first
// data request blocks while it bun-installs the plugin's dependencies over
// the network — so health polls retry on a short timeout while data
// requests get a generous but bounded one (a hung request must not stall
// the test past its own failure reporting).
const STARTUP_TIMEOUT_MS = 180_000;
const HEALTH_POLL_TIMEOUT_MS = 3_000;
const DATA_REQUEST_TIMEOUT_MS = 120_000;

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

// The read-only workers whose isolation must actually bind: they may inspect
// and read, but must not mutate Flow state, spawn subagents, load native
// skills, or edit files. (flow-candidate-worker is excluded — it may edit/bash
// with "ask" in an assigned slice.)
const READ_ONLY_WORKERS = [
	"flow-audit-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
];

type ResolvedPermissionRule = {
	permission: string;
	pattern: string;
	action: "ask" | "allow" | "deny";
};

type ResolvedAgent = {
	name: string;
	permission?: ResolvedPermissionRule[];
};

// OpenCode resolves an agent's permission config into an ordered rule list
// returned by GET /agent. A rule binds when it is present with the expected
// action.
function hasPermissionRule(
	rules: ResolvedPermissionRule[],
	permission: string,
	action: ResolvedPermissionRule["action"],
): boolean {
	return rules.some(
		(rule) => rule.permission === permission && rule.action === action,
	);
}

async function fetchJson(
	url: string,
	timeoutMs = DATA_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`GET ${url} failed with ${response.status}`);
	}
	return response.json();
}

async function waitForHealth(baseUrl: string, deadline: number): Promise<void> {
	while (Date.now() < deadline) {
		try {
			const health = (await fetchJson(
				`${baseUrl}/global/health`,
				HEALTH_POLL_TIMEOUT_MS,
			)) as {
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

describe("live OpenCode smoke configuration", () => {
	test("uses the pinned host by default and accepts an explicit compatibility target", () => {
		expect(resolveOpenCodeVersion(undefined)).toBe(PINNED_OPENCODE_VERSION);
		expect(resolveOpenCodeVersion("  ")).toBe(PINNED_OPENCODE_VERSION);
		expect(resolveOpenCodeVersion("latest")).toBe("latest");
	});
});

describe.skipIf(!LIVE)(`live OpenCode ${OPENCODE_VERSION} smoke`, () => {
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

				const agents = (await fetchJson(`${baseUrl}/agent`)) as ResolvedAgent[];
				const agentNames = agents.map((agent) => agent.name);
				for (const expected of EXPECTED_AGENTS) {
					expect(agentNames).toContain(expected);
				}

				// Prove the hidden read-only worker isolation actually binds at
				// runtime. Flow declares these denials with tool-name and wildcard
				// permission keys (skill, task, flow_*, flow_status) that are absent
				// from the SDK's simplified AgentConfig permission type — this test
				// exists to confirm OpenCode nonetheless compiles them into the
				// resolved permission rules, rather than silently dropping them.
				const agentsByName = new Map(
					agents.map((agent) => [agent.name, agent]),
				);
				for (const name of READ_ONLY_WORKERS) {
					const agent = agentsByName.get(name);
					if (!agent) throw new Error(`Expected agent '${name}' to register.`);
					const rules = agent.permission ?? [];
					expect(
						rules.length,
						`${name} has resolved permission rules`,
					).toBeGreaterThan(0);
					// Cannot mutate Flow state, but flow_status stays readable (the
					// allow rule follows the flow_* deny, so status resolves to allow).
					expect(
						hasPermissionRule(rules, "flow_*", "deny"),
						`${name} denies state-changing flow_* tools`,
					).toBe(true);
					expect(
						hasPermissionRule(rules, "flow_status", "allow"),
						`${name} still allows flow_status`,
					).toBe(true);
					// Cannot spawn subagents, load native skills, or edit files.
					expect(
						hasPermissionRule(rules, "task", "deny"),
						`${name} cannot spawn task subagents`,
					).toBe(true);
					expect(
						hasPermissionRule(rules, "skill", "deny"),
						`${name} cannot load native skills`,
					).toBe(true);
					expect(
						hasPermissionRule(rules, "edit", "deny"),
						`${name} is read-only`,
					).toBe(true);
					// Bash is never fully granted for a read-only worker (deny or ask).
					expect(
						hasPermissionRule(rules, "bash", "allow"),
						`${name} never gets unrestricted bash`,
					).toBe(false);
				}

				// Plugin startup must not install, refresh, or inspect global skills.
				await expect(
					lstat(join(home, ".config", "opencode", "skills")),
				).rejects.toMatchObject({ code: "ENOENT" });
				// Config registration must also remain workspace-read-only. Session
				// state is created only by an explicit Flow mutation tool call.
				await expect(lstat(join(project, ".flow"))).rejects.toMatchObject({
					code: "ENOENT",
				});
			} catch (error) {
				stopServer(server);
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}\nServer output:\n${serverOutput.join("")}`,
				);
			}
			stopServer(server);
		},
		STARTUP_TIMEOUT_MS + 2 * DATA_REQUEST_TIMEOUT_MS,
	);
});
