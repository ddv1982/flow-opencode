import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// End-to-end npm distribution lifecycle: pack the publishable tarball, install
// it the way OpenCode resolves npm plugins, start the plugin (skill sync +
// pre-npm warning), exercise the tool surface, and uninstall via the CLI.
// The heavy lifting lives in scripts/cross-area/opencode-smoke.mjs so the
// release gate and this test cannot drift apart.

describe("cross-area npm install lifecycle", () => {
	test(
		"packed tarball installs, syncs skills, serves tools, and uninstalls cleanly",
		async () => {
			const smokeScript = join(
				import.meta.dir,
				"..",
				"..",
				"scripts",
				"cross-area",
				"opencode-smoke.mjs",
			);
			const smoke = Bun.spawnSync({
				cmd: ["node", smokeScript],
				stdout: "pipe",
				stderr: "pipe",
			});
			const stdout = new TextDecoder().decode(smoke.stdout);
			const stderr = new TextDecoder().decode(smoke.stderr);

			if (!smoke.success) {
				throw new Error(`npm install smoke failed:\n${stderr}\n${stdout}`);
			}

			const report = JSON.parse(stdout) as {
				packedVersion: string;
				expectedVersion: string;
				readmePinnedVersion: string;
				syncedSkills: string[];
				configAgents: number;
				configCommands: number;
				toolCount: number;
				extraToolCount: number;
				preNpmWarningVerified: boolean;
				uninstallVerified: boolean;
			};

			expect(report.packedVersion).toBe(report.expectedVersion);
			expect(report.readmePinnedVersion).toBe(report.expectedVersion);
			expect(report.syncedSkills).toEqual([
				"flow",
				"flow-deslop",
				"flow-plan",
				"flow-review",
				"flow-run",
				"flow-ui-quality",
			]);
			expect(report.configAgents).toBe(1);
			expect(report.configCommands).toBe(5);
			expect(report.toolCount).toBe(8);
			expect(report.extraToolCount).toBe(0);
			expect(report.preNpmWarningVerified).toBe(true);
			expect(report.uninstallVerified).toBe(true);
		},
		{ timeout: 60000 },
	);
});
