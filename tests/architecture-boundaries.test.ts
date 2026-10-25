import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { PUBLIC_DECLARATION_PATHS } from "../scripts/lib/package-surface.js";

const repositoryRoot = resolve(import.meta.dir, "..");
const sourceRoot = join(repositoryRoot, "src");
const MAX_TYPESCRIPT_FILE_LINES = 1_000;
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

/** Repository-relative and slash-separated, so comparisons hold on Windows. */
function repositoryPath(file: string): string {
	return relative(repositoryRoot, file).split(sep).join("/");
}

const DECLARED_EXPORT =
	/^export\s+(?:async\s+)?(?:type|const|let|function\*?|class|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const IMPORT_LIST = /^(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from/gm;

/**
 * The names a braced import or export list moves across a module boundary. In
 * `{ a as b }` an export list exposes `b` while an import list reads `a`, so
 * `side` picks which end of the rename the caller means.
 */
function bindings(
	source: string,
	pattern: RegExp,
	side: "exposed" | "local",
): string[] {
	return [...source.matchAll(pattern)].flatMap((match) =>
		(match[1] ?? "").split(",").flatMap((member) => {
			const parts = member
				.replace(/\btype\s+/, "")
				.trim()
				.split(/\s+as\s+/);
			const name = side === "exposed" ? (parts[1] ?? parts[0]) : parts[0];
			return name && name !== "default" ? [name] : [];
		}),
	);
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

	test("keeps each TypeScript source file within 1,000 lines", async () => {
		const files = await sourceFiles();
		const oversized: string[] = [];
		for (const path of files) {
			const source = await readFile(path, "utf8");
			if (source.split("\n").length > MAX_TYPESCRIPT_FILE_LINES)
				oversized.push(relative(sourceRoot, path));
		}
		expect(oversized).toEqual([]);
	});

	test("keeps input evidence subordinate to the admission ledger, including type imports and re-exports", async () => {
		const violations: string[] = [];
		const target = join(sourceRoot, "platform/opencode/input-evidence.ts");
		for (const directory of ["src", "tests", "scripts", "evals"]) {
			for (const file of await sourceFiles(join(repositoryRoot, directory))) {
				const source = await readFile(file, "utf8");
				const imports = [
					...source.matchAll(
						/(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/g,
					),
				];
				for (const match of imports) {
					const specifier = match[1];
					if (!specifier) continue;
					if (
						resolve(dirname(file), specifier).replace(/\.js$/, ".ts") ===
							target &&
						repositoryPath(file) !== "src/platform/opencode/input-admission.ts"
					)
						violations.push(`${repositoryPath(file)} imports ${specifier}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("keeps every src export referenced outside its declaring file", async () => {
		// `noUnusedLocals` cannot see an export that nothing imports, so dead
		// exported types and constants accumulate silently. Anything outside the
		// published declarations must have an in-repository consumer.
		//
		// References are read from import bindings rather than searched for as text,
		// so a name that only survives in a comment or a string does not look live.
		// No source in the repository uses a namespace import, so an import binding
		// is the only way one file can reach another's export. Module paths are
		// ignored, so two exports sharing a name vouch for each other.
		const allowed = new Set(
			PUBLIC_DECLARATION_PATHS.map((path) =>
				path.replace(/^dist\//, "src/").replace(/\.d\.ts$/, ".ts"),
			),
		);
		const files = new Map<string, string>();
		for (const root of ["src", "tests", "scripts", "evals"]) {
			for (const file of await sourceFiles(join(repositoryRoot, root))) {
				files.set(repositoryPath(file), await readFile(file, "utf8"));
			}
		}
		const imported = new Map(
			[...files].map(([path, source]) => [
				path,
				new Set(bindings(source, IMPORT_LIST, "local")),
			]),
		);

		const unused: string[] = [];
		for (const [path, source] of files) {
			if (!path.startsWith("src/") || allowed.has(path)) continue;
			const exported = [
				...[...source.matchAll(DECLARED_EXPORT)].flatMap((match) =>
					match[1] ? [match[1]] : [],
				),
				...bindings(source, EXPORT_LIST, "exposed"),
			];
			for (const name of exported) {
				const referenced = [...imported].some(
					([other, names]) => other !== path && names.has(name),
				);
				if (!referenced) unused.push(`${path}:${name}`);
			}
		}

		expect(unused).toEqual([]);
	});

	test("keeps native OpenCode imports in the host adapters and RPC contract", async () => {
		const violations: string[] = [];
		for (const file of await sourceFiles()) {
			const source = await readFile(file, "utf8");
			const path = repositoryPath(file);
			if (/(?:from\s+|import\s*)["']@opencode-ai\//.test(source))
				violations.push(path);
			if (
				/(?:from\s+|import\s*)["']@opencode\//.test(source) &&
				!path.startsWith("src/platform/opencode/") &&
				path !== "src/tui.ts" &&
				path !== "src/flow-rpc.ts"
			)
				violations.push(path);
		}
		expect(violations).toEqual([]);
	});

	test("keeps active host tooling free of V1 imports and launch packages", async () => {
		const files = (
			await Promise.all(
				["scripts", "evals"].map((directory) =>
					sourceFiles(join(repositoryRoot, directory)),
				),
			)
		).flat();
		const violations: string[] = [];
		for (const file of files) {
			const path = repositoryPath(file);
			if (path.startsWith("evals/qualification/")) continue;
			const source = await readFile(file, "utf8");
			if (
				/(?:from\s+|import\s*)["']@opencode-ai\//.test(source) ||
				/opencode-ai@/.test(source)
			)
				violations.push(path);
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
				/(?:from\s+|import\s*)["']@opencode(?:-ai)?\//.test(source)
			) {
				violations.push(
					`${relative(sourceRoot, file)} imports the OpenCode host`,
				);
			}
		}
		expect(violations).toEqual([]);
	});
});
