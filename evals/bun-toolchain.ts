import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

export type BunToolchain = {
	readonly executable: string;
	readonly actualVersion: string;
	readonly expectedVersion: string;
	readonly environment: NodeJS.ProcessEnv;
};

export function pinnedBunVersion(packageManager: string | undefined): string {
	const match = /^bun@(\d+\.\d+\.\d+)$/.exec(packageManager ?? "");
	if (!match?.[1]) {
		throw new Error(
			"package.json#packageManager must name one exact Bun version, such as bun@1.3.14.",
		);
	}
	return match[1];
}

export function bunToolchainFor(input: {
	readonly packageManager: string | undefined;
	readonly actualVersion: string;
	readonly executable: string;
	readonly environment: NodeJS.ProcessEnv;
}): BunToolchain {
	const expectedVersion = pinnedBunVersion(input.packageManager);
	if (input.actualVersion !== expectedVersion) {
		throw new Error(
			`Flow evals require bun@${expectedVersion} from package.json, but this process is bun@${input.actualVersion}. Run the command with the pinned Bun before generating evidence.`,
		);
	}
	const executableDirectory = dirname(input.executable);
	const inheritedPath =
		input.environment.PATH ??
		Object.entries(input.environment).find(
			([key]) => key.toLowerCase() === "path",
		)?.[1];
	const environment = Object.fromEntries(
		Object.entries(input.environment).filter(
			([key]) => key.toLowerCase() !== "path",
		),
	);
	return {
		executable: input.executable,
		actualVersion: input.actualVersion,
		expectedVersion,
		environment: {
			...environment,
			PATH: inheritedPath
				? `${executableDirectory}${delimiter}${inheritedPath}`
				: executableDirectory,
		},
	};
}

export function currentBunToolchain(
	packageManager: string | undefined,
): BunToolchain {
	return bunToolchainFor({
		packageManager,
		actualVersion: Bun.version,
		executable: process.execPath,
		environment: process.env,
	});
}

export function runPinnedBunSync(
	toolchain: BunToolchain,
	args: readonly string[],
	options: { readonly cwd: string },
): SpawnSyncReturns<string> {
	return spawnSync(toolchain.executable, [...args], {
		cwd: options.cwd,
		encoding: "utf8",
		env: toolchain.environment,
	});
}
