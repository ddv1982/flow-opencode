import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	applyFlowActivation,
	checkFlowActivation,
	createMarkerOwnedFlowWrapper,
	resolveActivationPaths,
	resolveActivationTarget,
} from "../src/distribution/activation.js";

const temporaryRoots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-activation-inventory-"));
	temporaryRoots.push(root);
	const project = join(root, "project");
	const home = join(root, "home");
	const configRoot = join(root, "config", "opencode");
	const cacheRoot = join(root, "cache", "opencode");
	const managedConfigRoot = join(root, "managed", "opencode");
	await mkdir(project, { recursive: true });
	return {
		root,
		project,
		home,
		configRoot,
		cacheRoot,
		managedConfigRoot,
		paths: {
			home,
			configRoot,
			cacheRoot,
			managedConfigRoot,
			managedPreferencePaths: [],
			env: {},
		},
	};
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function installCacheArtifact(
	cacheRoot: string,
	specifier: string,
	version: string,
): Promise<string> {
	const path = join(cacheRoot, "packages", specifier);
	await writeJson(
		join(path, "node_modules", "opencode-plugin-flow", "package.json"),
		{ name: "opencode-plugin-flow", version },
	);
	return path;
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

describe("Flow activation inventory", () => {
	test("maps all four OpenCode sources and separates cache artifacts", async () => {
		const environment = await fixture();
		const resolved = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		const globalWrapper = join(
			resolved.globalPluginDirectory,
			"flow-owned-wrapper.js",
		);
		await mkdir(dirname(globalWrapper), { recursive: true });
		await writeFile(
			globalWrapper,
			createMarkerOwnedFlowWrapper("5.1.0"),
			"utf8",
		);
		const unsupportedExtension = join(
			resolved.globalPluginDirectory,
			"flow-ignored-wrapper.mjs",
		);
		await writeFile(
			unsupportedExtension,
			createMarkerOwnedFlowWrapper("4.0.0"),
			"utf8",
		);
		const projectWrapper = join(
			resolved.projectPluginDirectory,
			"flow-custom-wrapper.js",
		);
		await mkdir(dirname(projectWrapper), { recursive: true });
		await writeFile(
			projectWrapper,
			'import plugin from "opencode-plugin-flow@5.0.0";\nexport default plugin;\n',
			"utf8",
		);
		await writeJson(resolved.globalConfig, {
			plugin: [
				"unrelated-plugin@1.0.0",
				"opencode-plugin-flow@5.1.0",
				"./plugins/flow-owned-wrapper.js",
			],
		});
		await writeJson(resolved.projectConfig, {
			plugin: ["opencode-plugin-flow@5.2.2"],
		});
		await installCacheArtifact(
			environment.cacheRoot,
			"opencode-plugin-flow@5.2.2",
			"5.2.2",
		);
		await installCacheArtifact(
			environment.cacheRoot,
			"opencode-plugin-flow@5.1.0",
			"5.1.0",
		);
		await mkdir(
			join(environment.cacheRoot, "packages", "opencode-plugin-flow@unknown"),
			{ recursive: true },
		);

		const report = await checkFlowActivation({
			project: environment.project,
			target: "5.2.2",
			paths: environment.paths,
		});

		expect(new Set(report.records.map(({ source }) => source))).toEqual(
			new Set([
				"global-config",
				"project-config",
				"global-plugin-directory",
				"project-plugin-directory",
			]),
		);
		expect(
			report.records.find(
				(record) =>
					record.source === "project-config" && record.ownership === "flow-npm",
			),
		).toMatchObject({
			specifier: "opencode-plugin-flow@5.2.2",
			resolvedVersion: "5.2.2",
			status: "target",
		});
		expect(
			report.records.find(
				(record) =>
					record.source === "global-plugin-directory" &&
					record.path === globalWrapper,
			),
		).toMatchObject({
			resolvedVersion: "5.1.0",
			ownership: "marker-owned-wrapper",
			status: "conflict",
		});
		expect(
			report.records.find((record) => record.path === projectWrapper),
		).toMatchObject({
			resolvedVersion: "5.0.0",
			ownership: "unknown-flow-like",
			status: "refused",
		});
		expect(
			report.records.some((record) => record.path === unsupportedExtension),
		).toBe(false);
		expect(
			report.cacheArtifacts.map(({ resolvedVersion, status }) => ({
				resolvedVersion,
				status,
			})),
		).toEqual(
			expect.arrayContaining([
				{ resolvedVersion: "5.2.2", status: "target" },
				{ resolvedVersion: "5.1.0", status: "inactive" },
				{ resolvedVersion: null, status: "ambiguous" },
			]),
		);
		expect(report.singleVersionSatisfied).toBe(false);
		expect(report.issues).toContainEqual(
			expect.objectContaining({ code: "ambiguous-cache-artifact" }),
		);
	});

	test("inventories custom, inline, managed, and singular compatibility sources", async () => {
		const environment = await fixture();
		const customConfig = join(environment.root, "custom", "profile.json");
		const customDirectory = join(environment.root, "custom-directory");
		const pathOptions = {
			...environment.paths,
			env: {
				OPENCODE_CONFIG: customConfig,
				OPENCODE_CONFIG_DIR: customDirectory,
				OPENCODE_CONFIG_CONTENT:
					'{"plugin": [["opencode-plugin-flow@4.9.0", {"inline": true}]],}',
			},
		};
		const resolved = resolveActivationPaths(environment.project, pathOptions);
		await writeJson(customConfig, {
			plugin: [["opencode-plugin-flow@5.0.0", { source: "custom" }]],
		});
		await writeJson(join(customDirectory, "opencode.json"), {
			plugin: ["opencode-plugin-flow@5.1.0"],
		});
		await writeJson(resolved.managedConfigFiles[0] as string, {
			plugin: ["opencode-plugin-flow@4.8.0"],
		});
		const customSingular = resolved.pluginDirectories.find(
			(directory) =>
				directory.source === "custom-plugin-directory" &&
				directory.path.endsWith(`${join("", "plugin")}`),
		);
		if (!customSingular)
			throw new Error("Expected custom singular plugin path");
		await mkdir(customSingular.path, { recursive: true });
		await writeFile(
			join(customSingular.path, "flow-owned-wrapper.js"),
			createMarkerOwnedFlowWrapper("5.1.0"),
			"utf8",
		);

		const report = await checkFlowActivation({
			project: environment.project,
			target: "5.2.2",
			paths: pathOptions,
		});

		const sources = new Set(report.records.map(({ source }) => source));
		for (const source of [
			"custom-config",
			"custom-directory-config",
			"custom-plugin-directory",
			"inline-config",
			"managed-config",
		] as const) {
			expect(sources.has(source), source).toBe(true);
		}
		expect(report.records).toContainEqual(
			expect.objectContaining({
				source: "inline-config",
				scope: "inline",
				specifier: "opencode-plugin-flow@4.9.0",
			}),
		);
		expect(report.limitations).toContainEqual(
			expect.objectContaining({
				source: "remote-config",
				coverage: "runtime-leadership",
				blocking: false,
			}),
		);
		expect(report.singleVersionSatisfied).toBe(false);

		const applied = await applyFlowActivation({
			project: environment.project,
			scope: "global",
			target: "5.2.2",
			apply: true,
			paths: pathOptions,
		});
		expect(applied.status).toBe("refused");
		expect(applied.refusals).toContainEqual(
			expect.stringContaining("OPENCODE_CONFIG_CONTENT"),
		);
		expect(applied.refusals).toContainEqual(
			expect.stringContaining("managed config is immutable"),
		);
	});

	test("accepts only an absolute project and exact local target", async () => {
		expect(() => resolveActivationTarget("latest")).toThrow(
			"must be an exact semantic version",
		);
		expect(() => resolveActivationTarget("^5.2.2")).toThrow(
			"must be an exact semantic version",
		);
		expect(resolveActivationTarget("5.2.2-beta.1")).toBe("5.2.2-beta.1");
		expect(() => resolveActivationPaths("relative/project")).toThrow(
			"must be absolute",
		);
		const environment = await fixture();
		const isolatedHome = join(environment.root, "isolated-home");
		const injected = resolveActivationPaths(environment.project, {
			home: isolatedHome,
			env: {
				XDG_CONFIG_HOME: join(environment.root, "must-not-be-used", "config"),
				XDG_CACHE_HOME: join(environment.root, "must-not-be-used", "cache"),
			},
		});
		expect(injected.globalConfig).toBe(
			join(isolatedHome, ".config", "opencode", "opencode.json"),
		);
		expect(injected.packageCacheRoot).toBe(
			join(isolatedHome, ".cache", "opencode", "packages"),
		);
	});

	test("inventories JSONC but refuses lossy mutation with remediation", async () => {
		const environment = await fixture();
		const resolved = resolveActivationPaths(
			environment.project,
			environment.paths,
		);
		await mkdir(dirname(resolved.globalConfig), { recursive: true });
		await writeFile(
			resolved.globalConfig,
			'{\n  // kept for humans\n  "plugin": ["opencode-plugin-flow@5.2.2"],\n}\n',
			"utf8",
		);

		const report = await checkFlowActivation({
			project: environment.project,
			target: "5.2.2",
			paths: environment.paths,
		});

		expect(report.singleVersionSatisfied).toBe(true);
		expect(report.records).toContainEqual(
			expect.objectContaining({
				source: "global-config",
				specifier: "opencode-plugin-flow@5.2.2",
				status: "target",
			}),
		);
		const applied = await applyFlowActivation({
			project: environment.project,
			scope: "project",
			target: "5.2.2",
			apply: true,
			paths: environment.paths,
		});
		expect(applied.status).toBe("refused");
		expect(applied.refusals).toContainEqual(
			expect.stringContaining("cannot be edited losslessly"),
		);
		expect(await Bun.file(resolved.globalConfig).text()).toContain(
			"// kept for humans",
		);
	});

	test("reports managed preferences as nonblocking runtime-covered uncertainty", async () => {
		const environment = await fixture();
		const preferencePath = join(
			environment.root,
			"managed-preferences",
			"ai.opencode.desktop.plist",
		);
		const pathOptions = {
			...environment.paths,
			platform: "darwin" as const,
			managedPreferencePaths: [preferencePath],
		};
		const resolved = resolveActivationPaths(environment.project, pathOptions);
		await writeJson(resolved.globalConfig, {
			plugin: ["opencode-plugin-flow@5.2.2"],
		});
		await mkdir(dirname(preferencePath), { recursive: true });
		await writeFile(preferencePath, "opaque managed preferences\n", "utf8");

		const report = await checkFlowActivation({
			project: environment.project,
			target: "5.2.2",
			paths: pathOptions,
		});

		expect(report.singleVersionSatisfied).toBe(true);
		expect(report.limitations).toContainEqual(
			expect.objectContaining({
				source: "managed-preferences",
				coverage: "runtime-leadership",
				blocking: false,
				detail: expect.stringContaining(preferencePath),
			}),
		);
	});
});
