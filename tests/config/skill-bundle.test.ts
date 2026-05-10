import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION,
	FLOW_SKILL_BUNDLE_DIRECTORY,
	installFlowSkillBundle,
	resolveFlowSkillBundleFiles,
	uninstallFlowSkillBundle,
} from "../../src/adapters/opencode/skill-bundle";
import { OPENCODE_TOOL_NAMES_FROM_REGISTRY } from "../../src/adapters/opencode/tool-surface/tool-registry";
import {
	FLOW_SKILL_GENERATED_MARKER,
	FLOW_SKILL_GENERATED_VERSION,
	FLOW_SKILL_SPECS,
	inspectFlowSkillDocument,
	renderFlowSkillDocument,
} from "../../src/prompts/generated/skill-docs";
import { FLOW_MODE_CONTRACTS } from "../../src/prompts/mode-contracts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-skill-bundle-"));
	tempDirs.push(dir);
	return dir;
}

function generatedMarkerLine(document: string): string {
	const marker = document
		.split("\n")
		.find((line) => line.startsWith(`<!-- ${FLOW_SKILL_GENERATED_MARKER} `));
	expect(marker).toBeDefined();
	return marker ?? "";
}

function withRecomputedGeneratedHash(document: string): string {
	const lines = document.split("\n");
	const markerIndex = lines.findIndex((line) =>
		line.startsWith(`<!-- ${FLOW_SKILL_GENERATED_MARKER} `),
	);
	expect(markerIndex).toBeGreaterThanOrEqual(0);
	const marker = lines[markerIndex];
	if (marker === undefined) {
		throw new Error("Missing generated marker");
	}
	const managedPayload = [
		...lines.slice(0, markerIndex),
		...lines.slice(markerIndex + 1),
	].join("\n");
	const hash = createHash("sha256").update(managedPayload).digest("hex");
	lines[markerIndex] = marker.replace(
		/hash=sha256:[a-f0-9]{64}/u,
		`hash=sha256:${hash}`,
	);
	return lines.join("\n");
}

type ResolvedFlowSkillFile = ReturnType<
	typeof resolveFlowSkillBundleFiles
>[number];

async function writeSkillDocument(
	path: string,
	document: string,
): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, document, "utf8");
}

