#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageJson = JSON.parse(
	readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const distPath = join(projectRoot, "dist", "index.js");
const defaultOutputDir = join(projectRoot, "prompt-exports", "release-smoke");
const releaseInstallScript = join(projectRoot, "scripts", "release-install.sh");
const releaseUninstallScript = join(
	projectRoot,
	"scripts",
	"release-uninstall.sh",
);
const skillBundleWriter = join(
	projectRoot,
	"scripts",
	"cross-area",
	"write-release-skill-bundle.ts",
);
const opencodeSmokeScript = join(
	projectRoot,
	"scripts",
	"cross-area",
	"opencode-smoke.mjs",
);

function parseArgs(argv) {
	const options = {
		outputDir: defaultOutputDir,
		skipBuild: false,
		keepAssets: true,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--output-dir") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--output-dir requires a path.");
			}
			options.outputDir = resolve(value);
			index += 1;
			continue;
		}
		if (arg === "--skip-build") {
			options.skipBuild = true;
			continue;
		}
		if (arg === "--keep-assets") {
			options.keepAssets = true;
			continue;
		}
		if (arg === "--no-keep-assets") {
			options.keepAssets = false;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? projectRoot,
		env: options.env ?? process.env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed with exit ${result.status}: ${result.stderr || result.stdout}`,
		);
	}
	return result;
}

function ensureFile(path, label) {
	if (!existsSync(path)) {
		throw new Error(`Missing ${label}: ${path}`);
	}
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeSha256(path, assetPath) {
	writeFileSync(
		path,
		`${sha256File(assetPath)}  ${relative(dirname(path), assetPath)}\n`,
		"utf8",
	);
}

function writeManualChecklist(path, outputDir) {
	writeFileSync(
		path,
		[
			"# Manual live OpenCode validation checklist",
			"",
			"This checklist is a template only. It is not automated evidence and does not mean live OpenCode validation has been completed.",
			"",
			`- Candidate package version: ${packageJson.version}`,
			`- Local asset directory: ${outputDir}`,
			"- Manual live OpenCode completed: false",
			"",
			"## Steps",
			"",
			"1. Install the candidate using `install.sh` from the local asset directory with `FLOW_RELEASE_DOWNLOAD_URL=file://.../flow.js` and `FLOW_RELEASE_SKILL_BUNDLE_URL=file://.../flow-skills.tar.gz`, or use the matching post-tag release install script.",
			"2. Open real OpenCode in a disposable project.",
			"3. Run `/flow-doctor detail`.",
			"4. Run `/flow-plan Live smoke: verify Flow can create a plan in OpenCode`.",
			"5. Run `/flow-status detail`.",
			"6. Run `/flow-session close abandoned`.",
			"7. Uninstall with `uninstall.sh` from the local asset directory, or the matching release uninstall script.",
			"",
			"## Evidence to record manually",
			"",
			"- Date/operator:",
			"- OpenCode version/provider if known:",
			"- Candidate version/tag:",
			"- Disposable project path/name:",
			"- Pass/fail:",
			"- Observed plugin/UI errors:",
			"- `.flow/**` isolation result:",
			"",
		].join("\n"),
		"utf8",
	);
}

class PreflightRefusalError extends Error {}

function releaseSmokeDisposableAssetFiles(outputDir) {
	return [
		"flow.js",
		"flow.js.sha256",
		"flow-skills.tar.gz",
		"install.sh",
		"uninstall.sh",
	].map((file) => join(outputDir, file));
}

function releaseSmokeEvidenceFiles(outputDir) {
	return [
		"opencode-smoke-evidence.json",
		"opencode-smoke-evidence.md",
		"manual-live-opencode-checklist.md",
		"release-smoke-evidence.json",
	].map((file) => join(outputDir, file));
}

function releaseSmokeOutputFiles(outputDir) {
	return [
		...releaseSmokeDisposableAssetFiles(outputDir),
		...releaseSmokeEvidenceFiles(outputDir),
	];
}

function opencodeSmokeEvidencePaths(outputDir) {
	return {
		jsonPath: join(outputDir, "opencode-smoke-evidence.json"),
		summaryPath: join(outputDir, "opencode-smoke-evidence.md"),
	};
}

function cleanupGeneratedFiles(paths) {
	for (const path of paths) {
		rmSync(path, { force: true });
	}
}

function prepareAssets(outputDir, options) {
	mkdirSync(outputDir, { recursive: true });
	if (!options.skipBuild) {
		run("bun", ["run", "build"]);
	}
	ensureFile(
		distPath,
		"dist/index.js; run bun run build first or omit --skip-build",
	);

	const flowJsPath = join(outputDir, "flow.js");
	const checksumPath = join(outputDir, "flow.js.sha256");
	const skillBundlePath = join(outputDir, "flow-skills.tar.gz");
	const installScriptPath = join(outputDir, "install.sh");
	const uninstallScriptPath = join(outputDir, "uninstall.sh");
	const bundleRoot = mkdtempSync(join(tmpdir(), "flow-release-smoke-skills-"));

	try {
		copyFileSync(distPath, flowJsPath);
		copyFileSync(releaseInstallScript, installScriptPath);
		copyFileSync(releaseUninstallScript, uninstallScriptPath);
		run("bun", ["run", skillBundleWriter, bundleRoot]);
		run("tar", ["-czf", skillBundlePath, "-C", bundleRoot, ".config"]);
		writeSha256(checksumPath, flowJsPath);
	} finally {
		rmSync(bundleRoot, { recursive: true, force: true });
	}

	return {
		flowJsPath,
		checksumPath,
		skillBundlePath,
		installScriptPath,
		uninstallScriptPath,
	};
}

