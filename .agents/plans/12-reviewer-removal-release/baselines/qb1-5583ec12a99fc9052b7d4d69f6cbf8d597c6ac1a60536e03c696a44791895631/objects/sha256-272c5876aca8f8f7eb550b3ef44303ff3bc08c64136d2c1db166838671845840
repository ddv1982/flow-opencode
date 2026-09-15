import { spawnSync } from "node:child_process";
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
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { scrubSecrets } from "./cassette.js";

const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TextSchema = z.string().min(1).max(4096).regex(/\S/);
const RoleSchema = z.enum([
	"report",
	"catalog",
	"policy",
	"plan",
	"completion",
	"expected-provenance",
	"decision",
	"artifact",
	"attempt",
	"transcript",
	"canary-record",
	"canary-installation",
	"canary-session",
	"canary-transcript",
	"authority-source",
]);
const MediaTypeSchema = z.enum([
	"application/json",
	"application/gzip",
	"text/typescript",
]);
const BundleFileSchema = z
	.object({
		role: RoleSchema,
		id: TextSchema.optional(),
		mediaType: MediaTypeSchema,
		object: z.string().regex(/^objects\/sha256-[a-f0-9]{64}$/),
		sha256: DigestSchema,
		bytes: z.number().int().safe().nonnegative().max(MAX_OBJECT_BYTES),
	})
	.strict();

export const QualificationBundleManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		kind: z.literal("release-qualification"),
		bundleId: z.string().regex(/^qb1-[a-f0-9]{64}$/),
		bundleSha256: DigestSchema,
		reportId: TextSchema,
		packageVersion: TextSchema,
		verdict: z.enum(["VERIFIED", "NOT VERIFIED", "INCONCLUSIVE"]),
		files: z.array(BundleFileSchema).min(1).max(1024),
	})
	.strict();

export type QualificationBundleManifest = z.infer<
	typeof QualificationBundleManifestSchema
>;
export type QualificationBundleFile = Readonly<{
	role: z.infer<typeof RoleSchema>;
	id?: string | undefined;
	mediaType: z.infer<typeof MediaTypeSchema>;
	bytes: Uint8Array;
}>;
export type QualificationBundleInput = Readonly<{
	reportId: string;
	packageVersion: string;
	verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";
	files: readonly QualificationBundleFile[];
}>;

const fixedRoles = [
	"report",
	"catalog",
	"policy",
	"plan",
	"completion",
	"expected-provenance",
	"decision",
	"artifact",
	"canary-record",
	"canary-installation",
	"canary-session",
	"canary-transcript",
] as const;

function sha256(bytes: Uint8Array): `sha256:${string}` {
	return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
}

function manifestSha256(
	manifest: Omit<QualificationBundleManifest, "bundleId" | "bundleSha256">,
): string {
	return canonicalSha256("flow-qualification-bundle-v1", manifest);
}

function fileKey(file: Pick<QualificationBundleFile, "role" | "id">): string {
	return `${file.role}\0${file.id ?? ""}`;
}

function validateRoles(files: readonly QualificationBundleFile[]): void {
	const keys = files.map(fileKey);
	if (new Set(keys).size !== keys.length)
		throw new Error("Qualification bundle contains a duplicate role and id.");
	for (const file of files) {
		if (!file.id) continue;
		if (
			file.role === "authority-source"
				? isAbsolute(file.id) ||
					win32.isAbsolute(file.id) ||
					file.id.split(/[\\/]/).includes("..")
				: /[\\/]/.test(file.id)
		) {
			throw new Error("Qualification bundle role id is not a safe identifier.");
		}
	}
	for (const role of fixedRoles) {
		if (files.filter((file) => file.role === role && !file.id).length !== 1) {
			throw new Error(
				`Qualification bundle role ${role} must occur exactly once.`,
			);
		}
	}
	const attempts = new Set(
		files
			.filter((file) => file.role === "attempt" && file.id)
			.map((file) => file.id),
	);
	const transcripts = new Set(
		files
			.filter((file) => file.role === "transcript" && file.id)
			.map((file) => file.id),
	);
	if (
		attempts.size === 0 ||
		canonicalJson([...attempts].sort()) !==
			canonicalJson([...transcripts].sort())
	) {
		throw new Error(
			"Qualification bundle attempt and transcript roles must be complete.",
		);
	}
	if (!files.some((file) => file.role === "authority-source" && file.id)) {
		throw new Error("Qualification bundle authority source roles are missing.");
	}
}

