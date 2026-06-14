import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FLOW_AGENTS_DIRECTORY,
	FLOW_COMMANDS_DIRECTORY,
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILL_BACKUP_FILENAME,
	FLOW_SKILL_MARKER_FILENAME,
	FLOW_SKILLS_DIRECTORY,
	parseFlowSkillFileHashes,
	parseFlowSkillFolderMarker,
	renderFlowManagedMarkdownMarker,
	sha256,
} from "../src/distribution/skill-markers";
import {
	detectPreNpmFlowPlugin,
	FLOW_SKILL_DEFINITIONS,
	type FlowSkillDefinition,
	flowAgentDefinitions,
	flowCommandDefinitions,
	inspectFlowCommandAgentSyncState,
	inspectFlowSkillSyncState,
	syncFlowCommandsAndAgents,
	syncFlowSkills,
} from "../src/distribution/skill-sync";
import { uninstallFlow } from "../src/distribution/uninstall";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-opencode-install-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (!dir) {
			break;
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

function skillFolder(homeDir: string, name: string): string {
	return join(homeDir, FLOW_SKILLS_DIRECTORY, name);
}

function skillPath(homeDir: string, name: string): string {
	return join(skillFolder(homeDir, name), "SKILL.md");
}

function markerPath(homeDir: string, name: string): string {
	return join(skillFolder(homeDir, name), FLOW_SKILL_MARKER_FILENAME);
}

function commandPath(homeDir: string, name: string): string {
	return join(homeDir, FLOW_COMMANDS_DIRECTORY, `${name}.md`);
}

function commandMarkerPath(homeDir: string, name: string): string {
	return join(homeDir, FLOW_COMMANDS_DIRECTORY, `.${name}.flow-version`);
}

function agentPath(homeDir: string, name: string): string {
	return join(homeDir, FLOW_AGENTS_DIRECTORY, `${name}.md`);
}

function agentMarkerPath(homeDir: string, name: string): string {
	return join(homeDir, FLOW_AGENTS_DIRECTORY, `.${name}.flow-version`);
}

function firstSkill(): FlowSkillDefinition {
	const definition = FLOW_SKILL_DEFINITIONS[0];
	if (!definition) {
		throw new Error("Missing Flow skill definitions.");
	}
	return definition;
}

function skillDocumentContent(definition: FlowSkillDefinition): string {
	const document = definition.files.find(
		(file) => file.relativePath === "SKILL.md",
	);
	if (!document) {
		throw new Error(`Flow skill ${definition.name} is missing SKILL.md`);
	}
	return document.content;
}

/**
 * Builds a pre-npm-era generated SKILL.md: a managed payload plus a valid
 * in-document hash-locked marker line, exactly as the pre-npm installer wrote.
 */
function renderPreNpmGeneratedDocument(name: string): string {
	const payload = `# Old generated ${name} skill\n`;
	const marker = `<!-- flow-opencode-generated-skill name=${name} version=1 hash=sha256:${sha256(payload)} -->`;
	return `${payload.slice(0, -1)}\n${marker}\n`;
}

describe("npm distribution stability surfaces", () => {
	test("package.json keeps the npm plugin and bin contract", async () => {
		const packageJson = JSON.parse(
			await readFile(join(import.meta.dir, "..", "package.json"), "utf8"),
		) as {
			name: string;
			main: string;
			exports: Record<string, string>;
			bin: Record<string, string>;
			files: string[];
			dependencies: Record<string, string>;
		};

		expect(packageJson.name).toBe("opencode-plugin-flow");
		expect(packageJson.main).toBe("dist/index.js");
		expect(packageJson.exports).toEqual({ ".": "./dist/index.js" });
		expect(packageJson.bin).toEqual({
			"opencode-plugin-flow": "./dist/cli.js",
		});
		expect(packageJson.files).toContain("dist");
		expect(Object.keys(packageJson.dependencies).sort()).toEqual([
			"ignore",
			"zod",
		]);
		expect(FLOW_SKILLS_DIRECTORY).toBe(join(".config", "opencode", "skills"));
		expect(FLOW_COMMANDS_DIRECTORY).toBe(
			join(".config", "opencode", "commands"),
		);
		expect(FLOW_AGENTS_DIRECTORY).toBe(join(".config", "opencode", "agents"));
		expect(FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH).toBe(
			join(".config", "opencode", "plugins", "flow.js"),
		);
	});

	test("embeds the four hand-authored skills with their reference files", () => {
		expect(FLOW_SKILL_DEFINITIONS.map((definition) => definition.name)).toEqual(
			["flow", "flow-plan", "flow-run", "flow-review"],
		);
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			expect(
				definition.files.some((file) => file.relativePath === "SKILL.md"),
			).toBe(true);
			for (const file of definition.files) {
				expect(file.content.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("skill sync", () => {
	test("installs all bundled skill files with per-file marker hashes on a fresh home", async () => {
		const homeDir = makeTempDir();

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		expect(results.map((result) => result.action)).toEqual(
			FLOW_SKILL_DEFINITIONS.map(() => "installed"),
		);
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			const folder = skillFolder(homeDir, definition.name);
			for (const file of definition.files) {
				const content = await readFile(
					join(folder, ...file.relativePath.split("/")),
					"utf8",
				);
				expect(content).toBe(file.content);
			}

			const markerContent = await readFile(
				markerPath(homeDir, definition.name),
				"utf8",
			);
			const marker = parseFlowSkillFolderMarker(markerContent);
			expect(marker?.version).toBe("3.0.0");
			expect(marker?.hash).toBe(sha256(skillDocumentContent(definition)));

			const fileHashes = parseFlowSkillFileHashes(markerContent);
			for (const file of definition.files) {
				expect(fileHashes.get(file.relativePath)).toBe(sha256(file.content));
			}
		}
	});

	test("is idempotent: a second sync reports unchanged and stays synced", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "3.0.0" });

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		expect(results.map((result) => result.action)).toEqual(
			FLOW_SKILL_DEFINITIONS.map(() => "unchanged"),
		);
		const state = await inspectFlowSkillSyncState(homeDir);
		expect(state.map((entry) => entry.state)).toEqual(
			FLOW_SKILL_DEFINITIONS.map(() => "synced"),
		);
	});

	test("reports stale skills after a local edit and missing skills before any sync", async () => {
		const homeDir = makeTempDir();
		const name = firstSkill().name;

		const beforeSync = await inspectFlowSkillSyncState(homeDir);
		expect(beforeSync.map((entry) => entry.state)).toEqual(
			FLOW_SKILL_DEFINITIONS.map(() => "missing"),
		);

		await syncFlowSkills({ homeDir, version: "3.0.0" });
		await writeFile(skillPath(homeDir, name), "# Edited\n", "utf8");

		const state = await inspectFlowSkillSyncState(homeDir);
		expect(state.find((entry) => entry.name === name)?.state).toBe("stale");
	});

	test("backs up a user-edited SKILL.md before replacing it", async () => {
		const homeDir = makeTempDir();
		const definition = firstSkill();
		await syncFlowSkills({ homeDir, version: "3.0.0" });
		const edited = "# My customized Flow skill\n";
		await writeFile(skillPath(homeDir, definition.name), edited, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		const result = results.find((entry) => entry.name === definition.name);
		expect(result?.action).toBe("updated_with_backup");
		const backup = await readFile(
			join(skillFolder(homeDir, definition.name), FLOW_SKILL_BACKUP_FILENAME),
			"utf8",
		);
		expect(backup).toBe(edited);
		const content = await readFile(skillPath(homeDir, definition.name), "utf8");
		expect(content).toBe(skillDocumentContent(definition));
	});

	test("backs up a user-edited reference file next to itself before replacing it", async () => {
		const homeDir = makeTempDir();
		const definition = FLOW_SKILL_DEFINITIONS.find((entry) =>
			entry.files.some((file) => file.relativePath !== "SKILL.md"),
		);
		if (!definition) {
			throw new Error("Expected at least one skill with reference files.");
		}
		const reference = definition.files.find(
			(file) => file.relativePath !== "SKILL.md",
		);
		if (!reference) {
			throw new Error("Expected a reference file.");
		}
		await syncFlowSkills({ homeDir, version: "3.0.0" });
		const referencePath = join(
			skillFolder(homeDir, definition.name),
			...reference.relativePath.split("/"),
		);
		const edited = "# Edited reference\n";
		await writeFile(referencePath, edited, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		const result = results.find((entry) => entry.name === definition.name);
		expect(result?.action).toBe("updated_with_backup");
		expect(await readFile(`${referencePath}.backup`, "utf8")).toBe(edited);
		expect(await readFile(referencePath, "utf8")).toBe(reference.content);
	});

	test("never touches a skill folder without a Flow marker", async () => {
		const homeDir = makeTempDir();
		const name = firstSkill().name;
		const userContent = "---\nname: flow\n---\nUser-managed skill.\n";
		await mkdir(skillFolder(homeDir, name), { recursive: true });
		await writeFile(skillPath(homeDir, name), userContent, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		const result = results.find((entry) => entry.name === name);
		expect(result?.action).toBe("skipped_foreign");
		expect(await readFile(skillPath(homeDir, name), "utf8")).toBe(userContent);
		expect(existsSync(markerPath(homeDir, name))).toBe(false);
		const state = await inspectFlowSkillSyncState(homeDir);
		expect(state.find((entry) => entry.name === name)?.state).toBe("foreign");
	});

	test("adopts a pristine pre-npm hash-locked install without creating a backup", async () => {
		const homeDir = makeTempDir();
		const definition = firstSkill();
		await mkdir(skillFolder(homeDir, definition.name), { recursive: true });
		await writeFile(
			skillPath(homeDir, definition.name),
			renderPreNpmGeneratedDocument(definition.name),
			"utf8",
		);

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		const result = results.find((entry) => entry.name === definition.name);
		expect(result?.action).toBe("updated");
		const marker = parseFlowSkillFolderMarker(
			await readFile(markerPath(homeDir, definition.name), "utf8"),
		);
		expect(marker?.version).toBe("3.0.0");
		expect(
			existsSync(
				join(skillFolder(homeDir, definition.name), FLOW_SKILL_BACKUP_FILENAME),
			),
		).toBe(false);
		expect(await readFile(skillPath(homeDir, definition.name), "utf8")).toBe(
			skillDocumentContent(definition),
		);
	});

	test("backs up an edited pre-npm hash-locked install before replacing it", async () => {
		const homeDir = makeTempDir();
		const definition = firstSkill();
		const edited = `${renderPreNpmGeneratedDocument(definition.name)}\nUser note appended.\n`;
		await mkdir(skillFolder(homeDir, definition.name), { recursive: true });
		await writeFile(skillPath(homeDir, definition.name), edited, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "3.0.0" });

		const result = results.find((entry) => entry.name === definition.name);
		expect(result?.action).toBe("updated_with_backup");
		const backup = await readFile(
			join(skillFolder(homeDir, definition.name), FLOW_SKILL_BACKUP_FILENAME),
			"utf8",
		);
		expect(backup).toBe(edited);
	});
});

describe("command and agent sync", () => {
	test("installs Flow command and agent markdown files on a fresh home", async () => {
		const homeDir = makeTempDir();

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.0.0",
		});

		expect(results.filter((result) => result.kind === "command")).toHaveLength(
			flowCommandDefinitions().size,
		);
		expect(results.filter((result) => result.kind === "agent")).toHaveLength(
			flowAgentDefinitions().size,
		);
		expect(results.every((result) => result.action === "installed")).toBe(true);
		expect(await readFile(commandPath(homeDir, "flow-auto"), "utf8")).toContain(
			"Load the `flow` skill",
		);
		expect(
			await readFile(commandMarkerPath(homeDir, "flow-auto"), "utf8"),
		).toContain("kind=command");
		expect(
			await readFile(agentPath(homeDir, "flow-reviewer"), "utf8"),
		).toContain("permission:");
		expect(
			await readFile(agentMarkerPath(homeDir, "flow-reviewer"), "utf8"),
		).toContain("kind=agent");
	});

	test("is idempotent and exposes command/agent sync state", async () => {
		const homeDir = makeTempDir();
		await syncFlowCommandsAndAgents({ homeDir, version: "3.0.0" });

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.0.0",
		});

		expect(results.every((result) => result.action === "unchanged")).toBe(true);
		const state = await inspectFlowCommandAgentSyncState(homeDir);
		expect(state.every((entry) => entry.state === "synced")).toBe(true);
	});

	test("backs up user-edited Flow-owned command files before replacing them", async () => {
		const homeDir = makeTempDir();
		await syncFlowCommandsAndAgents({ homeDir, version: "3.0.0" });
		const edited = "---\ndescription: Custom\n---\nCustom body.\n";
		await writeFile(commandPath(homeDir, "flow-auto"), edited, "utf8");

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.0.0",
		});

		expect(results.find((result) => result.name === "flow-auto")?.action).toBe(
			"updated_with_backup",
		);
		expect(
			await readFile(`${commandPath(homeDir, "flow-auto")}.backup`, "utf8"),
		).toBe(edited);
		expect(await readFile(commandPath(homeDir, "flow-auto"), "utf8")).toContain(
			"Load the `flow` skill",
		);
	});

	async function seedRetiredCommand(
		homeDir: string,
		content: string,
		markerHash: string,
	) {
		await mkdir(join(homeDir, FLOW_COMMANDS_DIRECTORY), { recursive: true });
		await writeFile(commandPath(homeDir, "flow-doctor"), content, "utf8");
		await writeFile(
			commandMarkerPath(homeDir, "flow-doctor"),
			renderFlowManagedMarkdownMarker({
				kind: "command",
				name: "flow-doctor",
				version: "3.0.1",
				hash: markerHash,
			}),
			"utf8",
		);
	}

	test("removes Flow-owned files left behind by retired command names", async () => {
		const homeDir = makeTempDir();
		const pristine =
			'---\ndescription: "Check Flow readiness"\n---\n\nCall flow_status.\n';
		await seedRetiredCommand(homeDir, pristine, sha256(pristine));

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.1.0",
		});

		expect(
			results.find((result) => result.name === "flow-doctor")?.action,
		).toBe("removed_retired");
		expect(existsSync(commandPath(homeDir, "flow-doctor"))).toBe(false);
		expect(existsSync(commandMarkerPath(homeDir, "flow-doctor"))).toBe(false);
	});

	test("keeps a user-edited retired command file in place", async () => {
		const homeDir = makeTempDir();
		const pristine =
			'---\ndescription: "Check Flow readiness"\n---\n\nCall flow_status.\n';
		const edited = "---\ndescription: Custom doctor\n---\n\nMy own checks.\n";
		await seedRetiredCommand(homeDir, edited, sha256(pristine));

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.1.0",
		});

		expect(results.some((result) => result.name === "flow-doctor")).toBe(false);
		expect(await readFile(commandPath(homeDir, "flow-doctor"), "utf8")).toBe(
			edited,
		);
	});

	test("uninstall removes retired Flow-owned command files", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "3.1.0" });
		await syncFlowCommandsAndAgents({ homeDir, version: "3.1.0" });
		// Seed after sync: simulates an install that never restarted after the
		// upgrade, so startup cleanup has not run yet.
		const pristine =
			'---\ndescription: "Check Flow readiness"\n---\n\nCall flow_status.\n';
		await seedRetiredCommand(homeDir, pristine, sha256(pristine));

		const result = await uninstallFlow({ homeDir });

		expect(result.removedCommands).toContain(
			commandPath(homeDir, "flow-doctor"),
		);
		expect(existsSync(commandPath(homeDir, "flow-doctor"))).toBe(false);
	});

	test("never touches a foreign command with the same name", async () => {
		const homeDir = makeTempDir();
		const userContent = "---\ndescription: Mine\n---\nUser command.\n";
		await mkdir(join(homeDir, FLOW_COMMANDS_DIRECTORY), { recursive: true });
		await writeFile(commandPath(homeDir, "flow-auto"), userContent, "utf8");

		const results = await syncFlowCommandsAndAgents({
			homeDir,
			version: "3.0.0",
		});

		expect(results.find((result) => result.name === "flow-auto")?.action).toBe(
			"skipped_foreign",
		);
		expect(await readFile(commandPath(homeDir, "flow-auto"), "utf8")).toBe(
			userContent,
		);
	});
});

