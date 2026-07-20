import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const sourceRoot = join(repositoryRoot, "src");
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

async function expectMissing(path: string): Promise<void> {
	await expect(stat(join(repositoryRoot, path))).rejects.toMatchObject({
		code: "ENOENT",
	});
}

describe("v6 architecture boundaries", () => {
	test("keeps deleted framework subsystems out of the runtime", async () => {
		for (const path of [
			"src/application/replay/index.ts",
			"src/application/harness/resource-report.ts",
			"src/application/validation-receipts.ts",
			"src/cli.ts",
			"src/distribution/activation.ts",
			"src/distribution/markdown-modules.d.ts",
			"src/domain/audit-ledger.ts",
			"src/domain/orchestration-policy.ts",
			"src/domain/validation-receipt.ts",
			"src/infrastructure/fs/evidence-artifact-store.ts",
			"src/platform/opencode/harness-tools.ts",
			"src/platform/opencode/observation.ts",
			"src/platform/opencode/orchestration-admission.ts",
		]) {
			await expectMissing(path);
		}
	});

	test("keeps the runtime deliberately small", async () => {
		const files = await sourceFiles();
		const measurements = await Promise.all(
			files.map(async (path) => ({
				path: relative(sourceRoot, path),
				lines: (await readFile(path, "utf8")).split("\n").length,
			})),
		);
		const total = measurements.reduce((sum, item) => sum + item.lines, 0);
		const oversized = measurements.filter((item) => item.lines > 1_000);

		expect(total).toBeLessThanOrEqual(6_000);
		expect(oversized).toEqual([]);
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
				/(?:from\s+|import\s*)["']@opencode-ai\//.test(source)
			) {
				violations.push(
					`${relative(sourceRoot, file)} imports the OpenCode host`,
				);
			}
		}
		expect(violations).toEqual([]);
	});
});
