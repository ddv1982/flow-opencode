import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
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
const releaseSmokeScriptPath = join(
	repoRoot,
	"scripts",
	"cross-area",
	"release-smoke.mjs",
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

	test("refuses disposable cleanup when release-smoke output files already exist", async () => {
		const tempRoot = makeTempDir();
		const outputDir = join(tempRoot, "release-smoke");
		mkdirSync(outputDir, { recursive: true });
		const existingFlowJs = join(outputDir, "flow.js");
		await Bun.write(existingFlowJs, "existing content");

		const process = Bun.spawn({
			cmd: [
				"node",
				releaseSmokeScriptPath,
				"--skip-build",
				"--output-dir",
				outputDir,
				"--no-keep-assets",
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();
		expect(exitCode).toBe(1);
		expect(stderr).toContain(
			"refuses to overwrite existing release-smoke output files",
		);
		expect(readFileSync(existingFlowJs, "utf8")).toBe("existing content");
		expect(existsSync(join(outputDir, "release-smoke-evidence.json"))).toBe(
			false,
		);
		expect(
			existsSync(join(outputDir, "manual-live-opencode-checklist.md")),
		).toBe(false);
	});

	test("refuses disposable cleanup without overwriting existing evidence files", async () => {
		for (const existingFile of [
			"release-smoke-evidence.json",
			"manual-live-opencode-checklist.md",
		]) {
			const tempRoot = makeTempDir();
			const outputDir = join(tempRoot, "release-smoke");
			mkdirSync(outputDir, { recursive: true });
			const existingPath = join(outputDir, existingFile);
			writeFileSync(existingPath, "existing diagnostic content", "utf8");

			const process = Bun.spawn({
				cmd: [
					"node",
					releaseSmokeScriptPath,
					"--skip-build",
					"--output-dir",
					outputDir,
					"--no-keep-assets",
				],
				cwd: repoRoot,
				stdout: "pipe",
				stderr: "pipe",
			});

			const exitCode = await process.exited;
			const stderr = await new Response(process.stderr).text();
			expect(exitCode).toBe(1);
			expect(stderr).toContain(
				"refuses to overwrite existing release-smoke output files",
			);
			expect(readFileSync(existingPath, "utf8")).toBe(
				"existing diagnostic content",
			);
			const siblingFile =
				existingFile === "release-smoke-evidence.json"
					? "manual-live-opencode-checklist.md"
					: "release-smoke-evidence.json";
			expect(existsSync(join(outputDir, siblingFile))).toBe(false);
		}
	});

	test("disposable release-smoke cleanup retains diagnostic evidence", async () => {
		ensureBuiltDist();
		const tempRoot = makeTempDir();
		const outputDir = join(tempRoot, "release-smoke");

		const process = Bun.spawn({
			cmd: [
				"node",
				releaseSmokeScriptPath,
				"--skip-build",
				"--output-dir",
				outputDir,
				"--no-keep-assets",
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();
		if (exitCode !== 0) {
			throw new Error(`release smoke failed: ${stderr}`);
		}
		expect(exitCode).toBe(0);

		for (const file of [
			"opencode-smoke-evidence.json",
			"opencode-smoke-evidence.md",
			"manual-live-opencode-checklist.md",
			"release-smoke-evidence.json",
		]) {
			expect(existsSync(join(outputDir, file))).toBe(true);
		}
		for (const file of [
			"flow.js",
			"flow.js.sha256",
			"flow-skills.tar.gz",
			"install.sh",
			"uninstall.sh",
		]) {
			expect(existsSync(join(outputDir, file))).toBe(false);
		}

		const releaseEvidence = JSON.parse(
			readFileSync(join(outputDir, "release-smoke-evidence.json"), "utf8"),
		);
		expect(releaseEvidence.status).toBe("passed");
		expect(releaseEvidence.manualLiveOpenCodeRequired).toBe(true);
		expect(releaseEvidence.manualLiveOpenCodeCompleted).toBe(false);
		expect(releaseEvidence.automatedSmoke.realOpenCodeCliInvoked).toBe(false);
		expect(releaseEvidence.assetRetention).toEqual({
			disposableAssetsRetained: false,
			evidenceFilesRetained: true,
		});
	});

	test("release-smoke failure evidence includes child smoke evidence paths", async () => {
		ensureBuiltDist();
		const tempRoot = makeTempDir();
		const outputDir = join(tempRoot, "release-smoke");
		const binDir = join(tempRoot, "bin");
		mkdirSync(binDir, { recursive: true });
		const curlPath = join(binDir, "curl");
		writeFileSync(
			curlPath,
			"#!/usr/bin/env bash\necho stub curl failure >&2\nexit 42\n",
			"utf8",
		);
		chmodSync(curlPath, 0o755);

		const smokeProcess = Bun.spawn({
			cmd: [
				"node",
				releaseSmokeScriptPath,
				"--skip-build",
				"--output-dir",
				outputDir,
			],
			cwd: repoRoot,
			env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await smokeProcess.exited;
		expect(exitCode).toBe(1);
		const opencodeEvidencePath = join(
			outputDir,
			"opencode-smoke-evidence.json",
		);
		const opencodeSummaryPath = join(outputDir, "opencode-smoke-evidence.md");
		const releaseEvidencePath = join(outputDir, "release-smoke-evidence.json");
		expect(existsSync(opencodeEvidencePath)).toBe(true);
		expect(existsSync(releaseEvidencePath)).toBe(true);

		const opencodeEvidence = JSON.parse(
			readFileSync(opencodeEvidencePath, "utf8"),
		);
		expect(opencodeEvidence.status).toBe("failed");
		const releaseEvidence = JSON.parse(
			readFileSync(releaseEvidencePath, "utf8"),
		);
		expect(releaseEvidence.status).toBe("failed");
		expect(releaseEvidence.automatedSmoke.evidenceJson).toBe(
			opencodeEvidencePath,
		);
		expect(releaseEvidence.automatedSmoke.evidenceSummary).toBe(
			opencodeSummaryPath,
		);
		expect(releaseEvidence.manualLiveOpenCodeRequired).toBe(true);
		expect(releaseEvidence.manualLiveOpenCodeCompleted).toBe(false);
	});

	test("default release-smoke refreshes generated files in a reusable output directory", async () => {
		ensureBuiltDist();
		const tempRoot = makeTempDir();
		const outputDir = join(tempRoot, "release-smoke");
		mkdirSync(outputDir, { recursive: true });
		for (const file of [
			"flow.js",
			"flow.js.sha256",
			"flow-skills.tar.gz",
			"install.sh",
			"uninstall.sh",
			"opencode-smoke-evidence.json",
			"opencode-smoke-evidence.md",
			"manual-live-opencode-checklist.md",
			"release-smoke-evidence.json",
		]) {
			writeFileSync(join(outputDir, file), "stale reusable output", "utf8");
		}

		const process = Bun.spawn({
			cmd: [
				"node",
				releaseSmokeScriptPath,
				"--skip-build",
				"--output-dir",
				outputDir,
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();
		if (exitCode !== 0) {
			throw new Error(`release smoke failed: ${stderr}`);
		}
		expect(exitCode).toBe(0);
		for (const file of [
			"flow.js",
			"flow.js.sha256",
			"flow-skills.tar.gz",
			"install.sh",
			"uninstall.sh",
			"opencode-smoke-evidence.json",
			"opencode-smoke-evidence.md",
			"manual-live-opencode-checklist.md",
			"release-smoke-evidence.json",
		]) {
			expect(readFileSync(join(outputDir, file), "utf8")).not.toBe(
				"stale reusable output",
			);
		}
		const releaseEvidence = JSON.parse(
			readFileSync(join(outputDir, "release-smoke-evidence.json"), "utf8"),
		);
		expect(releaseEvidence.status).toBe("passed");
		expect(releaseEvidence.assetRetention).toEqual({
			disposableAssetsRetained: true,
			evidenceFilesRetained: true,
		});
	});

	test("prepares a reusable release-smoke asset path without automating live OpenCode", async () => {
		ensureBuiltDist();
		const tempRoot = makeTempDir();
		const outputDir = join(tempRoot, "release-smoke");

		const process = Bun.spawn({
			cmd: [
				"node",
				releaseSmokeScriptPath,
				"--skip-build",
				"--output-dir",
				outputDir,
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();
		if (exitCode !== 0) {
			throw new Error(`release smoke failed: ${stderr}`);
		}
		expect(exitCode).toBe(0);

		const expectedFiles = [
			"flow.js",
			"flow.js.sha256",
			"flow-skills.tar.gz",
			"install.sh",
			"uninstall.sh",
			"opencode-smoke-evidence.json",
			"opencode-smoke-evidence.md",
			"manual-live-opencode-checklist.md",
			"release-smoke-evidence.json",
		];
		for (const file of expectedFiles) {
			expect(existsSync(join(outputDir, file))).toBe(true);
		}

		const opencodeEvidence = JSON.parse(
			readFileSync(join(outputDir, "opencode-smoke-evidence.json"), "utf8"),
		);
		expect(opencodeEvidence.status).toBe("passed");
		expect(opencodeEvidence.releaseInstall.assetSource).toBe(
			"explicit-or-mixed",
		);
		expect(opencodeEvidence.hostBoundary.realOpenCodeCliInvoked).toBe(false);
		expect(opencodeEvidence.hostBoundary.manualLiveOpenCodeRequired).toBe(true);

		const releaseEvidence = JSON.parse(
			readFileSync(join(outputDir, "release-smoke-evidence.json"), "utf8"),
		);
		expect(releaseEvidence.status).toBe("passed");
		expect(releaseEvidence.manualLiveOpenCodeRequired).toBe(true);
		expect(releaseEvidence.manualLiveOpenCodeCompleted).toBe(false);
		expect(releaseEvidence.automatedSmoke.realOpenCodeCliInvoked).toBe(false);
		for (const path of [
			releaseEvidence.assets.flowJs,
			releaseEvidence.assets.flowJsSha256,
			releaseEvidence.assets.skillBundle,
			releaseEvidence.assets.installScript,
			releaseEvidence.assets.uninstallScript,
			releaseEvidence.automatedSmoke.evidenceJson,
			releaseEvidence.automatedSmoke.evidenceSummary,
			releaseEvidence.manualLiveOpenCodeChecklist,
		]) {
			expect(path.startsWith(outputDir)).toBe(true);
		}

		const checksum = readFileSync(join(outputDir, "flow.js.sha256"), "utf8");
		expect(checksum).toMatch(/^[a-f0-9]{64} {2}flow\.js\n$/);

		const checklist = readFileSync(
			join(outputDir, "manual-live-opencode-checklist.md"),
			"utf8",
		);
		expect(checklist).toContain("not automated evidence");
		expect(checklist).toContain("/flow-doctor detail");
		expect(checklist).toContain("/flow-plan Live smoke");
		expect(checklist).toContain("/flow-status detail");
		expect(checklist).toContain("/flow-session close abandoned");
	});
});
