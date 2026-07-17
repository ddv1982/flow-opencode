import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import packageJson from "../package.json";
import FlowPlugin from "../src";
import { createFlowLog } from "../src/adapters/opencode/logging";
import { createTools } from "../src/adapters/opencode/tools";
import {
	applyFlowConfig,
	createFlowCoreConfigEntries,
} from "../src/config-shared";
import { FLOW_SKILL_DEFINITIONS } from "../src/distribution/flow-skill-definitions";
import {
	formatFlowDoctorCommand,
	formatFlowSkillDoctor,
	getFlowSkillSetupStatus,
	getLatestFlowSkillSyncHealth,
	inspectFlowSkillInstall,
	resolveFlowPluginVersion,
	resolveFlowSkillsRoot,
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

type FlowPermissionSummary = {
	edit: string;
	bash: string;
	task: string;
	skill: string;
	flowState: string;
	flowStatus: string;
};

const EXPECTED_FLOW_PERMISSION_KEYS = [
	"bash",
	"edit",
	"flow_*",
	"flow_status",
	"skill",
	"task",
] as const;
const WILDCARD_PERMISSION_KEYS = ["*"] as const;

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

// Write a genuine Flow-format backup: writeBackup names files
// `<base>.backup.<sha256(content).slice(0,12)>`, so the name is a checksum of
// the content. Uninstall/doctor only treat a file as Flow residue when the two
// agree, so tests must construct them the same way.
async function writeFlowBackup(
	home: string,
	skillName: string,
	baseRelativePath: string,
	content: string,
): Promise<{ relativePath: string; path: string }> {
	const relativePath = `${baseRelativePath}.backup.${sha256(content).slice(0, 12)}`;
	const path = flowSkillFile(home, skillName, relativePath);
	await writeFile(path, content, "utf8");
	return { relativePath, path };
}

function requireExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	context: string,
): void {
	const actualKeys = Object.keys(value).sort();
	const expectedKeys = [...expected].sort();
	if (
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index])
	) {
		throw new Error(
			`Expected ${context} keys ${expectedKeys.join(", ")}, got ${actualKeys.join(", ")}`,
		);
	}
}

function summarizePermission(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const permissionMap = value as Record<string, unknown>;
		requireExactKeys(
			permissionMap,
			WILDCARD_PERMISSION_KEYS,
			"wildcard permission map",
		);
		const wildcard = permissionMap["*"];
		if (typeof wildcard === "string") return wildcard;
	}
	throw new Error(`Unsupported permission value: ${JSON.stringify(value)}`);
}

function permissionSummary(agent: unknown): FlowPermissionSummary {
	const permission = (agent as { permission?: Record<string, unknown> })
		.permission;
	if (!permission) throw new Error("Expected agent permission config");
	requireExactKeys(
		permission,
		EXPECTED_FLOW_PERMISSION_KEYS,
		"agent permission",
	);
	return {
		edit: summarizePermission(permission.edit),
		bash: summarizePermission(permission.bash),
		task: summarizePermission(permission.task),
		skill: summarizePermission(permission.skill),
		flowState: summarizePermission(permission["flow_*"]),
		flowStatus: summarizePermission(permission.flow_status),
	};
}

function parsePermissionContractDoc(
	markdown: string,
): Record<string, FlowPermissionSummary> {
	const marker = "## Permission contract";
	const markerIndex = markdown.indexOf(marker);
	if (markerIndex === -1)
		throw new Error("Missing permission contract section");
	const nextSectionIndex = markdown.indexOf(
		"\n## ",
		markerIndex + marker.length,
	);
	const section = markdown.slice(
		markerIndex,
		nextSectionIndex === -1 ? undefined : nextSectionIndex,
	);
	const rows = section
		.split("\n")
		.filter((line) => line.startsWith("| `flow-"));
	const contract: Record<string, FlowPermissionSummary> = {};

	for (const row of rows) {
		const cells = row
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim().replaceAll("`", ""));
		if (cells.length !== 7) {
			throw new Error(`Malformed permission contract row: ${row}`);
		}
		const [worker, edit, bash, task, skill, flowState, flowStatus] = cells;
		if (
			!worker ||
			!edit ||
			!bash ||
			!task ||
			!skill ||
			!flowState ||
			!flowStatus
		) {
			throw new Error(`Malformed permission contract row: ${row}`);
		}
		if (worker in contract) {
			throw new Error(`Duplicate permission contract row: ${worker}`);
		}
		contract[worker] = { edit, bash, task, skill, flowState, flowStatus };
	}

	return contract;
}

