import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readQualificationBundle } from "../evals/qualification-bundle.js";
import { materializeQualificationArchive } from "./materialize-qualification.js";

const VERSION = "9.4.0";
const TARBALL = `opencode-plugin-flow-${VERSION}.tgz`;
const ARTIFACT_SHA256 =
	"sha256:e74135581934ca8b53068ea8192a3216112ddf976ff47d3b228f8a93ac3cb5fe";
function run(
	[command, ...args]: readonly [string, ...string[]],
	cwd: string,
): string {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	}).trim();
}

export async function prepareQualifiedRelease940(input: {
	readonly repositoryRoot: string;
	readonly outputPath: string;
}): Promise<string> {
	if (process.versions.bun !== "1.4.0")
		throw new Error("Qualified preparation requires Bun 1.4.0.");
	const repositoryRoot = await realpath(input.repositoryRoot),
		outputPath = resolve(input.outputPath);
	if (basename(outputPath) !== TARBALL)
		throw new Error(`Output must be named ${TARBALL}.`);
	try {
		await lstat(outputPath);
		throw new Error("Qualified artifact output already exists.");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const commit = run(["git", "rev-parse", "HEAD"], repositoryRoot);
	const metadata = JSON.parse(
		run(["git", "show", `${commit}:package.json`], repositoryRoot),
	) as { version?: unknown; packageManager?: unknown };
	if (metadata.version !== VERSION || metadata.packageManager !== "bun@1.4.0")
		throw new Error(
			"Qualified preparation requires package version 9.4.0 and bun@1.4.0.",
		);
	if (
		run(
			["git", "status", "--porcelain", "--untracked-files=all"],
			repositoryRoot,
		)
	)
		throw new Error("Qualified preparation requires a clean Git checkout.");
	const root = await mkdtemp(join(tmpdir(), "flow-qualified-release-940-"));
	try {
		const bundle = await materializeQualificationArchive({
			descriptorPath: join(
				repositoryRoot,
				"evals/qualification/archives/9.4.0.json",
			),
			outputRoot: join(root, "bundles"),
		});
		const { manifest } = await readQualificationBundle(bundle);
		const artifact = manifest.files.find((file) => file.role === "artifact");
		if (
			manifest.packageVersion !== VERSION ||
			artifact?.sha256 !== ARTIFACT_SHA256
		)
			throw new Error("Archive does not contain the qualified 9.4.0 artifact.");
		const sourceArchive = join(root, "source.tar"),
			candidate = join(root, "flow-worktrees/candidate");
		await mkdir(candidate, { recursive: true, mode: 0o700 });
		run(
			["git", "archive", "--format=tar", "--output", sourceArchive, commit],
			repositoryRoot,
		);
		run(["tar", "-xf", sourceArchive, "-C", candidate], repositoryRoot);
		run([process.execPath, "install", "--frozen-lockfile"], candidate);
		await mkdir(join(root, "flow-opencode"), { mode: 0o700 });
		await rename(
			join(candidate, "node_modules"),
			join(root, "flow-opencode/node_modules"),
		);
		await symlink(
			"../../flow-opencode/node_modules",
			join(candidate, "node_modules"),
			"dir",
		);
		run([process.execPath, "run", "build"], candidate);
		run([process.execPath, "pm", "pack", "--destination", root], candidate);
		const rebuilt = join(root, TARBALL);
		run(
			[
				process.execPath,
				"run",
				join(candidate, "scripts/restore-exact-release-artifact.ts"),
				rebuilt,
				join(bundle, artifact.object),
				ARTIFACT_SHA256,
			],
			candidate,
		);
		if (
			run(["git", "rev-parse", "HEAD"], repositoryRoot) !== commit ||
			run(
				["git", "status", "--porcelain", "--untracked-files=all"],
				repositoryRoot,
			)
		)
			throw new Error("Source checkout changed during qualified preparation.");
		await mkdir(dirname(outputPath), { recursive: true });
		await copyFile(rebuilt, outputPath, constants.COPYFILE_EXCL);
		return outputPath;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const options = new Map<string, string>(),
		args = process.argv.slice(2);
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index],
			value = args[index + 1];
		if (
			(key !== "--repository-root" && key !== "--out") ||
			!value ||
			options.has(key)
		)
			throw new Error(
				"Usage: prepare-qualified-release-940 [--repository-root <checkout>] --out <tarball>",
			);
		options.set(key, value);
	}
	const outputPath = options.get("--out");
	if (!outputPath) throw new Error("--out is required.");
	const prepared = await prepareQualifiedRelease940({
		repositoryRoot: options.get("--repository-root") ?? process.cwd(),
		outputPath,
	});
	console.log(
		`Prepared qualified ${VERSION} artifact ${ARTIFACT_SHA256} at ${prepared}.`,
	);
}
