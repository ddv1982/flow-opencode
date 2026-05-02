import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackageManager } from "../schema";
import { candidateWorkspaceDirectories } from "./workspace-boundaries";

const PACKAGE_MANAGER_LOCKFILES: Array<{
	manager: PackageManager;
	filenames: string[];
}> = [
	{ manager: "pnpm", filenames: ["pnpm-lock.yaml"] },
	{ manager: "npm", filenames: ["package-lock.json", "npm-shrinkwrap.json"] },
	{ manager: "yarn", filenames: ["yarn.lock"] },
	{ manager: "bun", filenames: ["bun.lock", "bun.lockb"] },
];

export type PackageManagerDetection = {
	packageManager?: PackageManager;
	ambiguous: boolean;
};

export async function detectPackageManager(
	workspaceRoot: string,
	startDirectory?: string,
): Promise<PackageManagerDetection> {
	for (const directory of candidateWorkspaceDirectories(
		workspaceRoot,
		startDirectory,
	)) {
		const packageManagerFromManifest =
			await detectPackageManagerFromManifest(directory);
		if (packageManagerFromManifest) {
			return {
				packageManager: packageManagerFromManifest,
				ambiguous: false,
			};
		}

		const lockfileDetection = await detectPackageManagerFromLockfile(directory);
		if (lockfileDetection.ambiguous || lockfileDetection.packageManager) {
			return lockfileDetection;
		}
	}

	return { ambiguous: false };
}

async function detectPackageManagerFromManifest(
	directory: string,
): Promise<PackageManager | undefined> {
	const manifestPath = join(directory, "package.json");
	if (!(await pathExists(manifestPath))) {
		return undefined;
	}

	try {
		const packageJson = JSON.parse(await readFile(manifestPath, "utf8")) as {
			packageManager?: unknown;
		};
		return parsePackageManager(packageJson.packageManager);
	} catch {
		return undefined;
	}
}

async function detectPackageManagerFromLockfile(
	directory: string,
): Promise<PackageManagerDetection> {
	const detectedManagers = new Set<PackageManager>();

	for (const candidate of PACKAGE_MANAGER_LOCKFILES) {
		for (const filename of candidate.filenames) {
			if (await pathExists(join(directory, filename))) {
				detectedManagers.add(candidate.manager);
				break;
			}
		}
	}

	if (detectedManagers.size > 1) {
		return { ambiguous: true };
	}

	const packageManager = detectedManagers.values().next().value as
		| PackageManager
		| undefined;
	return packageManager === undefined
		? { ambiguous: false }
		: { packageManager, ambiguous: false };
}

function parsePackageManager(value: unknown): PackageManager | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim().split("@")[0];
	if (
		normalized === "npm" ||
		normalized === "pnpm" ||
		normalized === "yarn" ||
		normalized === "bun"
	) {
		return normalized;
	}

	return undefined;
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}