function runOpenCodeSmoke(assets, smokePaths) {
	run("node", [
		opencodeSmokeScript,
		"--skip-build",
		"--flow-js",
		assets.flowJsPath,
		"--skill-bundle",
		assets.skillBundlePath,
		"--install-script",
		assets.installScriptPath,
		"--uninstall-script",
		assets.uninstallScriptPath,
		"--json",
		smokePaths.jsonPath,
		"--summary",
		smokePaths.summaryPath,
	]);
}

function createReleaseEvidence(
	outputDir,
	assets,
	smokePaths,
	smokeEvidence,
	options,
) {
	const checklistPath = join(outputDir, "manual-live-opencode-checklist.md");
	return {
		schemaVersion: 1,
		status: smokeEvidence.status === "passed" ? "passed" : "failed",
		generatedAt: new Date().toISOString(),
		packageVersion: packageJson.version,
		assetDirectory: outputDir,
		assets: {
			flowJs: assets.flowJsPath,
			flowJsSha256: assets.checksumPath,
			skillBundle: assets.skillBundlePath,
			installScript: assets.installScriptPath,
			uninstallScript: assets.uninstallScriptPath,
		},
		automatedSmoke: {
			status: smokeEvidence.status,
			evidenceJson: smokePaths.jsonPath,
			evidenceSummary: smokePaths.summaryPath,
			realOpenCodeCliInvoked:
				smokeEvidence.hostBoundary?.realOpenCodeCliInvoked === true,
		},
		manualLiveOpenCodeRequired: true,
		manualLiveOpenCodeCompleted: false,
		manualLiveOpenCodeChecklist: checklistPath,
		assetRetention: {
			disposableAssetsRetained: options.keepAssets,
			evidenceFilesRetained: true,
		},
	};
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const outputDir = options.outputDir;
	const releaseEvidencePath = join(outputDir, "release-smoke-evidence.json");
	let assets;
	let smokePaths;
	let smokeEvidence;
	let cleanupFiles = [];
	try {
		if (!options.keepAssets) {
			const plannedCleanupFiles = releaseSmokeOutputFiles(outputDir);
			const existingGeneratedPaths = plannedCleanupFiles.filter((path) =>
				existsSync(path),
			);
			if (existingGeneratedPaths.length > 0) {
				throw new PreflightRefusalError(
					`--no-keep-assets refuses to overwrite existing release-smoke output files: ${existingGeneratedPaths.join(", ")}`,
				);
			}
			cleanupFiles = releaseSmokeDisposableAssetFiles(outputDir);
		}
		assets = prepareAssets(outputDir, options);
		smokePaths = opencodeSmokeEvidencePaths(outputDir);
		runOpenCodeSmoke(assets, smokePaths);
		smokeEvidence = JSON.parse(readFileSync(smokePaths.jsonPath, "utf8"));
		writeManualChecklist(
			join(outputDir, "manual-live-opencode-checklist.md"),
			outputDir,
		);
		const releaseEvidence = createReleaseEvidence(
			outputDir,
			assets,
			smokePaths,
			smokeEvidence,
			options,
		);
		writeJson(releaseEvidencePath, releaseEvidence);
		console.log(JSON.stringify(releaseEvidence, null, 2));
		if (releaseEvidence.status !== "passed") {
			process.exitCode = 1;
		}
	} catch (error) {
		if (error instanceof PreflightRefusalError) {
			console.error(error.message);
			process.exitCode = 1;
			return;
		}
		if (smokePaths && !smokeEvidence && existsSync(smokePaths.jsonPath)) {
			try {
				smokeEvidence = JSON.parse(readFileSync(smokePaths.jsonPath, "utf8"));
			} catch {
				// Keep wrapper failure evidence useful even when child evidence is malformed.
			}
		}
		const failedEvidence = {
			schemaVersion: 1,
			status: "failed",
			generatedAt: new Date().toISOString(),
			packageVersion: packageJson.version,
			assetDirectory: outputDir,
			assets: assets
				? {
						flowJs: assets.flowJsPath,
						flowJsSha256: assets.checksumPath,
						skillBundle: assets.skillBundlePath,
						installScript: assets.installScriptPath,
						uninstallScript: assets.uninstallScriptPath,
					}
				: undefined,
			automatedSmoke: smokePaths
				? {
						status: smokeEvidence?.status ?? "failed",
						evidenceJson: smokePaths.jsonPath,
						evidenceSummary: smokePaths.summaryPath,
						realOpenCodeCliInvoked:
							smokeEvidence?.hostBoundary?.realOpenCodeCliInvoked === true,
					}
				: undefined,
			manualLiveOpenCodeRequired: true,
			manualLiveOpenCodeCompleted: false,
			manualLiveOpenCodeChecklist: join(
				outputDir,
				"manual-live-opencode-checklist.md",
			),
			assetRetention: {
				disposableAssetsRetained: options.keepAssets,
				evidenceFilesRetained: true,
			},
			failure: {
				message: error instanceof Error ? error.message : String(error),
			},
		};
		mkdirSync(outputDir, { recursive: true });
		writeManualChecklist(
			join(outputDir, "manual-live-opencode-checklist.md"),
			outputDir,
		);
		writeJson(releaseEvidencePath, failedEvidence);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		if (!options.keepAssets) {
			cleanupGeneratedFiles(cleanupFiles);
		}
	}
}

await main();
