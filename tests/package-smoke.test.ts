import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
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

		const extractDir = await tempDir("flow-extract");
		run("tar", ["-xzf", tarballPath, "-C", extractDir]);
		const extractedPackage = join(extractDir, "package");
		const cliPath = join(extractedPackage, "dist", "cli.js");
		expect(await readFile(cliPath, "utf8")).toStartWith("#!/usr/bin/env node");
		const extractedManifest = JSON.parse(
			await readFile(join(extractedPackage, "package.json"), "utf8"),
		);
		expect(extractedManifest.types).toBe("dist/index.d.ts");
		expect(extractedManifest.bin["opencode-plugin-flow"]).toBe("./dist/cli.js");

		const home = await tempDir("flow-pack-home");
		const packedBinPath = join(
			extractedPackage,
			extractedManifest.bin["opencode-plugin-flow"],
		);
		const doctor = run("node", [packedBinPath, "doctor", "--json"], {
			env: { HOME: home },
		});
		expect(JSON.parse(doctor.stdout).status).toBe("sync_required");
		run("node", [packedBinPath, "sync"], { env: { HOME: home } });
		run("node", [packedBinPath, "uninstall"], { env: { HOME: home } });

		const consumerDir = await tempDir("flow-consumer");
		await mkdir(join(consumerDir, "node_modules"), { recursive: true });
		await symlink(
			extractedPackage,
			join(consumerDir, "node_modules", "opencode-plugin-flow"),
			"dir",
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
			"ES2022",
			"--module",
			"ESNext",
			"--moduleResolution",
			"Bundler",
			"--strict",
			"--skipLibCheck",
			"--allowSyntheticDefaultImports",
			"--esModuleInterop",
			"--types",
			"bun-types",
			consumer,
		]);
	}, 20_000);
});