describe("uninstall", () => {
	test("removes pristine Flow skills, marker files, and the pre-npm plugin copy", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "3.0.0" });
		await syncFlowCommandsAndAgents({ homeDir, version: "3.0.0" });
		const preNpmPath = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
		await mkdir(join(homeDir, ".config", "opencode", "plugins"), {
			recursive: true,
		});
		await writeFile(
			preNpmPath,
			`${FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER}export default 'flow';\n`,
			"utf8",
		);
		const logs: string[] = [];

		const result = await uninstallFlow({
			homeDir,
			logger: (message) => logs.push(message),
		});

		expect(result.removedSkills).toHaveLength(FLOW_SKILL_DEFINITIONS.length);
		expect(result.removedCommands).toHaveLength(flowCommandDefinitions().size);
		expect(result.removedAgents).toHaveLength(flowAgentDefinitions().size);
		expect(result.removedPreNpmPlugin).toBe(preNpmPath);
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			expect(existsSync(skillFolder(homeDir, definition.name))).toBe(false);
		}
		expect(existsSync(commandPath(homeDir, "flow-auto"))).toBe(false);
		expect(existsSync(agentPath(homeDir, "flow-reviewer"))).toBe(false);
		expect(existsSync(preNpmPath)).toBe(false);
		expect(logs.join("\n")).toContain(
			'remove "opencode-plugin-flow" from the plugin array in opencode.json',
		);
	});

	test("keeps user-edited Flow skills and foreign plugin files", async () => {
		const homeDir = makeTempDir();
		const name = firstSkill().name;
		await syncFlowSkills({ homeDir, version: "3.0.0" });
		await syncFlowCommandsAndAgents({ homeDir, version: "3.0.0" });
		const edited = "# Customized\n";
		await writeFile(skillPath(homeDir, name), edited, "utf8");
		const editedCommand = "---\ndescription: Mine\n---\nEdited.\n";
		await writeFile(commandPath(homeDir, "flow-auto"), editedCommand, "utf8");
		const preNpmPath = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
		await mkdir(join(homeDir, ".config", "opencode", "plugins"), {
			recursive: true,
		});
		await writeFile(preNpmPath, "// user-managed plugin\n", "utf8");

		const result = await uninstallFlow({ homeDir });

		expect(result.keptUserEditedSkills).toEqual([skillFolder(homeDir, name)]);
		expect(result.keptUserEditedCommands).toEqual([
			commandPath(homeDir, "flow-auto"),
		]);
		expect(await readFile(skillPath(homeDir, name), "utf8")).toBe(edited);
		expect(await readFile(commandPath(homeDir, "flow-auto"), "utf8")).toBe(
			editedCommand,
		);
		expect(result.keptForeignPreNpmPlugin).toBe(preNpmPath);
		expect(existsSync(preNpmPath)).toBe(true);
	});

	test("ignores non-Flow skill folders entirely", async () => {
		const homeDir = makeTempDir();
		const foreignFolder = join(homeDir, FLOW_SKILLS_DIRECTORY, "my-skill");
		await mkdir(foreignFolder, { recursive: true });
		await writeFile(join(foreignFolder, "SKILL.md"), "# Mine\n", "utf8");

		const result = await uninstallFlow({ homeDir });

		expect(result.removedSkills).toEqual([]);
		expect(existsSync(join(foreignFolder, "SKILL.md"))).toBe(true);
	});

	test("dry-run removes nothing", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "3.0.0" });
		await syncFlowCommandsAndAgents({ homeDir, version: "3.0.0" });

		const result = await uninstallFlow({ homeDir, dryRun: true });

		expect(result.removedSkills).toHaveLength(FLOW_SKILL_DEFINITIONS.length);
		expect(result.removedCommands).toHaveLength(flowCommandDefinitions().size);
		expect(result.removedAgents).toHaveLength(flowAgentDefinitions().size);
		for (const definition of FLOW_SKILL_DEFINITIONS) {
			expect(existsSync(skillPath(homeDir, definition.name))).toBe(true);
		}
		expect(existsSync(commandPath(homeDir, "flow-auto"))).toBe(true);
		expect(existsSync(agentPath(homeDir, "flow-reviewer"))).toBe(true);
	});

	test("dry-run leaves pre-existing empty command/agent directories in place", async () => {
		const homeDir = makeTempDir();
		await mkdir(join(homeDir, FLOW_COMMANDS_DIRECTORY), { recursive: true });
		await mkdir(join(homeDir, FLOW_AGENTS_DIRECTORY), { recursive: true });

		await uninstallFlow({ homeDir, dryRun: true });

		expect(existsSync(join(homeDir, FLOW_COMMANDS_DIRECTORY))).toBe(true);
		expect(existsSync(join(homeDir, FLOW_AGENTS_DIRECTORY))).toBe(true);
	});
});

describe("pre-npm plugin detection", () => {
	test("reports a Flow-owned stale pre-npm copy", async () => {
		const homeDir = makeTempDir();
		const preNpmPath = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
		await mkdir(join(homeDir, ".config", "opencode", "plugins"), {
			recursive: true,
		});
		await writeFile(
			preNpmPath,
			`${FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER}export default 'flow';\n`,
			"utf8",
		);

		expect(await detectPreNpmFlowPlugin(homeDir)).toEqual({
			path: preNpmPath,
			flowOwned: true,
		});
	});

	test("returns null when no stale pre-npm copy exists", async () => {
		const homeDir = makeTempDir();
		expect(await detectPreNpmFlowPlugin(homeDir)).toBeNull();
	});
});
