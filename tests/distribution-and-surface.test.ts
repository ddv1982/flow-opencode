import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FlowPlugin from "../src";
import { createTools } from "../src/adapters/opencode/tools";
import { createFlowCoreConfigEntries } from "../src/config-shared";
import { FLOW_SKILL_DEFINITIONS } from "../src/distribution/flow-skill-definitions";
import {
	formatFlowSkillDoctor,
	getFlowSkillSetupStatus,
	getLatestFlowSkillSyncHealth,
	inspectFlowSkillInstall,
	resolveFlowPluginVersion,
	runFlowSkillSync,
	syncFlowSkills,
	uninstallFlowSkills,
} from "../src/distribution/sync";
import { flowPlanSave } from "../src/runtime/api";
import { flowInstructionPath } from "../src/runtime/workspace";

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

function expectSameMembers(
	actual: readonly string[] | undefined,
	expected: readonly string[],
): void {
	expect([...(actual ?? [])].sort()).toEqual([...expected].sort());
}

function expectFlowCommandTextParts(
	parts: Array<{ text: string; synthetic?: boolean }>,
	expectedSeed: string,
) {
	expect(parts).toHaveLength(2);
	expect(parts[0]?.synthetic).toBeUndefined();
	expect(parts[0]?.text).toBe(expectedSeed);
	expect(parts[1]?.synthetic).toBe(true);
	expect(parts[1]?.text).toBeString();
	return parts[1]?.text ?? "";
}

const FLOW_AGENT_NAMES = [
	"flow-audit-worker",
	"flow-candidate-worker",
	"flow-evidence-worker",
	"flow-reviewer",
	"flow-validation-worker",
	"flow-verifier-worker",
] as const;

const FLOW_COMMAND_NAMES = [
	"flow-auto",
	"flow-plan",
	"flow-review",
	"flow-run",
	"flow-status",
] as const;

const FLOW_MANAGED_SKILL_NAMES = FLOW_SKILL_DEFINITIONS.map(
	(definition) => definition.name,
);
const EXPECTED_FLOW_MANAGED_SKILL_NAMES = [
	"flow",
	"flow-plan",
	"flow-run",
	"flow-test",
	"flow-review",
	"flow-deslop",
	"flow-ui-quality",
	"flow-commit",
] as const;

function flowSkillFolder(home: string, skillName: string): string {
	return join(home, ".config", "opencode", "skills", skillName);
}

function flowSkillFile(
	home: string,
	skillName: string,
	relativePath: string,
): string {
	return join(flowSkillFolder(home, skillName), ...relativePath.split("/"));
}

function flowSkillMarker(
	version: string,
	files: Array<{ relativePath: string; content: string }>,
): string {
	return [
		`version=${version}`,
		...files.map(
			(file) => `file=${file.relativePath} sha256=${sha256(file.content)}`,
		),
		"",
	].join("\n");
}