function assertSafeText(text: string): void {
	if (scrubSecrets(text) !== text)
		throw new Error("Qualification bundle contains secret-shaped evidence.");
	if (/\b(?:ses_[A-Za-z0-9]+|(?:session|review):[A-Za-z0-9-]+)\b/.test(text))
		throw new Error("Qualification bundle contains a raw session identifier.");
	// Match Unix homes at path starts, not beneath another root such as /tmp.
	// Decode escaped slashes for inspection only; retained bytes stay untouched.
	const paths = text.replace(/\\+\//g, "/");
	if (
		/(?:(?:^|[\s"'`=():,;<>[\]{}!?|]|\\[nrtbf]|file:\/\/[^/\s"'<>]*)[*_~]*\/+(?:Users|home)\/[^/\s]+|[A-Za-z]:\\+Users\\+[^\\\s]+)/.test(
			paths,
		)
	)
		throw new Error("Qualification bundle contains an absolute user path.");
}

function assertSafeSource(text: string): void {
	if (
		/\b(?:sk-ant|sk-proj|sk-or|xai|gsk|hf|dop_v1|shpat)[-_][A-Za-z0-9_-]{16,}/.test(
			text,
		) ||
		/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{16}|AKIA[0-9A-Z]{16})\b/.test(
			text,
		) ||
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
		/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i.test(text)
	) {
		throw new Error("Qualification bundle contains secret-shaped source.");
	}
}

async function assertSafeArtifact(bytes: Uint8Array): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "flow-bundle-artifact-"));
	const path = join(directory, "artifact.tgz");
	try {
		await writeFile(path, bytes, { mode: 0o600 });
		const listed = spawnSync("tar", ["-tzf", path], {
			encoding: "utf8",
			maxBuffer: MAX_BUNDLE_BYTES,
		});
		if (listed.status !== 0)
			throw new Error("Qualification artifact is not a readable tarball.");
		const members = listed.stdout.split(/\r?\n/).filter(Boolean);
		const verbose = spawnSync("tar", ["-tvzf", path], {
			encoding: "utf8",
			maxBuffer: MAX_BUNDLE_BYTES,
		});
		const memberTypes = verbose.stdout.split(/\r?\n/).filter(Boolean);
		if (
			verbose.status !== 0 ||
			memberTypes.length !== members.length ||
			memberTypes.some((line) => line[0] !== "-" && line[0] !== "d")
		) {
			throw new Error(
				"Qualification artifact contains an unsupported member type.",
			);
		}
		if (new Set(members).size !== members.length)
			throw new Error("Qualification artifact contains duplicate members.");
		let total = 0;
		for (const member of members) {
			if (
				member.startsWith("-") ||
				member.startsWith("/") ||
				member.split("/").includes("..") ||
				member.includes("\\")
			)
				throw new Error(
					"Qualification artifact contains an unsafe member path.",
				);
			if (member.endsWith("/")) continue;
			const extracted = spawnSync("tar", ["-xOzf", path, "--", member], {
				encoding: "buffer",
				maxBuffer: MAX_OBJECT_BYTES + 1,
			});
			if (extracted.status !== 0 || !Buffer.isBuffer(extracted.stdout))
				throw new Error("Qualification artifact member is unreadable.");
			if (extracted.stdout.byteLength > MAX_OBJECT_BYTES)
				throw new Error(
					"Qualification artifact member exceeds its byte limit.",
				);
			total += extracted.stdout.byteLength;
			if (total > MAX_BUNDLE_BYTES)
				throw new Error(
					"Qualification artifact exceeds its expanded byte limit.",
				);
			const source = extracted.stdout.toString("utf8");
			assertSafeSource(source);
			try {
				assertSafeText(
					new TextDecoder("utf-8", { fatal: true }).decode(extracted.stdout),
				);
			} catch (error) {
				if (!(error instanceof TypeError)) throw error;
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function normalizedBytes(file: QualificationBundleFile): Buffer {
	const bytes = Buffer.from(file.bytes);
	if (bytes.byteLength > MAX_OBJECT_BYTES)
		throw new Error("Qualification bundle object exceeds its byte limit.");
	if (file.mediaType === "application/json") {
		let parsed: unknown;
		try {
			parsed = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} catch {
			throw new Error("Qualification bundle JSON is malformed.");
		}
		const canonical = canonicalJson(parsed);
		assertSafeText(canonical);
		return Buffer.from(canonical);
	}
	if (file.mediaType === "text/typescript") {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		assertSafeSource(text);
		return Buffer.from(text);
	}
	return bytes;
}

function buildManifest(input: QualificationBundleInput): {
	readonly manifest: QualificationBundleManifest;
	readonly objects: ReadonlyMap<string, Buffer>;
} {
	validateRoles(input.files);
	const objects = new Map<string, Buffer>();
	const files = input.files
		.map((file) => {
			const bytes = normalizedBytes(file);
			const digest = sha256(bytes);
			const object = `objects/sha256-${digest.slice("sha256:".length)}`;
			const prior = objects.get(object);
			if (prior && !prior.equals(bytes))
				throw new Error("Qualification bundle object digest collision.");
			objects.set(object, bytes);
			return {
				role: file.role,
				...(file.id ? { id: file.id } : {}),
				mediaType: file.mediaType,
				object,
				sha256: digest,
				bytes: bytes.byteLength,
			};
		})
		.sort((left, right) => fileKey(left).localeCompare(fileKey(right)));
	const total = files.reduce((sum, file) => sum + file.bytes, 0);
	if (total > MAX_BUNDLE_BYTES)
		throw new Error("Qualification bundle exceeds its total byte limit.");
	const base = {
		schemaVersion: 1 as const,
		kind: "release-qualification" as const,
		reportId: input.reportId,
		packageVersion: input.packageVersion,
		verdict: input.verdict,
		files,
	};
	const bundleSha256 = manifestSha256(base);
	const manifest = QualificationBundleManifestSchema.parse({
		...base,
		bundleId: `qb1-${bundleSha256.slice("sha256:".length)}`,
		bundleSha256,
	});
	return { manifest, objects };
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeImmutable(
	path: string,
	bytes: Buffer,
	temporaryRoot: string,
): Promise<"written" | "replayed"> {
	try {
		const existing = await readSettledImmutable(path, bytes.byteLength + 1);
		if (existing.equals(bytes)) return "replayed";
		throw new Error(`Immutable qualification object conflicts: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = join(temporaryRoot, `.bundle-${crypto.randomUUID()}`);
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(temporary, path);
		return "written";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const existing = await readSettledImmutable(path, bytes.byteLength + 1);
		if (!existing.equals(bytes))
			throw new Error(`Immutable qualification object conflicts: ${path}`);
		return "replayed";
	} finally {
		await unlink(temporary).catch(() => {});
	}
}

async function readSettledImmutable(
	path: string,
	maxBytes: number,
): Promise<Buffer> {
	let last: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await readStable(path, maxBytes);
		} catch (error) {
			last = error;
			if (!String(error).includes("changed while reading")) throw error;
			await Bun.sleep(1);
		}
	}
	throw last;
}

export async function writeQualificationBundle(input: {
	readonly input: QualificationBundleInput;
	readonly outputRoot: string;
	readonly checkpoint?:
		| ((stage: "before-seal", path: string) => void | Promise<void>)
		| undefined;
}): Promise<{
	readonly kind: "written" | "replayed";
	readonly path: string;
	readonly manifest: QualificationBundleManifest;
}> {
	const artifact = input.input.files.find((file) => file.role === "artifact");
	if (!artifact)
		throw new Error("Qualification bundle artifact role is missing.");
	await assertSafeArtifact(artifact.bytes);
	const built = buildManifest(input.input);
	await mkdir(input.outputRoot, { recursive: true, mode: 0o700 });
	const outputIdentity = await realDirectoryIdentity(input.outputRoot);
	const path = join(input.outputRoot, built.manifest.bundleId);
	await mkdir(join(path, "objects"), { recursive: true, mode: 0o700 });
	const bundleIdentity = await realDirectoryIdentity(path);
	const objectsIdentity = await realDirectoryIdentity(join(path, "objects"));
	let kind: "written" | "replayed" = "replayed";
	for (const [object, bytes] of built.objects) {
		if (
			(await writeImmutable(join(path, object), bytes, input.outputRoot)) ===
			"written"
		) {
			kind = "written";
		}
	}
	await syncDirectory(join(path, "objects"));
	await input.checkpoint?.("before-seal", path);
	const seal = Buffer.from(canonicalJson(built.manifest));
	assertSafeText(seal.toString("utf8"));
	if (
		(await writeImmutable(
			join(path, "bundle.json"),
			seal,
			input.outputRoot,
		)) === "written"
	) {
		kind = "written";
	}
	await syncDirectory(path);
	await syncDirectory(input.outputRoot);
	await readQualificationBundle(path);
	if (
		!(await sameDirectoryIdentity(outputIdentity)) ||
		!(await sameDirectoryIdentity(bundleIdentity)) ||
		!(await sameDirectoryIdentity(objectsIdentity))
	)
		throw new Error(
			"Qualification bundle directory changed during publication.",
		);
	return { kind, path, manifest: built.manifest };
}

async function readStable(path: string, maxBytes: number): Promise<Buffer> {
	const beforePath = await lstat(path, { bigint: true });
	if (
		!beforePath.isFile() ||
		beforePath.isSymbolicLink() ||
		beforePath.ino === 0n
	)
		throw new Error(
			"Qualification bundle object is not a stable regular file.",
		);
	const flags =
		process.platform === "win32"
			? constants.O_RDONLY
			: constants.O_RDONLY | constants.O_NOFOLLOW;
	const handle = await open(path, flags);
	try {
		const before = await handle.stat({ bigint: true });
		if (
			!before.isFile() ||
			before.ino === 0n ||
			before.dev !== beforePath.dev ||
			before.ino !== beforePath.ino ||
			before.size > BigInt(maxBytes)
		)
			throw new Error("Qualification bundle object exceeds its byte limit.");
		const bytes = Buffer.allocUnsafe(Number(before.size) + 1);
		let length = 0;
		while (length < bytes.length) {
			const read = await handle.read(
				bytes,
				length,
				bytes.length - length,
				length,
			);
			if (read.bytesRead === 0) break;
			length += read.bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		const afterPath = await lstat(path, { bigint: true });
		if (
			length > maxBytes ||
			afterPath.isSymbolicLink() ||
			before.dev !== afterPath.dev ||
			before.ino !== afterPath.ino ||
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			before.mode !== after.mode ||
			before.size !== after.size ||
			before.ctimeNs !== after.ctimeNs ||
			before.mtimeNs !== after.mtimeNs ||
			BigInt(length) !== after.size
		) {
			throw new Error("Qualification bundle object changed while reading.");
		}
		return bytes.subarray(0, length);
	} finally {
		await handle.close();
	}
}

type DirectoryIdentity = Readonly<{ path: string; dev: bigint; ino: bigint }>;

async function realDirectoryIdentity(path: string): Promise<DirectoryIdentity> {
	const info = await lstat(path, { bigint: true });
	if (info.isSymbolicLink() || !info.isDirectory() || info.ino === 0n)
		throw new Error("Qualification bundle directory must not be a symlink.");
	return { path, dev: info.dev, ino: info.ino };
}

async function sameDirectoryIdentity(
	identity: DirectoryIdentity,
): Promise<boolean> {
	const current = await realDirectoryIdentity(identity.path);
	return current.dev === identity.dev && current.ino === identity.ino;
}

async function safeInputPath(
	rootPath: string,
	relativePath: string,
	kind: "file" | "directory",
): Promise<{
	readonly path: string;
	readonly identities: readonly Readonly<{
		path: string;
		dev: bigint;
		ino: bigint;
	}>[];
}> {
	if (isAbsolute(relativePath) || win32.isAbsolute(relativePath))
		throw new Error("Qualification input path must be relative.");
	const requestedRoot = resolve(rootPath);
	const inside = relative(requestedRoot, resolve(requestedRoot, relativePath));
	if (!inside || inside.split(/[\\/]/)[0] === ".." || isAbsolute(inside))
		throw new Error("Qualification input path escapes its root.");
	const rootInfo = await lstat(requestedRoot, { bigint: true });
	if (
		rootInfo.isSymbolicLink() ||
		!rootInfo.isDirectory() ||
		rootInfo.ino === 0n
	)
		throw new Error("Qualification input root must be a real directory.");
	const root = await realpath(requestedRoot);
	const identities = [{ path: root, dev: rootInfo.dev, ino: rootInfo.ino }];
	let current = root;
	const parts = inside.split(sep);
	for (const [index, part] of parts.entries()) {
		current = join(current, part);
		const info = await lstat(current, { bigint: true });
		const final = index === parts.length - 1;
		if (
			info.isSymbolicLink() ||
			info.ino === 0n ||
			(final
				? kind === "file"
					? !info.isFile()
					: !info.isDirectory()
				: !info.isDirectory())
		) {
			throw new Error(
				"Qualification input path is not a stable expected type.",
			);
		}
		identities.push({ path: current, dev: info.dev, ino: info.ino });
	}
	if (
		(await realpath(current)).split(sep).join("/") !==
		current.split(sep).join("/")
	)
		throw new Error("Qualification input path changed during inspection.");
	return { path: current, identities };
}

function sameIdentities(
	left: readonly {
		readonly path: string;
		readonly dev: bigint;
		readonly ino: bigint;
	}[],
	right: readonly {
		readonly path: string;
		readonly dev: bigint;
		readonly ino: bigint;
	}[],
): boolean {
	return (
		left.length === right.length &&
		left.every((identity, index) => {
			const next = right[index];
			return (
				next?.path === identity.path &&
				next.dev === identity.dev &&
				next.ino === identity.ino
			);
		})
	);
}

export async function readStableQualificationInput(
	root: string,
	relativePath: string,
	maxBytes = MAX_OBJECT_BYTES,
	checkpoint?:
		| ((stage: "inspected" | "read") => void | Promise<void>)
		| undefined,
): Promise<Buffer> {
	const before = await safeInputPath(root, relativePath, "file");
	await checkpoint?.("inspected");
	const bytes = await readStable(before.path, maxBytes);
	await checkpoint?.("read");
	const after = await safeInputPath(root, relativePath, "file");
	if (!sameIdentities(before.identities, after.identities))
		throw new Error("Qualification input path changed while reading.");
	return bytes;
}

export async function listStableQualificationDirectory(
	root: string,
	relativePath: string,
): Promise<readonly string[]> {
	const before = await safeInputPath(root, relativePath, "directory");
	const entries = await readdir(before.path, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile() || entry.isSymbolicLink())
			throw new Error(
				"Qualification input directory contains a non-file entry.",
			);
	}
	const after = await safeInputPath(root, relativePath, "directory");
	if (!sameIdentities(before.identities, after.identities))
		throw new Error("Qualification input directory changed while listing.");
	return entries.map((entry) => entry.name).sort();
}

export async function readQualificationBundle(path: string): Promise<{
	readonly manifest: QualificationBundleManifest;
	readonly files: readonly Readonly<{
		ref: z.infer<typeof BundleFileSchema>;
		bytes: Buffer;
	}>[];
}> {
	const bundleIdentity = await realDirectoryIdentity(path);
	const objectsIdentity = await realDirectoryIdentity(join(path, "objects"));
	const rootEntries = await readdir(path, { withFileTypes: true });
	if (!rootEntries.some((entry) => entry.name === "bundle.json"))
		throw new Error("Qualification bundle seal is missing.");
	if (
		rootEntries.length !== 2 ||
		!rootEntries.some(
			(entry) =>
				entry.name === "bundle.json" &&
				entry.isFile() &&
				!entry.isSymbolicLink(),
		) ||
		!rootEntries.some(
			(entry) =>
				entry.name === "objects" &&
				entry.isDirectory() &&
				!entry.isSymbolicLink(),
		)
	) {
		throw new Error(
			"Qualification bundle contains unexpected top-level entries.",
		);
	}
	let seal: Buffer;
	try {
		seal = await readStable(join(path, "bundle.json"), MAX_OBJECT_BYTES);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new Error("Qualification bundle seal is missing.");
		throw error;
	}
	const manifest = QualificationBundleManifestSchema.parse(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(seal)),
	);
	assertSafeText(canonicalJson(manifest));
	const {
		bundleId: _bundleId,
		bundleSha256: _bundleSha256,
		...base
	} = manifest;
	const expected = manifestSha256(base);
	if (
		manifest.bundleSha256 !== expected ||
		manifest.bundleId !== `qb1-${expected.slice("sha256:".length)}` ||
		manifest.bundleId !== path.split(/[\\/]/).at(-1)
	) {
		throw new Error("Qualification bundle manifest digest is invalid.");
	}
	validateRoles(
		manifest.files.map((file) => ({
			role: file.role,
			...(file.id ? { id: file.id } : {}),
			mediaType: file.mediaType,
			bytes: new Uint8Array(),
		})),
	);
	const totalBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
	if (totalBytes > MAX_BUNDLE_BYTES)
		throw new Error("Qualification bundle exceeds its total byte limit.");
	const objectNames = (await readdir(join(path, "objects"))).sort();
	const expectedNames = [
		...new Set(
			manifest.files.map((file) => file.object.slice("objects/".length)),
		),
	].sort();
	if (canonicalJson(objectNames) !== canonicalJson(expectedNames))
		throw new Error("Qualification bundle contains missing or extra objects.");
	const files = await Promise.all(
		manifest.files.map(async (ref) => {
			const bytes = await readStable(join(path, ref.object), MAX_OBJECT_BYTES);
			if (bytes.byteLength !== ref.bytes || sha256(bytes) !== ref.sha256)
				throw new Error(
					"Qualification bundle object digest or size is invalid.",
				);
			normalizedBytes({
				role: ref.role,
				...(ref.id ? { id: ref.id } : {}),
				mediaType: ref.mediaType,
				bytes,
			});
			return { ref, bytes };
		}),
	);
	const artifact = files.find(({ ref }) => ref.role === "artifact");
	if (!artifact) throw new Error("Qualification bundle artifact is missing.");
	await assertSafeArtifact(artifact.bytes);
	if (
		!(await sameDirectoryIdentity(bundleIdentity)) ||
		!(await sameDirectoryIdentity(objectsIdentity))
	)
		throw new Error("Qualification bundle directory changed while reading.");
	return { manifest, files };
}
