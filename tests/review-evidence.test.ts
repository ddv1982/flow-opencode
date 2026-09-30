import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import type { ReviewEvidencePacket } from "../src/application/ports/review-evidence.js";
import type {
	ExistingWork,
	ReviewEvidenceReference,
} from "../src/domain/session.js";
import { createFileReviewEvidenceProvider } from "../src/infrastructure/fs/review-evidence.js";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";

const exec = promisify(execFile);
const roots: string[] = [];
async function git(root: string, ...args: string[]) {
	return (await exec("git", ["-C", root, ...args])).stdout.trim();
}
async function repository(
	files: Record<string, string | Buffer> = {},
	objectFormat: "sha1" | "sha256" = "sha1",
) {
	const root = await mkdtemp(join(tmpdir(), "flow-evidence-test-"));
	roots.push(root);
	await git(root, "init", "--quiet", `--object-format=${objectFormat}`);
	await git(root, "config", "user.name", "Flow Test");
	await git(root, "config", "user.email", "flow@example.invalid");
	for (const [path, contents] of Object.entries(files))
		await writeFile(join(root, path), contents);
	if (Object.keys(files).length) {
		await git(root, "add", ".");
		await git(root, "commit", "--quiet", "-m", "base");
	}
	return root;
}
function digest(root: string) {
	return createFileSourceIdentityProvider(root).computeSourceDigest();
}
async function baseline(root: string, existingWork?: ExistingWork) {
	return createFileReviewEvidenceProvider(root).captureBaseline({
		sessionId: "session",
		featureId: "feature",
		originRunId: "original-run",
		sourceDigest: await digest(root),
		...(existingWork ? { existingWork } : {}),
	});
}
async function packet(
	root: string,
	reference: ReviewEvidenceReference,
	runId = "retry-run",
) {
	const provider = createFileReviewEvidenceProvider(root);
	const binding = {
		sessionId: "session",
		featureId: "feature",
		runId,
		sourceDigest: await digest(root),
	};
	const evidence = await provider.prepare({
		...binding,
		baseline: reference,
		declaredArtifacts: [],
		authorizedTargets: [],
	});
	return {
		provider,
		binding,
		evidence,
		value: await provider.read({ ...binding, reference: evidence }),
	};
}
function objectPath(root: string, reference: ReviewEvidenceReference) {
	return join(root, ".flow", "evidence", `${reference.sha256.slice(7)}.json`);
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

test("a retry sees the complete original diff with additions, deletions, and executable modes", async () => {
	const root = await repository({
		"deleted.txt": "old\n",
		"script.sh": "echo before\n",
	});
	const ref = await baseline(root);
	await unlink(join(root, "deleted.txt"));
	await writeFile(join(root, "added.txt"), "new\n");
	await writeFile(join(root, "script.sh"), "echo after\n");
	await chmod(join(root, "script.sh"), 0o755);
	const result = await packet(root, ref);
	expect(
		result.value.changes.map((change) => ({
			path: change.path,
			before: change.before.kind,
			after: change.after.kind,
			mode: change.after.mode,
		})),
	).toEqual([
		{ path: "added.txt", before: "missing", after: "file", mode: 0 },
		{ path: "deleted.txt", before: "file", after: "missing", mode: 0 },
		{ path: "script.sh", before: "file", after: "file", mode: 0o111 },
	]);
	expect(result.value.changes[2]?.diff).toContain("-echo before\n+echo after");
	expect(result.value.runId).toBe("retry-run");
	expect(result.value.baseline).toEqual(ref);
	expect((await packet(root, ref)).evidence).toEqual(result.evidence);
});

test("captures a typed empty tree in an unborn repository", async () => {
	const root = await repository();
	const ref = await baseline(root);
	const stored = JSON.parse(await readFile(objectPath(root, ref), "utf8"));
	expect(stored.git).toEqual({ kind: "empty" });
	await writeFile(join(root, "first.txt"), "first\n");
	expect(
		(await packet(root, ref)).value.changes.map((change) => change.before.kind),
	).toEqual(["missing"]);
});

test("preserves raw pre-existing CRLF and mode changes even with Git normalization disabled detection", async () => {
	const root = await repository({
		"line.txt": "a\n",
		"script.sh": "echo before\n",
	});
	await git(root, "config", "core.autocrlf", "true");
	await git(root, "config", "core.fileMode", "false");
	await writeFile(join(root, "line.txt"), "a\r\n");
	await chmod(join(root, "script.sh"), 0o755);
	const ref = await baseline(root);
	await writeFile(join(root, "feature.txt"), "feature\n");
	const result = await packet(root, ref);
	expect(result.value.preservedPreexisting.count).toBe(2);
	expect(result.value.changes.map((change) => change.path)).toEqual([
		"feature.txt",
	]);
	await writeFile(join(root, "line.txt"), "a\n");
	await expect(packet(root, ref)).rejects.toThrow(
		"Unrelated pre-existing content changed",
	);
});

test("does not use configured clean filters to identify the raw overlay", async () => {
	const root = await repository({
		"source.txt": "before\n",
		".gitattributes": "source.txt filter=collapse\n",
	});
	await git(root, "config", "filter.collapse.clean", "printf 'before\\n'");
	await git(root, "config", "filter.collapse.smudge", "cat");
	await writeFile(join(root, "source.txt"), "pre-existing raw\n");
	const ref = await baseline(root);
	await writeFile(join(root, "feature.txt"), "feature\n");
	expect((await packet(root, ref)).value.preservedPreexisting.count).toBe(1);
	await writeFile(join(root, "source.txt"), "different raw\n");
	await expect(packet(root, ref)).rejects.toThrow("Unrelated pre-existing");
});

test("declared existing work compares owned files to the immutable base and preserves unrelated edits", async () => {
	const root = await repository({
		"owned.txt": "base\n",
		"other.txt": "other\n",
	});
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "owned.txt"), "already implemented\n");
	await writeFile(join(root, "other.txt"), "unrelated\n");
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), "repaired\n");
	const result = await packet(root, ref);
	expect(result.value.provenance).toBe("declared-existing-work");
	expect(result.value.changes[0]?.diff).toContain("-base\n+repaired");
	expect(result.value.preservedPreexisting.count).toBe(1);
	await writeFile(join(root, "other.txt"), "overwritten\n");
	await expect(packet(root, ref)).rejects.toThrow("Unrelated pre-existing");
});

