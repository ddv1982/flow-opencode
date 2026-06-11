import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FLOW_PRE_NPM_PLUGIN_OWNERSHIP_HEADER,
	FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH,
	FLOW_SKILL_BACKUP_FILENAME,
	FLOW_SKILL_MARKER_FILENAME,
	FLOW_SKILLS_DIRECTORY,
	parseFlowSkillFolderMarker,
} from "../src/distribution/skill-markers";
import {
	detectPreNpmFlowPlugin,
	inspectFlowSkillSyncState,
	syncFlowSkills,
} from "../src/distribution/skill-sync";
import { uninstallFlow } from "../src/distribution/uninstall";
import {
	FLOW_SKILL_SPECS,
	renderFlowSkillDocument,
} from "../src/prompts/generated/skill-docs";

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

function firstSkillName(): string {
	const spec = FLOW_SKILL_SPECS[0];
	if (!spec) {
		throw new Error("Missing Flow skill specs.");
	}
	return spec.name;
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
		expect(Object.keys(packageJson.dependencies)).toEqual(["zod"]);
		expect(FLOW_SKILLS_DIRECTORY).toBe(join(".config", "opencode", "skills"));
		expect(FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH).toBe(
			join(".config", "opencode", "plugins", "flow.js"),
		);
	});
});

describe("skill sync", () => {
	test("installs all bundled skills with marker files on a fresh home", async () => {
		const homeDir = makeTempDir();

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		expect(results.map((result) => result.action)).toEqual(
			FLOW_SKILL_SPECS.map(() => "installed"),
		);
		for (const skill of FLOW_SKILL_SPECS) {
			const content = await readFile(skillPath(homeDir, skill.name), "utf8");
			expect(content).toBe(renderFlowSkillDocument(skill));
			const marker = parseFlowSkillFolderMarker(
				await readFile(markerPath(homeDir, skill.name), "utf8"),
			);
			expect(marker?.version).toBe("2.1.0");
			expect(marker?.hash).toMatch(/^[a-f0-9]{64}$/);
		}
	});

	test("is idempotent: a second sync reports unchanged and rewrites nothing", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "2.1.0" });

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		expect(results.map((result) => result.action)).toEqual(
			FLOW_SKILL_SPECS.map(() => "unchanged"),
		);
		const state = await inspectFlowSkillSyncState(homeDir);
		expect(state.map((entry) => entry.state)).toEqual(
			FLOW_SKILL_SPECS.map(() => "synced"),
		);
	});

	test("backs up a user-edited SKILL.md before replacing it", async () => {
		const homeDir = makeTempDir();
		const name = firstSkillName();
		await syncFlowSkills({ homeDir, version: "2.1.0" });
		const edited = "# My customized Flow skill\n";
		await writeFile(skillPath(homeDir, name), edited, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		const result = results.find((entry) => entry.name === name);
		expect(result?.action).toBe("updated_with_backup");
		const backup = await readFile(
			join(skillFolder(homeDir, name), FLOW_SKILL_BACKUP_FILENAME),
			"utf8",
		);
		expect(backup).toBe(edited);
		const content = await readFile(skillPath(homeDir, name), "utf8");
		expect(content).toContain("flow-opencode-generated-skill");
	});

	test("never touches a skill folder without a Flow marker", async () => {
		const homeDir = makeTempDir();
		const name = firstSkillName();
		const userContent = "---\nname: flow-plan\n---\nUser-managed skill.\n";
		await mkdir(skillFolder(homeDir, name), { recursive: true });
		await writeFile(skillPath(homeDir, name), userContent, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		const result = results.find((entry) => entry.name === name);
		expect(result?.action).toBe("skipped_foreign");
		expect(await readFile(skillPath(homeDir, name), "utf8")).toBe(userContent);
		expect(existsSync(markerPath(homeDir, name))).toBe(false);
		const state = await inspectFlowSkillSyncState(homeDir);
		expect(state.find((entry) => entry.name === name)?.state).toBe("foreign");
	});

	test("adopts a pristine pre-npm hash-locked install without creating a backup", async () => {
		const homeDir = makeTempDir();
		const skill = FLOW_SKILL_SPECS[0];
		if (!skill) {
			throw new Error("Missing Flow skill specs.");
		}
		// A pristine pre-npm install is byte-identical to the rendered document
		// but has no marker file (pre-npm installs were hash-locked in-document).
		await mkdir(skillFolder(homeDir, skill.name), { recursive: true });
		await writeFile(
			skillPath(homeDir, skill.name),
			renderFlowSkillDocument(skill),
			"utf8",
		);

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		const result = results.find((entry) => entry.name === skill.name);
		expect(result?.action).toBe("unchanged");
		const marker = parseFlowSkillFolderMarker(
			await readFile(markerPath(homeDir, skill.name), "utf8"),
		);
		expect(marker?.version).toBe("2.1.0");
		expect(
			existsSync(
				join(skillFolder(homeDir, skill.name), FLOW_SKILL_BACKUP_FILENAME),
			),
		).toBe(false);
	});

	test("backs up an edited pre-npm hash-locked install before replacing it", async () => {
		const homeDir = makeTempDir();
		const skill = FLOW_SKILL_SPECS[0];
		if (!skill) {
			throw new Error("Missing Flow skill specs.");
		}
		const edited = `${renderFlowSkillDocument(skill)}\nUser note appended.\n`;
		await mkdir(skillFolder(homeDir, skill.name), { recursive: true });
		await writeFile(skillPath(homeDir, skill.name), edited, "utf8");

		const results = await syncFlowSkills({ homeDir, version: "2.1.0" });

		const result = results.find((entry) => entry.name === skill.name);
		expect(result?.action).toBe("updated_with_backup");
		const backup = await readFile(
			join(skillFolder(homeDir, skill.name), FLOW_SKILL_BACKUP_FILENAME),
			"utf8",
		);
		expect(backup).toBe(edited);
	});
});

