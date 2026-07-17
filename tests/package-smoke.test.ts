import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };

function run(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		encoding: "utf8",
		env: { ...process.env, ...options.env },
	});
	if (result.status !== 0) {
		throw new Error(
			[
				`Command failed: ${command} ${args.join(" ")}`,
				`status=${result.status}`,
				result.stdout,
				result.stderr,
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	return result;
}

async function tempDir(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `${name}-`));
}

describe("package smoke", () => {
	test("package metadata, README pins, packed bin, and declarations are valid", async () => {
		expect(packageJson.types).toBe("dist/index.d.ts");
		expect(packageJson.exports["."]).toMatchObject({
			types: "./dist/index.d.ts",
			import: "./dist/index.js",
		});

		const readme = await readFile("README.md", "utf8");
		const pinnedVersions = [
			...readme.matchAll(/opencode-plugin-flow@(\d+\.\d+\.\d+)/g),
		].map((match) => match[1]);
		expect(pinnedVersions.length).toBeGreaterThan(0);
		expect(new Set(pinnedVersions)).toEqual(new Set([packageJson.version]));

		run(process.execPath, ["run", "build"]);

		const packDir = await tempDir("flow-pack");
		run(process.execPath, ["pm", "pack", "--destination", packDir]);
		const tarball = (await readdir(packDir)).find((entry) =>
			entry.endsWith(".tgz"),
		);
		expect(tarball).toBeString();
		if (!tarball) throw new Error("Expected packed tarball.");
		const tarballPath = join(packDir, tarball);

		const tarList = run("tar", ["-tzf", tarballPath]).stdout;
		for (const expected of [
			"package/dist/index.js",
			"package/dist/index.d.ts",
			"package/dist/cli.js",
			"package/README.md",
			"package/CHANGELOG.md",
		]) {
			expect(tarList).toContain(expected);
		}
		for (const removedSurface of [
			"package/dist/runtime/",
			"package/dist/adapters/",
			"package/dist/platform/opencode/tool-input-schemas.d.ts",
		]) {
			expect(tarList).not.toContain(removedSurface);
		}

		const extractDir = await tempDir("flow-extract");
		run("tar", ["-xzf", tarballPath, "-C", extractDir]);
		const extractedPackage = join(extractDir, "package");
		const cliPath = join(extractedPackage, "dist", "cli.js");
		expect(await readFile(cliPath, "utf8")).toStartWith("#!/usr/bin/env node");
		const bundledPlugin = await readFile(
			join(extractedPackage, "dist", "index.js"),
			"utf8",
		);
		expect(bundledPlugin).toContain("# Flow Test");
		expect(bundledPlugin).toContain("flow-ui-quality/references/ui-rubric.md");
		expect(bundledPlugin).not.toContain(".flow-skill-version");
		const extractedManifest = JSON.parse(
			await readFile(join(extractedPackage, "package.json"), "utf8"),
		);
		expect(extractedManifest.types).toBe("dist/index.d.ts");
		expect(extractedManifest.bin["opencode-plugin-flow"]).toBe("./dist/cli.js");

		const declarations = (
			await readdir(join(extractedPackage, "dist"), {
				recursive: true,
				withFileTypes: true,
			})
		)
			.filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
			.map((entry) => join(entry.parentPath, entry.name));
		expect(declarations.length).toBeGreaterThan(0);
		for (const declaration of declarations) {
			const source = await readFile(declaration, "utf8");
			expect(source).not.toContain("node_modules");
			expect(source).not.toContain(".bun/");
			expect(source).not.toMatch(/zod@\d/);
		}

		const home = await tempDir("flow-pack-home");
		const packedBinPath = join(
			extractedPackage,
			extractedManifest.bin["opencode-plugin-flow"],
		);
		const version = run("node", [packedBinPath, "--version"], {
			env: { npm_package_version: "9.9.9" },
		});
		expect(version.stdout.trim()).toBe(extractedManifest.version);
		const cleanup = run(
			"node",
			[packedBinPath, "legacy-cleanup", "--dry-run", "--json"],
			{
				env: { HOME: home },
			},
		);
		const cleanupReport = JSON.parse(cleanup.stdout);
		expect(cleanupReport.mode).toBe("dry-run");
		expect(
			cleanupReport.results.every(
				(result: { status: string }) => result.status === "absent",
			),
		).toBe(true);
		expect(await readdir(home)).toEqual([]);

		const consumerDir = await tempDir("flow-consumer");
		await writeFile(
			join(consumerDir, "package.json"),
			'{"type":"module"}\n',
			"utf8",
		);
		await mkdir(join(consumerDir, "node_modules"), { recursive: true });
		await cp(
			extractedPackage,
			join(consumerDir, "node_modules", "opencode-plugin-flow"),
			{ recursive: true },
		);
		const scopedModules = join(consumerDir, "node_modules", "@opencode-ai");
		await mkdir(scopedModules, { recursive: true });
		for (const packageName of ["plugin", "sdk"]) {
			await symlink(
				join(process.cwd(), "node_modules", "@opencode-ai", packageName),
				join(scopedModules, packageName),
				"dir",
			);
		}
		await symlink(
			join(process.cwd(), "node_modules", "zod"),
			join(consumerDir, "node_modules", "zod"),
			"dir",
		);
		const consumer = join(consumerDir, "consumer.ts");
		await writeFile(
			consumer,
			[
				'import type { Plugin } from "@opencode-ai/plugin";',
				'import flowPlugin from "opencode-plugin-flow";',
				"const plugin: Plugin = flowPlugin;",
				"void plugin;",
				"",
			].join("\n"),
			"utf8",
		);
		run(join(process.cwd(), "node_modules", ".bin", "tsc"), [
			"--noEmit",
			"--ignoreConfig",
			"--target",
			"ES2024",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--strict",
			"--types",
			"node",
			consumer,
		]);

		const runtimeConsumer = join(consumerDir, "consumer.mjs");
		await writeFile(
			runtimeConsumer,
			[
				'import flowPlugin from "opencode-plugin-flow";',
				'if (typeof flowPlugin !== "function") throw new Error("Expected a plugin function.");',
				"",
			].join("\n"),
			"utf8",
		);
		run("node", [runtimeConsumer], { cwd: consumerDir });
	}, 20_000);
});
