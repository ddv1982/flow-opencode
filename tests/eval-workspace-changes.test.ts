import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ScenarioGradeInputSchema } from "../evals/grader-input.js";
import {
	captureWorkspaceSnapshot,
	observeReviewDocument,
	observeWorkspaceChanges,
} from "../evals/harness.js";
import { redactTranscript } from "../evals/provenance.js";

const workspace = () => mkdtempSync(join(tmpdir(), "flow-workspace-observe-"));
const write = (root: string, path: string, content: string) => {
	const target = join(root, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
};
const git = (root: string, ...args: string[]) => {
	const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
	return result.stdout.trim();
};
const init = (root: string) => {
	git(root, "init", "-q");
	git(root, "config", "user.email", "fixture@example.invalid");
	git(root, "config", "user.name", "Fixture");
};

test("host snapshot observes edits, untracked files, deletions, and both sides of a rename", async () => {
	const root = workspace();
	try {
		init(root);
		write(root, "src/count.ts", "old\n");
		write(root, "src/deleted.ts", "old\n");
		write(root, "src/renamed.ts", "old\n");
		write(root, "src/build/rule.ts", "old\n");
		write(root, "opencode.json", "host config\n");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "baseline");
		const baseline = await captureWorkspaceSnapshot(root);
		write(root, "docs/codebase-review.md", "Roadmap\n");
		write(root, "src/count.ts", "changed\n");
		write(root, "src/build/rule.ts", "changed\n");
		unlinkSync(join(root, "src/deleted.ts"));
		renameSync(join(root, "src/renamed.ts"), join(root, "src/moved.ts"));
		write(root, "src/new.ts", "new\n");
		write(root, ".flow/session.json", "{}\n");
		write(root, ".opencode/package.json", "{}\n");
		write(root, "dist/index.js", "generated\n");
		expect(await observeWorkspaceChanges(root, baseline)).toEqual({
			kind: "observed",
			paths: [
				"docs",
				"docs/codebase-review.md",
				"src/build/rule.ts",
				"src/count.ts",
				"src/deleted.ts",
				"src/moved.ts",
				"src/new.ts",
				"src/renamed.ts",
			],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host snapshot observes a Bash edit committed before the outcome", async () => {
	const root = workspace();
	try {
		init(root);
		write(root, "src/count.ts", "old\n");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "baseline");
		const baseline = await captureWorkspaceSnapshot(root);
		write(root, "src/count.ts", "changed by Bash\n");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "manager edit");
		expect(git(root, "status", "--porcelain")).toBe("");
		expect(await observeWorkspaceChanges(root, baseline)).toEqual({
			kind: "observed",
			paths: ["src/count.ts"],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host snapshot ignores Git index flags and excludes while detecting host config edits", async () => {
	const root = workspace();
	try {
		init(root);
		write(root, "src/count.ts", "old\n");
		write(root, "opencode.json", "host config\n");
		git(root, "add", "-A");
		git(root, "commit", "-qm", "baseline");
		const baseline = await captureWorkspaceSnapshot(root);
		git(root, "update-index", "--assume-unchanged", "src/count.ts");
		write(root, "src/count.ts", "hidden edit\n");
		write(root, ".git/info/exclude", "src/new.ts\n");
		write(root, "src/new.ts", "ignored product file\n");
		write(root, "opencode.json", "edited config\n");
		expect(await observeWorkspaceChanges(root, baseline)).toEqual({
			kind: "observed",
			paths: ["opencode.json", "src/count.ts", "src/new.ts"],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host snapshot compares file mode and symlink target without following links", async () => {
	const root = workspace();
	try {
		write(root, "src/count.ts", "one\n");
		write(root, "src/other.ts", "two\n");
		symlinkSync("count.ts", join(root, "src/link.ts"));
		const baseline = await captureWorkspaceSnapshot(root);
		chmodSync(join(root, "src/count.ts"), 0o755);
		unlinkSync(join(root, "src/link.ts"));
		symlinkSync("other.ts", join(root, "src/link.ts"));
		expect(await observeWorkspaceChanges(root, baseline)).toEqual({
			kind: "observed",
			paths: ["src/count.ts", "src/link.ts"],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host snapshot observes directory chmod and empty directory changes", async () => {
	const root = workspace();
	try {
		write(root, "src/count.ts", "one\n");
		mkdirSync(join(root, "old-empty"));
		const baseline = await captureWorkspaceSnapshot(root);
		chmodSync(join(root, "src"), 0o700);
		rmSync(join(root, "old-empty"), { recursive: true });
		mkdirSync(join(root, "new-empty"));
		expect(await observeWorkspaceChanges(root, baseline)).toEqual({
			kind: "observed",
			paths: ["new-empty", "old-empty", "src"],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host marks failed snapshots unavailable", async () => {
	const root = workspace();
	const baseline = await captureWorkspaceSnapshot(root);
	rmSync(root, { recursive: true, force: true });
	expect(await observeWorkspaceChanges(root, baseline)).toEqual({
		kind: "unavailable",
		reason: "workspace-snapshot-failed",
	});
});

test("host retains only the bounded regular review document bound to its snapshot", async () => {
	const root = workspace();
	try {
		const content = "# Findings\n\ninclusiveRangeLength is off-by-one.\n";
		write(root, "docs/codebase-review.md", content);
		const current = await captureWorkspaceSnapshot(root);
		expect(await observeReviewDocument(root, current)).toEqual({
			kind: "observed",
			content,
			sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
		});
		write(root, "docs/codebase-review.md", "changed after snapshot\n");
		expect(await observeReviewDocument(root, current)).toEqual({
			kind: "unavailable",
			reason: "review-document-changed-after-snapshot",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host fails closed on symlink, oversize, and invalid UTF-8 review documents", async () => {
	const root = workspace();
	try {
		write(root, "src/count.ts", "source\n");
		mkdirSync(join(root, "docs"));
		symlinkSync("../src/count.ts", join(root, "docs/codebase-review.md"));
		expect(
			(await observeReviewDocument(root, await captureWorkspaceSnapshot(root)))
				.kind,
		).toBe("unavailable");
		unlinkSync(join(root, "docs/codebase-review.md"));
		write(root, "docs/codebase-review.md", "x".repeat(64 * 1024 + 1));
		expect(
			(await observeReviewDocument(root, await captureWorkspaceSnapshot(root)))
				.kind,
		).toBe("unavailable");
		writeFileSync(join(root, "docs/codebase-review.md"), Buffer.from([0xff]));
		expect(
			(await observeReviewDocument(root, await captureWorkspaceSnapshot(root)))
				.kind,
		).toBe("unavailable");
		write(
			root,
			"docs/codebase-review.md",
			"credential: sk-proj-ABCDEFGHIJKLMNOPQRST\n",
		);
		expect(
			(await observeReviewDocument(root, await captureWorkspaceSnapshot(root)))
				.kind,
		).toBe("unavailable");
		for (const key of [
			"GH_TOKEN",
			"NPM_TOKEN",
			"TOKEN",
			"PASSWORD",
			"API_KEY",
			"KEY",
		]) {
			write(root, "docs/codebase-review.md", `${key}=synthetic-value-123456\n`);
			expect(
				await observeReviewDocument(root, await captureWorkspaceSnapshot(root)),
			).toEqual({
				kind: "unavailable",
				reason: "review-document-not-safe-to-retain",
			});
		}
		for (const content of [
			"https://example.com/?token=synthetic-value-1234567890\n",
			"https://example.com/#GH_TOKEN=synthetic-value-1234567890\n",
		]) {
			write(root, "docs/codebase-review.md", content);
			expect(
				await observeReviewDocument(root, await captureWorkspaceSnapshot(root)),
			).toEqual({
				kind: "unavailable",
				reason: "review-document-not-safe-to-retain",
			});
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("host rejects review text that transcript normalization would alter", async () => {
	const root = workspace();
	try {
		for (const content of [
			`Workspace: ${root}\n`,
			"Session: ses_ABC123DEF\n",
		]) {
			write(root, "docs/codebase-review.md", content);
			const observation = await observeReviewDocument(
				root,
				await captureWorkspaceSnapshot(root),
			);
			expect(observation).toEqual({
				kind: "unavailable",
				reason: "review-document-not-safe-to-retain",
			});
			const input = ScenarioGradeInputSchema.parse({
				schemaVersion: 1,
				flowCalls: [],
				allCalls: [],
				session: null,
				archives: [],
				reviewDocument: observation,
				finalText: "",
				providerErrors: [],
			});
			const retained = ScenarioGradeInputSchema.parse(
				JSON.parse(redactTranscript({ value: input, projectPath: root }).text),
			);
			expect(retained.reviewDocument).toEqual(observation);
			expect(JSON.stringify(retained)).not.toContain(content.trim());
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
