import { isUtf8 } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	open,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
	ReviewEvidencePacket,
	ReviewEvidencePort,
} from "../../application/ports/review-evidence.js";
import {
	MAX_SOURCE_FILE_BYTES,
	MAX_SOURCE_FILES,
	MAX_SOURCE_TOTAL_BYTES,
} from "../../domain/limits.js";
import type {
	ReviewEvidenceReference,
	SourceDigest,
} from "../../domain/session.js";
import {
	ensureFlowDirectory,
	pathKind,
	writeAtomically,
} from "./managed-fs.js";
import { collectGitDiff, jsonStringBytes } from "./review-diff.js";
import {
	captureWorkspaceSource,
	createFileSourceIdentityProvider,
	type WorkspaceSourceEntry,
	workspaceSourcePathExists,
} from "./source-identity.js";
import { assertMutableWorkspaceRoot } from "./workspace-paths.js";

const exec = promisify(execFile);
const gitEnvironment = {
	...process.env,
	GIT_NO_LAZY_FETCH: "1",
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_OPTIONAL_LOCKS: "0",
	GIT_ATTR_NOSYSTEM: "1",
};
const MAX_PACKET_BYTES = 4 * 1024 * 1024;
const MAX_BASELINE_BYTES = MAX_SOURCE_TOTAL_BYTES * 2 + MAX_SOURCE_FILES * 2048;
const digestSchema = z.templateLiteral([
	"sha256:",
	z.string().regex(/^[a-f0-9]{64}$/),
]);
const referenceSchema = z.strictObject({
	version: z.literal(1),
	sha256: digestSchema,
});
const identity = z.string().min(1).max(512);
const gitObject = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

class ReviewEvidenceError extends Error {
	readonly code = "FLOW_REVIEW_EVIDENCE";
}

function fail(message: string, cause?: unknown): never {
	throw new ReviewEvidenceError(message, cause ? { cause } : undefined);
}

function safePath(value: string): string {
	if (
		!value ||
		value.includes("\0") ||
		value.includes("\\") ||
		isAbsolute(value) ||
		normalize(value) !== value ||
		value === "." ||
		value === ".." ||
		value.startsWith("../") ||
		value === ".git" ||
		value.startsWith(".git/") ||
		value === ".flow" ||
		value.startsWith(".flow/")
	) {
		fail(
			"Review evidence requires exact normalized workspace paths outside .git and .flow.",
		);
	}
	return value;
}

function authorizedDirtyEdit(
	targets: readonly string[],
	declaredPaths: readonly string[],
) {
	const literalTargets = targets.flatMap((raw) => {
		const target = raw.replace(/\/+$/, "");
		if (/[*?[\]{}]/.test(target)) return [];
		if (target === ".") return [target];
		try {
			return [safePath(target)];
		} catch {
			return [];
		}
	});
	const declarations = new Set(declaredPaths);
	return (path: string): boolean =>
		literalTargets.length > 0
			? literalTargets.some(
					(target) =>
						target === "." || path === target || path.startsWith(`${target}/`),
				)
			: targets.length > 0 && declarations.has(path);
}

const pathSchema = z
	.string()
	.max(4096)
	.refine((value) => {
		try {
			safePath(value);
			return true;
		} catch {
			return false;
		}
	});
const modeSchema = z
	.number()
	.int()
	.min(0)
	.max(0o111)
	.refine((mode) => (mode & ~0o111) === 0);
