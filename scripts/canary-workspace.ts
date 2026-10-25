import { spawnSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

function git(directory: string, args: readonly string[]): string {
	const env = { ...process.env };
	for (const name of Object.keys(env)) {
		if (name.startsWith("GIT_")) delete env[name];
	}
	env.GIT_CONFIG_NOSYSTEM = "1";
	env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
	const result = spawnSync(
		"git",
		[
			"-c",
			`core.hooksPath=${join(directory, ".git", "disabled-hooks")}`,
			"-C",
			directory,
			...args,
		],
		{ env, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
	);
	if (result.status !== 0 || typeof result.stdout !== "string") {
		throw new Error("Canary fixture requires a committed Git workspace.");
	}
	return result.stdout.trim();
}

export async function assertCanaryWorkspace(directory: string): Promise<void> {
	try {
		const expected = await realpath(directory);
		if (
			(await realpath(git(expected, ["rev-parse", "--show-toplevel"]))) !==
			expected
		) {
			throw new Error("Workspace root differs.");
		}
		git(expected, ["rev-parse", "--verify", "HEAD^{commit}"]);
	} catch {
		throw new Error("Canary fixture requires a committed Git workspace.");
	}
}

export async function prepareCanaryWorkspace(directory: string): Promise<void> {
	const workspace = await realpath(directory);
	await mkdir(join(workspace, ".git"));
	await writeFile(
		join(workspace, ".gitignore"),
		".flow/\n.opencode/\nnode_modules/\n",
		{ flag: "wx" },
	);
	git(workspace, ["init", "--initial-branch=main"]);
	git(workspace, ["add", "--all"]);
	git(workspace, [
		"-c",
		"user.name=Flow Canary",
		"-c",
		"user.email=flow-canary@example.invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"--no-verify",
		"-m",
		"Prepare canary fixture",
	]);
	await assertCanaryWorkspace(workspace);
}
