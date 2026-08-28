import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, sep } from "node:path";
import { promisify } from "node:util";
import { createFileSourceIdentityProvider } from "../src/infrastructure/fs/source-identity.js";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import { normalizeRecorded, REDACTED } from "./cassette.js";
import { pseudonymizeEvalIds } from "./grader-input.js";
import type {
	ArtifactIdentity,
	EvaluatorIdentity,
	InstructionDelivery,
	ModelIdentity,
} from "./report.js";

const exec = promisify(execFile);

type ArchiveEntry = {
	readonly path: string;
	readonly kind: "file" | "directory";
	readonly bytes: Buffer;
};

export type PackedPackageManifest = {
	readonly version: string;
	readonly dependencies?: Record<string, unknown>;
	readonly devDependencies?: Record<string, unknown>;
};

export type WorkingSourceIdentity = Pick<
	ArtifactIdentity,
	"sourceCommit" | "sourceTreeSha256"
>;

export type PackedArtifactIdentity = Pick<
	ArtifactIdentity,
	"packageVersion" | "tarballSha256" | "unpackedManifestSha256"
>;

export type RequestedModelInput = {
	readonly modelId: string;
	readonly gateway: string | null;
	readonly family: string;
	readonly revision: string | null;
};

export type EvaluatorIdentityInput = {
	readonly sourceCommit: string;
	readonly caseCatalog: unknown;
	readonly policyCatalog: unknown;
	readonly graderBundle: unknown;
};

export type InstructionInput = {
	readonly source: InstructionDelivery["source"];
	readonly name: string;
	readonly sequence: number;
	readonly text: string;
};

export type RedactedTranscript = {
	readonly text: string;
	readonly sha256: string;
};

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function text(value: Buffer | string): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}

async function run(command: string, args: readonly string[]): Promise<Buffer> {
	const result = await exec(command, [...args], {
		encoding: "buffer",
		maxBuffer: 64 * 1024 * 1024,
	});
	return Buffer.isBuffer(result.stdout)
		? result.stdout
		: Buffer.from(result.stdout);
}

async function tar(args: readonly string[]): Promise<Buffer> {
	let unavailable: unknown = null;
	for (const command of ["bsdtar", "tar"]) {
		try {
			return await run(command, args);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			unavailable = error;
		}
	}
	throw new Error(
		"A bsdtar or tar executable is required to inspect eval artifacts.",
		{
			cause: unavailable,
		},
	);
}

function archivePath(path: string): string {
	const normalized = normalize(path).replaceAll("\\", "/");
	if (
		path.length === 0 ||
		path.startsWith("-") ||
		isAbsolute(path) ||
		path.includes("\\") ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith(`..${sep}`) ||
		normalized.split("/").includes("..")
	) {
		throw new Error(`Unsafe tar archive path: ${JSON.stringify(path)}.`);
	}
	return normalized.replace(/\/$/, "");
}

async function archiveEntries(
	tarballPath: string,
): Promise<readonly ArchiveEntry[]> {
	const listed = text(await tar(["-tzf", tarballPath]));
	const paths = listed.split("\n").filter(Boolean).map(archivePath);
	const verbose = text(await tar(["-tvzf", tarballPath]))
		.split("\n")
		.filter(Boolean);
	if (verbose.length !== paths.length) {
		throw new Error("Tar archive listing changed while computing provenance.");
	}
	const known = new Set<string>();
	const entries: ArchiveEntry[] = [];
	for (const [index, path] of paths.entries()) {
		if (known.has(path))
			throw new Error(`Duplicate tar archive path: ${path}.`);
		known.add(path);
		const type = verbose[index]?.[0];
		if (type !== "-" && type !== "d") {
			throw new Error(`Unsupported tar archive entry type for ${path}.`);
		}
		entries.push({
			path,
			kind: type === "d" ? "directory" : "file",
			bytes:
				type === "d"
					? Buffer.alloc(0)
					: await tar(["-xOzf", tarballPath, path]),
		});
	}
	return entries.toSorted((left, right) => left.path.localeCompare(right.path));
}

function packageManifest(
	entries: readonly ArchiveEntry[],
): PackedPackageManifest {
	const manifest = entries.find(
		(entry) => entry.path === "package/package.json",
	);
	if (manifest?.kind !== "file")
		throw new Error("Packed artifact is missing package/package.json.");
	const parsed: unknown = JSON.parse(manifest.bytes.toString("utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(
			"Packed artifact package.json must contain a string version.",
		);
	}
	const version = Reflect.get(parsed, "version");
	if (typeof version !== "string") {
		throw new Error(
			"Packed artifact package.json must contain a string version.",
		);
	}
	const dependencies = Reflect.get(parsed, "dependencies");
	const devDependencies = Reflect.get(parsed, "devDependencies");
	const record = (value: unknown): Record<string, unknown> | undefined =>
		value && typeof value === "object" && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value))
			: undefined;
	const dependencyRecord = record(dependencies);
	const devDependencyRecord = record(devDependencies);
	return {
		version,
		...(dependencyRecord ? { dependencies: dependencyRecord } : {}),
		...(devDependencyRecord ? { devDependencies: devDependencyRecord } : {}),
	};
}