function getResolvedFlowSkillFile(
	workspace: string,
	skillName: string,
): ResolvedFlowSkillFile {
	const file = resolveFlowSkillBundleFiles(workspace).find(
		(item) => item.skill.name === skillName,
	);
	expect(file).toBeDefined();
	if (!file) {
		throw new Error(`Missing generated Flow skill fixture for ${skillName}`);
	}
	return file;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("OpenCode skill bundle", () => {
	test("defines only the minimal Slice 2 Flow skills with valid global paths", () => {
		expect(FLOW_SKILL_SPECS.map((skill) => skill.name)).toEqual([
			"flow-plan",
			"flow-run",
			"flow-review",
		]);

		for (const skill of FLOW_SKILL_SPECS) {
			expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
			expect(skill.description.length).toBeGreaterThan(0);
			expect(skill.description.length).toBeLessThanOrEqual(1024);
			const [resolved] = resolveFlowSkillBundleFiles("/workspace").filter(
				(item) => item.skill.name === skill.name,
			);
			expect(resolved?.relativePath).toBe(
				join(FLOW_SKILL_BUNDLE_DIRECTORY, skill.name, "SKILL.md"),
			);
			expect(resolved?.absolutePath).toBe(
				join("/workspace", FLOW_SKILL_BUNDLE_DIRECTORY, skill.name, "SKILL.md"),
			);
		}
	});

	test("renders valid frontmatter and generated markers without defining new runtime behavior", () => {
		const registryTools = new Set(OPENCODE_TOOL_NAMES_FROM_REGISTRY);

		for (const skill of FLOW_SKILL_SPECS) {
			const document = renderFlowSkillDocument(skill);
			expect(document.startsWith("---\n")).toBe(true);
			expect(document).toContain(`name: ${skill.name}\n`);
			expect(document).toContain("description: ");
			expect(document).toContain("license: MIT\n");
			expect(document).toContain("metadata:\n");
			expect(document).toContain('  flow-owned: "true"\n');
			expect(document).toContain("<!-- flow-opencode-generated-skill ");
			expect(document).toContain("sha256:");
			expect(document).toContain("Runtime tools are authoritative");
			expect(document).toContain("Do not edit `.flow/**` directly");
			expect(document).toContain(
				"completion, review, and persistence remain runtime-owned",
			);
			expect(document).toContain("This skill does not define new tools");
			expect(document).toContain("OpenCode discovers this global file");
			expect(document).toContain("permission.skill");

			const inspection = inspectFlowSkillDocument(document);
			expect(inspection).toEqual({
				kind: "valid_generated",
				marker: {
					name: skill.name,
					version: FLOW_SKILL_GENERATED_VERSION,
					hash: expect.stringMatching(/^[a-f0-9]{64}$/),
				},
			});

			for (const mode of skill.modeContracts) {
				const contract = FLOW_MODE_CONTRACTS[mode];
				expect(document).toContain(contract.title);
				expect(document).toContain(contract.stopCondition);
				for (const tool of contract.allowedFlowTools) {
					expect(registryTools.has(tool)).toBe(true);
					expect(document).toContain(`\`${tool}\``);
				}
			}
		}
	});

	test("installs generated skills idempotently and never writes under .flow", async () => {
		const workspace = makeTempDir();
		const logs: string[] = [];

		const firstInstall = await installFlowSkillBundle({
			projectRoot: workspace,
			logger: (message) => logs.push(message),
		});
		const secondInstall = await installFlowSkillBundle({
			projectRoot: workspace,
			logger: (message) => logs.push(message),
		});

		expect(firstInstall.installed).toEqual([
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-plan", "SKILL.md"),
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-run", "SKILL.md"),
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-review", "SKILL.md"),
		]);
		expect(secondInstall.installed).toEqual(firstInstall.installed);
		expect(
			logs.filter((line) => line.includes("Installed Flow skills")),
		).toHaveLength(2);
		expect(existsSync(join(workspace, ".flow"))).toBe(false);

		for (const item of resolveFlowSkillBundleFiles(workspace)) {
			await expect(readFile(item.absolutePath, "utf8")).resolves.toBe(
				renderFlowSkillDocument(item.skill),
			);
		}
	});

	test("refuses to overwrite non-generated or user-edited skill files", async () => {
		const workspace = makeTempDir();
		const flowPlanPath = join(
			workspace,
			FLOW_SKILL_BUNDLE_DIRECTORY,
			"flow-plan",
			"SKILL.md",
		);
		await writeSkillDocument(flowPlanPath, "# user-owned plan skill\n");

		await expect(
			installFlowSkillBundle({ projectRoot: workspace, logger: () => {} }),
		).rejects.toThrow("Refusing to overwrite user-managed OpenCode skill");

		expect(await readFile(flowPlanPath, "utf8")).toBe(
			"# user-owned plan skill\n",
		);

		rmSync(join(workspace, FLOW_SKILL_BUNDLE_DIRECTORY), {
			recursive: true,
			force: true,
		});
		await installFlowSkillBundle({ projectRoot: workspace, logger: () => {} });
		await writeFile(
			flowPlanPath,
			`${await readFile(flowPlanPath, "utf8")}\nuser edit\n`,
			"utf8",
		);

		await expect(
			installFlowSkillBundle({ projectRoot: workspace, logger: () => {} }),
		).rejects.toThrow("Refusing to overwrite user-edited OpenCode skill");
	});

	test("overwrites stale but intact generated skill files", async () => {
		const workspace = makeTempDir();
		const flowPlanFile = getResolvedFlowSkillFile(workspace, "flow-plan");
		const staleDocument = withRecomputedGeneratedHash(
			renderFlowSkillDocument(flowPlanFile.skill).replace(
				"Purpose: Use when creating, refining, selecting, or approving a Flow plan from repository evidence.",
				"Purpose: Use when creating, refining, selecting, or approving a Flow plan from stale generated evidence.",
			),
		);
		expect(staleDocument).not.toBe(flowPlanFile.content);
		expect(inspectFlowSkillDocument(staleDocument).kind).toBe(
			"valid_generated",
		);
		await writeSkillDocument(flowPlanFile.absolutePath, staleDocument);

		await installFlowSkillBundle({ projectRoot: workspace, logger: () => {} });

		expect(await readFile(flowPlanFile.absolutePath, "utf8")).toBe(
			flowPlanFile.content,
		);
	});

	test("uninstall removes intact generated skills and skips user-managed skills", async () => {
		const workspace = makeTempDir();
		await installFlowSkillBundle({ projectRoot: workspace, logger: () => {} });
		const userSkillPath = join(
			workspace,
			FLOW_SKILL_BUNDLE_DIRECTORY,
			"user-skill",
			"SKILL.md",
		);
		await writeSkillDocument(userSkillPath, "# keep me\n");

		const result = await uninstallFlowSkillBundle({
			projectRoot: workspace,
			logger: () => {},
		});

		expect(result.removed).toEqual([
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-plan", "SKILL.md"),
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-run", "SKILL.md"),
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-review", "SKILL.md"),
		]);
		expect(await readFile(userSkillPath, "utf8")).toBe("# keep me\n");
		for (const item of resolveFlowSkillBundleFiles(workspace)) {
			expect(existsSync(item.absolutePath)).toBe(false);
		}
	});

	test("uninstall skips user-managed same-name skills", async () => {
		const workspace = makeTempDir();
		await installFlowSkillBundle({ projectRoot: workspace, logger: () => {} });
		const flowPlanFile = getResolvedFlowSkillFile(workspace, "flow-plan");
		await writeFile(
			flowPlanFile.absolutePath,
			"# user-owned plan skill\n",
			"utf8",
		);

		const result = await uninstallFlowSkillBundle({
			projectRoot: workspace,
			logger: () => {},
		});

		expect(result.removed).toEqual([
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-run", "SKILL.md"),
			join(FLOW_SKILL_BUNDLE_DIRECTORY, "flow-review", "SKILL.md"),
		]);
		expect(await readFile(flowPlanFile.absolutePath, "utf8")).toBe(
			"# user-owned plan skill\n",
		);
	});

	test("uninstall refuses to remove user-edited generated skills", async () => {
		const workspace = makeTempDir();
		await installFlowSkillBundle({ projectRoot: workspace, logger: () => {} });
		const flowRunPath = join(
			workspace,
			FLOW_SKILL_BUNDLE_DIRECTORY,
			"flow-run",
			"SKILL.md",
		);
		await writeFile(
			flowRunPath,
			`${await readFile(flowRunPath, "utf8")}\nuser edit\n`,
			"utf8",
		);

		await expect(
			uninstallFlowSkillBundle({ projectRoot: workspace, logger: () => {} }),
		).rejects.toThrow("Refusing to remove user-edited OpenCode skill");
		expect(existsSync(flowRunPath)).toBe(true);
	});

	test("refuses malformed or mismatched Flow-generated skill markers", async () => {
		const cases = [
			{
				mutate: (document: string) =>
					`${document}${generatedMarkerLine(document)}\n`,
				message: "user-edited OpenCode skill",
			},
			{
				mutate: (document: string) => document.replace(" version=1 ", " "),
				message: "user-edited OpenCode skill",
			},
			{
				mutate: (document: string) =>
					document.replace(" name=flow-plan ", " name=flow-run "),
				message: "mismatched Flow-generated OpenCode skill",
			},
			{
				mutate: (document: string) =>
					document.replace(" version=1 ", " version=999 "),
				message: "mismatched Flow-generated OpenCode skill",
			},
			{
				mutate: (document: string) =>
					document.replace(
						/hash=sha256:[a-f0-9]{64}/u,
						(match) =>
							`${match.slice(0, -1)}${match.endsWith("0") ? "1" : "0"}`,
					),
				message: "user-edited OpenCode skill",
			},
		] as const;

		for (const item of cases) {
			const workspace = makeTempDir();
			const flowPlanFile = getResolvedFlowSkillFile(workspace, "flow-plan");
			const document = item.mutate(renderFlowSkillDocument(flowPlanFile.skill));
			await writeSkillDocument(flowPlanFile.absolutePath, document);

			await expect(
				installFlowSkillBundle({ projectRoot: workspace, logger: () => {} }),
			).rejects.toThrow(`Refusing to overwrite ${item.message}`);
			await expect(
				uninstallFlowSkillBundle({ projectRoot: workspace, logger: () => {} }),
			).rejects.toThrow(`Refusing to remove ${item.message}`);
		}
	});

	test("documents OpenCode discovery and permission expectations without weakening deny or ask", () => {
		expect(FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION.discoveryPath).toBe(
			"~/.config/opencode/skills/<name>/SKILL.md",
		);
		expect(FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION.permissionPattern).toBe(
			"flow-*",
		);
		expect(FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION.allowedPostures).toEqual([
			"allow",
			"ask",
		]);
		expect(FLOW_OPENCODE_SKILL_PERMISSION_EXPECTATION.deniedPosture).toBe(
			"deny hides generated Flow skills from agents",
		);
	});
});