test.skipIf(process.platform === "win32")(
	"captures symlink targets and file type changes without following external targets",
	async () => {
		const root = await repository({ source: "before\n" });
		const ref = await baseline(root);
		await unlink(join(root, "source"));
		await symlink("/a/private/missing/target", join(root, "source"));
		const result = await packet(root, ref);
		expect(result.value.changes[0]?.after.kind).toBe("symlink");
		expect(result.value.changes[0]?.diff).toContain(
			"+/a/private/missing/target",
		);
		await git(root, "add", "source");
		await git(root, "commit", "--quiet", "-m", "link");
		const linkRef = await baseline(root);
		await unlink(join(root, "source"));
		await symlink("../another/target", join(root, "source"));
		expect((await packet(root, linkRef)).value.changes[0]?.diff).toContain(
			"-/a/private/missing/target",
		);
	},
);

test("reports binary changes explicitly with a bounded binary patch", async () => {
	const root = await repository({ "data.bin": Buffer.from([0, 1, 2, 3]) });
	const ref = await baseline(root);
	await writeFile(join(root, "data.bin"), Buffer.from([0, 5, 6, 7]));
	const value = (await packet(root, ref)).value;
	expect(value.changes[0]?.binary).toBe(true);
	expect(value.changes[0]?.diff).toContain("GIT binary patch");
	const expected = (
		await exec("git", [
			"-C",
			root,
			"diff",
			"--binary",
			"--no-ext-diff",
			"--no-textconv",
			"--",
			"data.bin",
		])
	).stdout;
	const observed = value.changes[0]?.diff ?? "";
	const marker = "GIT binary patch\n";
	expect(observed.slice(observed.indexOf(marker))).toBe(
		expected.slice(expected.indexOf(marker)),
	);
});

test("a rename remains a lossless deletion and addition", async () => {
	const root = await repository({ "old.txt": "same\n" });
	const ref = await baseline(root);
	await unlink(join(root, "old.txt"));
	await writeFile(join(root, "new.txt"), "same\n");
	const value = (await packet(root, ref)).value;
	expect(
		value.changes.map((change) => [
			change.path,
			change.before.kind,
			change.after.kind,
		]),
	).toEqual([
		["new.txt", "missing", "file"],
		["old.txt", "file", "missing"],
	]);
});

