import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import {
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
	type QualificationBundleInput,
	readQualificationBundle,
	writeQualificationBundle,
} from "../evals/qualification-bundle.js";
import { materializeQualificationArchive } from "../scripts/materialize-qualification.js";
import { assertQualificationBundle } from "../scripts/release-metadata.js";

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

async function fixture(packageVersion = "9.4.0") {
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
		packageVersion,
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
		packageVersion,
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

test("default archive resolution cleans independent temporary roots after concurrent regrade errors", async () => {
	const f = await fixture(),
		archives = join(f.root, "archives");
	await mkdir(archives);
	await copyFile(f.archivePath, join(archives, "9.4.0.tar.gz"));
	await copyFile(f.descriptorPath, join(archives, "9.4.0.json"));
	const results = await Promise.allSettled(
		Array.from({ length: 3 }, () =>
			assertQualificationBundle({
				version: "9.4.0",
				directory: join(f.root, "bundles"),
			}),
		),
	);
	const roots: string[] = [];
	for (const result of results) {
		expect(result.status).toBe("rejected");
		if (result.status !== "rejected" || !(result.reason instanceof Error))
			throw new Error("Expected strict regrade failure");
		expect(result.reason.message).toMatch(/did not regrade cleanly/);
		const match = result.reason.message.match(
			/Qualification bundle (.+) for 9\.4\.0/,
		);
		if (!match?.[1]) throw new Error("Missing rejected bundle path");
		const root = dirname(match[1]);
		roots.push(root);
		await expect(lstat(root)).rejects.toMatchObject({ code: "ENOENT" });
	}
	expect(new Set(roots).size).toBe(3);
});

test("a symlink ancestor targeting the source workspace is refused before mkdir", async () => {
	const f = await fixture(),
		source = resolve(import.meta.dir, ".."),
		leaf = `.materializer-output-${f.root.split("/").at(-1)}`;
	await symlink(source, join(f.root, "source-link"));
	const destination = join(source, leaf);
	temporary.push(destination);
	await expect(
		materializeQualificationArchive({
			descriptorPath: f.descriptorPath,
			outputRoot: join(f.root, "source-link", leaf),
		}),
	).rejects.toThrow(/outside.*workspace/i);
	await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
});

test("concurrent explicit materialization publishes only complete identical proof", async () => {
	const f = await fixture();
	const paths = await Promise.all(
		Array.from({ length: 3 }, () =>
			materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			}),
		),
	);
	expect(new Set(paths).size).toBe(1);
	const path = paths[0];
	if (!path) throw new Error("Missing restored proof");
	expect((await readQualificationBundle(path)).manifest).toEqual(
		f.original.manifest,
	);
	for (const entry of f.entries)
		expect(await readFile(join(path, entry.name))).toEqual(entry.bytes);
});

test("existing output comparison settles a publication alias unlink without relaxing archive reads", async () => {
	const f = await fixture();
	const path = await materializeQualificationArchive({
		descriptorPath: f.descriptorPath,
		outputRoot: f.outputRoot,
	});
	const entry = f.entries.find((entry) => entry.name.startsWith("objects/"));
	if (!entry) throw new Error("Missing publication race object");
	const destination = join(path, entry.name),
		alias = join(f.root, "publication-alias");
	await fs.link(destination, alias);
	const nativeOpen = fs.open;
	let opens = 0,
		intervened = false;
	const opened = spyOn(fs, "open").mockImplementation(async (...args) => {
		const file = await nativeOpen(...args);
		if (args[0] !== destination || ++opens !== 2) return file;
		return new Proxy(file, {
			get(target, key) {
				const value = Reflect.get(target, key, target);
				if (key === "read")
					return async (...readArgs: unknown[]) => {
						const result = await Reflect.apply(value, target, readArgs);
						if (!intervened) {
							await fs.unlink(alias);
							intervened = true;
						}
						return result;
					};
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	});
	try {
		expect(
			await materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			}),
		).toBe(path);
		expect(intervened).toBe(true);
		expect(await readFile(destination)).toEqual(entry.bytes);
	} finally {
		opened.mockRestore();
	}
});

test("archive input changing during a read fails once without output retry", async () => {
	const f = await fixture(),
		nativeOpen = fs.open;
	let opens = 0,
		changed = false;
	const opened = spyOn(fs, "open").mockImplementation(async (...args) => {
		const file = await nativeOpen(...args);
		if (args[0] !== f.archivePath) return file;
		opens += 1;
		return new Proxy(file, {
			get(target, key) {
				const value = Reflect.get(target, key, target);
				if (key === "read")
					return async (...readArgs: unknown[]) => {
						const result = await Reflect.apply(value, target, readArgs);
						if (!changed) {
							const stat = await target.stat();
							await fs.utimes(
								f.archivePath,
								stat.atime,
								new Date(stat.mtimeMs + 1000),
							);
							changed = true;
						}
						return result;
					};
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
	});
	try {
		await expect(
			materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			}),
		).rejects.toThrow("Archive input changed while reading.");
		expect(changed).toBe(true);
		expect(opens).toBe(1);
		await expect(lstat(f.outputRoot)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		opened.mockRestore();
	}
});

test("bounded SemVer build metadata remains valid for descriptors and legacy bundle discovery", async () => {
	const f = await fixture("9.4.0+build.1");
	const path = await materializeQualificationArchive({
		descriptorPath: f.descriptorPath,
		outputRoot: f.outputRoot,
	});
	expect((await readQualificationBundle(path)).manifest.packageVersion).toBe(
		"9.4.0+build.1",
	);
	await expect(
		assertQualificationBundle({
			version: "9.4.0+build.1",
			directory: join(f.root, "absent-bundles"),
		}),
	).rejects.toThrow(/no sealed qualification bundle/);
});

for (const variant of [
	"output-link",
	"object-link",
	"truncated",
	"gzip-limit",
	"descriptor-version",
] as const) {
	test(`materialization refuses ${variant} without changing original sealed proof`, async () => {
		const f = await fixture();
		if (variant === "output-link") await symlink(f.original.path, f.outputRoot);
		if (variant === "object-link") {
			const path = await materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			});
			const entry = f.entries.find((entry) =>
				entry.name.startsWith("objects/"),
			);
			if (!entry) throw new Error("Missing object link control");
			await rm(join(path, entry.name));
			await symlink(join(f.original.path, entry.name), join(path, entry.name));
		}
		if (variant === "truncated")
			await f.save(gzipSync(tar(f.entries).subarray(0, -1024)));
		if (variant === "gzip-limit")
			await f.save(gzipSync(Buffer.alloc(129 * 1024 * 1024)));
		if (variant === "descriptor-version") {
			const descriptor = JSON.parse(await readFile(f.descriptorPath, "utf8"));
			await writeFile(
				f.descriptorPath,
				JSON.stringify({ ...descriptor, packageVersion: "9.4.1" }),
			);
		}
		await expect(
			materializeQualificationArchive({
				descriptorPath: f.descriptorPath,
				outputRoot: f.outputRoot,
			}),
		).rejects.toThrow();
		for (const entry of f.entries)
			expect(await readFile(join(f.original.path, entry.name))).toEqual(
				entry.bytes,
			);
	});
}
