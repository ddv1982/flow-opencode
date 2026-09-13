import { expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../evals/evidence-store.js";
import {
	FixtureSnapshotSchema,
	restoreSnapshot,
	snapshotFiles,
	snapshotProject,
} from "../evals/fixture-snapshot.js";

test("retains exact binary bytes, source additions and executable mode after project deletion", async () => {
	const root = await mkdtemp(join(tmpdir(), "snapshot-check-"));
	try {
		const source = join(root, "source");
		const restored = join(root, "restored");
		await mkdir(source);
		await mkdir(restored);
		await mkdir(join(source, ".flow"));
		await writeFile(join(source, "asset.bin"), Buffer.from([0, 255, 13]));
		await writeFile(join(source, "run.sh"), "#!/bin/sh\nexit 0\n");
		await chmod(join(source, "run.sh"), 0o700);
		await writeFile(
			join(source, ".flow", "session.json"),
			"private host state",
		);
		const store = new EvidenceStore(join(root, "evidence"));
		const ref = await store.writeJson(await snapshotProject(source));
		await rm(source, { recursive: true });
		const snapshot = await restoreSnapshot(await store.readJson(ref), restored);
		expect(snapshot.files.map((file) => file.path)).toEqual([
			"asset.bin",
			"run.sh",
		]);
		expect(snapshot.files[1]?.executable).toBe(true);
		expect(await readFile(join(restored, "asset.bin"))).toEqual(
			Buffer.from([0, 255, 13]),
		);
		expect(await snapshotProject(restored)).toEqual(snapshot);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects unsafe, duplicate, corrupt and oversized fixture representations", () => {
	const valid = snapshotFiles({ "src/value.ts": "export const value = 1;" });
	for (const path of [
		"../escape",
		"/absolute",
		"src/../../escape",
		".git/config",
		"src\\escape",
		"C:drive",
		"src/file:stream",
		"src/CON.txt",
		"src/NUL",
		"src/LPT¹.txt",
		"src/trailing.",
		"src/trailing ",
	])
		expect(
			FixtureSnapshotSchema.safeParse({
				...valid,
				files: [{ ...valid.files[0], path }],
			}).success,
		).toBe(false);
	expect(
		FixtureSnapshotSchema.safeParse({
			...valid,
			files: [...valid.files, ...valid.files],
		}).success,
	).toBe(false);
	expect(
		FixtureSnapshotSchema.safeParse({
			...valid,
			files: [{ ...valid.files[0], contentBase64: "Y29ycnVwdA==" }],
		}).success,
	).toBe(false);
	for (const path of [
		".GIT/config",
		".Flow/session.json",
		"OpenCode.json",
		"NODE_MODULES/evil.js",
	])
		expect(
			FixtureSnapshotSchema.safeParse({
				...valid,
				files: [{ ...valid.files[0], path }],
			}).success,
		).toBe(false);
});

test("rejects source symlinks and changed immutable objects", async () => {
	const root = await mkdtemp(join(tmpdir(), "snapshot-check-"));
	try {
		await mkdir(join(root, "source"));
		await writeFile(join(root, "outside"), "not source");
		await symlink(join(root, "outside"), join(root, "source", "linked"));
		await expect(snapshotProject(join(root, "source"))).rejects.toThrow(
			"unsupported",
		);
		const store = new EvidenceStore(join(root, "evidence"));
		const ref = await store.writeJson({ value: "original" });
		expect(await store.writeJson({ value: "original" })).toEqual(ref);
		await writeFile(join(store.directory, ref.artifact), "corrupt");
		await expect(store.read(ref)).rejects.toThrow();
		await expect(store.writeJson({ value: "original" })).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
