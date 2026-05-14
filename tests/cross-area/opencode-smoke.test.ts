import { afterEach, describe, expect, test } from "bun:test";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	repoRoot,
	"scripts",
	"cross-area",
	"opencode-smoke.mjs",
);
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-opencode-smoke-test-"));
	tempDirs.push(dir);
	return dir;
}

function ensureBuiltDist(): void {
	const result = Bun.spawnSync({
		cmd: ["bun", "run", "build"],
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (!result.success) {
		throw new Error(
			`bun run build failed: ${result.stderr.toString() || result.stdout.toString()}`,
		);
	}
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("OpenCode-oriented smoke script", () => {
	test("smokes explicit prepared assets without claiming live OpenCode UI validation", async () => {
		ensureBuiltDist();
		const tempRoot = makeTempDir();
		const preparedDir = join(tempRoot, "prepared");
		const bundleRoot = join(tempRoot, "bundle-root");
		mkdirSync(preparedDir, { recursive: true });
		const flowJsPath = join(preparedDir, "flow.js");
		const skillBundlePath = join(preparedDir, "flow-skills.tar.gz");
		const installScriptPath = join(preparedDir, "install.sh");
		const uninstallScriptPath = join(preparedDir, "uninstall.sh");
		copyFileSync(join(repoRoot, "dist", "index.js"), flowJsPath);
		copyFileSync(
			join(repoRoot, "scripts", "release-install.sh"),
			installScriptPath,
		);
		copyFileSync(
			join(repoRoot, "scripts", "release-uninstall.sh"),
			uninstallScriptPath,
		);
		let result = Bun.spawnSync({
			cmd: [
				"bun",
				"run",
				"./scripts/cross-area/write-release-skill-bundle.ts",
				bundleRoot,
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (!result.success) {
			throw new Error(
				`skill bundle write failed: ${result.stderr.toString() || result.stdout.toString()}`,
			);
		}
		result = Bun.spawnSync({
			cmd: ["tar", "-czf", skillBundlePath, "-C", bundleRoot, ".config"],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (!result.success) {
			throw new Error(
				`skill bundle archive failed: ${result.stderr.toString() || result.stdout.toString()}`,
			);
		}
		const jsonPath = join(tempRoot, "evidence.json");
		const summaryPath = join(tempRoot, "evidence.md");

		const process = Bun.spawn({
			cmd: [
				"node",
				scriptPath,
				"--skip-build",
				"--flow-js",
				flowJsPath,
				"--skill-bundle",
				skillBundlePath,
				"--install-script",
				installScriptPath,
				"--uninstall-script",
				uninstallScriptPath,
				"--json",
				jsonPath,
				"--summary",
				summaryPath,
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();
		if (exitCode !== 0) {
			throw new Error(`opencode smoke failed: ${stderr}`);
		}
		expect(exitCode).toBe(0);
		const evidence = JSON.parse(readFileSync(jsonPath, "utf8"));
		expect(evidence.status).toBe("passed");
		expect(evidence.releaseInstall.assetMode).toBe("local-file-url");
		expect(evidence.releaseInstall.assetSource).toBe("explicit-or-mixed");
		expect(evidence.releaseInstall.assets).toEqual({
			flowJs: flowJsPath,
			skillBundle: skillBundlePath,
			installScript: installScriptPath,
			uninstallScript: uninstallScriptPath,
		});
		expect(evidence.releaseInstall.installed).toBe(true);
		expect(evidence.releaseInstall.uninstalled).toBe(true);
		expect(evidence.hostBoundary.realOpenCodeCliInvoked).toBe(false);
		expect(evidence.hostBoundary.manualLiveOpenCodeRequired).toBe(true);
		expect(evidence.surface.agents).toBe(7);
		expect(evidence.surface.commands).toBe(9);
		expect(evidence.surface.tools).toBe(18);
		expect(evidence.surface.generatedSkillsPresent).toEqual([
			"flow-plan",
			"flow-run",
			"flow-review",
		]);
		expect(
			evidence.runtimeSmoke.map((item: { tool: string }) => item.tool),
		).toEqual(
			expect.arrayContaining([
				"flow_status",
				"flow_plan_start",
				"flow_history",
			]),
		);
		expect(readFileSync(summaryPath, "utf8")).toContain(
			"Remaining manual live OpenCode validation",
		);
		expect(evidence.workspaceIsolation.repoRoot).toBe(repoRoot);
		expect(evidence.workspaceIsolation.worktree).not.toBe(repoRoot);
		expect(evidence.workspaceIsolation.worktreeFlowCreated).toBe(true);
		expect(evidence.workspaceIsolation.repoRootFlowExistedAfter).toBe(
			evidence.workspaceIsolation.repoRootFlowExistedBefore,
		);
	});
});
