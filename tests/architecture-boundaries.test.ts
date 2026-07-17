import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const sourceRoot = resolve(import.meta.dir, "../src");
const inwardLayers = new Set(["domain", "application", "infrastructure"]);
const allowedTargets = {
	domain: new Set(["domain"]),
	application: new Set(["domain", "application"]),
	infrastructure: new Set(["domain", "application", "infrastructure"]),
} as const;

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return sourceFiles(path);
			return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
		}),
	);
	return files.flat();
}

function relativeImports(source: string): string[] {
	return [
		...source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g),
	].flatMap((match) => (match[1] ? [match[1]] : []));
}

function sourceLayer(path: string): string {
	return relative(sourceRoot, path).split(sep)[0] ?? "";
}

describe("v5 architecture boundaries", () => {
	test("has no legacy runtime or adapter source trees", async () => {
		for (const legacyPath of [
			"runtime",
			"adapters",
			"distribution/sync.ts",
			"distribution/flow-skill-definitions.ts",
		]) {
			await expect(stat(join(sourceRoot, legacyPath))).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
	});

	test("keeps global skill maintenance out of the plugin runtime graph", async () => {
		const violations: string[] = [];
		for (const file of await sourceFiles()) {
			const relativeFile = relative(sourceRoot, file);
			const source = await readFile(file, "utf8");
			if (
				relativeFile !== join("distribution", "legacy-cleanup.ts") &&
				/(?:\.flow-skill-version|setup\.skills|runFlowSkillSync|syncFlowSkills)/.test(
					source,
				)
			) {
				violations.push(relativeFile);
			}
			if (
				relativeFile.startsWith(`platform${sep}`) &&
				/(?:from\s+|import\s*)["'][^"']*distribution\//.test(source)
			) {
				violations.push(`${relativeFile} imports distribution`);
			}
		}
		expect(violations).toEqual([]);
	});

	test("keeps domain, application, and infrastructure dependencies inward", async () => {
		const violations: string[] = [];
		for (const file of await sourceFiles()) {
			const layer = sourceLayer(file);
			if (!inwardLayers.has(layer)) continue;
			const source = await readFile(file, "utf8");
			for (const specifier of relativeImports(source)) {
				const targetLayer = sourceLayer(resolve(dirname(file), specifier));
				const allowed = allowedTargets[layer as keyof typeof allowedTargets];
				if (!allowed.has(targetLayer)) {
					violations.push(
						`${relative(sourceRoot, file)} imports ${specifier} (${targetLayer})`,
					);
				}
			}

			if (
				(layer === "domain" || layer === "application") &&
				/(?:from\s+|import\s*)["'](?:node:|@opencode-ai\/)/.test(source)
			) {
				violations.push(
					`${relative(sourceRoot, file)} imports a host or system module`,
				);
			}
		}
		expect(violations).toEqual([]);
	});
});
