import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFile,
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	EvidenceArtifactCollisionError,
	EvidenceArtifactIntegrityError,
	EvidenceArtifactNotFoundError,
	EvidenceArtifactTooLargeError,
	InvalidEvidenceArtifactReferenceError,
	MAX_EVIDENCE_ARTIFACT_BYTES,
} from "../src/application/ports/evidence-artifact-store.js";
import {
	createFileEvidenceArtifactStore,
	evidenceArtifactDirectory,
	evidenceArtifactPath,
	evidenceArtifactRefForBytes,
} from "../src/infrastructure/fs/evidence-artifact-store.js";
import { createFileSessionRepository } from "../src/infrastructure/fs/session-repository.js";
import {
	flowDir,
	loadSession,
	quarantineUnreadableSession,
	sessionPath,
	UnsafeFlowWorkspaceLayoutError,
} from "../src/infrastructure/fs/workspace.js";
import {
	flowPlanSave,
	flowSessionClose,
} from "../src/infrastructure/fs/workspace-flow-service.js";

const utf8 = new TextEncoder();
const execFileAsync = promisify(execFile);
const ancestorRaceProbe = fileURLToPath(
	new URL("./support/ancestor-directory-race-probe.ts", import.meta.url),
);
const temporaryWorkspaces: string[] = [];

async function tempWorkspace(): Promise<string> {
	const workspace = await mkdtemp(join(tmpdir(), "flow-evidence-artifacts-"));
	temporaryWorkspaces.push(workspace);
	return workspace;
}

function bytes(value: string): Uint8Array {
	return utf8.encode(value);
}

