import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"release-hygiene.mjs",
);
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-release-hygiene-"));
	tempDirs.push(dir);
	return dir;
}

function runReleaseHygiene(sourceRoot: string, artifactPath: string) {
	return Bun.spawn({
		cmd: ["node", scriptPath],
		cwd: repoRoot,
		env: {
			...process.env,
			FLOW_RELEASE_HYGIENE_SOURCE_ROOTS: sourceRoot,
			FLOW_RELEASE_HYGIENE_ARTIFACTS: artifactPath,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("release hygiene script", () => {
	test("passes when release-bound source and artifact code contain no debug artifacts", async () => {
		const directory = makeTempDir();
		const sourceRoot = join(directory, "src");
		const artifactPath = join(directory, "dist", "index.js");
		mkdirSync(join(sourceRoot, "nested"), { recursive: true });
		mkdirSync(join(directory, "dist"), { recursive: true });
		writeFileSync(
			join(sourceRoot, "nested", "ok.ts"),
			"export const write = (message: string) => process.stdout.write(message);\n",
		);
		writeFileSync(artifactPath, "export const value = 1;\n");

		const process = runReleaseHygiene(sourceRoot, artifactPath);

		expect(await process.exited).toBe(0);
		expect(await new Response(process.stdout).text()).toContain(
			"Release hygiene OK",
		);
	});

	test("fails with concrete locations for console and debugger artifacts", async () => {
		const directory = makeTempDir();
		const sourceRoot = join(directory, "src");
		const artifactPath = join(directory, "dist", "index.js");
		mkdirSync(sourceRoot, { recursive: true });
		mkdirSync(join(directory, "dist"), { recursive: true });
		writeFileSync(
			join(sourceRoot, "debug.ts"),
			"export function debug() {\n\tconsole.log('temporary');\n}\n",
		);
		writeFileSync(artifactPath, "debugger;\n");

		const process = runReleaseHygiene(sourceRoot, artifactPath);

		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain("Release hygiene failed");
		expect(stderr).toContain("src/debug.ts:2:2 console.*");
		expect(stderr).toContain("dist/index.js:1:1 debugger");
	});

	test("catches common executable console access forms", async () => {
		const directory = makeTempDir();
		const sourceRoot = join(directory, "src");
		const artifactPath = join(directory, "dist", "index.js");
		mkdirSync(sourceRoot, { recursive: true });
		mkdirSync(join(directory, "dist"), { recursive: true });
		writeFileSync(
			join(sourceRoot, "console-forms.ts"),
			[
				"console?.log('optional');",
				"console['warn']('bracket');",
				"(console).error('parenthesized');",
				"globalThis.console.info('global');",
			].join("\n"),
		);
		writeFileSync(artifactPath, "export const value = 1;\n");

		const process = runReleaseHygiene(sourceRoot, artifactPath);

		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain("src/console-forms.ts:1:1 console.*");
		expect(stderr).toContain("src/console-forms.ts:2:1 console.*");
		expect(stderr).toContain("src/console-forms.ts:3:2 console.*");
		expect(stderr).toContain("src/console-forms.ts:4:12 console.*");
	});

	test("scans executable expressions inside template interpolation", async () => {
		const directory = makeTempDir();
		const sourceRoot = join(directory, "src");
		const artifactPath = join(directory, "dist", "index.js");
		mkdirSync(sourceRoot, { recursive: true });
		mkdirSync(join(directory, "dist"), { recursive: true });
		const interpolationExpression =
			"$" + "{console.log('inside interpolation')}";
		writeFileSync(
			join(sourceRoot, "template.ts"),
			`export const value = \`${interpolationExpression}\`;\n`,
		);
		writeFileSync(artifactPath, "export const value = 1;\n");

		const process = runReleaseHygiene(sourceRoot, artifactPath);

		expect(await process.exited).toBe(1);
		const stderr = await new Response(process.stderr).text();
		expect(stderr).toContain("src/template.ts:1:25 console.*");
	});

	test("ignores debug words inside strings comments templates and regex literals", async () => {
		const directory = makeTempDir();
		const sourceRoot = join(directory, "src");
		const artifactPath = join(directory, "dist", "index.js");
		mkdirSync(sourceRoot, { recursive: true });
		mkdirSync(join(directory, "dist"), { recursive: true });
		writeFileSync(
			join(sourceRoot, "safe-text.ts"),
			[
				"const literal = 'console.log debugger';",
				"const template = `console.log debugger`;",
				"const pattern = /console\\.log|debugger/;",
				"// console.log('commented'); debugger;",
				"/* console.error('commented'); debugger; */",
				"const flags = { debugger: false };",
				"inspector.debugger;",
			].join("\n"),
		);
		writeFileSync(artifactPath, "export const value = /debugger/;\n");

		const process = runReleaseHygiene(sourceRoot, artifactPath);

		expect(await process.exited).toBe(0);
		expect(await new Response(process.stdout).text()).toContain(
			"Release hygiene OK",
		);
	});
});