const rawSchema = z.strictObject({
	path: pathSchema,
	kind: z.enum(["missing", "file", "symlink"]),
	mode: modeSchema,
	bytes: z
		.string()
		.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
const baselineSchema = z.strictObject({
	owner: z.literal("flow-review-evidence"),
	version: z.literal(1),
	kind: z.literal("baseline"),
	sessionId: identity,
	featureId: identity,
	originRunId: identity,
	sourceDigest: digestSchema,
	provenance: z.enum(["captured-before-run", "declared-existing-work"]),
	git: z.discriminatedUnion("kind", [
		z.strictObject({ kind: z.literal("empty") }),
		z.strictObject({
			kind: z.literal("commit"),
			commit: gitObject,
			tree: gitObject,
		}),
	]),
	ownedPaths: z.array(pathSchema).max(MAX_SOURCE_FILES),
	overlay: z.array(rawSchema).max(MAX_SOURCE_FILES),
});
type Baseline = z.infer<typeof baselineSchema>;
const fileSchema = z.strictObject({
	kind: z.enum(["missing", "file", "symlink"]),
	mode: modeSchema,
	digest: digestSchema.nullable(),
});
const packetSchema = z.strictObject({
	version: z.literal(1),
	sessionId: identity,
	featureId: identity,
	runId: identity,
	baseline: referenceSchema,
	sourceDigest: digestSchema,
	provenance: z.enum(["captured-before-run", "declared-existing-work"]),
	complete: z.literal(true),
	preservedPreexisting: z.strictObject({
		count: z.number().int().min(0).max(MAX_SOURCE_FILES),
		digest: digestSchema,
		entries: z
			.array(z.strictObject({ path: pathSchema, state: fileSchema }))
			.max(MAX_SOURCE_FILES),
	}),
	changes: z
		.array(
			z
				.strictObject({
					path: pathSchema,
					before: fileSchema,
					after: fileSchema,
					binary: z.boolean(),
					preexistingDirty: z.boolean(),
					diff: z.string(),
					acceptedBefore: fileSchema.optional(),
					acceptedDiff: z.string().optional(),
					newDiff: z.string().optional(),
				})
				.superRefine((change, context) => {
					const count = [
						change.acceptedBefore,
						change.acceptedDiff,
						change.newDiff,
					].filter((value) => value !== undefined).length;
					if (count !== 0 && count !== 3)
						context.addIssue({
							code: "custom",
							message: "Accepted evidence requires all three fields.",
						});
				}),
		)
		.max(256),
});
const packetObjectSchema = z.strictObject({
	owner: z.literal("flow-review-evidence"),
	version: z.literal(1),
	kind: z.literal("packet"),
	packet: packetSchema,
});

function hash(bytes: string | Buffer): SourceDigest {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function git(
	root: string,
	args: string[],
	maxBuffer = 32 * 1024 * 1024,
): Promise<Buffer> {
	try {
		const result = await exec("git", ["-C", root, ...args], {
			encoding: "buffer",
			maxBuffer,
			env: gitEnvironment,
		});
		return result.stdout;
	} catch (error) {
		fail("Review evidence could not read the pinned local Git objects.", error);
	}
}

async function pinGit(
	root: string,
	existingCommit?: string,
): Promise<Baseline["git"]> {
	if (existingCommit !== undefined) gitObject.parse(existingCommit);
	let commit: string;
	if (existingCommit !== undefined) {
		commit = (
			await git(root, ["rev-parse", "--verify", `${existingCommit}^{commit}`])
		)
			.toString()
			.trim();
		if (commit !== existingCommit)
			fail("Existing work requires the full immutable commit object identity.");
	} else {
		try {
			const result = await exec(
				"git",
				["-C", root, "rev-parse", "--verify", "HEAD^{commit}"],
				{ encoding: "utf8", env: gitEnvironment },
			);
			commit = result.stdout.trim();
		} catch {
			const branch = (await git(root, ["symbolic-ref", "--quiet", "HEAD"]))
				.toString()
				.trim();
			try {
				await exec(
					"git",
					["-C", root, "show-ref", "--verify", "--quiet", branch],
					{ env: gitEnvironment },
				);
			} catch (error) {
				if ((error as { code?: number }).code === 1) return { kind: "empty" };
				fail(
					"Review evidence could not establish an unborn Git baseline.",
					error,
				);
			}
			fail("Review evidence refuses an unreadable HEAD commit.");
		}
	}
	const tree = (await git(root, ["rev-parse", "--verify", `${commit}^{tree}`]))
		.toString()
		.trim();
	return {
		kind: "commit",
		commit: gitObject.parse(commit),
		tree: gitObject.parse(tree),
	};
}

type TreeEntry = Readonly<{
	path: string;
	mode: number;
	kind: "file" | "symlink";
	object: string;
	size: number;
}>;
async function treeEntries(
	root: string,
	pinned: Baseline["git"],
): Promise<Map<string, TreeEntry>> {
	if (pinned.kind === "empty") return new Map();
	const observedTree = (
		await git(root, ["rev-parse", "--verify", `${pinned.commit}^{tree}`])
	)
		.toString()
		.trim();
	if (observedTree !== pinned.tree) fail("Pinned commit and tree disagree.");
	const bytes = await git(root, [
		"ls-tree",
		"-lrz",
		"--full-tree",
		pinned.tree,
	]);
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		fail("Review evidence requires UTF-8 tree paths.", error);
	}
	const entries = new Map<string, TreeEntry>();
	for (const record of text.split("\0").filter(Boolean)) {
		const match =
			/^([0-7]{6}) ([a-z]+) ([a-f0-9]+) +([0-9]+|-)\t([\s\S]+)$/.exec(record);
		if (!match?.[1] || !match[3] || !match[4] || !match[5])
			fail("Invalid Git tree metadata.");
		const path = match[5];
		if (path === ".flow" || path.startsWith(".flow/")) continue;
		safePath(path);
		if (
			match[2] !== "blob" ||
			!["100644", "100755", "120000"].includes(match[1])
		)
			fail("Review evidence does not support gitlinks or special Git entries.");
		entries.set(path, {
			path,
			mode: match[1] === "100755" ? 0o111 : 0,
			kind: match[1] === "120000" ? "symlink" : "file",
			object: gitObject.parse(match[3]),
			size: Number(match[4]),
		});
	}
	let total = 0;
	for (const entry of entries.values()) {
		if (
			!Number.isSafeInteger(entry.size) ||
			entry.size < 0 ||
			entry.size > MAX_SOURCE_FILE_BYTES
		)
			fail("Git baseline blob exceeds the source file limit.");
		total += entry.size;
	}
	if (total > MAX_SOURCE_TOTAL_BYTES)
		fail("Git baseline exceeds the source byte limit.");
	if (entries.size > MAX_SOURCE_FILES)
		fail("Git baseline exceeds the source file limit.");
	return entries;
}

function missing(path: string): WorkspaceSourceEntry {
	return { path, kind: "missing", mode: 0, bytes: Buffer.alloc(0) };
}
async function absentSource(
	root: string,
	path: string,
): Promise<WorkspaceSourceEntry> {
	if (await workspaceSourcePathExists(root, path))
		fail(`Content at ${JSON.stringify(path)} is excluded from source binding.`);
	return missing(path);
}
type VerifiedBlobCache = { entries: Map<string, Buffer>; bytes: number };

async function treeSource(
	root: string,
	entry: TreeEntry | undefined,
	path: string,
	cache?: VerifiedBlobCache,
): Promise<WorkspaceSourceEntry> {
	if (!entry) return missing(path);
	const size = entry.size;
	if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SOURCE_FILE_BYTES)
		fail("Git baseline blob exceeds the source file limit.");
	const key = `${entry.object}:${size}`;
	const cached = cache?.entries.get(key);
	if (cached)
		return { path, kind: entry.kind, mode: entry.mode, bytes: cached };
	const bytes = await git(
		root,
		["cat-file", "blob", entry.object],
		MAX_SOURCE_FILE_BYTES + 1,
	);
	if (bytes.length !== size) fail("Incomplete Git baseline blob.");
	if (gitBlobIdentity(entry.object, bytes) !== entry.object) {
		fail("Git baseline blob content does not match its object identity.");
	}
	if (
		cache &&
		cache.entries.size < 256 &&
		cache.bytes + bytes.length <= 1024 * 1024
	) {
		cache.entries.set(key, bytes);
		cache.bytes += bytes.length;
	}
	return { path, kind: entry.kind, mode: entry.mode, bytes };
}

function gitBlobIdentity(object: string, bytes: Buffer): string {
	return createHash(object.length === 40 ? "sha1" : "sha256")
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest("hex");
}

function sameTree(
	entry: TreeEntry | undefined,
	effective: WorkspaceSourceEntry,
): boolean {
	if (!entry) return effective.kind === "missing";
	if (entry.kind !== effective.kind || entry.mode !== effective.mode)
		return false;
	return gitBlobIdentity(entry.object, effective.bytes) === entry.object;
}

function same(
	left: WorkspaceSourceEntry,
	right: WorkspaceSourceEntry,
): boolean {
	return (
		left.kind === right.kind &&
		left.mode === right.mode &&
		left.bytes.equals(right.bytes)
	);
}
function encode(entry: WorkspaceSourceEntry): Baseline["overlay"][number] {
	return {
		path: entry.path,
		kind: entry.kind,
		mode: entry.mode,
		bytes: entry.bytes.toString("base64"),
	};
}
function decode(entry: Baseline["overlay"][number]): WorkspaceSourceEntry {
	const bytes = Buffer.from(entry.bytes, "base64");
	if (
		bytes.length > MAX_SOURCE_FILE_BYTES ||
		(entry.kind === "missing" && (bytes.length || entry.mode)) ||
		(entry.kind === "symlink" && entry.mode)
	)
		fail("Invalid baseline overlay entry.");
	return { ...entry, bytes };
}
function describe(
	entry: WorkspaceSourceEntry,
): ReviewEvidencePacket["changes"][number]["before"] {
	return {
		kind: entry.kind,
		mode: entry.mode,
		digest: entry.kind === "missing" ? null : hash(entry.bytes),
	};
}
function binary(entry: WorkspaceSourceEntry): boolean {
	return entry.bytes.includes(0) || !isUtf8(entry.bytes);
}

async function diff(
	before: WorkspaceSourceEntry,
	after: WorkspaceSourceEntry,
): Promise<string> {
	const temporary = await mkdtemp(join(tmpdir(), "flow-review-diff-"));
	try {
		await writeFile(join(temporary, "before"), before.bytes, { mode: 0o600 });
		await writeFile(join(temporary, "after"), after.bytes, { mode: 0o600 });
		await chmod(join(temporary, "before"), before.mode ? 0o700 : 0o600);
		await chmod(join(temporary, "after"), after.mode ? 0o700 : 0o600);
		const attributes = join(temporary, "attributes");
		await writeFile(
			attributes,
			binary(before) || binary(after) ? "* -diff\n" : "* diff\n",
			{ mode: 0o600 },
		);
		let output: Buffer;
		try {
			output = await collectGitDiff(
				[
					"-C",
					temporary,
					"-c",
					`core.attributesFile=${attributes}`,
					"-c",
					"core.fileMode=true",
					"-c",
					"core.autocrlf=false",
					"diff",
					"--no-index",
					"--no-ext-diff",
					"--no-textconv",
					"--binary",
					"--no-color",
					"--",
					"before",
					"after",
				],
				gitEnvironment,
			);
		} catch (cause) {
			fail(
				"Review diff exceeds the evidence capacity or could not be generated.",
				cause,
			);
		}
		const a = JSON.stringify(`a/${before.path}`);
		const b = JSON.stringify(`b/${after.path}`);
		const text = output.toString("utf8");
		const boundary =
			/^(?:@@ |GIT binary patch(?:\n|$))/m.exec(text)?.index ?? text.length;
		const prefix = text
			.slice(0, boundary)
			.replace(/^diff --git [^\n]*$/m, () => `diff --git ${a} ${b}`)
			.replace(/^--- a\/before$/m, () => `--- ${a}`)
			.replace(/^\+\+\+ b\/after$/m, () => `+++ ${b}`);
		return prefix + text.slice(boundary);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function evidenceDirectory(
	root: string,
	create: boolean,
): Promise<string> {
	await pathKind(root, "directory", "the workspace evidence root");
	if (create) await ensureFlowDirectory(root);
	if (
		(await pathKind(
			join(root, ".flow"),
			"directory",
			"the Flow evidence parent",
		)) !== "present"
	)
		fail("Review evidence storage is missing.");
	const directory = join(root, ".flow", "evidence");
	if (
		create &&
		(await pathKind(directory, "directory", "the evidence directory")) ===
			"missing"
	) {
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	if (
		(await pathKind(directory, "directory", "the evidence directory")) !==
		"present"
	)
		fail("Review evidence storage is missing.");
	return directory;
}
async function evidenceParents(root: string, directory: string) {
	const parents = [];
	for (const path of [root, join(root, ".flow"), directory]) {
		const stat = await lstat(path);
		if (stat.isSymbolicLink() || !stat.isDirectory())
			fail("Unsafe review evidence parent.");
		parents.push({ path, stat });
	}
	return parents;
}
async function checkEvidenceParents(
	parents: Awaited<ReturnType<typeof evidenceParents>>,
) {
	for (const parent of parents) {
		const after = await lstat(parent.path);
		if (
			after.dev !== parent.stat.dev ||
			after.ino !== parent.stat.ino ||
			after.mode !== parent.stat.mode
		)
			fail("Review evidence parent changed during access.");
	}
}

async function readObject(
	root: string,
	reference: ReviewEvidenceReference,
	maximum: number,
	mode: "parse" | "verify" = "parse",
): Promise<unknown> {
	referenceSchema.parse(reference);
	const directory = await evidenceDirectory(root, false);
	const parents = await evidenceParents(root, directory);
	const path = join(directory, `${reference.sha256.slice(7)}.json`);
	await pathKind(path, "file", "the evidence object");
	const handle = await open(
		path,
		constants.O_RDONLY |
			(process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
	);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.size > maximum)
			fail("Review evidence object exceeds its capacity.");
		const digest = createHash("sha256");
		let bytes: Buffer | undefined;
		let length = 0;
		if (mode === "parse") {
			bytes = await handle.readFile();
			length = bytes.length;
			digest.update(bytes);
		} else {
			const chunk = Buffer.allocUnsafe(
				Math.min(64 * 1024, Math.max(before.size, 1)),
			);
			while (true) {
				const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
				if (bytesRead === 0) break;
				length += bytesRead;
				if (length > before.size || length > maximum)
					fail("Review evidence object was altered or is incomplete.");
				digest.update(chunk.subarray(0, bytesRead));
			}
		}
		const after = await lstat(path);
		if (
			length !== before.size ||
			before.ino !== after.ino ||
			before.dev !== after.dev ||
			before.mode !== after.mode ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			`sha256:${digest.digest("hex")}` !== reference.sha256
		)
			fail("Review evidence object was altered or is incomplete.");
		await checkEvidenceParents(parents);
		return bytes === undefined ? undefined : JSON.parse(bytes.toString("utf8"));
	} finally {
		await handle.close();
	}
}
async function publish(
	root: string,
	value: unknown,
	maximum: number,
): Promise<ReviewEvidenceReference> {
	const contents = JSON.stringify(value);
	if (Buffer.byteLength(contents) > maximum)
		fail("Review evidence exceeds its aggregate capacity.");
	const directory = await evidenceDirectory(root, true);
	const parents = await evidenceParents(root, directory);
	const reference = { version: 1 as const, sha256: hash(contents) };
	const path = join(directory, `${reference.sha256.slice(7)}.json`);
	if ((await pathKind(path, "file", "the evidence object")) === "present") {
		await readObject(root, reference, maximum, "verify");
	} else {
		await writeAtomically(path, contents);
	}
	await checkEvidenceParents(parents);
	return reference;
}

function validateBaseline(value: unknown): Baseline {
	const baseline = baselineSchema.parse(value);
	if (
		new Set(baseline.ownedPaths).size !== baseline.ownedPaths.length ||
		new Set(baseline.overlay.map((entry) => entry.path)).size !==
			baseline.overlay.length
	)
		fail("Baseline contains duplicate paths.");
	if (
		(baseline.provenance === "captured-before-run" &&
			baseline.ownedPaths.length > 0) ||
		(baseline.provenance === "declared-existing-work" &&
			(baseline.ownedPaths.length === 0 || baseline.git.kind !== "commit"))
	)
		fail("Baseline provenance is incomplete.");
	let bytes = 0;
	for (const entry of baseline.overlay) {
		bytes += decode(entry).bytes.length;
	}
	if (bytes > MAX_SOURCE_TOTAL_BYTES)
		fail("Baseline overlay exceeds the source byte limit.");
	return baseline;
}

async function buildPacket(
	root: string,
	input: Parameters<ReviewEvidencePort["prepare"]>[0],
): Promise<ReviewEvidencePacket> {
	const baseline = validateBaseline(
		await readObject(root, input.baseline, MAX_BASELINE_BYTES),
	);
	if (
		baseline.sessionId !== input.sessionId ||
		baseline.featureId !== input.featureId
	)
		fail("Baseline belongs to another session or feature.");
	const allowsDirtyEdit = authorizedDirtyEdit(
		input.authorizedTargets,
		input.declaredArtifacts.map((artifact) => safePath(artifact.path)),
	);
	const packetHeader = {
		version: 1,
		sessionId: input.sessionId,
		featureId: input.featureId,
		runId: input.runId,
		baseline: input.baseline,
		sourceDigest: input.sourceDigest,
		provenance: baseline.provenance,
		complete: true,
	};
	let packetBytes = Buffer.byteLength(
		JSON.stringify({
			owner: "flow-review-evidence",
			version: 1,
			kind: "packet",
			packet: {
				...packetHeader,
				preservedPreexisting: {
					count: 0,
					digest: `sha256:${"0".repeat(64)}`,
					entries: [],
				},
				changes: [],
			},
		}),
	);
	const reserve = (bytes: number) => {
		packetBytes += bytes;
		if (packetBytes > MAX_PACKET_BYTES)
			fail("Review evidence exceeds its aggregate capacity.");
	};
	reserve(0);
	const snapshot = await captureWorkspaceSource(root);
	if (snapshot.digest !== input.sourceDigest)
		fail("Source drift prevented review evidence preparation.");
	const tree = await treeEntries(root, baseline.git);
	const current = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
	const overlay = new Map(
		baseline.overlay.map((entry) => [entry.path, decode(entry)]),
	);
	const owned = new Set(baseline.ownedPaths);
	const preserved: Baseline["overlay"] = [];
	const changes: ReviewEvidencePacket["changes"][number][] = [];
	const blobs: VerifiedBlobCache = { entries: new Map(), bytes: 0 };
	for (const path of [
		...new Set([
			...tree.keys(),
			...current.keys(),
			...overlay.keys(),
			...owned,
		]),
	].sort()) {
		const preexisting = overlay.get(path);
		const after = current.get(path) ?? (await absentSource(root, path));
		if (preexisting && !owned.has(path)) {
			if (same(preexisting, after)) {
				reserve(
					Buffer.byteLength(
						JSON.stringify({ path, state: describe(preexisting) }),
					) +
						Number(preserved.length > 0) +
						String(preserved.length + 1).length -
						String(preserved.length).length,
				);
				preserved.push(encode(preexisting));
			} else if (!allowsDirtyEdit(path))
				fail(
					`Unrelated pre-existing content changed at ${JSON.stringify(path)}.`,
				);
		}
		const effectiveOverlay = owned.has(path) ? undefined : preexisting;
		const unchanged = effectiveOverlay
			? same(effectiveOverlay, after)
			: sameTree(tree.get(path), after);
		if (
			unchanged &&
			!(owned.has(path) && preexisting && !same(preexisting, after))
		)
			continue;
		const before =
			effectiveOverlay ?? (await treeSource(root, tree.get(path), path, blobs));
		const accepted = owned.has(path) ? (preexisting ?? before) : undefined;
		if (changes.length === 256)
			fail("Review evidence exceeds the 256 changed-entry limit.");
		const change = {
			path,
			before: describe(before),
			after: describe(after),
			binary:
				binary(before) ||
				binary(after) ||
				(accepted !== undefined && binary(accepted)),
			preexistingDirty: effectiveOverlay !== undefined,
			diff: "",
			...(accepted
				? { acceptedBefore: describe(accepted), acceptedDiff: "", newDiff: "" }
				: {}),
		};
		reserve(
			Buffer.byteLength(JSON.stringify(change)) + Number(changes.length > 0),
		);
		change.diff = await diff(before, after);
		reserve(jsonStringBytes(change.diff) - 2);
		if (accepted) {
			change.acceptedDiff = await diff(before, accepted);
			reserve(jsonStringBytes(change.acceptedDiff) - 2);
			change.newDiff = await diff(accepted, after);
			reserve(jsonStringBytes(change.newDiff) - 2);
		}
		changes.push(change);
	}
	if (
		(await createFileSourceIdentityProvider(root).computeSourceDigest()) !==
		input.sourceDigest
	)
		fail("Source drift prevented review evidence publication.");
	return packetSchema.parse({
		...packetHeader,
		preservedPreexisting: {
			count: preserved.length,
			digest: hash(JSON.stringify(preserved)),
			entries: preserved.map((entry) => ({
				path: entry.path,
				state: describe(decode(entry)),
			})),
		},
		changes,
	});
}

export function createFileReviewEvidenceProvider(
	workspace: string,
): ReviewEvidencePort {
	const root = assertMutableWorkspaceRoot(workspace);
	return {
		async captureBaseline(input) {
			const snapshot = await captureWorkspaceSource(root);
			if (snapshot.digest !== input.sourceDigest)
				fail("Source drift prevented baseline capture.");
			const ownedPaths = input.existingWork?.ownedPaths.map(safePath) ?? [];
			if (
				input.existingWork &&
				(ownedPaths.length === 0 ||
					new Set(ownedPaths).size !== ownedPaths.length)
			)
				fail("Existing work requires unique exact owned paths.");
			const pinned = await pinGit(root, input.existingWork?.baseCommit);
			const tree = await treeEntries(root, pinned);
			const effective = new Map(
				snapshot.entries.map((entry) => [entry.path, entry]),
			);
			for (const path of ownedPaths) {
				if (!effective.has(path) && !tree.has(path))
					fail(
						`Owned path ${JSON.stringify(path)} is excluded from source binding.`,
					);
			}
			const overlay: Baseline["overlay"] = [];
			for (const path of [
				...new Set([...tree.keys(), ...effective.keys()]),
			].sort()) {
				const current = effective.get(path) ?? (await absentSource(root, path));
				if (!sameTree(tree.get(path), current)) overlay.push(encode(current));
			}
			if (
				(await createFileSourceIdentityProvider(root).computeSourceDigest()) !==
				input.sourceDigest
			)
				fail("Source drift prevented baseline publication.");
			const baseline = validateBaseline({
				owner: "flow-review-evidence",
				version: 1,
				kind: "baseline",
				sessionId: input.sessionId,
				featureId: input.featureId,
				originRunId: input.originRunId,
				sourceDigest: input.sourceDigest,
				provenance: input.existingWork
					? "declared-existing-work"
					: "captured-before-run",
				git: pinned,
				ownedPaths: ownedPaths.sort(),
				overlay,
			});
			return publish(root, baseline, MAX_BASELINE_BYTES);
		},
		async prepare(input) {
			const packet = await buildPacket(root, input);
			return publish(
				root,
				{ owner: "flow-review-evidence", version: 1, kind: "packet", packet },
				MAX_PACKET_BYTES,
			);
		},
		async read(input) {
			const object = packetObjectSchema.parse(
				await readObject(root, input.reference, MAX_PACKET_BYTES),
			);
			const packet = object.packet;
			if (
				packet.sessionId !== input.sessionId ||
				packet.featureId !== input.featureId ||
				packet.runId !== input.runId ||
				packet.sourceDigest !== input.sourceDigest
			)
				fail("Review evidence binding does not match the assignment.");
			const baseline = validateBaseline(
				await readObject(root, packet.baseline, MAX_BASELINE_BYTES),
			);
			if (
				baseline.sessionId !== input.sessionId ||
				baseline.featureId !== input.featureId ||
				baseline.provenance !== packet.provenance
			)
				fail("Review baseline binding does not match the assignment.");
			const tree = await treeEntries(root, baseline.git);
			const owned = new Set(baseline.ownedPaths);
			const changedPaths = new Set(packet.changes.map((entry) => entry.path));
			const dirtyInputs = new Map(
				baseline.overlay.map((entry) => [entry.path, entry]),
			);
			const preserved = baseline.overlay
				.filter(
					(entry) => !owned.has(entry.path) && !changedPaths.has(entry.path),
				)
				.sort((left, right) =>
					left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
				);
			const expectedEntries = preserved.map((entry) => ({
				path: entry.path,
				state: describe(decode(entry)),
			}));
			if (
				packet.preservedPreexisting.count !== preserved.length ||
				packet.preservedPreexisting.digest !==
					hash(JSON.stringify(preserved)) ||
				JSON.stringify(packet.preservedPreexisting.entries) !==
					JSON.stringify(expectedEntries)
			) {
				fail("Review packet preserved inventory does not match its baseline.");
			}
			if (
				new Set(packet.changes.map((entry) => entry.path)).size !==
				packet.changes.length
			)
				fail("Review packet contains duplicate changed paths.");
			for (const change of packet.changes) {
				if (owned.has(change.path)) {
					const raw = dirtyInputs.get(change.path);
					const accepted = raw
						? decode(raw)
						: await treeSource(root, tree.get(change.path), change.path);
					if (
						change.acceptedBefore === undefined ||
						change.acceptedDiff === undefined ||
						change.newDiff === undefined ||
						JSON.stringify(change.acceptedBefore) !==
							JSON.stringify(describe(accepted))
					)
						fail(
							"Review packet accepted state does not match its captured baseline.",
						);
				} else if (
					change.acceptedBefore !== undefined ||
					change.acceptedDiff !== undefined ||
					change.newDiff !== undefined
				) {
					fail("Accepted evidence requires explicit existing-work ownership.");
				}
				const dirty = owned.has(change.path)
					? undefined
					: dirtyInputs.get(change.path);
				if (
					change.preexistingDirty !== (dirty !== undefined) ||
					(dirty &&
						JSON.stringify(change.before) !==
							JSON.stringify(describe(decode(dirty))))
				)
					fail(
						"Review packet dirty input does not match its captured baseline.",
					);
				for (const entry of [change.before, change.after]) {
					if (
						(entry.kind === "missing") !== (entry.digest === null) ||
						(entry.kind !== "file" && entry.mode !== 0)
					)
						fail("Review packet has incomplete file evidence.");
				}
			}
			return packet;
		},
	};
}