function digest(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

async function expectMode(path: string, expected: number): Promise<void> {
	if (process.platform === "win32") return;
	expect((await stat(path)).mode & 0o777).toBe(expected);
}

async function ensureArtifactParents(
	workspace: string,
	digestHex: string,
): Promise<string> {
	const evidence = join(flowDir(workspace), "evidence");
	const version = join(evidence, "v1");
	const algorithm = join(version, "sha256");
	const shard = join(algorithm, digestHex.slice(0, 2));
	await mkdir(flowDir(workspace), { mode: 0o700 });
	await mkdir(evidence, { mode: 0o700 });
	await mkdir(version, { mode: 0o700 });
	await mkdir(algorithm, { mode: 0o700 });
	await mkdir(shard, { mode: 0o700 });
	return shard;
}

afterEach(async () => {
	await Promise.all(
		temporaryWorkspaces
			.splice(0)
			.map((workspace) => rm(workspace, { recursive: true, force: true })),
	);
});

describe("restricted evidence artifact persistence", () => {
	test("publishes owner-only hash-addressed bytes and verifies reads", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const content = bytes('{"command":"bun test"}');
		const expectedDigest = digest(content);

		const ref = await store.publishEvidenceArtifact(content);

		expect(ref).toEqual({
			kind: "restricted_evidence_v1",
			digest: `sha256:${expectedDigest}`,
			byteLength: content.byteLength,
		});
		expect(evidenceArtifactPath(workspace, ref)).toBe(
			join(
				evidenceArtifactDirectory(workspace),
				expectedDigest.slice(0, 2),
				expectedDigest.slice(2),
			),
		);
		expect(await store.readEvidenceArtifact(ref)).toEqual(content);
		await expectMode(evidenceArtifactPath(workspace, ref), 0o600);
		await expectMode(join(flowDir(workspace), "evidence"), 0o700);
		await expectMode(evidenceArtifactDirectory(workspace), 0o700);
		await expect(
			readFile(join(flowDir(workspace), ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\n/session.json.*.*.tmp\nhistory/\nevidence/\nsession.lock/\n.gitignore\n/.gitignore.*.*.tmp\n",
		);
	});

	test("copies caller-owned bytes before asynchronous publication", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const input = bytes("immutable evidence");
		const original = Uint8Array.from(input);

		const publication = store.publishEvidenceArtifact(input);
		input.fill(0);
		const ref = await publication;

		expect(await store.readEvidenceArtifact(ref)).toEqual(original);
	});

	test("exposes evidence publication inside the session transaction lock", async () => {
		const workspace = await tempWorkspace();
		const repository = createFileSessionRepository(workspace);
		const content = bytes("transaction-bound evidence");

		const recorded = await repository.transact(async (transaction) => {
			const ref = await transaction.publishEvidenceArtifact(content);
			return {
				ref,
				bytes: await transaction.readEvidenceArtifact(ref),
			};
		});

		expect(recorded.bytes).toEqual(content);
		expect(recorded.ref).toEqual(evidenceArtifactRefForBytes(content));
	});

	test("rejects oversized artifacts before creating Flow state", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const oversized = new Uint8Array(MAX_EVIDENCE_ARTIFACT_BYTES + 1);

		await expect(
			store.publishEvidenceArtifact(oversized),
		).rejects.toBeInstanceOf(EvidenceArtifactTooLargeError);
		await expect(stat(flowDir(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("reads the byte limit and rejects a stored limit-plus-one artifact", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const content = new Uint8Array(MAX_EVIDENCE_ARTIFACT_BYTES);
		const ref = await store.publishEvidenceArtifact(content);

		expect((await store.readEvidenceArtifact(ref)).byteLength).toBe(
			MAX_EVIDENCE_ARTIFACT_BYTES,
		);
		await appendFile(evidenceArtifactPath(workspace, ref), Buffer.from([1]));
		await expect(store.readEvidenceArtifact(ref)).rejects.toBeInstanceOf(
			EvidenceArtifactTooLargeError,
		);
	});

	test("rejects invalid and missing references without creating directories", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const missing = evidenceArtifactRefForBytes(bytes("missing"));

		await expect(store.readEvidenceArtifact(missing)).rejects.toBeInstanceOf(
			EvidenceArtifactNotFoundError,
		);
		await expect(
			store.readEvidenceArtifact({
				kind: "restricted_evidence_v1",
				digest: "sha256:../../outside",
				byteLength: 1,
			}),
		).rejects.toBeInstanceOf(InvalidEvidenceArtifactReferenceError);
		await expect(stat(flowDir(workspace))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("publishes the same bytes idempotently under concurrency", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const content = bytes("concurrent immutable evidence");

		const refs = await Promise.all(
			Array.from({ length: 8 }, () => store.publishEvidenceArtifact(content)),
		);

		expect(refs.every((ref) => ref.digest === refs[0]?.digest)).toBe(true);
		const ref = refs[0];
		if (!ref) throw new Error("Expected an evidence artifact reference.");
		const shard = join(
			evidenceArtifactDirectory(workspace),
			digest(content).slice(0, 2),
		);
		expect(await readdir(shard)).toEqual([digest(content).slice(2)]);
		expect(await store.readEvidenceArtifact(ref)).toEqual(content);
	});

	test("never overwrites a colliding or corrupted target", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const expected = bytes("expected evidence");
		const ref = await store.publishEvidenceArtifact(expected);
		const target = evidenceArtifactPath(workspace, ref);
		const replacement = bytes("tampered evidence");
		expect(replacement.byteLength).toBe(expected.byteLength);
		await writeFile(target, replacement);
		await chmod(target, 0o600);

		await expect(
			store.publishEvidenceArtifact(expected),
		).rejects.toBeInstanceOf(EvidenceArtifactCollisionError);
		expect(await readFile(target)).toEqual(Buffer.from(replacement));
		await expect(store.readEvidenceArtifact(ref)).rejects.toBeInstanceOf(
			EvidenceArtifactIntegrityError,
		);
	});

	test("bounds verification of an oversized collision target", async () => {
		const workspace = await tempWorkspace();
		const content = bytes("bounded collision verification");
		const ref = evidenceArtifactRefForBytes(content);
		const target = evidenceArtifactPath(workspace, ref);
		await ensureArtifactParents(workspace, digest(content));
		await writeFile(target, "", { mode: 0o600 });
		await truncate(target, MAX_EVIDENCE_ARTIFACT_BYTES + 1);

		await expect(
			createFileEvidenceArtifactStore(workspace).publishEvidenceArtifact(
				content,
			),
		).rejects.toBeInstanceOf(EvidenceArtifactCollisionError);
		expect((await stat(target)).size).toBe(MAX_EVIDENCE_ARTIFACT_BYTES + 1);
	});

	test("fails closed on byte-length and permission mismatches", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const ref = await store.publishEvidenceArtifact(
			bytes("restricted evidence"),
		);

		await expect(
			store.readEvidenceArtifact({ ...ref, byteLength: ref.byteLength - 1 }),
		).rejects.toBeInstanceOf(EvidenceArtifactIntegrityError);
		if (process.platform !== "win32") {
			await chmod(evidenceArtifactPath(workspace, ref), 0o644);
			await expect(store.readEvidenceArtifact(ref)).rejects.toBeInstanceOf(
				UnsafeFlowWorkspaceLayoutError,
			);
		}
	});

	test("refuses symlinked evidence directories without touching their targets", async () => {
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const marker = join(outside, "marker");
		await writeFile(marker, "outside\n", "utf8");
		await mkdir(flowDir(workspace), { mode: 0o700 });
		await symlink(outside, join(flowDir(workspace), "evidence"), "dir");
		const store = createFileEvidenceArtifactStore(workspace);

		await expect(
			store.publishEvidenceArtifact(bytes("never escape")),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(marker, "utf8")).toBe("outside\n");
		expect(await readdir(outside)).toEqual(["marker"]);
	});

	test("refuses symlinked shards and target files", async () => {
		const shardWorkspace = await tempWorkspace();
		const shardOutside = await tempWorkspace();
		const shardContent = bytes("shard target");
		const shardDigest = digest(shardContent);
		await mkdir(flowDir(shardWorkspace), { mode: 0o700 });
		await mkdir(join(flowDir(shardWorkspace), "evidence"), { mode: 0o700 });
		await mkdir(join(flowDir(shardWorkspace), "evidence", "v1"), {
			mode: 0o700,
		});
		await mkdir(join(flowDir(shardWorkspace), "evidence", "v1", "sha256"), {
			mode: 0o700,
		});
		await symlink(
			shardOutside,
			join(
				flowDir(shardWorkspace),
				"evidence",
				"v1",
				"sha256",
				shardDigest.slice(0, 2),
			),
			"dir",
		);
		await expect(
			createFileEvidenceArtifactStore(shardWorkspace).publishEvidenceArtifact(
				shardContent,
			),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readdir(shardOutside)).toEqual([]);

		const fileWorkspace = await tempWorkspace();
		const fileOutside = await tempWorkspace();
		const outsideFile = join(fileOutside, "outside-file");
		const fileContent = bytes("file target");
		const fileRef = evidenceArtifactRefForBytes(fileContent);
		const fileDigest = digest(fileContent);
		await ensureArtifactParents(fileWorkspace, fileDigest);
		await writeFile(outsideFile, "outside\n", "utf8");
		await symlink(outsideFile, evidenceArtifactPath(fileWorkspace, fileRef));
		await expect(
			createFileEvidenceArtifactStore(fileWorkspace).publishEvidenceArtifact(
				fileContent,
			),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(outsideFile, "utf8")).toBe("outside\n");
	});

	test("never follows a symlink when reading an artifact", async () => {
		if (process.platform === "win32") return;
		const workspace = await tempWorkspace();
		const outside = await tempWorkspace();
		const content = bytes("outside evidence");
		const ref = evidenceArtifactRefForBytes(content);
		await ensureArtifactParents(workspace, digest(content));
		const outsideFile = join(outside, "artifact");
		await writeFile(outsideFile, content, { mode: 0o600 });
		await symlink(outsideFile, evidenceArtifactPath(workspace, ref));

		await expect(
			createFileEvidenceArtifactStore(workspace).readEvidenceArtifact(ref),
		).rejects.toBeInstanceOf(UnsafeFlowWorkspaceLayoutError);
		expect(await readFile(outsideFile)).toEqual(Buffer.from(content));
	});

	test("fails closed when a validated artifact ancestor is substituted", async () => {
		if (process.platform === "win32") return;
		await execFileAsync(process.execPath, [ancestorRaceProbe, "evidence"]);
	});

	test("pins publication to the validated shard during substitution", async () => {
		if (process.platform === "win32") return;
		await execFileAsync(process.execPath, [
			ancestorRaceProbe,
			"evidence-publish",
		]);
	});

	test("revalidates the canonical shard after an idempotent replay", async () => {
		if (process.platform === "win32") return;
		await execFileAsync(process.execPath, [
			ancestorRaceProbe,
			"evidence-replay",
		]);
	});

	test("bounds a collision target that grows after descriptor inspection", async () => {
		if (process.platform === "win32") return;
		await execFileAsync(process.execPath, [ancestorRaceProbe, "evidence-grow"]);
	});

	test("replays safely with target-plus-temp crash residue", async () => {
		const workspace = await tempWorkspace();
		const store = createFileEvidenceArtifactStore(workspace);
		const content = bytes("crash replay evidence");
		const ref = await store.publishEvidenceArtifact(content);
		const target = evidenceArtifactPath(workspace, ref);
		const shard = join(
			evidenceArtifactDirectory(workspace),
			digest(content).slice(0, 2),
		);
		const residue = join(shard, ".publish-crashed.tmp");
		await writeFile(residue, content, { mode: 0o600, flag: "wx" });

		expect(await store.publishEvidenceArtifact(content)).toEqual(ref);
		expect(await store.readEvidenceArtifact(ref)).toEqual(content);
		expect(await readFile(target)).toEqual(Buffer.from(content));
		expect((await readdir(shard)).sort()).toEqual(
			[".publish-crashed.tmp", digest(content).slice(2)].sort(),
		);
	});

	test("replays safely with temp-only crash residue", async () => {
		const workspace = await tempWorkspace();
		const content = bytes("pre-publication crash evidence");
		const ref = evidenceArtifactRefForBytes(content);
		const contentDigest = digest(content);
		const shard = await ensureArtifactParents(workspace, contentDigest);
		await writeFile(join(shard, ".publish-crashed.tmp"), content, {
			mode: 0o600,
			flag: "wx",
		});
		const store = createFileEvidenceArtifactStore(workspace);

		expect(await store.publishEvidenceArtifact(content)).toEqual(ref);
		expect(await store.readEvidenceArtifact(ref)).toEqual(content);
		expect((await readdir(shard)).sort()).toEqual(
			[".publish-crashed.tmp", contentDigest.slice(2)].sort(),
		);
	});

	test("archive and quarantine operations leave evidence artifacts intact", async () => {
		const archiveWorkspace = await tempWorkspace();
		const archiveStore = createFileEvidenceArtifactStore(archiveWorkspace);
		const archiveContent = bytes("archived evidence");
		const archiveRef =
			await archiveStore.publishEvidenceArtifact(archiveContent);
		expect(
			(
				await flowPlanSave(archiveWorkspace, {
					goal: "Preserve immutable evidence during archival",
				})
			).status,
		).toBe("ok");
		const archiveSession = await loadSession(archiveWorkspace);
		if (!archiveSession) throw new Error("Expected archive session.");
		expect(
			(
				await flowSessionClose(archiveWorkspace, {
					request: {
						mode: "start",
						operationId: "archive-evidence-session",
						expectedRevision: archiveSession.causal.revision,
						expectedSnapshotId: archiveSession.causal.snapshotId,
						kind: "deferred",
						summary: "Archive without moving evidence.",
					},
				})
			).status,
		).toBe("ok");
		expect(await archiveStore.readEvidenceArtifact(archiveRef)).toEqual(
			archiveContent,
		);

		const quarantineWorkspace = await tempWorkspace();
		const quarantineStore =
			createFileEvidenceArtifactStore(quarantineWorkspace);
		const quarantineContent = bytes("quarantined-session evidence");
		const quarantineRef =
			await quarantineStore.publishEvidenceArtifact(quarantineContent);
		await writeFile(sessionPath(quarantineWorkspace), "not json", "utf8");
		expect(
			await quarantineUnreadableSession(quarantineWorkspace),
		).not.toBeNull();
		expect(await quarantineStore.readEvidenceArtifact(quarantineRef)).toEqual(
			quarantineContent,
		);
	});

	test("upgrades the prior generated ignore file before publication", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { mode: 0o700 });
		await writeFile(
			join(flowDir(workspace), ".gitignore"),
			"session.json\nhistory/\nsession.lock/\n.gitignore\n",
			"utf8",
		);

		await createFileEvidenceArtifactStore(workspace).publishEvidenceArtifact(
			bytes("ignored evidence"),
		);

		await expect(
			readFile(join(flowDir(workspace), ".gitignore"), "utf8"),
		).resolves.toBe(
			"session.json\n/session.json.*.*.tmp\nhistory/\nevidence/\nsession.lock/\n.gitignore\n/.gitignore.*.*.tmp\n",
		);
	});

	test("preserves custom ignore entries and appends a final restricted-state block", async () => {
		const workspace = await tempWorkspace();
		await mkdir(flowDir(workspace), { mode: 0o700 });
		await writeFile(
			join(flowDir(workspace), ".gitignore"),
			"maintainer-scratch/\n!evidence/**\n",
			"utf8",
		);

		await createFileEvidenceArtifactStore(workspace).publishEvidenceArtifact(
			bytes("custom-ignore evidence"),
		);

		await expect(
			readFile(join(flowDir(workspace), ".gitignore"), "utf8"),
		).resolves.toBe(
			"maintainer-scratch/\n!evidence/**\nsession.json\n/session.json.*.*.tmp\nhistory/\nevidence/\nsession.lock/\n.gitignore\n/.gitignore.*.*.tmp\n",
		);
	});
});
