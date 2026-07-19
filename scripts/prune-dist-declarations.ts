import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { PUBLIC_DECLARATION_PATHS } from "./lib/package-surface.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const distributionRoot = join(repositoryRoot, "dist");
const allowed = new Set<string>(PUBLIC_DECLARATION_PATHS);
const declarations = (
	await readdir(distributionRoot, { recursive: true, withFileTypes: true })
)
	.filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
	.map((entry) => join(entry.parentPath, entry.name));

const relativePath = (path: string): string =>
	relative(repositoryRoot, path).split(sep).join("/");
const emitted = new Set(declarations.map(relativePath));

for (const expected of allowed) {
	if (!emitted.has(expected)) {
		throw new Error(
			`TypeScript did not emit required declaration '${expected}'.`,
		);
	}
}

const unsupported = declarations.filter(
	(path) => !allowed.has(relativePath(path)),
);
await Promise.all(unsupported.map((path) => rm(path)));

process.stdout.write(
	`Kept ${allowed.size} public declarations and pruned ${unsupported.length} internal declarations.\n`,
);
