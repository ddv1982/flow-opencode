import { constants } from "node:fs";
import {
	link,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	realpath,
	rm,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { exactPackageVersion } from "../evals/provenance.js";
import { readQualificationBundle } from "../evals/qualification-bundle.js";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_TAR_BYTES = 128 * 1024 * 1024;
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const Descriptor = z
	.object({
		schemaVersion: z.literal(1),
		packageVersion: z.string().transform(exactPackageVersion),
		archive: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tar\.gz$/),
		archiveSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		bundleId: z.string().regex(/^qb1-[a-f0-9]{64}$/),
		bundleSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	})
	.strict();
const sha256 = (bytes: Uint8Array) =>
	`sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;

async function readBounded(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const before = await file.stat();
		if (!before.isFile() || before.size > limit)
			throw new Error("Archive input is not a bounded regular file.");
		const buffer = Buffer.alloc(before.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await file.read(
				buffer,
				length,
				buffer.length - length,
				length,
			);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		const after = await file.stat();
		if (
			length !== before.size ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw new Error("Archive input changed while reading.");
		return buffer.subarray(0, length);
	} finally {
		await file.close();
	}
}

function octal(bytes: Buffer): number {
	const text = bytes
		.toString("latin1")
		.replace(/[\0 ]+$/, "")
		.trim();
	if (!/^[0-7]+$/.test(text))
		throw new Error("Invalid archive numeric header.");
	const value = Number.parseInt(text, 8);
	if (!Number.isSafeInteger(value))
		throw new Error("Invalid archive numeric header.");
	return value;
}

function archiveEntries(bytes: Buffer): Map<string, Buffer> {
	const entries = new Map<string, Buffer>();
	if (bytes.length % 512 !== 0) throw new Error("Invalid archive block size.");
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			if (
				bytes.length - offset < 1024 ||
				bytes.subarray(offset).some((byte) => byte !== 0)
			)
				throw new Error("Invalid archive terminator.");
			if (!entries.has("bundle.json"))
				throw new Error("Archive seal is missing.");
			return entries;
		}
		const checksum = header.reduce(
			(sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
			0,
		);
		if (octal(header.subarray(148, 156)) !== checksum)
			throw new Error("Archive checksum mismatch.");
		const nameField = header.subarray(0, 100),
			terminator = nameField.indexOf(0);
		if (
			terminator < 0 ||
			nameField.subarray(terminator).some((byte) => byte !== 0)
		)
			throw new Error("Invalid archive entry name padding.");
		const name = nameField.subarray(0, terminator).toString("utf8");
		const type = header[156];
		if (
			(type !== 0 && type !== 48) ||
			header.subarray(157, 257).some((byte) => byte !== 0) ||
			header.subarray(345, 500).some((byte) => byte !== 0) ||
			header.subarray(257, 263).toString("ascii") !== "ustar\0" ||
			header.subarray(263, 265).toString("ascii") !== "00" ||
			!(name === "bundle.json" || /^objects\/sha256-[a-f0-9]{64}$/.test(name))
		)
			throw new Error("Invalid archive entry.");
		if (entries.has(name)) throw new Error("Duplicate archive entry.");
		const size = octal(header.subarray(124, 136));
		const end = offset + 512 + size,
			next = offset + 512 + Math.ceil(size / 512) * 512;
		if (size > MAX_OBJECT_BYTES || next > bytes.length || entries.size >= 1025)
			throw new Error("Invalid archive entry size.");
		const body = bytes.subarray(offset + 512, end);
		if (bytes.subarray(end, next).some((byte) => byte !== 0))
			throw new Error("Invalid archive padding.");
		if (
			name !== "bundle.json" &&
			sha256(body) !== `sha256:${name.slice("objects/sha256-".length)}`
		)
			throw new Error("Archive object digest mismatch.");
		entries.set(name, body);
		offset = next;
	}
	throw new Error("Invalid archive terminator.");
}

async function privateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const stat = await lstat(path);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
		throw new Error("Materialization requires a private real directory.");
}

async function readSettledOutput(path: string): Promise<Buffer> {
	let last: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await readBounded(path, MAX_OBJECT_BYTES);
		} catch (error) {
			last = error;
			if (
				!(error instanceof Error) ||
				error.message !== "Archive input changed while reading."
			)
				throw error;
			await Bun.sleep(1);
		}
	}
	throw last;
}

async function writeIdentical(
	path: string,
	bytes: Buffer,
	staging: string,
): Promise<void> {
	const temporary = join(staging, basename(path));
	try {
		const file = await open(
			temporary,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		try {
			await file.writeFile(bytes);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			await link(temporary, path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!(await readSettledOutput(path)).equals(bytes))
				throw new Error("Materialized proof conflicts with archived bytes.");
		}
	} finally {
		await rm(temporary, { force: true });
	}
}

async function externalDestination(requested: string): Promise<string> {
	const destination = resolve(requested),
		source = await realpath(resolve(import.meta.dir, ".."));
	let ancestor = destination;
	for (;;) {
		try {
			const stat = await lstat(ancestor);
			if (ancestor === destination && stat.isSymbolicLink())
				throw new Error("Materialization requires a private real directory.");
			const target = resolve(
				await realpath(ancestor),
				relative(ancestor, destination),
			);
			const location = relative(source, target);
			if (
				location === "" ||
				(!location.startsWith(`..${sep}`) && !isAbsolute(location))
			)
				throw new Error(
					"Qualification archives must materialize outside the source workspace.",
				);
			return target;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = dirname(ancestor);
			if (parent === ancestor) throw error;
			ancestor = parent;
		}
	}
}

export async function materializeQualificationArchive(input: {
	readonly descriptorPath: string;
	readonly outputRoot: string;
}): Promise<string> {
	const descriptor = Descriptor.parse(
		JSON.parse(
			(await readBounded(input.descriptorPath, 64 * 1024)).toString("utf8"),
		),
	);
	if (
		descriptor.bundleId !==
		`qb1-${descriptor.bundleSha256.slice("sha256:".length)}`
	)
		throw new Error("Archive descriptor bundle identity conflicts.");
	const archive = await readBounded(
		join(dirname(input.descriptorPath), descriptor.archive),
		MAX_ARCHIVE_BYTES,
	);
	if (sha256(archive) !== descriptor.archiveSha256)
		throw new Error("Archive digest mismatch.");
	const entries = archiveEntries(
		gunzipSync(archive, { maxOutputLength: MAX_TAR_BYTES }),
	);
	const root = await externalDestination(input.outputRoot);
	await privateDirectory(root);
	const staging = await mkdtemp(join(root, ".materialize-"));
	try {
		const path = join(root, descriptor.bundleId);
		await privateDirectory(path);
		await privateDirectory(join(path, "objects"));
		const existing = await readdir(path);
		if (existing.some((name) => name !== "objects" && name !== "bundle.json"))
			throw new Error("Unexpected materialization root entry.");
		if (
			(await readdir(join(path, "objects"))).some(
				(name) => !entries.has(`objects/${name}`),
			)
		)
			throw new Error("Unexpected materialization object.");
		if (existing.includes("bundle.json")) await readQualificationBundle(path);
		for (const [name, bytes] of entries)
			if (name !== "bundle.json")
				await writeIdentical(join(path, name), bytes, staging);
		const seal = entries.get("bundle.json");
		if (!seal) throw new Error("Archive seal is missing.");
		await writeIdentical(join(path, "bundle.json"), seal, staging);
		const { manifest } = await readQualificationBundle(path);
		if (
			manifest.bundleId !== descriptor.bundleId ||
			manifest.bundleSha256 !== descriptor.bundleSha256 ||
			manifest.packageVersion !== descriptor.packageVersion
		)
			throw new Error(
				"Archive descriptor differs from its verified bundle seal.",
			);
		return path;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2),
		options = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index],
			value = args[index + 1];
		if (
			(key !== "--descriptor" && key !== "--out") ||
			!value ||
			options.has(key)
		)
			throw new Error(
				"Usage: materialize-qualification --descriptor <json> --out <external-private-directory>",
			);
		options.set(key, value);
	}
	const descriptorPath = options.get("--descriptor"),
		outputRoot = options.get("--out");
	if (!descriptorPath || !outputRoot)
		throw new Error("--descriptor and --out are required.");
	console.log(
		await materializeQualificationArchive({ descriptorPath, outputRoot }),
	);
}
