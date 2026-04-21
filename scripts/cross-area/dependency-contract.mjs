#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function resolveRepoPath(filePath) {
	return path.resolve(import.meta.dirname, "..", "..", filePath);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolvePathFromEnv(envName, fallback) {
	return process.env[envName] ?? resolveRepoPath(fallback);
}

function resolvePluginZodPackageJsonPath() {
	if (process.env.FLOW_DEPENDENCY_CONTRACT_PLUGIN_ZOD_PACKAGE_JSON_PATH) {
		return process.env.FLOW_DEPENDENCY_CONTRACT_PLUGIN_ZOD_PACKAGE_JSON_PATH;
	}

	const nestedPath = resolveRepoPath(
		"node_modules/@opencode-ai/plugin/node_modules/zod/package.json",
	);
	return existsSync(nestedPath)
		? nestedPath
		: resolveRepoPath("node_modules/zod/package.json");
}

function fail(lines) {
	console.error(lines.join("\n"));
	process.exit(1);
}

function main() {
	const packageJsonPath = resolvePathFromEnv(
		"FLOW_DEPENDENCY_CONTRACT_PACKAGE_JSON_PATH",
		"package.json",
	);
	const pluginPackageJsonPath = resolvePathFromEnv(
		"FLOW_DEPENDENCY_CONTRACT_PLUGIN_PACKAGE_JSON_PATH",
		"node_modules/@opencode-ai/plugin/package.json",
	);
	const rootZodPackageJsonPath = resolvePathFromEnv(
		"FLOW_DEPENDENCY_CONTRACT_ROOT_ZOD_PACKAGE_JSON_PATH",
		"node_modules/zod/package.json",
	);
	const pluginZodPackageJsonPath = resolvePluginZodPackageJsonPath();

	const projectPackage = readJson(packageJsonPath);
	const pluginPackage = readJson(pluginPackageJsonPath);
	const rootZodPackage = readJson(rootZodPackageJsonPath);
	const pluginZodPackage = readJson(pluginZodPackageJsonPath);

	const projectDeclaredZod = projectPackage.dependencies?.zod;
	const pluginDeclaredZod = pluginPackage.dependencies?.zod;
	const rootInstalledZod = rootZodPackage.version;
	const pluginInstalledZod = pluginZodPackage.version;

	const errors = [];
	if (typeof projectDeclaredZod !== "string" || projectDeclaredZod.length === 0) {
		errors.push(`Missing project zod dependency in ${packageJsonPath}.`);
	}
	if (typeof pluginDeclaredZod !== "string" || pluginDeclaredZod.length === 0) {
		errors.push(`Missing plugin zod dependency in ${pluginPackageJsonPath}.`);
	}
	if (typeof rootInstalledZod !== "string" || rootInstalledZod.length === 0) {
		errors.push(`Missing installed root zod version in ${rootZodPackageJsonPath}.`);
	}
	if (
		typeof pluginInstalledZod !== "string" ||
		pluginInstalledZod.length === 0
	) {
		errors.push(
			`Missing plugin effective zod version in ${pluginZodPackageJsonPath}.`,
		);
	}

	if (projectDeclaredZod !== rootInstalledZod) {
		errors.push(
			`Project zod dependency ${String(projectDeclaredZod)} does not match installed root zod ${String(rootInstalledZod)}.`,
		);
	}
	if (pluginDeclaredZod !== pluginInstalledZod) {
		errors.push(
			`Plugin zod dependency ${String(pluginDeclaredZod)} does not match plugin effective zod ${String(pluginInstalledZod)}.`,
		);
	}
	if (rootInstalledZod !== pluginInstalledZod) {
		errors.push(
			`Installed root zod ${String(rootInstalledZod)} does not match plugin effective zod ${String(pluginInstalledZod)}.`,
		);
	}

	if (errors.length > 0) {
		fail(["Dependency contract failed.", ...errors]);
	}

	console.log(
		[
			"Dependency contract OK.",
			`project dependency zod=${projectDeclaredZod}`,
			`plugin dependency zod=${pluginDeclaredZod}`,
			`installed root zod=${rootInstalledZod}`,
			`plugin effective zod=${pluginInstalledZod}`,
		].join("\n"),
	);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	fail(["Dependency contract failed.", message]);
}