describe("uninstall", () => {
	test("removes pristine Flow skills, marker files, and the pre-npm plugin copy", async () => {
		const homeDir = makeTempDir();
		await syncFlowSkills({ homeDir, version: "2.1.0" });
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

		expect(result.removedSkills).toHaveLength(FLOW_SKILL_SPECS.length);
		expect(result.removedPreNpmPlugin).toBe(preNpmPath);
		for (const skill of FLOW_SKILL_SPECS) {
			expect(existsSync(skillFolder(homeDir, skill.name))).toBe(false);
		}
		expect(existsSync(preNpmPath)).toBe(false);
		expect(logs.join("\n")).toContain(
			'remove "opencode-plugin-flow" from the plugin array in opencode.json',
		);
	});

	test("keeps user-edited Flow skills and foreign plugin files", async () => {
		const homeDir = makeTempDir();
		const name = firstSkillName();
		await syncFlowSkills({ homeDir, version: "2.1.0" });
		const edited = "# Customized\n";
		await writeFile(skillPath(homeDir, name), edited, "utf8");
		const preNpmPath = join(homeDir, FLOW_PRE_NPM_PLUGIN_RELATIVE_PATH);
		await mkdir(join(homeDir, ".config", "opencode", "plugins"), {
			recursive: true,
		});
		await writeFile(preNpmPath, "// user-managed plugin\n", "utf8");

		const result = await uninstallFlow({ homeDir });

		expect(result.keptUserEditedSkills).toEqual([skillFolder(homeDir, name)]);
		expect(await readFile(skillPath(homeDir, name), "utf8")).toBe(edited);
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
		await syncFlowSkills({ homeDir, version: "2.1.0" });

		const result = await uninstallFlow({ homeDir, dryRun: true });

		expect(result.removedSkills).toHaveLength(FLOW_SKILL_SPECS.length);
		for (const skill of FLOW_SKILL_SPECS) {
			expect(existsSync(skillPath(homeDir, skill.name))).toBe(true);
		}
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
