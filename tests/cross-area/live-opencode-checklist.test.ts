import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const scriptPath = join(
	import.meta.dir,
	"..",
	"..",
	"scripts",
	"cross-area",
	"live-opencode-checklist.mjs",
);
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "flow-live-checklist-"));
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

describe("live OpenCode checklist script", () => {
	test("writes a checklist without claiming live validation happened", async () => {
		const directory = makeTempDir();
		const output = join(directory, "checklist.md");
		const process = Bun.spawn({
			cmd: [
				"node",
				scriptPath,
				"--output",
				output,
				"--version",
				"9.8.7",
				"--tarball",
				"/tmp/flow.tgz",
			],
			cwd: repoRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		expect(await process.exited).toBe(0);
		const checklist = readFileSync(output, "utf8");
		expect(checklist).toContain("Version under test: 9.8.7");
		expect(checklist).toContain("Install spec: /tmp/flow.tgz");
		expect(checklist).toContain("It is not proof of live validation");
		expect(checklist).toContain("/flow-status");
		expect(checklist).not.toContain("/flow-doctor");
	});
});
