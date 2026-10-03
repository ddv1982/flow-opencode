import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
	type QualificationBundleInput,
	readQualificationBundle,
	writeQualificationBundle,
} from "../evals/qualification-bundle.js";
import { materializeQualificationArchive } from "../scripts/materialize-qualification.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

type Entry = { name: string; bytes: Buffer; type?: string; link?: string };
const sha256 = (bytes: Uint8Array) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
function tar(entries: readonly Entry[]): Buffer {
	const blocks: Buffer[] = [];
	for (const entry of entries) {
		const header = Buffer.alloc(512);
		header.write(entry.name, 0, "ascii");
		for (const [offset, width, value] of [
			[100, 8, 0o600],
			[108, 8, 0],
			[116, 8, 0],
			[124, 12, entry.bytes.length],
			[136, 12, 0],
		] as const)
			header.write(`${value.toString(8).padStart(width - 1, "0")}\0`, offset);
		header.fill(0x20, 148, 156);
		header.write(entry.type ?? "0", 156, "ascii");
		if (entry.link) header.write(entry.link, 157, "ascii");
		header.write("ustar\0", 257, "ascii");
		header.write("00", 263, "ascii");
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
		blocks.push(
			header,
			entry.bytes,
			Buffer.alloc((512 - (entry.bytes.length % 512)) % 512),
		);
	}
	return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-materialize-test-"));
	temporary.push(root);
	const roles = [
		"report",
		"catalog",
		"policy",
		"plan",
		"completion",
		"expected-provenance",
		"decision",
		"canary-record",
		"canary-installation",
		"canary-session",
		"canary-transcript",
	] as const;
	const input: QualificationBundleInput = {
		reportId: "report-materialization",
		packageVersion: "9.4.0",
		verdict: "VERIFIED",
		files: [
			...roles.map((role) => ({
				role,
				mediaType: "application/json" as const,
				bytes: Buffer.from(JSON.stringify({ role })),
			})),
			{
				role: "artifact",
				mediaType: "application/gzip",
				bytes: gzipSync(
					tar([
						{
							name: "package/README.md",
							bytes: Buffer.from("safe artifact\n"),
						},
					]),
				),
			},
			{
				role: "attempt",
				id: "attempt-1",
				mediaType: "application/json",
				bytes: Buffer.from('{"attemptId":"attempt-1"}'),
			},
			{
				role: "transcript",
				id: "attempt-1",
				mediaType: "application/json",
				bytes: Buffer.from('{"gradeInput":{"schemaVersion":1}}'),
			},
			{
				role: "authority-source",
				id: "evals/analysis.ts",
				mediaType: "text/typescript",
				bytes: Buffer.from("export const analysis = true;\n"),
			},
		],
	};
	const original = await writeQualificationBundle({
		input,
		outputRoot: join(root, "source"),
	});
	const entries = await Promise.all(
		[
			"bundle.json",
			...new Set(original.manifest.files.map((file) => file.object)),
		].map(async (name) => ({
			name,
			bytes: await readFile(join(original.path, name)),
		})),
	);
	const descriptorPath = join(root, "9.4.0.json"),
		archivePath = join(root, "9.4.0.tar.gz"),
		outputRoot = join(root, "materialized");
	const descriptor = {
		schemaVersion: 1,
		packageVersion: "9.4.0",
		archive: "9.4.0.tar.gz",
		archiveSha256: "",
		bundleId: original.manifest.bundleId,
		bundleSha256: original.manifest.bundleSha256,
	};
	async function save(bytes = gzipSync(tar(entries))) {
		await writeFile(archivePath, bytes);
		await writeFile(
			descriptorPath,
			JSON.stringify({ ...descriptor, archiveSha256: sha256(bytes) }),
		);
	}
	await save();
	return {
		root,
		original,
		entries,
		descriptor,
		descriptorPath,
		archivePath,
		outputRoot,
		save,
	};
}

test("materializes a genuine sealed bundle outside the source workspace with byte-identical replay", async () => {
	const f = await fixture();
	const first = await materializeQualificationArchive({
		descriptorPath: f.descriptorPath,
		outputRoot: f.outputRoot,
	});
	expect(first).toBe(join(f.outputRoot, f.original.manifest.bundleId));
	expect((await readQualificationBundle(first)).manifest).toEqual(
		f.original.manifest,
	);
	const before = await lstat(join(first, "bundle.json"));
	for (const entry of f.entries)
		expect(await readFile(join(first, entry.name))).toEqual(entry.bytes);
	expect(
		await materializeQualificationArchive({
			descriptorPath: f.descriptorPath,
			outputRoot: f.outputRoot,
		}),
	).toBe(first);
	expect((await lstat(join(first, "bundle.json"))).ino).toBe(before.ino);
	expect((await lstat(f.outputRoot)).mode & 0o077).toBe(0);
});

test("rejects the wrong archive digest before materializing any files", async () => {
	const f = await fixture();
	await writeFile(
		f.descriptorPath,
		JSON.stringify({
			...f.descriptor,
			archiveSha256: `sha256:${"0".repeat(64)}`,
		}),
	);
	await expect(
		materializeQualificationArchive({
			descriptorPath: f.descriptorPath,
			outputRoot: f.outputRoot,
		}),
	).rejects.toThrow(/archive.*digest/i);
	await expect(lstat(f.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

for (const variant of [
	"traversal",
	"symlink",
	"hardlink",
	"extra",
	"duplicate",
	"checksum",
	"object-digest",
] as const) {
	test(`rejects ${variant} archive content even with an authentic compressed digest`, async () => {
		const f = await fixture();
		let entries = [...f.entries];
		if (variant === "traversal")
			entries.push({ name: "../escape", bytes: Buffer.from("escape") });
		if (variant === "extra")
			entries.push({ name: "README.md", bytes: Buffer.from("extra") });
		if (variant === "duplicate")
			entries.push(
				f.entries[0] ?? { name: "bundle.json", bytes: Buffer.alloc(0) },
			);
		if (variant === "symlink" || variant === "hardlink")
			entries = entries.map((entry, index) =>
				index === 1
					? {
							...entry,
							type: variant === "symlink" ? "2" : "1",
							link: "../escape",
						}
					: entry,
			);
		if (variant === "object-digest")
			entries = entries.map((entry, index) =>
				index === 1 ? { ...entry, bytes: Buffer.from("changed") } : entry,
			);
		const bytes = tar(entries);
		if (variant === "checksum") bytes[100] = 0x37;
		await f.save(gzipSync(bytes));
		await expect(
			materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			}),
		).rejects.toThrow(
			variant === "object-digest"
				? /object digest/i
				: variant === "checksum"
					? /checksum/i
					: variant === "duplicate"
						? /duplicate archive entry/i
						: /invalid archive entry/i,
		);
		await expect(lstat(f.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
	});
}

test("refuses a conflicting existing object without overwriting retained bytes", async () => {
	const f = await fixture();
	const path = await materializeQualificationArchive({
		descriptorPath: f.descriptorPath,
		outputRoot: f.outputRoot,
	});
	const object = f.entries.find((entry) => entry.name.startsWith("objects/"));
	if (!object) throw new Error("Missing sealed object");
	await writeFile(join(path, object.name), "retained conflicting proof");
	await expect(
		materializeQualificationArchive({
			descriptorPath: f.descriptorPath,
			outputRoot: f.outputRoot,
		}),
	).rejects.toThrow();
	expect(await readFile(join(path, object.name), "utf8")).toBe(
		"retained conflicting proof",
	);
});
