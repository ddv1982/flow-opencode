import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import FlowPlugin from "../src";
import { createTools } from "../src/adapters/opencode/tools";
import { createFlowCoreConfigEntries } from "../src/config-shared";
import {
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

	test("injects only minimal commands and a read-only reviewer", () => {
		const config = createFlowCoreConfigEntries();
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
				"flow_*": "deny",
				flow_status: "allow",
			},
		});
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

	test("resolves plugin version from package metadata outside npm scripts", () => {
		const previous = process.env.npm_package_version;
		delete process.env.npm_package_version;
		try {
			expect(resolveFlowPluginVersion()).toBe("4.0.0");
		} finally {
			if (previous === undefined) {
				delete process.env.npm_package_version;
			} else {
				process.env.npm_package_version = previous;
			}
		}
	});
});