async function runFlowCli(args: string[], home?: string) {
	const cliHome = home ?? (await tempHome());
	return spawnSync(process.execPath, ["run", "./src/cli.ts", ...args], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: { ...process.env, HOME: cliHome },
	});
}

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
		expect(Object.keys(config.command).sort()).toEqual([...FLOW_COMMAND_NAMES]);
		expect(config.agent["flow-reviewer"]).toMatchObject({
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
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Bundled Flow review instructions");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("advisory review only");
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

	test("keeps public Flow commands self-contained from native skill loading", () => {
		const config = createFlowCoreConfigEntries();
		const expectedBundledSections = {
			"flow-auto": ["Bundled flow/SKILL.md", "Bundled flow-run/SKILL.md"],
			"flow-plan": [
				"Bundled flow-plan/SKILL.md",
				"Bundled flow/references/parallel-orchestration.md",
			],
			"flow-run": ["Bundled flow-run/SKILL.md", "Bundled flow-review/SKILL.md"],
			"flow-review": [
				"Bundled flow-review/SKILL.md",
				"Bundled flow-review/references/review-rubric.md",
			],
		} satisfies Record<
			Exclude<(typeof FLOW_COMMAND_NAMES)[number], "flow-status">,
			string[]
		>;

		for (const command of FLOW_COMMAND_NAMES) {
			const entry = config.command[command] as { template: string };
			if (command === "flow-status") {
				expect(entry.template).toBe(
					"Call flow_status and report the session state and next action.",
				);
				continue;
			}

			expect(entry.template).toStartWith("Call `flow_status` first.");
			expect(entry.template).toContain("setup.skills");
			expect(entry.template).toContain("continue with the bundled public Flow");
			expect(entry.template).toContain("Do not call native Flow skills");
			expect(entry.template).toContain(
				"In bundled sections, `load` means read and use",
			);
			expect(entry.template).toContain("Optional helper skills");
			for (const section of expectedBundledSections[command]) {
				expect(entry.template).toContain(section);
			}
			expect(entry.template).not.toContain("Otherwise load the `flow");
		}
	});

	test("registers the expected managed Flow skill set", () => {
		expect(FLOW_MANAGED_SKILL_NAMES).toEqual([
			...EXPECTED_FLOW_MANAGED_SKILL_NAMES,
		]);
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

	test("registers generated instructions without experimental hooks by default", async () => {
		const previousHome = process.env.HOME;
		process.env.HOME = await tempHome();
		try {
			const workspace = await tempWorkspace();
			const instructionPath = flowInstructionPath(workspace);
			await flowPlanSave(workspace, {
				goal: "Inspect stable instruction context",
			});
			const hooks = await FlowPlugin({
				client: { app: { log() {} } },
				project: {},
				directory: workspace,
				worktree: workspace,
				experimental_workspace: { register() {} },
				serverUrl: new URL("http://localhost"),
				$: {},
			} as unknown as Parameters<typeof FlowPlugin>[0]);
			expect(hooks["experimental.chat.system.transform"]).toBeUndefined();
			expect(hooks["experimental.session.compacting"]).toBeUndefined();

			const config = { instructions: ["AGENTS.md"] };
			const configHook = hooks.config;
			expect(configHook).toBeDefined();
			if (!configHook) throw new Error("Expected config hook.");
			await configHook(config);
			await configHook(config);

			expect(config.instructions).toEqual(["AGENTS.md", instructionPath]);
			await expect(readFile(instructionPath, "utf8")).resolves.toContain(
				"Inspect stable instruction context",
			);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("registers the generated instruction path before a session exists", async () => {
		const previousHome = process.env.HOME;
		process.env.HOME = await tempHome();
		try {
			const workspace = await tempWorkspace();
			const instructionPath = flowInstructionPath(workspace);
			const hooks = await FlowPlugin({
				client: { app: { log() {} } },
				project: {},
				directory: workspace,
				worktree: workspace,
				experimental_workspace: { register() {} },
				serverUrl: new URL("http://localhost"),
				$: {},
			} as unknown as Parameters<typeof FlowPlugin>[0]);

			const config = { instructions: ["AGENTS.md"] };
			const configHook = hooks.config;
			expect(configHook).toBeDefined();
			if (!configHook) throw new Error("Expected config hook.");
			await configHook(config);

			expect(config.instructions).toEqual(["AGENTS.md", instructionPath]);
			await expect(readFile(instructionPath, "utf8")).rejects.toThrow();
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
			expectSameMembers(health?.changedSkills, FLOW_MANAGED_SKILL_NAMES);

			const setup = getFlowSkillSetupStatus();
			expect(setup?.status).toBe("restart_required");

			const tools = createTools({});
			const statusOutput = await tools.flow_status.execute({}, {
				directory: workspace,
				worktree: workspace,
			} as Parameters<typeof tools.flow_status.execute>[1]);
			const parsedStatus = JSON.parse(String(statusOutput));
			expect(parsedStatus.setup.skills.status).toBe("restart_required");
			expectSameMembers(
				parsedStatus.setup.skills.changed,
				FLOW_MANAGED_SKILL_NAMES,
			);

			const preflight = hooks["command.execute.before"];
			expect(preflight).toBeDefined();
			if (!preflight) throw new Error("Expected command preflight hook.");

			for (const command of FLOW_COMMAND_NAMES) {
				const output: { parts: Array<{ text: string; synthetic?: boolean }> } =
					{
						parts: [
							{
								text: "Load the `flow-review` skill and review: stale",
							},
						],
					};
				await preflight(
					{
						command,
						sessionID: "test-session",
						arguments: "",
					},
					output as Parameters<typeof preflight>[1],
				);
				const bundledPrompt = expectFlowCommandTextParts(
					output.parts,
					{
						"flow-auto": "Flow auto",
						"flow-plan": "Flow plan",
						"flow-review": "Flow review",
						"flow-run": "Flow run",
						"flow-status": "Flow status",
					}[command],
				);
				if (command === "flow-status") {
					expect(bundledPrompt).toBe(
						"Call flow_status and report the session state and next action.",
					);
					continue;
				}
				expect(bundledPrompt).toContain("Restart OpenCode");
				expect(bundledPrompt).toContain("npx -y opencode-plugin-flow@");
				expect(bundledPrompt).toContain("Call `flow_status` first.");
				expect(bundledPrompt).toContain(
					"continue with the bundled public Flow",
				);
				expect(bundledPrompt).toContain(
					"briefly state which bundled Flow command is running",
				);
				expect(bundledPrompt).not.toContain("review: stale");
			}

			const nonFlowOutput: { parts: Array<{ text: string }> } = { parts: [] };
			await preflight(
				{
					command: "help",
					sessionID: "test-session",
					arguments: "",
				},
				nonFlowOutput as Parameters<typeof preflight>[1],
			);
			expect(nonFlowOutput.parts).toEqual([]);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("replaces stale resolved Flow command parts with canonical templates", async () => {
		const home = await tempHome();
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		try {
			await syncFlowSkills(resolveFlowPluginVersion(), home);
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
			expect(getLatestFlowSkillSyncHealth()?.status).toBe("ok");

			const preflight = hooks["command.execute.before"];
			expect(preflight).toBeDefined();
			if (!preflight) throw new Error("Expected command preflight hook.");

			const textCases = [
				{
					command: "/flow-auto",
					arguments: "Ship canonical commands",
					expectedSeed: "Flow auto: Ship canonical commands",
					expectedAction:
						"Drive the Flow loop until completion or a real blocker: Ship canonical commands",
					expectedBundledSection: "Bundled flow/SKILL.md",
				},
				{
					command: "/flow-plan",
					arguments: "Ship canonical commands",
					expectedSeed: "Flow plan: Ship canonical commands",
					expectedAction: "Plan: Ship canonical commands",
					expectedBundledSection: "Bundled flow-plan/SKILL.md",
				},
				{
					command: "/flow-run",
					arguments: "Ship canonical commands",
					expectedSeed: "Flow run: Ship canonical commands",
					expectedAction:
						"Execute the next approved feature. Ship canonical commands",
					expectedBundledSection: "Bundled flow-run/SKILL.md",
				},
			];

			for (const testCase of textCases) {
				const textOutput: {
					parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
				} = {
					parts: [
						{
							type: "text",
							text: "Load the `flow-plan` skill and plan stale content.",
						},
					],
				};
				await preflight(
					{
						command: testCase.command,
						sessionID: "test-session",
						arguments: testCase.arguments,
					},
					textOutput as Parameters<typeof preflight>[1],
				);
				const bundledPrompt = expectFlowCommandTextParts(
					textOutput.parts,
					testCase.expectedSeed,
				);
				expect(bundledPrompt).toContain("Do not call native Flow skills");
				expect(bundledPrompt).toContain(testCase.expectedAction);
				expect(bundledPrompt).toContain(testCase.expectedBundledSection);
				expect(bundledPrompt).toContain(
					"briefly state which bundled Flow command is running",
				);
				expect(bundledPrompt).not.toContain("stale content");
				expect(bundledPrompt).not.toContain("Otherwise load the `flow");
			}

			const statusOutput: {
				parts: Array<{ type: "text"; text: string; synthetic?: boolean }>;
			} = {
				parts: [
					{
						type: "text",
						text: "Restart OpenCode instead of calling flow_status.",
					},
				],
			};
			await preflight(
				{
					command: "flow-status",
					sessionID: "test-session",
					arguments: "",
				},
				statusOutput as Parameters<typeof preflight>[1],
			);
			const statusPrompt = expectFlowCommandTextParts(
				statusOutput.parts,
				"Flow status",
			);
			expect(statusPrompt).toBe(
				"Call flow_status and report the session state and next action.",
			);

			const reviewOutput: {
				parts: Array<{ type: "subtask"; prompt: string; agent: string }>;
			} = {
				parts: [
					{
						type: "subtask",
						agent: "flow-reviewer",
						prompt: "Load the `flow-review` skill and review: stale",
					},
				],
			};
			await preflight(
				{
					command: "flow-review",
					sessionID: "test-session",
					arguments: "the changed Flow command path",
				},
				reviewOutput as Parameters<typeof preflight>[1],
			);
			expect(reviewOutput.parts).toHaveLength(1);
			expect(reviewOutput.parts[0]?.prompt).toContain(
				"Do not call native Flow skills",
			);
			expect(reviewOutput.parts[0]?.prompt).toContain(
				"Review: the changed Flow command path",
			);
			expect(reviewOutput.parts[0]?.prompt).toContain(
				"Bundled flow-review/SKILL.md",
			);
			expect(reviewOutput.parts[0]?.prompt).not.toContain("review: stale");
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
		await expect(
			readFile(flowSkillFile(home, "flow-test", "SKILL.md"), "utf8"),
		).resolves.toContain("validationRun");
		await expect(
			readFile(flowSkillFile(home, "flow-commit", "SKILL.md"), "utf8"),
		).resolves.toContain("user explicitly asks");
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

	test("startup sync skips every expected managed skill folder without Flow markers", async () => {
		for (const skillName of FLOW_MANAGED_SKILL_NAMES) {
			const home = await tempHome();
			const folder = flowSkillFolder(home, skillName);
			await mkdir(folder, { recursive: true });
			await writeFile(join(folder, "SKILL.md"), "user skill\n", "utf8");

			const syncResults = await syncFlowSkills("4.0.0-test", home);
			expect(
				syncResults.find((result) => result.name === skillName),
			).toMatchObject({ action: "skipped_foreign" });
			await expect(readFile(join(folder, "SKILL.md"), "utf8")).resolves.toBe(
				"user skill\n",
			);
			await expect(
				readFile(join(folder, ".flow-skill-version"), "utf8"),
			).rejects.toMatchObject({ code: "ENOENT" });

			await runFlowSkillSync("4.0.0-test", () => {}, home);
			const health = getLatestFlowSkillSyncHealth();
			expect(health?.status).toBe("action_required");
			expectSameMembers(health?.actionRequiredSkills, [skillName]);
			expect(getFlowSkillSetupStatus()?.status).toBe("action_required");
		}
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

	test("startup sync updates stale generated content for every managed skill", async () => {
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			const home = await tempHome();
			await syncFlowSkills("4.0.0-old", home);
			const staleFiles = definition.files.map((file) => ({
				relativePath: file.relativePath,
				content: `old generated content for ${definition.name}:${file.relativePath}\n`,
			}));
			for (const file of staleFiles) {
				await writeFile(
					flowSkillFile(home, definition.name, file.relativePath),
					file.content,
					"utf8",
				);
			}
			await writeFile(
				join(flowSkillFolder(home, definition.name), ".flow-skill-version"),
				flowSkillMarker("4.0.0-old", staleFiles),
				"utf8",
			);

			await runFlowSkillSync("4.0.0-test", () => {}, home);

			const health = getLatestFlowSkillSyncHealth();
			expect(health?.status).toBe("restart_required");
			expectSameMembers(health?.changedSkills, [definition.name]);
			expect(
				health?.results.find((result) => result.name === definition.name),
			).toMatchObject({ action: "updated" });

			const report = await inspectFlowSkillInstall("4.0.0-test", home);
			expect(report.status).toBe("ok");
			expect(
				report.skills.find((skill) => skill.name === definition.name),
			).toMatchObject({ status: "ok" });
		}
	});

	test("doctor reports missing managed skills", async () => {
		for (const skillName of FLOW_MANAGED_SKILL_NAMES) {
			const home = await tempHome();
			await syncFlowSkills("4.0.0-test", home);
			await rm(flowSkillFolder(home, skillName), {
				recursive: true,
				force: true,
			});

			const report = await inspectFlowSkillInstall("4.0.0-test", home);
			expect(report.status).toBe("sync_required");
			expectSameMembers(report.syncRequiredSkills, [skillName]);
			expect(
				report.skills.find((skill) => skill.name === skillName)?.status,
			).toBe("missing");
			const formatted = formatFlowSkillDoctor(report);
			expect(formatted).toContain(`${skillName}: missing`);
			expect(formatted).toContain("Start or restart OpenCode");
			expect(formatted).toContain(
				"npx -y opencode-plugin-flow@4.0.0-test doctor",
			);
		}
	});

	test("doctor treats stale markers for current files as sync repair", async () => {
		for (const skillName of FLOW_MANAGED_SKILL_NAMES) {
			const home = await tempHome();
			await syncFlowSkills("4.0.0-test", home);
			const markerPath = join(
				flowSkillFolder(home, skillName),
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
			const skill = report.skills.find((skill) => skill.name === skillName);
			expect(report.status).toBe("sync_required");
			expectSameMembers(report.syncRequiredSkills, [skillName]);
			expect(report.actionRequiredSkills).not.toContain(skillName);
			expect(skill?.status).toBe("outdated");
			expect(skill?.editedFiles).toEqual([]);
		}
	});

	test("doctor reports foreign managed skills as user action", async () => {
		for (const skillName of FLOW_MANAGED_SKILL_NAMES) {
			const home = await tempHome();
			const folder = flowSkillFolder(home, skillName);
			await mkdir(folder, { recursive: true });
			await writeFile(join(folder, "SKILL.md"), "user skill\n", "utf8");

			const report = await inspectFlowSkillInstall("4.0.0-test", home);
			expect(report.status).toBe("action_required");
			expectSameMembers(report.actionRequiredSkills, [skillName]);
			expect(
				report.skills.find((skill) => skill.name === skillName)?.status,
			).toBe("foreign");
			expect(formatFlowSkillDoctor(report)).toContain("needs user decision");
		}
	});

	test("CLI reports doctor status", async () => {
		const home = await tempHome();
		const result = await runFlowCli(["doctor"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Flow doctor");
		expect(result.stdout).toContain("- status: sync_required");
		expect(result.stdout).toContain("flow-review: missing");
		expect(result.stdout).toContain("flow-test: missing");
		expect(result.stdout).toContain("flow-commit: missing");
	});

	test("CLI sync installs managed skills and requests restart", async () => {
		const home = await tempHome();
		const version = resolveFlowPluginVersion();
		const result = await runFlowCli(["sync"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Flow skill sync (");
		for (const skillName of FLOW_MANAGED_SKILL_NAMES) {
			expect(result.stdout).toContain(`- ${skillName}: installed`);
		}
		expect(result.stdout).toContain("Restart OpenCode");

		const report = await inspectFlowSkillInstall(version, home);
		expect(report.status).toBe("ok");
	});

	test("CLI uninstalls managed skills and keeps foreign Flow-like skills", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const foreignSkill = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow-local",
		);
		await mkdir(foreignSkill, { recursive: true });
		await writeFile(join(foreignSkill, "SKILL.md"), "user skill\n", "utf8");

		const result = await runFlowCli(["uninstall"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Removed Flow skill:");
		expect(result.stdout).toContain("Kept non-Flow or user-edited skill:");
		expect(result.stdout).toContain(
			"Remove opencode-plugin-flow from your OpenCode plugin config",
		);
		await expect(
			readFile(
				join(home, ".config", "opencode", "skills", "flow", "SKILL.md"),
				"utf8",
			),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			readFile(join(foreignSkill, "SKILL.md"), "utf8"),
		).resolves.toBe("user skill\n");
	});

	test("CLI rejects invalid commands with usage", async () => {
		const result = await runFlowCli(["invalid"]);
		expect(result.status).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(
			"usage: opencode-plugin-flow <doctor|sync|uninstall>\n",
		);
	});

	test("resolves plugin version from package metadata outside npm scripts", () => {
		const previous = process.env.npm_package_version;
		delete process.env.npm_package_version;
		try {
			expect(resolveFlowPluginVersion()).toBe("4.1.11");
		} finally {
			if (previous === undefined) {
				delete process.env.npm_package_version;
			} else {
				process.env.npm_package_version = previous;
			}
		}
	});
});