test("refuses stale source binding and references from other assignments", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const before = await digest(root);
	await writeFile(join(root, "source.txt"), "changed\n");
	const provider = createFileReviewEvidenceProvider(root);
	await expect(
		provider.captureBaseline({
			sessionId: "s",
			featureId: "f",
			originRunId: "r",
			sourceDigest: before,
		}),
	).rejects.toThrow("Source drift");
	const ref = await baseline(root);
	await writeFile(join(root, "added.txt"), "new\n");
	await expect(
		provider.prepare({
			sessionId: "session",
			featureId: "feature",
			runId: "r",
			baseline: ref,
			sourceDigest: before,
			declaredArtifacts: [],
			authorizedTargets: [],
		}),
	).rejects.toThrow("Source drift");
	await expect(
		provider.prepare({
			sessionId: "other",
			featureId: "feature",
			runId: "r",
			baseline: ref,
			sourceDigest: await digest(root),
			declaredArtifacts: [],
			authorizedTargets: [],
		}),
	).rejects.toThrow("another session");
	const result = await packet(root, ref);
	await expect(
		result.provider.read({
			...result.binding,
			runId: "other",
			reference: result.evidence,
		}),
	).rejects.toThrow("binding");
});

test("refuses missing and altered immutable evidence", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const ref = await baseline(root);
	const result = await packet(root, ref);
	await writeFile(objectPath(root, result.evidence), "{}\n");
	await expect(
		result.provider.read({ ...result.binding, reference: result.evidence }),
	).rejects.toThrow("altered");
	await unlink(objectPath(root, ref));
	await expect(packet(root, ref)).rejects.toThrow();
});

test("refuses missing Git objects instead of reconstructing the original baseline", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const ref = await baseline(root);
	const blob = await git(root, "rev-parse", "HEAD:source.txt");
	await unlink(join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
	await expect(packet(root, ref)).rejects.toThrow();
});

test("rejects traversal, mutable base names, and contradictory owned paths", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const commit = await git(root, "rev-parse", "HEAD");
	for (const path of [
		"../external",
		"/external",
		"a/../source.txt",
		".flow/state",
		".git/config",
	])
		await expect(
			baseline(root, { baseCommit: commit, ownedPaths: [path] }),
		).rejects.toThrow();
	await expect(
		baseline(root, { baseCommit: "HEAD", ownedPaths: ["source.txt"] }),
	).rejects.toThrow();
	await expect(
		baseline(root, {
			baseCommit: commit,
			ownedPaths: ["source.txt", "source.txt"],
		}),
	).rejects.toThrow("unique exact");
	const ref = await baseline(root);
	await expect(
		createFileReviewEvidenceProvider(root).prepare({
			sessionId: "session",
			featureId: "feature",
			runId: "r",
			baseline: ref,
			sourceDigest: await digest(root),
			declaredArtifacts: [{ path: "../external" }],
			authorizedTargets: [],
		}),
	).rejects.toThrow("normalized");
});

test.skipIf(process.platform === "win32")(
	"rejects symbolic links in evidence parents and object leaves",
	async () => {
		const root = await repository({ "source.txt": "base\n" });
		const ref = await baseline(root);
		const bytes = await readFile(objectPath(root, ref));
		await unlink(objectPath(root, ref));
		await writeFile(join(root, "external-object"), bytes);
		await symlink(join(root, "external-object"), objectPath(root, ref));
		await expect(packet(root, ref)).rejects.toThrow("symbolic link");
		await rm(join(root, ".flow", "evidence"), { recursive: true });
		await mkdir(join(root, "external-directory"));
		await symlink(
			join(root, "external-directory"),
			join(root, ".flow", "evidence"),
		);
		await expect(baseline(root)).rejects.toThrow("symbolic link");
	},
);

test("an unchanged dirty overlay larger than four MiB fits the independent baseline capacity", async () => {
	const root = await repository({ "source.txt": "base\n" });
	await writeFile(join(root, "unrelated.txt"), "x".repeat(4 * 1024 * 1024 + 1));
	const ref = await baseline(root);
	expect((await readFile(objectPath(root, ref))).length).toBeGreaterThan(
		4 * 1024 * 1024,
	);
	await writeFile(join(root, "feature.txt"), "feature\n");
	const result = await packet(root, ref);
	expect(result.value.preservedPreexisting.count).toBe(1);
	expect(result.value.changes.map((change) => change.path)).toEqual([
		"feature.txt",
	]);
});

test("fails closed when changed entry or aggregate evidence capacity is exceeded", async () => {
	const root = await repository();
	const ref = await baseline(root);
	for (let index = 0; index < 257; index += 1)
		await writeFile(join(root, `added-${index}.txt`), "added\n");
	await expect(packet(root, ref)).rejects.toThrow("256 changed-entry");
	for (let index = 0; index < 257; index += 1)
		await unlink(join(root, `added-${index}.txt`));
	await writeFile(join(root, "large.txt"), "0123456789".repeat(450000));
	await expect(packet(root, ref)).rejects.toThrow();
});

