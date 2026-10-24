import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBunToolchain } from "../evals/bun-toolchain.js";
import { EvalHost } from "../evals/harness.js";
import packageJson from "../package.json" with { type: "json" };
import { nativeIsolationExecutable } from "./fixtures/native-eval-client.js";

test("study host ignores ambient OpenCode configuration and synthetic Git hooks/signing", async () => {
	const directory = await mkdtemp(join(tmpdir(), "study-host-isolation-"));
	let host: EvalHost | undefined;
	try {
		const hooks = join(directory, "hooks");
		await mkdir(hooks);
		await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\nexit 79\n");
		await chmod(join(hooks, "pre-commit"), 0o755);
		const gitConfig = join(directory, "gitconfig");
		await writeFile(
			gitConfig,
			`[core]\n hooksPath = ${hooks}\n[commit]\n gpgSign = true\n[user]\n signingKey = nonexistent-test-key\n`,
		);
		const poisonConfig = join(directory, "opencode.json");
		await writeFile(poisonConfig, "not-json");
		const toolchain = currentBunToolchain(packageJson.packageManager);
		host = await EvalHost.start({
			toolchain: {
				...toolchain,
				environment: {
					PATH: toolchain.environment.PATH,
					GIT_CONFIG_GLOBAL: gitConfig,
					OPENCODE_CONFIG: poisonConfig,
					OPENCODE_CONFIG_CONTENT: "not-json",
					OPENCODE_CONFIG_DIR: directory,
				},
			},
			packageCache: "",
			withFlow: false,
			opencodeVersion: "2.1.4",
			opencodeExecutable: await nativeIsolationExecutable(directory),
			providerCredentials: "disabled",
			ambientConfig: "disabled",
			reviewerEnvironment: "disabled",
			files: { "package.json": '{"name":"project","private":true}\n' },
			signal: AbortSignal.timeout(180000),
		});
		expect(
			await readFile(join(host.project, "opencode.json"), "utf8"),
		).not.toContain("not-json");
		const log = spawnSync(
			"git",
			["-C", host.project, "log", "-1", "--format=%an <%ae>"],
			{ encoding: "utf8" },
		);
		expect(log.status).toBe(0);
		expect(log.stdout.trim()).toBe("Project <project@example.invalid>");
		const config = await host.client.config.get({
			location: { directory: host.project },
		});
		expect(config).toEqual([{ type: "document", info: { plugins: [] } }]);
	} finally {
		await host?.stop();
		await rm(directory, { recursive: true, force: true });
	}
}, 240000);