export async function packedPackageManifest(
	tarballPath: string,
): Promise<PackedPackageManifest> {
	return packageManifest(await archiveEntries(tarballPath));
}

async function gitCommit(repositoryRoot: string): Promise<string> {
	return text(
		await run("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
	).trim();
}

export async function inspectWorkingSource(
	repositoryRoot: string,
): Promise<WorkingSourceIdentity> {
	const sourceCommit = await gitCommit(repositoryRoot);
	const sourceTreeSha256 =
		await createFileSourceIdentityProvider(
			repositoryRoot,
		).computeSourceDigest();
	if ((await gitCommit(repositoryRoot)) !== sourceCommit) {
		throw new Error("Git commit changed while computing source identity.");
	}
	return { sourceCommit, sourceTreeSha256 };
}

export async function tarballSha256(tarballPath: string): Promise<string> {
	return sha256(await readFile(tarballPath));
}

export async function unpackedManifestSha256(
	tarballPath: string,
): Promise<string> {
	const entries = await archiveEntries(tarballPath);
	return canonicalSha256(
		"flow-unpacked-tar-manifest-v1",
		entries.map((entry) => ({
			path: entry.path,
			kind: entry.kind,
			sha256: sha256(entry.bytes),
		})),
	);
}

export async function inspectArtifact(input: {
	readonly repositoryRoot: string;
	readonly tarballPath: string;
}): Promise<ArtifactIdentity> {
	const source = await inspectWorkingSource(input.repositoryRoot);
	const tarballDigest = await tarballSha256(input.tarballPath);
	const entries = await archiveEntries(input.tarballPath);
	if ((await tarballSha256(input.tarballPath)) !== tarballDigest) {
		throw new Error("Packed artifact changed while computing provenance.");
	}
	return {
		packageVersion: packageManifest(entries).version,
		...source,
		tarballSha256: tarballDigest,
		unpackedManifestSha256: canonicalSha256(
			"flow-unpacked-tar-manifest-v1",
			entries.map((entry) => ({
				path: entry.path,
				kind: entry.kind,
				sha256: sha256(entry.bytes),
			})),
		),
	};
}

export function samePackedArtifact(
	left: PackedArtifactIdentity,
	right: PackedArtifactIdentity,
): boolean {
	return (
		left.packageVersion === right.packageVersion &&
		left.tarballSha256 === right.tarballSha256 &&
		left.unpackedManifestSha256 === right.unpackedManifestSha256
	);
}

export function evaluatorIdentity(
	input: EvaluatorIdentityInput,
): EvaluatorIdentity {
	return {
		sourceCommit: input.sourceCommit,
		caseCatalogSha256: canonicalSha256(
			"flow-evaluator-case-catalog-v1",
			input.caseCatalog,
		),
		policyCatalogSha256: canonicalSha256(
			"flow-evaluator-policy-catalog-v1",
			input.policyCatalog,
		),
		graderBundleSha256: canonicalSha256(
			"flow-evaluator-grader-bundle-v1",
			input.graderBundle,
		),
	};
}

export function hostConfigSha256(config: unknown): string {
	return canonicalSha256("flow-eval-host-config-v1", config);
}

export function normalizeRequestedModel(
	input: RequestedModelInput,
): ModelIdentity {
	const boundary = input.modelId.indexOf("/");
	if (boundary <= 0 || boundary === input.modelId.length - 1) {
		throw new Error(
			`Model id ${JSON.stringify(input.modelId)} must be providerID/modelID.`,
		);
	}
	return {
		routeProvider: input.modelId.slice(0, boundary),
		gateway: input.gateway,
		family: input.family,
		model: input.modelId.slice(boundary + 1),
		revision: input.revision,
	};
}

export function instructionDelivery(
	input: InstructionInput,
): InstructionDelivery {
	if (!input.text.isWellFormed()) {
		throw new Error(
			"Instruction text must contain only Unicode scalar values.",
		);
	}
	const bytes = new TextEncoder().encode(input.text);
	return {
		source: input.source,
		name: input.name,
		sequence: input.sequence,
		sha256: sha256(bytes),
		bytes: bytes.byteLength,
	};
}

const SENSITIVE_FIELD =
	/(?:authorization|credential|password|passwd|secret|token|api[_-]?key|client[_-]?secret)/i;
const TOKEN_COUNT_FIELD =
	/^(?:input|output|reasoning|cache[_-]?(?:read|write))[_-]?tokens$/i;

function isTokenCountField(key: string, value: unknown): boolean {
	return (
		TOKEN_COUNT_FIELD.test(key) &&
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0
	);
}

function isSensitiveField(key: string, value: unknown): boolean {
	return SENSITIVE_FIELD.test(key) && !isTokenCountField(key, value);
}

function redactSensitiveFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSensitiveFields);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				isSensitiveField(key, item) ? REDACTED : redactSensitiveFields(item),
			]),
		);
	}
	return value;
}

export function redactTranscript(input: {
	readonly value: unknown;
	readonly projectPath: string;
}): RedactedTranscript {
	const text = canonicalJson(
		pseudonymizeEvalIds(
			redactSensitiveFields(normalizeRecorded(input.value, input.projectPath)),
		),
	);
	return { text, sha256: sha256(new TextEncoder().encode(text)) };
}