test("content-addressed but incomplete packets do not pass the boundary parser", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const ref = await baseline(root);
	const result = await packet(root, ref);
	const altered = JSON.parse(
		await readFile(objectPath(root, result.evidence), "utf8"),
	);
	altered.packet.complete = false;
	const contents = JSON.stringify(altered);
	const badRef: ReviewEvidenceReference = {
		version: 1,
		sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
	};
	await writeFile(objectPath(root, badRef), contents);
	await expect(
		result.provider.read({ ...result.binding, reference: badRef }),
	).rejects.toThrow();
});

test("non-UTF-8 bytes receive a reversible binary patch without replacement characters", async () => {
	const root = await repository({ "data.bin": Buffer.from([0xff, 1, 2, 3]) });
	const ref = await baseline(root);
	await writeFile(join(root, "data.bin"), Buffer.from([0xfe, 5, 6, 7]));
	const value = (await packet(root, ref)).value;
	expect(value.changes[0]?.binary).toBe(true);
	expect(value.changes[0]?.diff).toContain("GIT binary patch");
	expect(value.changes[0]?.diff).not.toContain("\ufffd");
});

test("refuses existing owned content excluded from the source census", async () => {
	const root = await repository({ ".gitignore": "ignored.txt\n" });
	await writeFile(join(root, "ignored.txt"), "ignored implementation\n");
	await expect(
		baseline(root, {
			baseCommit: await git(root, "rev-parse", "HEAD"),
			ownedPaths: ["ignored.txt"],
		}),
	).rejects.toThrow("excluded from source binding");
});

test("refuses preserved baseline content newly excluded from source binding", async () => {
	const root = await repository({ "source.txt": "base\n" });
	await writeFile(join(root, "existing.txt"), "pre-existing\n");
	const ref = await baseline(root);
	await writeFile(join(root, ".gitignore"), "existing.txt\n");
	await expect(packet(root, ref)).rejects.toThrow(
		"excluded from source binding",
	);
});

test("publishes only metadata for preserved dirty inputs beyond the changed-entry budget", async () => {
	const root = await repository();
	const secret =
		"pre-existing private contents must stay out of review packets";
	for (let index = 0; index < 257; index += 1) {
		await writeFile(join(root, `existing-${index}.txt`), secret);
	}
	const ref = await baseline(root);
	await writeFile(join(root, "feature.txt"), "feature\n");
	const result = await packet(root, ref);
	expect(result.value.changes.map((change) => change.path)).toEqual([
		"feature.txt",
	]);
	expect(result.value.preservedPreexisting.count).toBe(257);
	expect(result.value.preservedPreexisting.entries).toHaveLength(257);
	expect(result.value.preservedPreexisting.entries[0]).toEqual({
		path: "existing-0.txt",
		state: {
			kind: "file",
			mode: 0,
			digest: `sha256:${createHash("sha256").update(secret).digest("hex")}`,
		},
	});
	expect(
		await readFile(objectPath(root, result.evidence), "utf8"),
	).not.toContain(secret);
});

test("rejects a content-addressed preserved inventory that disagrees with its baseline", async () => {
	const root = await repository();
	await writeFile(join(root, "existing.txt"), "pre-existing\n");
	const ref = await baseline(root);
	const result = await packet(root, ref);
	const altered = JSON.parse(
		await readFile(objectPath(root, result.evidence), "utf8"),
	);
	altered.packet.preservedPreexisting.entries[0].state.digest = `sha256:${"0".repeat(64)}`;
	const contents = JSON.stringify(altered);
	const badRef: ReviewEvidenceReference = {
		version: 1,
		sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
	};
	await writeFile(objectPath(root, badRef), contents);
	await expect(
		result.provider.read({ ...result.binding, reference: badRef }),
	).rejects.toThrow("preserved inventory");
});

