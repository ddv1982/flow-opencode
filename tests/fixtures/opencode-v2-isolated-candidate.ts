import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

export async function isolatedCandidate(root: string) {
	const repository = resolve(import.meta.dir, "../..");
	const snapshot = join(root, "source");
	await rm(snapshot, { recursive: true, force: true });
	await mkdir(snapshot, { recursive: true });
	for (const path of [
		"src",
		"skills",
		"scripts",
		"package.json",
		"tsconfig.json",
		"tsconfig.types.json",
		"LICENSE",
		"README.md",
		"CHANGELOG.md",
	])
		await cp(join(repository, path), join(snapshot, path), { recursive: true });
	await symlink(
		join(repository, "node_modules"),
		join(snapshot, "node_modules"),
		"dir",
	);
	const sourceFiles = [
		...(await readdir(join(snapshot, "src"), { recursive: true })),
		...(await readdir(join(snapshot, "skills"), { recursive: true }).then(
			(paths) => paths.map((path) => `../skills/${path}`),
		)),
	].sort();
	const hash = createHash("sha256");
	for (const path of sourceFiles) {
		try {
			hash.update(path);
			hash.update(await readFile(join(snapshot, "src", path)));
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "EISDIR")
			)
				throw error;
		}
	}
	const sourceSha256 = `sha256:${hash.digest("hex")}`;
	await writeFile(join(root, "npm-userconfig"), "");
	await writeFile(join(root, "npm-globalconfig"), "");
	const environment = {
		PATH: process.env.PATH,
		HOME: root,
		npm_config_userconfig: join(root, "npm-userconfig"),
		npm_config_globalconfig: join(root, "npm-globalconfig"),
		npm_config_offline: "true",
	};
	const run = (command: string, args: string[]) => {
		const result = spawnSync(command, args, {
			cwd: snapshot,
			env: environment,
			encoding: "utf8",
		});
		if (result.status !== 0)
			throw new Error(
				`Isolated candidate command failed. ${result.stderr || result.stdout}`,
			);
		return result.stdout;
	};
	const externals = [
		"@opencode/plugin",
		"@opencode/schema",
		"@opencode/client",
		"effect",
	].map((name) => `--external=${name}`);
	run(process.execPath, [
		"build",
		"--target=node",
		"--outdir=dist",
		"--entry-naming=index.js",
		"--external=zod",
		...externals,
		"--sourcemap=external",
		"src/index.ts",
	]);
	run(process.execPath, [
		"build",
		"--target=bun",
		"--outdir=dist",
		"--entry-naming=tui.js",
		...externals,
		"--sourcemap=external",
		"src/tui.ts",
	]);
	run(process.execPath, [
		join(repository, "node_modules/typescript/bin/tsc"),
		"-p",
		"tsconfig.types.json",
	]);
	run(process.execPath, ["scripts/prune-dist-declarations.ts"]);
	const packed: unknown = JSON.parse(
		run("npm", [
			"pack",
			"--ignore-scripts",
			"--json",
			"--pack-destination",
			root,
		]),
	);
	if (!Array.isArray(packed) || typeof packed[0]?.filename !== "string")
		throw new Error("Isolated pack returned no archive");
	const tarball = join(root, packed[0].filename);
	const cache = join(root, "cache");
	const modules = join(cache, "node_modules");
	await mkdir(modules, { recursive: true });
	const extracted = join(root, "extracted");
	await mkdir(extracted);
	const extraction = spawnSync("tar", ["-xzf", tarball, "-C", extracted], {
		encoding: "utf8",
	});
	if (extraction.status !== 0)
		throw new Error("Isolated candidate extraction failed");
	await cp(join(extracted, "package"), join(modules, "opencode-plugin-flow"), {
		recursive: true,
	});
	await symlink(
		join(repository, "node_modules"),
		join(modules, "opencode-plugin-flow", "node_modules"),
		"dir",
	);
	await writeFile(
		join(root, "candidate.json"),
		`${JSON.stringify({ tarball, packageCache: cache, sourceSha256, authority: "isolated runtime candidate; parent owns authoritative build" }, null, 2)}\n`,
	);
	return { tarball, packageCache: cache, sourceSha256 };
}
if (import.meta.main) {
	const root = process.argv[2];
	if (!root) throw new Error("Expected isolated output directory");
	console.log(JSON.stringify(await isolatedCandidate(resolve(root))));
}
