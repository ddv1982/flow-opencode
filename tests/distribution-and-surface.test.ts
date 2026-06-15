import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FlowPlugin from "../src";
import { createTools } from "../src/adapters/opencode/tools";
import { createFlowCoreConfigEntries } from "../src/config-shared";
import {
	formatFlowSkillDoctor,
	getFlowSkillSetupStatus,
	getLatestFlowSkillSyncHealth,
	inspectFlowSkillInstall,
	resolveFlowPluginVersion,
	syncFlowSkills,
	uninstallFlowSkills,
} from "../src/distribution/sync";
import { flowPlanSave } from "../src/runtime/api";

async function tempHome(): Promise<string> {
	const home = join(tmpdir(), `flow-home-${crypto.randomUUID()}`);
	await mkdir(home, { recursive: true });
	return home;
}

async function tempWorkspace(): Promise<string> {
	const workspace = join(tmpdir(), `flow-workspace-${crypto.randomUUID()}`);
	await mkdir(workspace, { recursive: true });
	return workspace;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

const FLOW_AGENT_NAMES = [
	"flow-audit-worker",
	"flow-candidate-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
] as const;

describe("Flow distribution and plugin surface", () => {
	test("exposes the seven-tool v4 surface", () => {
		expect(Object.keys(createTools({})).sort()).toEqual([
			"flow_feature_complete",
			"flow_feature_reset",
			"flow_plan_approve",
			"flow_plan_save",
			"flow_run_start",
			"flow_session_close",
			"flow_status",
		]);
	});

	test("injects only minimal commands and hidden Flow workers", () => {
		const config = createFlowCoreConfigEntries();
		expect(Object.keys(config.agent).sort()).toEqual(
			[...FLOW_AGENT_NAMES].sort(),
		);
		expect(Object.keys(config.command).sort()).toEqual([
			"flow-auto",
			"flow-plan",
			"flow-review",
			"flow-run",
			"flow-status",
		]);
		expect(config.agent["flow-reviewer"]).toMatchObject({
			mode: "subagent",
			permission: {
				edit: "deny",
				bash: "deny",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Bundled Flow review fallback");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Finding classes");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Never approve to unblock completion");
		expect(config.agent["flow-evidence-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "deny",
				bash: "deny",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(config.agent["flow-validation-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "deny",
				bash: "ask",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(config.agent["flow-audit-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "deny",
				bash: "ask",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(config.agent["flow-candidate-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "ask",
				bash: "ask",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(config.agent["flow-verifier-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "deny",
				bash: "ask",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
	});

	test("documents every injected Flow worker for parallel orchestration", async () => {
		const config = createFlowCoreConfigEntries();
		const orchestration = await readFile(
			"skills/flow/references/parallel-orchestration.md",
			"utf8",
		);

		for (const agentName of Object.keys(config.agent)) {
			expect(orchestration).toContain(`\`${agentName}\``);
		}
	});

	test("appends session facts in system and compaction hooks", async () => {
		const previousHome = process.env.HOME;
		process.env.HOME = await tempHome();
		try {
			const workspace = await tempWorkspace();
			await flowPlanSave(workspace, { goal: "Inspect hook context" });
			const hooks = await FlowPlugin({
				client: { app: { log() {} } },
				project: {},
				directory: workspace,
				worktree: workspace,
				experimental_workspace: { register() {} },
				serverUrl: new URL("http://localhost"),
				$: {},
			} as unknown as Parameters<typeof FlowPlugin>[0]);
			const systemHook = hooks["experimental.chat.system.transform"];
			const compactingHook = hooks["experimental.session.compacting"];
			expect(systemHook).toBeDefined();
			expect(compactingHook).toBeDefined();
			if (!systemHook || !compactingHook) {
				throw new Error("Expected Flow hooks to be registered.");
			}

			const systemOutput = { system: [] as string[] };
			await systemHook(
				{ sessionID: "test-session", model: {} } as Parameters<
					typeof systemHook
				>[0],
				systemOutput,
			);
			expect(systemOutput.system.at(-1)).toContain("Inspect hook context");

			const compactOutput = { context: [] as string[] };
			await compactingHook({ sessionID: "test-session" }, compactOutput);
			expect(compactOutput.context.at(-1)).toContain("Inspect hook context");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("surfaces startup skill sync health in flow_status and Flow command preflight", async () => {
		const home = await tempHome();
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		try {
			const workspace = await tempWorkspace();
			const hooks = await FlowPlugin({
				client: { app: { log() {} } },
				project: {},
				directory: workspace,
				worktree: workspace,
				experimental_workspace: { register() {} },
				serverUrl: new URL("http://localhost"),
				$: {},
			} as unknown as Parameters<typeof FlowPlugin>[0]);

			const health = getLatestFlowSkillSyncHealth();
			expect(health?.status).toBe("restart_required");
			expect(health?.changedSkills).toContain("flow-review");

			const setup = getFlowSkillSetupStatus();
			expect(setup?.status).toBe("restart_required");

			const tools = createTools({});
			const statusOutput = await tools.flow_status.execute({}, {
				directory: workspace,
				worktree: workspace,
			} as Parameters<typeof tools.flow_status.execute>[1]);
			const parsedStatus = JSON.parse(String(statusOutput));
			expect(parsedStatus.setup.skills.status).toBe("restart_required");
			expect(parsedStatus.setup.skills.changed).toContain("flow-review");

			const preflight = hooks["command.execute.before"];
			expect(preflight).toBeDefined();
			if (!preflight) throw new Error("Expected command preflight hook.");
			const output: { parts: Array<{ text: string }> } = { parts: [] };
			await preflight(
				{
					command: "flow-review",
					sessionID: "test-session",
					arguments: "",
				},
				output as Parameters<typeof preflight>[1],
			);
			expect(output.parts).toHaveLength(1);
			expect(output.parts[0]?.text).toContain("Restart OpenCode");
			expect(output.parts[0]?.text).toContain("npx -y opencode-plugin-flow@");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("syncs managed skills and preserves foreign skill folders", async () => {
		const home = await tempHome();
		const results = await syncFlowSkills("4.0.0-test", home);
		expect(results.every((result) => result.action === "installed")).toBe(true);

		const flowSkillPath = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow",
			"SKILL.md",
		);
		await expect(readFile(flowSkillPath, "utf8")).resolves.toContain(
			"skills-first",
		);
		await expect(
			readFile(
				join(
					home,
					".config",
					"opencode",
					"skills",
					"flow",
					"references",
					"handoff-format.md",
				),
				"utf8",
			),
		).resolves.toContain("Flow worker handoff contract");
		await expect(
			readFile(
				join(
					home,
					".config",
					"opencode",
					"skills",
					"flow",
					"references",
					"verification-gates.md",
				),
				"utf8",
			),
		).resolves.toContain("Verification gates");
		const marker = await readFile(
			join(
				home,
				".config",
				"opencode",
				"skills",
				"flow",
				".flow-skill-version",
			),
			"utf8",
		);
		expect(marker).toContain("file=references/handoff-format.md sha256=");
		expect(marker).toContain("file=references/verification-gates.md sha256=");

		const removed = await uninstallFlowSkills(home);
		expect(removed.removed.some((path) => path.endsWith("/flow"))).toBe(true);

		const foreignSkill = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow-custom",
		);
		await mkdir(foreignSkill, { recursive: true });
		await writeFile(join(foreignSkill, "SKILL.md"), "user skill\n", "utf8");
		const skipped = await syncFlowSkills("4.0.0-test", home);
		expect(
			skipped.some(
				(result) =>
					result.name === "flow-custom" && result.action === "skipped_foreign",
			),
		).toBe(false);
		expect(await readFile(join(foreignSkill, "SKILL.md"), "utf8")).toBe(
			"user skill\n",
		);
	});

	test("backs up edited skills with legacy managed markers", async () => {
		const home = await tempHome();
		const folder = join(home, ".config", "opencode", "skills", "flow");
		await mkdir(folder, { recursive: true });
		const original = "old generated skill\n";
		const edited = "user edited skill\n";
		const originalHash = sha256(original);
		await writeFile(join(folder, "SKILL.md"), edited, "utf8");
		await writeFile(
			join(folder, ".flow-skill-version"),
			[
				"plugin=opencode-plugin-flow",
				"version=3.3.22",
				`hash=sha256:${originalHash}`,
				`file=SKILL.md=sha256:${originalHash}`,
				"",
			].join("\n"),
			"utf8",
		);

		const results = await syncFlowSkills("4.0.0-test", home);
		expect(results.find((result) => result.name === "flow")?.action).toBe(
			"updated_with_backup",
		);
		await expect(
			readFile(join(folder, "SKILL.md.backup"), "utf8"),
		).resolves.toBe(edited);
	});

	test("doctor reports missing managed skills", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		await rm(join(home, ".config", "opencode", "skills", "flow-review"), {
			recursive: true,
			force: true,
		});

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		expect(report.status).toBe("sync_required");
		expect(report.syncRequiredSkills).toContain("flow-review");
		expect(
			report.skills.find((skill) => skill.name === "flow-review")?.status,
		).toBe("missing");
		const formatted = formatFlowSkillDoctor(report);
		expect(formatted).toContain("flow-review: missing");
		expect(formatted).toContain("Start or restart OpenCode");
		expect(formatted).toContain(
			"npx -y opencode-plugin-flow@4.0.0-test doctor",
		);
	});

	test("doctor treats stale markers for current files as sync repair", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const markerPath = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow-review",
			".flow-skill-version",
		);
		const marker = await readFile(markerPath, "utf8");
		await writeFile(
			markerPath,
			marker.replace(
				/file=SKILL\.md sha256=[a-f0-9]{64}/,
				`file=SKILL.md sha256=${sha256("older generated content")}`,
			),
			"utf8",
		);

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		const skill = report.skills.find((skill) => skill.name === "flow-review");
		expect(report.status).toBe("sync_required");
		expect(report.syncRequiredSkills).toContain("flow-review");
		expect(report.actionRequiredSkills).not.toContain("flow-review");
		expect(skill?.status).toBe("outdated");
		expect(skill?.editedFiles).toEqual([]);
	});

	test("doctor reports foreign managed skills as user action", async () => {
		const home = await tempHome();
		const folder = join(home, ".config", "opencode", "skills", "flow-review");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "SKILL.md"), "user skill\n", "utf8");

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		expect(report.status).toBe("action_required");
		expect(report.actionRequiredSkills).toContain("flow-review");
		expect(
			report.skills.find((skill) => skill.name === "flow-review")?.status,
		).toBe("foreign");
		expect(formatFlowSkillDoctor(report)).toContain("needs user decision");
	});

	test("resolves plugin version from package metadata outside npm scripts", () => {
		const previous = process.env.npm_package_version;
		delete process.env.npm_package_version;
		try {
			expect(resolveFlowPluginVersion()).toBe("4.1.2");
		} finally {
			if (previous === undefined) {
				delete process.env.npm_package_version;
			} else {
				process.env.npm_package_version = previous;
			}
		}
	});
});