test("authorized edits in an already dirty file review only the delta from captured dirty bytes", async () => {
	const root = await repository({
		"source.txt": "original committed bytes\n",
		"other.txt": "other committed bytes\n",
	});
	await writeFile(join(root, "source.txt"), "original dirty edit\n");
	await writeFile(join(root, "other.txt"), "unrelated dirty edit\n");
	const ref = await baseline(root);
	await writeFile(join(root, "source.txt"), "new authorized edit\n");
	const provider = createFileReviewEvidenceProvider(root);
	const binding = {
		sessionId: "session",
		featureId: "feature",
		runId: "run",
		sourceDigest: await digest(root),
	};
	const evidence = await provider.prepare({
		...binding,
		baseline: ref,
		declaredArtifacts: [{ path: "source.txt" }],
		authorizedTargets: ["source.txt"],
	});
	const value = await provider.read({ ...binding, reference: evidence });
	expect(
		value.changes.map((change) => ({
			path: change.path,
			preexistingDirty: change.preexistingDirty,
		})),
	).toEqual([{ path: "source.txt", preexistingDirty: true }]);
	expect(value.changes[0]?.diff).toContain(
		"-original dirty edit\n+new authorized edit",
	);
	expect(value.changes[0]?.diff).not.toContain("original committed bytes");
	expect(value.preservedPreexisting.entries.map((entry) => entry.path)).toEqual(
		["other.txt"],
	);
	await writeFile(join(root, "other.txt"), "overwritten unrelated edit\n");
	await expect(
		provider.prepare({
			...binding,
			sourceDigest: await digest(root),
			baseline: ref,
			declaredArtifacts: [{ path: "other.txt" }],
			authorizedTargets: ["source.txt"],
		}),
	).rejects.toThrow("Unrelated pre-existing");
});

test("literal directory targets authorize dirty overlap and declarations cannot override another literal target", async () => {
	const root = await repository();
	await mkdir(join(root, "dir"));
	await writeFile(join(root, "dir", "source.txt"), "dirty before\n");
	const ref = await baseline(root);
	await writeFile(join(root, "dir", "source.txt"), "authorized after\n");
	const provider = createFileReviewEvidenceProvider(root);
	const input = {
		sessionId: "session",
		featureId: "feature",
		runId: "run",
		sourceDigest: await digest(root),
		baseline: ref,
	};
	const evidence = await provider.prepare({
		...input,
		authorizedTargets: ["dir/"],
		declaredArtifacts: [],
	});
	expect(
		(await provider.read({ ...input, reference: evidence })).changes[0]
			?.preexistingDirty,
	).toBe(true);
	await expect(
		provider.prepare({
			...input,
			authorizedTargets: ["different.txt"],
			declaredArtifacts: [{ path: "dir/source.txt" }],
		}),
	).rejects.toThrow("Unrelated pre-existing");
	await expect(
		provider.prepare({
			...input,
			authorizedTargets: ["dir-other"],
			declaredArtifacts: [{ path: "dir/source.txt" }],
		}),
	).rejects.toThrow("Unrelated pre-existing");
	await expect(
		provider.prepare({
			...input,
			authorizedTargets: [],
			declaredArtifacts: [{ path: "dir/source.txt" }],
		}),
	).rejects.toThrow("Unrelated pre-existing");
	const fallback = await provider.prepare({
		...input,
		authorizedTargets: ["dir/*"],
		declaredArtifacts: [{ path: "dir/source.txt" }],
	});
	expect(
		(await provider.read({ ...input, reference: fallback })).changes[0]?.diff,
	).toContain("-dirty before\n+authorized after");
	await expect(
		provider.prepare({
			...input,
			authorizedTargets: ["different.txt", "dir/*"],
			declaredArtifacts: [{ path: "dir/source.txt" }],
		}),
	).rejects.toThrow("Unrelated pre-existing");
});

test.each(["sha1", "sha256"] as const)(
	"rejects forged same-length %s Git blob bytes before preparing evidence",
	async (objectFormat) => {
		const root = await repository({ "source.txt": "before\n" }, objectFormat);
		const ref = await baseline(root);
		const object = await git(root, "rev-parse", "HEAD:source.txt");
		const path = join(
			root,
			".git",
			"objects",
			object.slice(0, 2),
			object.slice(2),
		);
		await unlink(path);
		await writeFile(path, deflateSync(Buffer.from("blob 7\0forged\n")));
		expect(await git(root, "cat-file", "blob", object)).toBe("forged");
		await writeFile(join(root, "source.txt"), "after\n");
		await expect(packet(root, ref)).rejects.toThrow(
			"Git baseline blob content does not match its object identity",
		);
	},
);

