import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import packageJson from "../../package.json" with { type: "json" };
import {
	PACKED_PACKAGE_PATHS,
	PUBLIC_DECLARATION_PATHS,
} from "../../scripts/lib/package-surface.js";

export type PackageSurfaceSmokeEvidence = {
	packageVersion: string;
	tarballEntryCount: number;
	declarationCount: number;
	pinnedReadmeVersionCount: number;
	cliVersion: string;
	legacyCleanupDryRun: true;
	activationDryRun: true;
	activationApplied: true;
	activationSingleVersion: true;
	consumerTypechecked: true;
	runtimeImported: true;
};

function runCommand(
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

async function temporaryDirectory(name: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `${name}-`));
}

let cachedSmoke: Promise<PackageSurfaceSmokeEvidence> | undefined;

/**
 * Execute the actual build/pack/extract/typecheck/runtime package smoke. The
 * promise is cached so the invariant registry and package-smoke test share one
 * run when Bun loads both files in the same test process.
 */
export function runPackageSurfaceSmoke(): Promise<PackageSurfaceSmokeEvidence> {
	cachedSmoke ??= executePackageSurfaceSmoke();
	return cachedSmoke;
}

async function executePackageSurfaceSmoke(): Promise<PackageSurfaceSmokeEvidence> {
	const temporaryDirectories: string[] = [];
	const createTemporaryDirectory = async (name: string) => {
		const path = await temporaryDirectory(name);
		temporaryDirectories.push(path);
		return path;
	};
	try {
		assert.equal(packageJson.types, "dist/index.d.ts");
		assert.deepEqual(packageJson.exports["."], {
			types: "./dist/index.d.ts",
			import: "./dist/index.js",
			default: "./dist/index.js",
		});

		const readme = await readFile("README.md", "utf8");
		const pinnedVersions = [
			...readme.matchAll(/opencode-plugin-flow@(\d+\.\d+\.\d+)/g),
		].map((match) => match[1]);
		assert.ok(pinnedVersions.length > 0);
		assert.deepEqual(new Set(pinnedVersions), new Set([packageJson.version]));

		runCommand(process.execPath, ["run", "build"]);
		const packDirectory = await createTemporaryDirectory("flow-pack");
		runCommand(process.execPath, [
			"pm",
			"pack",
			"--destination",
			packDirectory,
		]);
		const tarball = (await readdir(packDirectory)).find((entry) =>
			entry.endsWith(".tgz"),
		);
		assert.ok(tarball, "Expected a packed tarball.");
		const tarballPath = join(packDirectory, tarball);
		const tarEntries = runCommand("tar", ["-tzf", tarballPath])
			.stdout.split(/\r?\n/)
			.filter(Boolean);
		assert.deepEqual(
			[...tarEntries].sort(),
			PACKED_PACKAGE_PATHS.map((path) => `package/${path}`).sort(),
			"Packed package files must match the intentional public allowlist.",
		);

		const extractDirectory = await createTemporaryDirectory("flow-extract");
		runCommand("tar", ["-xzf", tarballPath, "-C", extractDirectory]);
		const extractedPackage = join(extractDirectory, "package");
		const cliPath = join(extractedPackage, "dist", "cli.js");
		assert.ok(
			(await readFile(cliPath, "utf8")).startsWith("#!/usr/bin/env node"),
		);
		const bundledPlugin = await readFile(
			join(extractedPackage, "dist", "index.js"),
			"utf8",
		);
		assert.ok(bundledPlugin.includes("# Flow Test"));
		assert.ok(
			bundledPlugin.includes("flow-ui-quality/references/ui-rubric.md"),
		);
		assert.equal(bundledPlugin.includes(".flow-skill-version"), false);

		const extractedManifest = JSON.parse(
			await readFile(join(extractedPackage, "package.json"), "utf8"),
		) as {
			types: string;
			version: string;
			bin: Record<string, string>;
		};
		assert.equal(extractedManifest.types, "dist/index.d.ts");
		assert.equal(
			extractedManifest.bin["opencode-plugin-flow"],
			"./dist/cli.js",
		);

		const declarations = (
			await readdir(join(extractedPackage, "dist"), {
				recursive: true,
				withFileTypes: true,
			})
		)
			.filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
			.map((entry) => join(entry.parentPath, entry.name));
		assert.deepEqual(
			declarations
				.map((path) => relative(extractedPackage, path).split(sep).join("/"))
				.sort(),
			[...PUBLIC_DECLARATION_PATHS].sort(),
			"Packed declarations must match the supported root import chain.",
		);
		for (const declaration of declarations) {
			const source = await readFile(declaration, "utf8");
			assert.equal(source.includes("node_modules"), false);
			assert.equal(source.includes(".bun/"), false);
			assert.doesNotMatch(source, /zod@\d/);
		}

		const packedBinPath = join(
			extractedPackage,
			extractedManifest.bin["opencode-plugin-flow"] as string,
		);
		const version = runCommand("node", [packedBinPath, "--version"], {
			env: { npm_package_version: "9.9.9" },
		}).stdout.trim();
		assert.equal(version, extractedManifest.version);
		const isolatedHome = await createTemporaryDirectory("flow-pack-home");
		const cleanupReport = JSON.parse(
			runCommand(
				"node",
				[packedBinPath, "legacy-cleanup", "--dry-run", "--json"],
				{ env: { HOME: isolatedHome } },
			).stdout,
		) as { mode?: string; results?: Array<{ status?: string }> };
		assert.equal(cleanupReport.mode, "dry-run");
		assert.ok(
			cleanupReport.results?.every(({ status }) => status === "absent"),
		);
		assert.deepEqual(await readdir(isolatedHome), []);

		const activationRoot = await createTemporaryDirectory(
			"flow-pack-activation",
		);
		const activationProject = join(activationRoot, "project");
		const activationHome = join(activationRoot, "home");
		const activationConfigHome = join(activationRoot, "xdg-config");
		const activationCacheHome = join(activationRoot, "xdg-cache");
		const activationConfigRoot = join(activationConfigHome, "opencode");
		const activationCacheRoot = join(activationCacheHome, "opencode");
		const globalConfig = join(activationConfigRoot, "opencode.json");
		const projectConfig = join(activationProject, "opencode.json");
		const oldCache = join(
			activationCacheRoot,
			"packages",
			"opencode-plugin-flow@0.0.1",
		);
		const targetCache = join(
			activationCacheRoot,
			"packages",
			`opencode-plugin-flow@${extractedManifest.version}`,
		);
		const unrelatedCache = join(
			activationCacheRoot,
			"packages",
			"unrelated-plugin@1.0.0",
		);
		await mkdir(activationProject, { recursive: true });
		await mkdir(activationConfigRoot, { recursive: true });
		await writeFile(
			globalConfig,
			`${JSON.stringify({ plugin: ["unrelated-plugin@1.0.0", "opencode-plugin-flow@0.0.1"] }, null, 2)}\n`,
			"utf8",
		);
		await writeFile(
			projectConfig,
			`${JSON.stringify({ plugin: [`opencode-plugin-flow@${extractedManifest.version}`, "project-plugin@1.0.0"] }, null, 2)}\n`,
			"utf8",
		);
		for (const [cachePath, manifest] of [
			[oldCache, { name: "opencode-plugin-flow", version: "0.0.1" }],
			[
				targetCache,
				{
					name: "opencode-plugin-flow",
					version: extractedManifest.version,
				},
			],
		] as const) {
			const manifestPath = join(
				cachePath,
				"node_modules",
				"opencode-plugin-flow",
				"package.json",
			);
			await mkdir(dirname(manifestPath), { recursive: true });
			await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
		}
		await mkdir(unrelatedCache, { recursive: true });
		await writeFile(
			join(unrelatedCache, "user-note.txt"),
			"preserve\n",
			"utf8",
		);
		const activationEnvironment = {
			HOME: activationHome,
			XDG_CONFIG_HOME: activationConfigHome,
			XDG_CACHE_HOME: activationCacheHome,
			OPENCODE_CONFIG: "",
			OPENCODE_CONFIG_DIR: "",
			OPENCODE_CONFIG_CONTENT: "",
		};
		const activationArguments = [
			"activation-apply",
			"--project",
			activationProject,
			"--scope",
			"global",
			"--json",
		];
		const globalBeforeActivation = await readFile(globalConfig, "utf8");
		const projectBeforeActivation = await readFile(projectConfig, "utf8");
		const activationDryRun = JSON.parse(
			runCommand("node", [packedBinPath, ...activationArguments], {
				env: activationEnvironment,
			}).stdout,
		) as { mode?: string; status?: string };
		assert.equal(activationDryRun.mode, "dry-run");
		assert.equal(activationDryRun.status, "ready");
		assert.equal(await readFile(globalConfig, "utf8"), globalBeforeActivation);
		assert.equal(
			await readFile(projectConfig, "utf8"),
			projectBeforeActivation,
		);

		const activationApply = JSON.parse(
			runCommand(
				"node",
				[
					packedBinPath,
					"install",
					"--project",
					activationProject,
					"--scope",
					"global",
					"--json",
				],
				{ env: activationEnvironment },
			).stdout,
		) as {
			mode?: string;
			status?: string;
			after?: { singleVersionSatisfied?: boolean };
			recovery?: { journalPath?: string };
		};
		assert.equal(activationApply.mode, "apply");
		assert.equal(activationApply.status, "applied");
		assert.equal(activationApply.after?.singleVersionSatisfied, true);
		assert.ok(activationApply.recovery?.journalPath);
		await access(activationApply.recovery.journalPath);
		await assert.rejects(access(oldCache));
		await access(targetCache);
		assert.equal(
			await readFile(join(unrelatedCache, "user-note.txt"), "utf8"),
			"preserve\n",
		);
		assert.deepEqual(JSON.parse(await readFile(globalConfig, "utf8")), {
			plugin: [
				"unrelated-plugin@1.0.0",
				`opencode-plugin-flow@${extractedManifest.version}`,
			],
		});
		assert.deepEqual(JSON.parse(await readFile(projectConfig, "utf8")), {
			plugin: ["project-plugin@1.0.0"],
		});
		const activationCheck = JSON.parse(
			runCommand(
				"node",
				[
					packedBinPath,
					"activation-check",
					"--project",
					activationProject,
					"--json",
				],
				{ env: activationEnvironment },
			).stdout,
		) as { target?: string; singleVersionSatisfied?: boolean };
		assert.equal(activationCheck.target, extractedManifest.version);
		assert.equal(activationCheck.singleVersionSatisfied, true);

		const consumerDirectory = await createTemporaryDirectory("flow-consumer");
		await writeFile(
			join(consumerDirectory, "package.json"),
			'{"type":"module"}\n',
			"utf8",
		);
		await mkdir(join(consumerDirectory, "node_modules"), { recursive: true });
		await cp(
			extractedPackage,
			join(consumerDirectory, "node_modules", "opencode-plugin-flow"),
			{ recursive: true },
		);
		const scopedModules = join(
			consumerDirectory,
			"node_modules",
			"@opencode-ai",
		);
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
			join(consumerDirectory, "node_modules", "zod"),
			"dir",
		);
		const consumer = join(consumerDirectory, "consumer.ts");
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
		runCommand(join(process.cwd(), "node_modules", ".bin", "tsc"), [
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

		const runtimeConsumer = join(consumerDirectory, "consumer.mjs");
		await writeFile(
			runtimeConsumer,
			[
				'import flowPlugin from "opencode-plugin-flow";',
				'if (typeof flowPlugin !== "function") throw new Error("Expected a plugin function.");',
				"",
			].join("\n"),
			"utf8",
		);
		runCommand("node", [runtimeConsumer], { cwd: consumerDirectory });

		return {
			packageVersion: packageJson.version,
			tarballEntryCount: tarEntries.length,
			declarationCount: declarations.length,
			pinnedReadmeVersionCount: pinnedVersions.length,
			cliVersion: version,
			legacyCleanupDryRun: true,
			activationDryRun: true,
			activationApplied: true,
			activationSingleVersion: true,
			consumerTypechecked: true,
			runtimeImported: true,
		};
	} finally {
		await Promise.all(
			temporaryDirectories.map((path) =>
				rm(path, { force: true, recursive: true }),
			),
		);
	}
}
