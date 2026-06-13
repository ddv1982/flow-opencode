import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"release-smoke.mjs",
);
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-release-smoke-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("release smoke wrapper", () => {
	test(
		"uses the retained candidate tarball for smoke evidence and the live checklist",
		async () => {
			const evidenceDir = makeTempDir();
			const process = Bun.spawn({
				cmd: ["node", scriptPath, "--skip-build", "--output-dir", evidenceDir],
				cwd: repoRoot,
				stdout: "pipe",
				stderr: "pipe",
			});

			expect(await process.exited).toBe(0);
			const candidateDir = join(evidenceDir, "candidate-tarball");
			const checklistPath = join(
				evidenceDir,
				"manual-live-opencode-checklist.md",
			);
			const evidencePath = join(evidenceDir, "opencode-smoke-evidence.json");
			const checklist = readFileSync(checklistPath, "utf8");
			const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));

			expect(existsSync(evidence.tarball)).toBe(true);
			expect(evidence.tarball).toStartWith(candidateDir);
			expect(checklist).toContain(`Install spec: ${evidence.tarball}`);
			expect(checklist).not.toContain("Install spec: opencode-plugin-flow@");
		},
		{ timeout: 60000 },
	);
});