test("explicit existing work separates accepted and new changes using three captured states", async () => {
	const root = await repository({ "owned.txt": "base\n" });
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "owned.txt"), "accepted\n");
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), "new\n");
	const result = await packet(root, ref);
	const change = result.value.changes[0];
	expect([
		change?.before.digest,
		change?.acceptedBefore?.digest,
		change?.after.digest,
	]).toEqual(
		["base\n", "accepted\n", "new\n"].map(
			(bytes) =>
				`sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
		),
	);
	expect(change?.diff).toContain("-base\n+new");
	expect(change?.acceptedDiff).toContain("-base\n+accepted");
	expect(change?.newDiff).toContain("-accepted\n+new");
	expect(change?.newDiff).not.toContain("base");
	await writeFile(join(root, "owned.txt"), "base\n");
	const reverted = (await packet(root, ref)).value.changes[0];
	expect(reverted?.diff).toBe("");
	expect(reverted?.newDiff).toContain("-accepted\n+base");
});

test.skipIf(process.platform === "win32")(
	"accepted evidence preserves each state's file type, link target and executable mode",
	async () => {
		const root = await repository({ owned: "base\n" });
		const commit = await git(root, "rev-parse", "HEAD");
		await unlink(join(root, "owned"));
		await symlink("/missing/accepted", join(root, "owned"));
		const ref = await baseline(root, {
			baseCommit: commit,
			ownedPaths: ["owned"],
		});
		await unlink(join(root, "owned"));
		await writeFile(join(root, "owned"), "new\n");
		await chmod(join(root, "owned"), 0o755);
		const change = (await packet(root, ref)).value.changes[0];
		expect([
			change?.before.kind,
			change?.acceptedBefore?.kind,
			change?.after.kind,
		]).toEqual(["file", "symlink", "file"]);
		expect(change?.after.mode).toBe(0o111);
		expect(change?.acceptedDiff).toContain("+/missing/accepted");
		expect(change?.newDiff).toContain("-/missing/accepted");
	},
);

test("an unchanged owned file's accepted state comes from its verified pinned tree", async () => {
	const root = await repository({ "owned.txt": "base\n" });
	const ref = await baseline(root, {
		baseCommit: await git(root, "rev-parse", "HEAD"),
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), "new\n");
	const change = (await packet(root, ref)).value.changes[0];
	expect(change?.acceptedBefore).toEqual(change?.before);
	expect(change?.acceptedDiff).toBe("");
	expect(change?.newDiff).toContain("-base\n+new");
});

test("rejects partial accepted evidence and an accepted state fabricated from current bytes", async () => {
	const root = await repository({ "owned.txt": "base\n" });
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "owned.txt"), "accepted\n");
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), "new\n");
	const result = await packet(root, ref);
	for (const mutation of ["partial", "fabricated"] as const) {
		const altered = JSON.parse(
			await readFile(objectPath(root, result.evidence), "utf8"),
		);
		if (mutation === "partial") delete altered.packet.changes[0].acceptedDiff;
		else
			altered.packet.changes[0].acceptedBefore =
				altered.packet.changes[0].after;
		const contents = JSON.stringify(altered);
		const badRef: ReviewEvidenceReference = {
			version: 1,
			sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
		};
		await writeFile(objectPath(root, badRef), contents);
		await expect(
			result.provider.read({ ...result.binding, reference: badRef }),
		).rejects.toThrow();
	}
});

test("all accepted and new diff fields count toward the aggregate packet ceiling", async () => {
	const root = await repository({ "owned.txt": "base\n" });
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "owned.txt"), `${"a".repeat(2_000_000)}\n`);
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), `${"b".repeat(2_000_000)}\n`);
	await expect(packet(root, ref)).rejects.toThrow("aggregate capacity");
});

test("binary accepted bytes remain visible when the base and current states are text", async () => {
	const root = await repository({ "owned.txt": "base\n" });
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "owned.txt"), Buffer.from([0, 1, 2, 3]));
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["owned.txt"],
	});
	await writeFile(join(root, "owned.txt"), "new\n");
	const change = (await packet(root, ref)).value.changes[0];
	expect(change?.binary).toBe(true);
	expect(change?.diff).toContain("-base\n+new");
	expect(change?.acceptedDiff).toContain("GIT binary patch");
	expect(change?.newDiff).toContain("GIT binary patch");
});

test("ordinary captured work cannot publish an explicit accepted-work trio", async () => {
	const root = await repository({ "source.txt": "base\n" });
	const ref = await baseline(root);
	await writeFile(join(root, "source.txt"), "new\n");
	const result = await packet(root, ref);
	const altered = JSON.parse(
		await readFile(objectPath(root, result.evidence), "utf8"),
	);
	const change = altered.packet.changes[0];
	change.acceptedBefore = change.before;
	change.acceptedDiff = "";
	change.newDiff = change.diff;
	const contents = JSON.stringify(altered);
	const badRef: ReviewEvidenceReference = {
		version: 1,
		sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
	};
	await writeFile(objectPath(root, badRef), contents);
	await expect(
		result.provider.read({ ...result.binding, reference: badRef }),
	).rejects.toThrow("explicit existing-work ownership");
});

test("diff header rewriting preserves header-looking source lines inside the hunk", async () => {
	const root = await repository({
		"source.txt": "-- a/before\nkeep\ndiff --git literal before\n",
	});
	const ref = await baseline(root);
	await writeFile(
		join(root, "source.txt"),
		"++ b/after\nkeep\ndiff --git literal after\n",
	);
	const change = (await packet(root, ref)).value.changes[0];
	const boundary = change?.diff.indexOf("@@ ");
	expect(boundary).toBeGreaterThan(0);
	expect(change?.diff.slice(boundary)).toBe(
		"@@ -1,3 +1,3 @@\n--- a/before\n+++ b/after\n keep\n-diff --git literal before\n+diff --git literal after\n",
	);
});

test("republishing an existing large packet verifies its entire content hash", async () => {
	const root = await repository({ "source.txt": "base\n".repeat(20_000) });
	const ref = await baseline(root);
	await writeFile(join(root, "source.txt"), "next\n".repeat(20_000));
	const result = await packet(root, ref);
	const bytes = await readFile(objectPath(root, result.evidence));
	expect(bytes.length).toBeGreaterThan(64 * 1024);
	const index = Math.floor(bytes.length / 2);
	bytes[index] = bytes[index] === 0x61 ? 0x62 : 0x61;
	await writeFile(objectPath(root, result.evidence), bytes);
	await expect(packet(root, ref)).rejects.toThrow("altered or is incomplete");
});

test.skipIf(process.platform === "win32")(
	"one preparation verifies shared blobs once and the next preparation verifies them afresh",
	async () => {
		const root = await repository({
			"alpha-1.txt": "alpha\n",
			"alpha-2.txt": "alpha\n",
			"alpha-3.txt": "alpha\n",
			"beta-1.txt": "beta\n",
			"beta-2.txt": "beta\n",
			"beta-link": "beta\n",
		});
		await chmod(join(root, "alpha-2.txt"), 0o755);
		await unlink(join(root, "beta-link"));
		await symlink("beta\n", join(root, "beta-link"));
		await git(root, "add", ".");
		await git(root, "commit", "--quiet", "-m", "mode and type");
		const ref = await baseline(root);
		const trace = join(root, ".flow", "git-trace.jsonl");
		for (const name of [
			"alpha-1.txt",
			"alpha-2.txt",
			"alpha-3.txt",
			"beta-1.txt",
			"beta-2.txt",
		])
			await writeFile(join(root, name), `new ${name}\n`);
		await unlink(join(root, "beta-link"));
		await symlink("new-beta\n", join(root, "beta-link"));
		const input = {
			sessionId: "session",
			featureId: "feature",
			runId: "run",
			baseline: ref,
			sourceDigest: await digest(root),
			declaredArtifacts: [],
			authorizedTargets: [],
		};
		const modulePath = join(
			import.meta.dir,
			"..",
			"src",
			"infrastructure",
			"fs",
			"review-evidence.ts",
		);
		const code = `
		const { createFileReviewEvidenceProvider } = await import(${JSON.stringify(modulePath)});
		const { readFile } = await import("node:fs/promises");
		const provider = createFileReviewEvidenceProvider(${JSON.stringify(root)});
		const input = ${JSON.stringify(input)};
		const readCount = async () => (await readFile(${JSON.stringify(trace)}, "utf8")).trim().split("\\n").map((line) => JSON.parse(line)).filter((event) => event.event === "start" && event.argv.includes("cat-file") && event.argv.includes("blob")).length;
		const prepare = async () => provider.read({ ...input, reference: await provider.prepare(input) });
		const first = await prepare(); const firstReads = await readCount();
		const second = await prepare(); const secondReads = await readCount();
		console.log(JSON.stringify({ first, second, reads: [firstReads, secondReads] }));
	`;
		const traced = async (): Promise<{
			first: ReviewEvidencePacket;
			second: ReviewEvidencePacket;
			reads: number[];
		}> =>
			JSON.parse(
				(
					await exec(process.execPath, ["-e", code], {
						env: { ...process.env, GIT_TRACE2_EVENT: trace },
						maxBuffer: 4 * 1024 * 1024,
					})
				).stdout,
			);
		const result = await traced();
		const first = result.first;
		expect(
			first.changes.map((change) => [
				change.path,
				change.before.kind,
				change.before.mode,
			]),
		).toEqual([
			["alpha-1.txt", "file", 0],
			["alpha-2.txt", "file", 0o111],
			["alpha-3.txt", "file", 0],
			["beta-1.txt", "file", 0],
			["beta-2.txt", "file", 0],
			["beta-link", "symlink", 0],
		]);
		expect(first.changes[0]?.diff).toContain("-alpha\n+new alpha-1.txt");
		expect(first.changes[5]?.diff).toContain("-beta\n+new-beta");
		expect(result.reads).toEqual([2, 4]);
		expect(result.second).toEqual(first);
		const object = await git(root, "rev-parse", "HEAD:alpha-1.txt");
		const objectPath = join(
			root,
			".git",
			"objects",
			object.slice(0, 2),
			object.slice(2),
		);
		await unlink(objectPath);
		await writeFile(objectPath, deflateSync(Buffer.from("blob 6\0evil!\n")));
		await expect(traced()).rejects.toThrow(
			"Git baseline blob content does not match its object identity",
		);
	},
);

test("Unicode and escaped diffs fit exactly at the aggregate byte boundary with preserved inventory", async () => {
	const files: Record<string, string> = { "source.txt": "" };
	for (let index = 0; index < 10; index += 1)
		files[`pre-${index}-🧪.txt`] = "base";
	const root = await repository(files);
	for (let index = 0; index < 10; index += 1)
		await writeFile(join(root, `pre-${index}-🧪.txt`), "preserved dirty input");
	const ref = await baseline(root);
	const seed = '🧪"\\\t';
	await writeFile(join(root, "source.txt"), seed);
	const initial = await packet(root, ref);
	const initialBytes = (await readFile(objectPath(root, initial.evidence)))
		.length;
	const filler = 4 * 1024 * 1024 - initialBytes;
	expect(filler).toBeGreaterThan(0);
	await writeFile(join(root, "source.txt"), seed + "x".repeat(filler));
	const boundary = await packet(root, ref);
	const contents = await readFile(objectPath(root, boundary.evidence));
	expect(contents.length).toBe(4 * 1024 * 1024);
	expect(boundary.value.preservedPreexisting.count).toBe(10);
	expect(boundary.value.changes[0]?.diff).toContain(seed);
	expect(boundary.evidence.sha256).toBe(
		`sha256:${createHash("sha256").update(contents).digest("hex")}`,
	);
	const objects = (await readdir(join(root, ".flow", "evidence"))).sort();
	await writeFile(join(root, "source.txt"), seed + "x".repeat(filler + 1));
	await expect(packet(root, ref)).rejects.toThrow("aggregate capacity");
	expect((await readdir(join(root, ".flow", "evidence"))).sort()).toEqual(
		objects,
	);
});

test("an accepted-work diff overrun stops before generating the new-work constituent", async () => {
	const root = await repository({ "source.txt": "base line\n".repeat(100000) });
	const commit = await git(root, "rev-parse", "HEAD");
	await writeFile(join(root, "source.txt"), "kept line\n".repeat(100000));
	const ref = await baseline(root, {
		baseCommit: commit,
		ownedPaths: ["source.txt"],
	});
	await writeFile(join(root, "source.txt"), "next line\n".repeat(100000));
	const input = {
		sessionId: "session",
		featureId: "feature",
		runId: "run",
		baseline: ref,
		sourceDigest: await digest(root),
		declaredArtifacts: [],
		authorizedTargets: [],
	};
	const trace = join(root, ".flow", "constituent-trace.jsonl");
	const modulePath = join(
		import.meta.dir,
		"..",
		"src",
		"infrastructure",
		"fs",
		"review-evidence.ts",
	);
	const code = `const {createFileReviewEvidenceProvider}=await import(${JSON.stringify(modulePath)});let message="";try{await createFileReviewEvidenceProvider(${JSON.stringify(root)}).prepare(${JSON.stringify(input)});}catch(error){if(!(error instanceof Error))throw error;message=error.message;}console.log(JSON.stringify({message}));`;
	const child = await exec(process.execPath, ["-e", code], {
		env: { ...process.env, GIT_TRACE2_EVENT: trace },
	});
	expect(JSON.parse(child.stdout).message).toContain("aggregate capacity");
	const invocations = (await readFile(trace, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter(
			(event) => event.event === "start" && event.argv.includes("--no-index"),
		);
	expect(invocations).toHaveLength(2);
	expect(await readdir(join(root, ".flow", "evidence"))).toEqual([
		`${ref.sha256.slice(7)}.json`,
	]);
});