function expectGithubSafeSkillFrontmatter(
	path: string,
	markdown: string,
): void {
	if (!markdown.startsWith("---\n")) {
		throw new Error(`${path} is missing YAML frontmatter`);
	}
	const frontmatterEnd = markdown.indexOf("\n---", 4);
	if (frontmatterEnd === -1) {
		throw new Error(`${path} has unterminated YAML frontmatter`);
	}
	const unsafeLines = markdown
		.slice(4, frontmatterEnd)
		.split("\n")
		.filter((line) => {
			const match = line.match(/^[A-Za-z0-9_-]+:\s+(.*)$/);
			if (!match) return false;
			const value = match[1]?.trimStart() ?? "";
			if (
				value.startsWith('"') ||
				value.startsWith("'") ||
				value.startsWith("|") ||
				value.startsWith(">")
			) {
				return false;
			}
			return /:\s/.test(value);
		});
	expect(unsafeLines, `${path} has unquoted frontmatter scalars`).toEqual([]);
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
				skill: "deny",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Feature review depths");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt.replace(
				/\s+/g,
				" ",
			),
		).toContain("label the result advisory");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt,
		).toContain("Finding classes");
		expect(
			(config.agent["flow-reviewer"] as { prompt: string }).prompt.replace(
				/\s+/g,
				" ",
			),
		).toContain("Only the root manager may mutate Flow state");
		expect(config.agent["flow-evidence-worker"]).toMatchObject({
			mode: "subagent",
			hidden: true,
			permission: {
				edit: "deny",
				bash: "deny",
				skill: "deny",
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
				skill: "deny",
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
				skill: "deny",
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
				skill: "deny",
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
				skill: "deny",
				task: { "*": "deny" },
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
	});

	test("applies optional worker model routing by worker class", () => {
		const previous = {
			OPENCODE_FLOW_WORKER_MODEL: process.env.OPENCODE_FLOW_WORKER_MODEL,
			OPENCODE_FLOW_READONLY_WORKER_MODEL:
				process.env.OPENCODE_FLOW_READONLY_WORKER_MODEL,
			OPENCODE_FLOW_REVIEW_WORKER_MODEL:
				process.env.OPENCODE_FLOW_REVIEW_WORKER_MODEL,
			OPENCODE_FLOW_CANDIDATE_WORKER_MODEL:
				process.env.OPENCODE_FLOW_CANDIDATE_WORKER_MODEL,
		};
		try {
			process.env.OPENCODE_FLOW_WORKER_MODEL = "test/fallback";
			process.env.OPENCODE_FLOW_READONLY_WORKER_MODEL = "test/fast-readonly";
			process.env.OPENCODE_FLOW_REVIEW_WORKER_MODEL = "test/review";
			process.env.OPENCODE_FLOW_CANDIDATE_WORKER_MODEL = "test/candidate";

			const config = createFlowCoreConfigEntries();
			expect(
				(config.agent["flow-evidence-worker"] as { model?: string }).model,
			).toBe("test/fast-readonly");
			expect(
				(config.agent["flow-validation-worker"] as { model?: string }).model,
			).toBe("test/fast-readonly");
			expect((config.agent["flow-reviewer"] as { model?: string }).model).toBe(
				"test/review",
			);
			expect(
				(config.agent["flow-verifier-worker"] as { model?: string }).model,
			).toBe("test/review");
			expect(
				(config.agent["flow-candidate-worker"] as { model?: string }).model,
			).toBe("test/candidate");
		} finally {
			for (const [name, value] of Object.entries(previous)) {
				if (value === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = value;
				}
			}
		}
	});

	test("uses runtime-backed OpenCode tool argument schemas", () => {
		const tools = createTools({});

		expect(() => tools.flow_plan_save.args.plan.parse({})).toThrow();
		expect(() =>
			tools.flow_plan_save.args.plan.parse({
				summary: "Ship typed tool schemas",
				overview:
					"Tighten adapter schemas while runtime parsing remains final.",
				features: [
					{
						id: "typed-tools",
						title: "Typed tools",
						summary: "Exercise plan schema.",
					},
				],
			}),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.featureReview.parse({}),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.featureReview.parse({
				status: "passed",
				summary: "Reviewed typed tool schemas.",
				blockingFindings: [],
			}),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.outcome.parse({
				kind: "needs_input",
				summary: "Need user input.",
			}),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "runtime-candidate-pass",
					kind: "candidate",
					decision: "candidate-exact-path",
					decisionReason: "Candidate owns a disjoint exact path.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					modes: ["candidate-implementation"],
					workerCount: 1,
					candidateWorkerCount: 1,
					sliceIds: ["runtime-slice"],
					dependsOn: ["runtime-discovery"],
					writeScope: "exact-path",
					handoffRefs: ["/tmp/flow/runtime-candidate.md"],
					verificationStatus: "passed",
					outcome: "modified",
					synthesisRef: "/tmp/flow/runtime-synthesis.md",
				},
			]),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "runtime-candidate-decision-with-worker-evidence",
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					decisionReason:
						"Candidate worker owned a disjoint exact-path implementation.",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 1,
					candidateWorkerCount: 1,
					writeScope: "exact-path",
				},
			]),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "candidate-used-with-omitted-decision",
					kind: "candidate",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 1,
					candidateWorkerCount: 1,
				},
			]),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "candidate-used-with-worktree-decision",
					kind: "candidate",
					decision: "candidate-worktree",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface", "validation_available"],
					workerCount: 1,
					candidateWorkerCount: 1,
					writeScope: "isolated-worktree",
				},
			]),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "contradictory-used-pass",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "not_eligible",
					candidateDecision: "used",
					decisionFactors: ["shared_state"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "candidate-used-with-serial-decision",
					kind: "candidate",
					decision: "serial",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface"],
					workerCount: 1,
					candidateWorkerCount: 1,
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "contradictory-serial-pass",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "eligible",
					candidateDecision: "serial_required",
					decisionFactors: ["independent_surface"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "contradictory-skipped-pass",
					kind: "implementation-decision",
					decision: "skipped",
					candidateEligibility: "not_eligible",
					candidateDecision: "serial_required",
					decisionFactors: ["shared_state"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "mispaired-skipped-pass",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "eligible",
					candidateDecision: "skipped",
					decisionFactors: ["small_slice"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "missing-factor-pass",
					kind: "implementation-decision",
					decision: "skipped",
					candidateEligibility: "eligible",
					candidateDecision: "skipped",
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "missing-implementation-decision-pass",
					kind: "implementation-decision",
					candidateEligibility: "not_eligible",
					candidateDecision: "serial_required",
					decisionFactors: ["shared_state"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "missing-candidate-decision-pass",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "eligible",
					decisionFactors: ["small_slice"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "missing-candidate-eligibility-pass",
					kind: "implementation-decision",
					decision: "skipped",
					candidateDecision: "skipped",
					decisionFactors: ["small_slice"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "used-without-candidate-signal",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "used-with-decision-only-signal",
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface"],
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "serial-used-with-worker-signal",
					kind: "implementation-decision",
					decision: "serial",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface"],
					workerCount: 1,
					candidateWorkerCount: 1,
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "validation-skipped-candidate",
					kind: "validation",
					candidateEligibility: "eligible",
					candidateDecision: "skipped",
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "audit-serial-required-candidate",
					kind: "audit",
					candidateEligibility: "not_eligible",
					candidateDecision: "serial_required",
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "candidate-worker-count-exceeds-total",
					kind: "implementation-decision",
					decision: "candidate-exact-path",
					candidateEligibility: "eligible",
					candidateDecision: "used",
					decisionFactors: ["independent_surface"],
					workerCount: 0,
					candidateWorkerCount: 1,
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "parallel-implementation-decision",
					kind: "implementation-decision",
					decision: "parallel",
					candidateEligibility: "not_eligible",
					candidateDecision: "serial_required",
					decisionFactors: ["shared_state"],
					workerCount: 2,
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "candidate-shaped-decision-without-evidence",
					kind: "review",
					decision: "tournament",
					workerCount: 3,
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "dual-role-single-worker",
					kind: "candidate",
					modes: ["candidate-implementation", "verifier"],
					candidateEligibility: "eligible",
					candidateDecision: "used",
					workerCount: 1,
					candidateWorkerCount: 1,
					verifierWorkerCount: 1,
				},
			]),
		).not.toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "snake-case-pass",
					kind: "candidate",
					candidate_eligibility: "eligible",
					handoff_ref: "/tmp/flow/snake.md",
					verification_status: "passed",
				},
			]),
		).toThrow();
		expect(() =>
			tools.flow_feature_complete.args.orchestrationPasses.parse([
				{
					id: "unknown-key-pass",
					kind: "validation",
					workerCount: 1,
					unexpectedKey: true,
				},
			]),
		).toThrow();
	});

	test("keeps public Flow commands self-contained from native skill loading", () => {
		const config = createFlowCoreConfigEntries();
		const expectedBundledSections = {
			"flow-auto": [
				"Bundled flow/SKILL.md (selected sections)",
				"Bundled flow-plan/references/plan-quality-checklist.md (selected sections)",
				"Bundled flow-run/SKILL.md (selected sections)",
				"Conditional parallel pass",
			],
			"flow-plan": [
				"Bundled flow-plan/SKILL.md (selected sections)",
				"Bundled flow-plan/references/plan-quality-checklist.md (selected sections)",
				"Conditional parallel pass",
			],
			"flow-run": [
				"Bundled flow-run/SKILL.md (selected sections)",
				"Bundled flow-run/references/validation-rubric.md (selected sections)",
				"## Candidate implementation",
				"Public reviewer routing",
			],
		} satisfies Record<
			Exclude<
				(typeof FLOW_COMMAND_NAMES)[number],
				"flow-review" | "flow-status"
			>,
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
			if (command === "flow-review") {
				expect(entry.template).toStartWith("# Flow review request");
				expect(entry.template).toContain("`flow-reviewer` contract");
				expect(entry.template).toContain("setup or required evidence");
				expect(entry.template).not.toContain("Bundled flow-review/SKILL.md");
				continue;
			}

			expect(entry.template).toStartWith(
				`# Flow ${command.slice(5)} command contract`,
			);
			expect(entry.template).toContain("Call `flow_status` first");
			expect(entry.template).toContain("setup.skills");
			expect(entry.template).toContain("compiled core instructions");
			expect(entry.template).toContain(
				"mean use the matching compiled section, not a native skill call",
			);
			expect(entry.template).toContain("missing optional helper");
			for (const section of expectedBundledSections[command]) {
				expect(entry.template).toContain(section);
			}
			expect(entry.template).not.toContain(
				"## Bundled flow-plan/references/planning-examples.md",
			);
			expect(entry.template).not.toContain(
				"## Bundled flow/references/handoff-format.md",
			);
		}
	});

	test("registers the expected managed Flow skill set", () => {
		expect(FLOW_MANAGED_SKILL_NAMES).toEqual([
			...EXPECTED_FLOW_MANAGED_SKILL_NAMES,
		]);
	});

	test("documents every injected Flow worker and permission contract", async () => {
		const config = createFlowCoreConfigEntries();
		const execution = await readFile(
			"skills/flow/references/parallel-execution.md",
			"utf8",
		);

		for (const agentName of Object.keys(config.agent)) {
			expect(execution).toContain(`\`${agentName}\``);
		}

		expect(parsePermissionContractDoc(execution)).toEqual(
			Object.fromEntries(
				Object.entries(config.agent).map(([agentName, agent]) => [
					agentName,
					permissionSummary(agent),
				]),
			),
		);

		for (const [agentName, agent] of Object.entries(config.agent)) {
			const prompt = (agent as { prompt: string }).prompt;
			const normalizedPrompt = prompt.toLowerCase();
			const squashedPrompt = normalizedPrompt.replace(/\s+/g, " ");
			expect(
				normalizedPrompt,
				`${agentName} prompt cites or drops claims`,
			).toContain("cite or drop every claim");
			expect(
				normalizedPrompt,
				`${agentName} prompt preserves confidence gaps`,
			).toContain("single-source, inferred, and unsettled");
			expect(squashedPrompt, `${agentName} prompt fails closed`).toContain(
				"`## status` set to `blocked`",
			);
			expect(
				squashedPrompt,
				`${agentName} prompt rejects empty handoffs`,
			).toContain("empty or unstructured output is a failed handoff");
		}
	});

	test("keeps parallel skill docs linked and handoff statuses stable", async () => {
		const [
			orchestration,
			decision,
			manifest,
			execution,
			synthesis,
			discovery,
			handoff,
			passExample,
			hiddenReviewerContract,
			flowSkill,
		] = await Promise.all([
			readFile("skills/flow/references/parallel-orchestration.md", "utf8"),
			readFile("skills/flow/references/parallel-decision.md", "utf8"),
			readFile("skills/flow/references/parallel-manifest.md", "utf8"),
			readFile("skills/flow/references/parallel-execution.md", "utf8"),
			readFile("skills/flow/references/parallel-synthesis.md", "utf8"),
			readFile("skills/flow-plan/references/parallel-discovery.md", "utf8"),
			readFile("skills/flow/references/handoff-format.md", "utf8"),
			readFile("skills/flow/references/parallel-pass-example.md", "utf8"),
			readFile(
				"skills/flow-review/references/hidden-reviewer-contract.md",
				"utf8",
			),
			readFile("skills/flow/SKILL.md", "utf8"),
		]);

		expect(orchestration).toContain("handoff-format.md");
		expect(orchestration).toContain("parallel-pass-example.md");
		expect(orchestration).toContain("parallel-decision.md");
		expect(orchestration).toContain("parallel-manifest.md");
		expect(orchestration).toContain("parallel-execution.md");
		expect(orchestration).toContain("parallel-synthesis.md");
		expect(discovery).toContain("../../flow/references/handoff-format.md");
		expect(discovery).toContain(
			"../../flow/references/parallel-orchestration.md",
		);
		expect(discovery).toContain("manager synthesis barrier");
		expect(handoff).toContain("success | partial | blocked");
		expect(handoff).toContain("- `success`:");
		expect(handoff).toContain("- `partial`:");
		expect(handoff).toContain("- `blocked`:");
		expect(synthesis).toContain("### Verification tiers");
		expect(synthesis).toContain("**Verify strongly**");
		expect(synthesis).toContain("stable ids");
		expect(decision).toContain("## Choose a pass");
		expect(decision).toContain("## Implementation pass decision");
		expect(synthesis).toContain("## Extend or stop");
		expect(manifest).toContain("## Write the manifest");
		expect(decision).toContain("orchestrationPasses");
		expect(decision).toContain("decisionReason");
		expect(decision).toContain("candidateEligibility");
		expect(decision).toContain("candidateDecision");
		expect(decision).toContain("decisionFactors");
		expect(manifest).toContain("writeScope");
		expect(synthesis).toContain("Worker failure ladder");
		expect(passExample).toContain("# Parallel pass example");
		expect(passExample).toContain(
			"Return only the Flow handoff in this exact shape:",
		);
		expect(passExample).toContain(
			"<matching handoff template copied verbatim from handoff-format.md>",
		);
		expect(execution).toContain(
			"Copy the\nmatching block from `handoff-format.md`",
		);
		expect(handoff.replace(/\s+/g, " ")).toContain(
			"Empty or unstructured output is a failed handoff",
		);
		expect(handoff).toContain("## Pass metadata");
		expect(handoff).toContain("## Manager pass accounting record");
		expect(handoff).toContain("<!-- flow-prompt:worker-integrity:start -->");
		expect(handoff).toContain("<!-- flow-prompt:handoff-candidate:end -->");
		expect(decision).toContain(
			"<!-- flow-prompt:manager-parallel-core:start -->",
		);
		for (const role of [
			"evidence",
			"validation",
			"audit",
			"candidate",
			"verifier",
		]) {
			expect(execution).toContain(
				`<!-- flow-prompt:worker-role-${role}:start -->`,
			);
			expect(execution).toContain(
				`<!-- flow-prompt:worker-role-${role}:end -->`,
			);
		}
		expect(hiddenReviewerContract).toContain("## Feature review depths");
		expect(hiddenReviewerContract).toContain("## Special-case evidence");
		expect(flowSkill).not.toMatch(
			/visible tokens|non-cache tokens|session is large enough|request compaction/i,
		);
		expect(synthesis).toContain("empty");
		expect(execution).toContain("OPENCODE_FLOW_READONLY_WORKER_MODEL");

		const disallowedTerm = ["w", "a", "v", "e"].join("");
		for (const [name, text] of [
			["orchestration", orchestration],
			["decision", decision],
			["manifest", manifest],
			["execution", execution],
			["synthesis", synthesis],
			["discovery", discovery],
			["passExample", passExample],
		] as const) {
			expect(
				text.toLowerCase(),
				`${name} uses Flow-native terminology`,
			).not.toContain(disallowedTerm);
		}
	});

	test("keeps skill frontmatter compatible with GitHub YAML preview", async () => {
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			const skillFile = definition.files.find(
				(file) => file.relativePath === "SKILL.md",
			);
			if (!skillFile) {
				throw new Error(`Missing SKILL.md for ${definition.name}`);
			}
			expectGithubSafeSkillFrontmatter(
				`skills/${definition.name}/SKILL.md`,
				skillFile.content,
			);
		}

		const contributionSkillPath =
			".agents/skills/flow-contribution-check/SKILL.md";
		expectGithubSafeSkillFrontmatter(
			contributionSkillPath,
			await readFile(contributionSkillPath, "utf8"),
		);
	});

	test("registers generated instructions through stable hooks only", async () => {
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
			expect(
				Object.keys(hooks).filter((name) => name.startsWith("experimental.")),
			).toEqual([]);

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

	test("registers generated instruction path when refresh fails", async () => {
		const previousHome = process.env.HOME;
		process.env.HOME = await tempHome();
		try {
			const workspace = await tempWorkspace();
			await writeFile(join(workspace, ".flow"), "not a directory\n", "utf8");
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
				expect(bundledPrompt).toContain("Call `flow_status` first");
				if (command === "flow-review") {
					expect(bundledPrompt).toContain("`flow-reviewer` contract");
				} else {
					expect(bundledPrompt).toContain("compiled core instructions");
				}
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
					expectedAction:
						"Create or revise the Flow plan for: Ship canonical commands",
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
				expect(bundledPrompt).toContain(
					"Only the root manager may call state-changing `flow_*` tools",
				);
				expect(bundledPrompt).toContain(testCase.expectedAction);
				expect(bundledPrompt).toContain(testCase.expectedBundledSection);
				expect(bundledPrompt).not.toContain("stale content");
				expect(bundledPrompt).not.toContain(
					"## Bundled flow-plan/references/planning-examples.md",
				);
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
				parts: Array<{
					type: "subtask";
					prompt: string;
					description: string;
					agent: string;
				}>;
			} = {
				parts: [
					{
						type: "subtask",
						agent: "flow-reviewer",
						description: "Review Flow changes",
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
				"Review the assigned work: the changed Flow command path",
			);
			expect(reviewOutput.parts[0]?.prompt).toContain(
				"`flow-reviewer` contract",
			);
			expect(reviewOutput.parts[0]?.prompt).not.toContain(
				"Bundled flow-review/SKILL.md",
			);
			expect(reviewOutput.parts[0]?.agent).toBe("flow-reviewer");
			expect(reviewOutput.parts[0]?.description).toBe("Review Flow changes");
			expect(reviewOutput.parts[0]?.prompt).not.toContain("review: stale");
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("rewrites the subtask prompt in place when a Flow command carries an attachment", async () => {
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
			const preflight = hooks["command.execute.before"];
			if (!preflight) throw new Error("Expected command preflight hook.");

			const output = {
				parts: [
					{
						type: "subtask",
						agent: "flow-reviewer",
						description: "Review Flow changes",
						prompt: "Load the `flow-review` skill and review: stale",
					},
					{ type: "file", url: "file:///src/auth.ts" },
				],
			};
			await preflight(
				{ command: "flow-review", sessionID: "s", arguments: "check @auth" },
				output as unknown as Parameters<typeof preflight>[1],
			);

			// The subtask prompt is rewritten in place (instructions run isolated in
			// the reviewer), the attachment is preserved, and NO parent-session text
			// part is injected — otherwise the instructions would run with the
			// parent agent's permissions and the stale subtask would also execute.
			expect(output.parts).toHaveLength(2);
			const subtask = output.parts.find((part) => part.type === "subtask");
			const file = output.parts.find((part) => part.type === "file");
			expect(subtask?.prompt).toContain("`flow-reviewer` contract");
			expect(subtask?.prompt).not.toContain("review: stale");
			expect(file?.url).toBe("file:///src/auth.ts");
			expect(output.parts.some((part) => part.type === "text")).toBe(false);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		}
	});

	test("command preflight ignores a user command named like an Object prototype member", async () => {
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
			const preflight = hooks["command.execute.before"];
			if (!preflight) throw new Error("Expected command preflight hook.");

			// `toString`/`constructor` live on Object.prototype; the `in` operator
			// would misclassify them as Flow commands and crash on the template
			// lookup. The hook must leave such commands untouched.
			for (const command of ["toString", "constructor", "valueOf"]) {
				const output = { parts: [{ type: "text", text: "user content" }] };
				await preflight(
					{ command, sessionID: "s", arguments: "" },
					output as unknown as Parameters<typeof preflight>[1],
				);
				expect(output.parts).toEqual([{ type: "text", text: "user content" }]);
			}
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
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
					"parallel-orchestration.md",
				),
				"utf8",
			),
		).resolves.toContain("Parallel orchestration");
		await expect(
			readFile(
				flowSkillFile(home, "flow", "references/parallel-decision.md"),
				"utf8",
			),
		).resolves.toContain("Parallel pass decisions");
		await expect(
			readFile(
				flowSkillFile(home, "flow", "references/parallel-execution.md"),
				"utf8",
			),
		).resolves.toContain("Parallel pass execution");
		await expect(
			readFile(flowSkillFile(home, "flow-test", "SKILL.md"), "utf8"),
		).resolves.toContain("validationRun");
		await expect(
			readFile(
				flowSkillFile(
					home,
					"flow-plan",
					"references/plan-quality-checklist.md",
				),
				"utf8",
			),
		).resolves.toContain("Plan quality checklist");
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
		expect(marker).toContain(
			"file=references/parallel-orchestration.md sha256=",
		);
		expect(marker).toContain("file=references/parallel-decision.md sha256=");
		expect(marker).toContain("file=references/parallel-manifest.md sha256=");
		expect(marker).toContain("file=references/parallel-execution.md sha256=");
		expect(marker).toContain("file=references/parallel-synthesis.md sha256=");
		expect(marker).toContain(
			"file=references/parallel-pass-example.md sha256=",
		);

		const removed = await uninstallFlowSkills(home);
		expect(removed.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			true,
		);

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

	test("startup sync prunes retired marker-owned skill files with backup", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-old", home);
		const flowDefinition = FLOW_SKILL_DEFINITIONS.find(
			(definition) => definition.name === "flow",
		);
		if (!flowDefinition) throw new Error("Expected flow skill definition.");

		const retiredTerm = ["w", "a", "v", "e"].join("");
		const retiredRelativePath = `references/parallel-full-${retiredTerm}-example.md`;
		const retiredPath = flowSkillFile(home, "flow", retiredRelativePath);
		const recordedRetiredContent = "old generated parallel example\n";
		const editedRetiredContent = "old generated parallel example\nuser edit\n";
		await writeFile(retiredPath, editedRetiredContent, "utf8");
		await writeFile(
			join(flowSkillFolder(home, "flow"), ".flow-skill-version"),
			flowSkillMarker("4.0.0-old", [
				...flowDefinition.files.map((file) => ({
					relativePath: file.relativePath,
					content: file.content,
				})),
				{
					relativePath: retiredRelativePath,
					content: recordedRetiredContent,
				},
			]),
			"utf8",
		);

		await runFlowSkillSync("4.0.0-test", () => {}, home);

		const flowResult = getLatestFlowSkillSyncHealth()?.results.find(
			(result) => result.name === "flow",
		);
		expect(flowResult).toMatchObject({ action: "updated_with_backup" });
		const backupPath = flowResult?.backupPaths?.[0];
		if (!backupPath) throw new Error("Expected retired file backup path.");
		await expect(readFile(backupPath, "utf8")).resolves.toBe(
			editedRetiredContent,
		);
		await expect(readFile(retiredPath, "utf8")).rejects.toThrow();

		const marker = await readFile(
			join(flowSkillFolder(home, "flow"), ".flow-skill-version"),
			"utf8",
		);
		expect(marker).not.toContain(retiredRelativePath);
		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		// The retired file is gone, but its backup is orphaned residue: doctor
		// must surface it as action_required rather than silently reporting "ok".
		expect(report.status).toBe("action_required");
		expect(report.actionRequiredSkills).toContain("flow");
		const flowSkill = report.skills.find((skill) => skill.name === "flow");
		expect(flowSkill?.status).toBe("ok");
		expect(
			flowSkill?.backupFiles.some((file) =>
				file.startsWith(`${retiredRelativePath}.backup.`),
			),
		).toBe(true);
		expect(formatFlowSkillDoctor(report)).toContain("backups:");
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

	test("startup sync reports mixed action-required and restart-required health", async () => {
		const home = await tempHome();
		const folder = flowSkillFolder(home, "flow");
		await mkdir(folder, { recursive: true });
		await writeFile(join(folder, "SKILL.md"), "user skill\n", "utf8");

		await runFlowSkillSync("4.0.0-test", () => {}, home);

		const health = getLatestFlowSkillSyncHealth();
		expect(health?.status).toBe("action_required");
		expect(health?.restartRequired).toBe(true);
		expectSameMembers(health?.actionRequiredSkills, ["flow"]);
		expectSameMembers(
			health?.changedSkills,
			FLOW_MANAGED_SKILL_NAMES.filter((name) => name !== "flow"),
		);
		expect(health?.summary).toContain("Restart OpenCode");
		expect(health?.summary).toContain("user-owned skill folders");

		const setup = getFlowSkillSetupStatus();
		expect(setup?.status).toBe("action_required");
		expectSameMembers(setup?.actionRequired, ["flow"]);
		expectSameMembers(
			setup?.changed,
			FLOW_MANAGED_SKILL_NAMES.filter((name) => name !== "flow"),
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
		const flowResult = results.find((result) => result.name === "flow");
		expect(flowResult?.action).toBe("updated_with_backup");
		expect(flowResult?.backupPaths).toHaveLength(1);
		const backupPath = flowResult?.backupPaths?.[0];
		expect(backupPath).toContain("SKILL.md.backup.");
		if (!backupPath) throw new Error("Expected backup path.");
		await expect(readFile(backupPath, "utf8")).resolves.toBe(edited);
	});

	test("edited skill backups do not clobber previous backups", async () => {
		const home = await tempHome();
		const folder = flowSkillFolder(home, "flow");
		await syncFlowSkills("4.0.0-test", home);
		const firstEdit = "first user edit\n";
		await writeFile(join(folder, "SKILL.md"), firstEdit, "utf8");
		const firstResults = await syncFlowSkills("4.0.0-test", home);
		const firstBackup = firstResults.find((result) => result.name === "flow")
			?.backupPaths?.[0];
		if (!firstBackup) throw new Error("Expected first backup path.");

		const secondEdit = "second user edit\n";
		await writeFile(join(folder, "SKILL.md"), secondEdit, "utf8");
		const secondResults = await syncFlowSkills("4.0.0-test", home);
		const secondBackup = secondResults.find((result) => result.name === "flow")
			?.backupPaths?.[0];
		if (!secondBackup) throw new Error("Expected second backup path.");

		expect(secondBackup).not.toBe(firstBackup);
		await expect(readFile(firstBackup, "utf8")).resolves.toBe(firstEdit);
		await expect(readFile(secondBackup, "utf8")).resolves.toBe(secondEdit);
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

	test("CLI reports doctor status as JSON", async () => {
		const home = await tempHome();
		const result = await runFlowCli(["doctor", "--json"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const report = JSON.parse(result.stdout);
		expect(report.status).toBe("sync_required");
		expect(report.syncRequiredSkills).toContain("flow-review");
		expect(report.actionRequiredSkills).toEqual([]);
	});

	test("CLI doctor check mode exits nonzero for unhealthy skills", async () => {
		const home = await tempHome();
		const result = await runFlowCli(["doctor", "--check"], home);
		expect(result.status).toBe(1);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Flow doctor");
		expect(result.stdout).toContain("- status: sync_required");
	});

	test("CLI doctor strict mode exits zero for healthy skills", async () => {
		const home = await tempHome();
		await syncFlowSkills(resolveFlowPluginVersion(), home);
		const result = await runFlowCli(["doctor", "--strict", "--json"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout).status).toBe("ok");
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

	test("uninstall keeps a managed skill folder containing unknown user files", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const userNotes = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow",
			"references",
			"my-notes.md",
		);
		await writeFile(userNotes, "personal notes\n", "utf8");

		const result = await uninstallFlowSkills(home);
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			false,
		);
		expect(result.kept.some((path) => path.endsWith(`${sep}flow`))).toBe(true);
		await expect(readFile(userNotes, "utf8")).resolves.toBe("personal notes\n");
	});

	test("uninstall keeps a managed skill folder when the marker lists no files", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const markerPath = join(
			home,
			".config",
			"opencode",
			"skills",
			"flow",
			".flow-skill-version",
		);
		await writeFile(markerPath, "version=4.0.0-test\n", "utf8");

		const result = await uninstallFlowSkills(home);
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			false,
		);
		expect(result.kept.some((path) => path.endsWith(`${sep}flow`))).toBe(true);
		await expect(
			readFile(
				join(home, ".config", "opencode", "skills", "flow", "SKILL.md"),
				"utf8",
			),
		).resolves.toContain("flow");
	});

	test("uninstall dry run reports removals without deleting anything", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);

		const result = await uninstallFlowSkills(home, { dryRun: true });
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			true,
		);
		await expect(
			readFile(
				join(home, ".config", "opencode", "skills", "flow", "SKILL.md"),
				"utf8",
			),
		).resolves.toContain("flow");
	});

	test("doctor flags leftover Flow backup files as action required", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const backup = await writeFlowBackup(
			home,
			"flow",
			"references/handoff-format.md",
			"earlier user edit\n",
		);

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		expect(report.status).toBe("action_required");
		expect(report.actionRequiredSkills).toContain("flow");
		const flowSkill = report.skills.find((skill) => skill.name === "flow");
		// The managed files are untouched; only the orphaned backup is the problem.
		expect(flowSkill?.status).toBe("ok");
		expect(flowSkill?.backupFiles).toContain(backup.relativePath);
		const text = formatFlowSkillDoctor(report);
		expect(text).toContain(`backups: ${backup.relativePath}`);
		expect(text).toContain(".backup files");
	});

	test("doctor and uninstall keep a user file that only resembles a backup name", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		// Name matches the backup pattern (12 hex chars) but the content does NOT
		// hash to it — this is the user's own file, not Flow residue.
		const userFile = flowSkillFile(
			home,
			"flow",
			"references/db.backup.20240115abcd",
		);
		await writeFile(userFile, "my personal database notes\n", "utf8");

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		const flowSkill = report.skills.find((skill) => skill.name === "flow");
		expect(flowSkill?.backupFiles).toEqual([]);

		const result = await uninstallFlowSkills(home);
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			false,
		);
		expect(result.kept.some((path) => path.endsWith(`${sep}flow`))).toBe(true);
		expect(result.removedBackups).toEqual([]);
		await expect(readFile(userFile, "utf8")).resolves.toBe(
			"my personal database notes\n",
		);
	});

	test("uninstall removes a pristine managed folder with Flow backup residue and reports it", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const backup = await writeFlowBackup(
			home,
			"flow",
			"references/handoff-format.md",
			"earlier user edit\n",
		);

		const dryRun = await uninstallFlowSkills(home, { dryRun: true });
		expect(dryRun.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			true,
		);
		expect(dryRun.removedBackups).toContain(backup.path);
		await expect(readFile(backup.path, "utf8")).resolves.toBe(
			"earlier user edit\n",
		);

		const result = await uninstallFlowSkills(home);
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			true,
		);
		expect(result.removedBackups).toContain(backup.path);
		await expect(readFile(backup.path, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("CLI uninstall reports removed Flow backup files", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const backup = await writeFlowBackup(
			home,
			"flow",
			"references/handoff-format.md",
			"earlier user edit\n",
		);

		const result = await runFlowCli(["uninstall"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Removed Flow-created backup files");
		expect(result.stdout).toContain(backup.path);
		await expect(readFile(backup.path, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("sync skips a folder holding a user file at a nested managed path without a marker", async () => {
		const home = await tempHome();
		const userContent = "my own handoff notes\n";
		await mkdir(join(flowSkillFolder(home, "flow"), "references"), {
			recursive: true,
		});
		const nested = flowSkillFile(home, "flow", "references/handoff-format.md");
		await writeFile(nested, userContent, "utf8");
		// No SKILL.md, no marker — the folder is the user's, not Flow's.

		const results = await syncFlowSkills("4.0.0-test", home);
		expect(results.find((result) => result.name === "flow")).toMatchObject({
			action: "skipped_foreign",
		});
		await expect(readFile(nested, "utf8")).resolves.toBe(userContent);
		await expect(
			readFile(flowSkillFile(home, "flow", ".flow-skill-version"), "utf8"),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("uninstall ignores a regular file named like a Flow skill in the skills root", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const strayFile = join(resolveFlowSkillsRoot(home), "flow-notes.md");
		await writeFile(strayFile, "loose notes\n", "utf8");

		const result = await uninstallFlowSkills(home);
		// The stray file must not abort the command with ENOTDIR.
		expect(result.removed.some((path) => path.endsWith(`${sep}flow`))).toBe(
			true,
		);
		expect(result.kept).toContain(strayFile);
		await expect(readFile(strayFile, "utf8")).resolves.toBe("loose notes\n");
	});

	test("doctor treats a CRLF-converted marker as current, not outdated", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);
		const markerPath = flowSkillFile(home, "flow", ".flow-skill-version");
		const lf = await readFile(markerPath, "utf8");
		await writeFile(markerPath, lf.replace(/\n/g, "\r\n"), "utf8");

		const report = await inspectFlowSkillInstall("4.0.0-test", home);
		const flowSkill = report.skills.find((skill) => skill.name === "flow");
		expect(flowSkill?.status).toBe("ok");
		expect(flowSkill?.outdatedFiles).toEqual([]);
	});

	test("resolveFlowSkillsRoot skips an empty HOME instead of going cwd-relative", () => {
		const originalHome = process.env.HOME;
		const originalUserProfile = process.env.USERPROFILE;
		try {
			// An empty HOME must be skipped, not turned into the cwd-relative
			// ".config/opencode/skills". Point USERPROFILE at a real absolute dir
			// so the assertion holds cross-platform — on Windows os.homedir()
			// itself throws when every home var is empty, so clearing both would
			// test the OS, not our fallback.
			const realHome = tmpdir();
			process.env.HOME = "";
			process.env.USERPROFILE = realHome;
			const root = resolveFlowSkillsRoot();
			expect(isAbsolute(root)).toBe(true);
			expect(root.startsWith(".config")).toBe(false);
			expect(root.startsWith(realHome)).toBe(true);
		} finally {
			if (originalHome === undefined) delete process.env.HOME;
			else process.env.HOME = originalHome;
			if (originalUserProfile === undefined) delete process.env.USERPROFILE;
			else process.env.USERPROFILE = originalUserProfile;
		}
	});

	test("CLI uninstall --dry-run previews without deleting", async () => {
		const home = await tempHome();
		await syncFlowSkills("4.0.0-test", home);

		const result = await runFlowCli(["uninstall", "--dry-run"], home);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Would remove Flow skill:");
		await expect(
			readFile(
				join(home, ".config", "opencode", "skills", "flow", "SKILL.md"),
				"utf8",
			),
		).resolves.toContain("flow");
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
		expect(result.stderr).toContain(
			"usage: opencode-plugin-flow <doctor|sync|uninstall> [options]",
		);
	});

	test("CLI reports help and version", async () => {
		const help = await runFlowCli(["--help"]);
		expect(help.status).toBe(0);
		expect(help.stderr).toBe("");
		expect(help.stdout).toContain("doctor options:");

		const version = await runFlowCli(["--version"]);
		expect(version.status).toBe(0);
		expect(version.stderr).toBe("");
		expect(version.stdout.trim()).toBe(resolveFlowPluginVersion());
	});

	test("resolves plugin version from package metadata outside npm scripts", () => {
		const previous = process.env.npm_package_version;
		delete process.env.npm_package_version;
		try {
			expect(resolveFlowPluginVersion()).toBe(packageJson.version);
		} finally {
			if (previous === undefined) {
				delete process.env.npm_package_version;
			} else {
				process.env.npm_package_version = previous;
			}
		}
	});
});

describe("adapter and distribution correctness", () => {
	test("command preflight preserves literal dollar sequences in arguments", async () => {
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
			const preflight = hooks["command.execute.before"];
			if (!preflight) throw new Error("Expected command preflight hook.");

			const args = "fix the $$ escaping and $& capture in build.sh";
			const output: { parts: Array<{ text: string; synthetic?: boolean }> } = {
				parts: [{ text: "stale" }],
			};
			await preflight(
				{ command: "flow-plan", sessionID: "test", arguments: args },
				output as Parameters<typeof preflight>[1],
			);
			expect(output.parts[1]?.text).toContain(args);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("command preflight preserves non-text parts such as attachments", async () => {
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
			const preflight = hooks["command.execute.before"];
			if (!preflight) throw new Error("Expected command preflight hook.");

			const output: {
				parts: Array<{ type?: string; text?: string; url?: string }>;
			} = {
				parts: [
					{ type: "text", text: "stale" },
					{ type: "file", url: "file:///spec.md" },
				],
			};
			await preflight(
				{ command: "flow-plan", sessionID: "test", arguments: "goal" },
				output as Parameters<typeof preflight>[1],
			);
			expect(
				output.parts.some(
					(part) => part.type === "file" && part.url === "file:///spec.md",
				),
			).toBe(true);
		} finally {
			if (previousHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = previousHome;
			}
		}
	});

	test("logging swallows rejected log transport promises", async () => {
		const rejections: unknown[] = [];
		const onRejection = (reason: unknown) => {
			rejections.push(reason);
		};
		process.on("unhandledRejection", onRejection);
		try {
			const log = createFlowLog({
				client: {
					app: {
						log: () => Promise.reject(new Error("transport down")),
					},
				},
			});
			log("info", "hello");
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(rejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", onRejection);
		}
	});

	test("skills root falls back to os.homedir when HOME and USERPROFILE are unset", () => {
		const previousHome = process.env.HOME;
		const previousProfile = process.env.USERPROFILE;
		delete process.env.HOME;
		delete process.env.USERPROFILE;
		try {
			expect(resolveFlowSkillsRoot()).toBe(
				join(homedir(), ".config", "opencode", "skills"),
			);
		} finally {
			if (previousHome !== undefined) process.env.HOME = previousHome;
			if (previousProfile !== undefined)
				process.env.USERPROFILE = previousProfile;
		}
	});

	test("doctor command guidance never pins the 0.0.0 sentinel", () => {
		expect(formatFlowDoctorCommand("0.0.0")).toBe(
			"npx -y opencode-plugin-flow@latest doctor",
		);
	});
});

describe("config collision reporting", () => {
	test("applyFlowConfig reports user-defined agents and commands it replaces", () => {
		const collisions: Array<{ kind: string; name: string }> = [];
		const config = {
			agent: { "flow-reviewer": { description: "user reviewer" } },
			command: { "flow-plan": { template: "user template" } },
		};
		applyFlowConfig(config, {
			onCollision: (kind, name) => collisions.push({ kind, name }),
		});
		expect(collisions).toContainEqual({ kind: "agent", name: "flow-reviewer" });
		expect(collisions).toContainEqual({ kind: "command", name: "flow-plan" });
		expect(
			(config.agent["flow-reviewer"] as { description: string }).description,
		).toBe("Internal read-only reviewer for Flow-guided work.");
	});
});
