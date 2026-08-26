#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	link,
	mkdir,
	open,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import {
	mapStrings,
	normalizeRecorded,
	scrubSecrets,
} from "../evals/cassette.js";
import {
	inspectArtifact,
	packedPackageManifest,
	samePackedArtifact,
} from "../evals/provenance.js";
import type { ActorIdentity, ArtifactIdentity } from "../evals/report.js";
import { reportArtifactForCanary } from "../evals/report-artifact.js";

export const CANARY_CHECKLIST_VERSION = "phase9-canary-v1";
export const CANARY_CHECK_IDS = [
	"installs-packed-artifact",
	"loads-flow-tools",
	"saves-plan",
	"captures-validation",
	"dispatches-reviewer",
	"closes-with-delivery",
] as const;
export const CANARY_MAX_AGE_MS = 72 * 60 * 60 * 1_000;

const checklist = {
	version: CANARY_CHECKLIST_VERSION,
	checks: CANARY_CHECK_IDS,
	maxAgeMs: CANARY_MAX_AGE_MS,
};
export const CANARY_CHECKLIST_SHA256 = canonicalSha256(
	"flow-canary-checklist-v1",
	checklist,
);

const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const TextSchema = z.string().min(1).max(4096).regex(/\S/);
const ModelIdentitySchema = z
	.object({
		routeProvider: TextSchema,
		gateway: TextSchema.nullable(),
		family: TextSchema,
		model: TextSchema,
		revision: TextSchema.nullable(),
	})
	.strict();
const ObservedModelIdentitySchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("observed"), value: ModelIdentitySchema })
		.strict(),
	z.object({ kind: z.literal("unobserved"), reason: TextSchema }).strict(),
]);
const ActorIdentitySchema = z
	.object({
		role: z.enum(["manager", "reviewer"]),
		requestedModel: ModelIdentitySchema,
		actualModel: ObservedModelIdentitySchema,
		sessionIds: z.array(TextSchema),
	})
	.strict();
const RedactedActorIdentitySchema = ActorIdentitySchema.refine(
	(actor) =>
		actor.sessionIds.every((sessionId) => sessionId === "<redacted-id>"),
	"Canary actor session ids must be redacted.",
);
const ArtifactIdentitySchema = z
	.object({
		packageVersion: TextSchema,
		sourceCommit: TextSchema,
		sourceTreeSha256: DigestSchema,
		tarballSha256: DigestSchema,
		unpackedManifestSha256: DigestSchema,
	})
	.strict();
const ChecksSchema = z
	.object({
		"installs-packed-artifact": z.boolean(),
		"loads-flow-tools": z.boolean(),
		"saves-plan": z.boolean(),
		"captures-validation": z.boolean(),
		"dispatches-reviewer": z.boolean(),
		"closes-with-delivery": z.boolean(),
	})
	.strict();
const PackageMetadataSchema = z
	.object({
		dependencies: z.object({ zod: TextSchema }).passthrough(),
		devDependencies: z
			.object({ "@opencode-ai/plugin": TextSchema })
			.passthrough(),
	})
	.passthrough();
const EvidenceRefSchema = z
	.object({
		path: TextSchema,
		sha256: DigestSchema,
		bytes: z.number().int().safe().nonnegative(),
	})
	.strict();

export const PreparedCanarySchema = z
	.object({
		schemaVersion: z.literal(1),
		releaseTag: TextSchema,
		artifact: ArtifactIdentitySchema,
		artifactSha256: DigestSchema,
		checklistVersion: z.literal(CANARY_CHECKLIST_VERSION),
		checklistSha256: DigestSchema,
		preparedAt: z.string().datetime({ offset: true }),
		artifactFile: z.literal("artifact.tgz"),
		pluginEntrySha256: DigestSchema,
		sha256: DigestSchema,
	})
	.strict();
export type PreparedCanary = z.infer<typeof PreparedCanarySchema>;

export const CanaryRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		status: z.enum(["passed", "failed", "incomplete"]),
		artifact: ArtifactIdentitySchema,
		artifactSha256: DigestSchema,
		releaseTag: TextSchema,
		operator: TextSchema,
		recordedAt: z.string().datetime({ offset: true }),
		expiresAt: z.string().datetime({ offset: true }),
		checklistVersion: z.literal(CANARY_CHECKLIST_VERSION),
		checklistSha256: DigestSchema,
		checks: ChecksSchema,
		hostConfigSha256: DigestSchema,
		actors: z.array(RedactedActorIdentitySchema),
		artifacts: z
			.object({
				session: EvidenceRefSchema.nullable(),
				transcript: EvidenceRefSchema.nullable(),
			})
			.strict(),
		recordSha256: DigestSchema,
	})
	.strict()
	.superRefine((record, context) => {
		const values = Object.values(record.checks);
		if (record.status === "passed" && !values.every(Boolean)) {
			context.addIssue({
				code: "custom",
				path: ["checks"],
				message: "Passed canaries require every check.",
			});
		}
		if (record.status === "failed" && !values.some((value) => !value)) {
			context.addIssue({
				code: "custom",
				path: ["checks"],
				message: "Failed canaries require a failed check.",
			});
		}
		if (
			record.status === "passed" &&
			(record.actors.length === 0 ||
				record.artifacts.session === null ||
				record.artifacts.transcript === null)
		) {
			context.addIssue({
				code: "custom",
				path: ["artifacts"],
				message:
					"Passed canaries require actors, session, and transcript evidence.",
			});
		}
	});
export type CanaryRecord = z.infer<typeof CanaryRecordSchema>;

function sha256(bytes: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function artifactIdentitySha256(artifact: ArtifactIdentity): string {
	return canonicalSha256("flow-canary-artifact-v1", artifact);
}

export function canaryRecordSha256(
	record: Omit<CanaryRecord, "recordSha256">,
): string {
	return canonicalSha256("flow-canary-record-v1", record);
}

export function preparedCanarySha256(
	prepared: Omit<PreparedCanary, "sha256">,
): string {
	return canonicalSha256("flow-canary-preparation-v1", prepared);
}

function parsePreparedCanary(input: unknown): PreparedCanary {
	const prepared = PreparedCanarySchema.parse(input);
	const { sha256: _sha256, ...withoutHash } = prepared;
	if (
		prepared.sha256 !== preparedCanarySha256(withoutHash) ||
		prepared.releaseTag !== `v${prepared.artifact.packageVersion}` ||
		prepared.artifactSha256 !== artifactIdentitySha256(prepared.artifact) ||
		prepared.checklistSha256 !== CANARY_CHECKLIST_SHA256
	) {
		throw new Error("Canary preparation bindings are invalid.");
	}
	return prepared;
}

export function parseCanaryRecord(
	input: unknown,
):
	| { readonly ok: true; readonly value: CanaryRecord }
	| { readonly ok: false; readonly issues: readonly string[] } {
	const parsed = CanaryRecordSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) => issue.message),
		};
	}
	const record = parsed.data;
	const { recordSha256: _recordSha256, ...withoutHash } = record;
	const issues = [
		...(record.releaseTag === `v${record.artifact.packageVersion}`
			? []
			: ["Canary tag does not match its artifact version."]),
		...(record.artifactSha256 === artifactIdentitySha256(record.artifact)
			? []
			: ["Canary artifact identity hash is invalid."]),
		...(record.checklistSha256 === CANARY_CHECKLIST_SHA256
			? []
			: ["Canary checklist hash is invalid."]),
		...(record.recordSha256 === canaryRecordSha256(withoutHash)
			? []
			: ["Canary record hash is invalid."]),
		...(Date.parse(record.expiresAt) - Date.parse(record.recordedAt) ===
		CANARY_MAX_AGE_MS
			? []
			: ["Canary expiry is not checklist-derived."]),
	];
	return issues.length > 0
		? { ok: false, issues }
		: { ok: true, value: record };
}

function syncDirectory(path: string): Promise<void> {
	return open(path, "r")
		.then(async (handle) => {
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
		})
		.catch(() => {});
}

async function writeImmutable(path: string, bytes: Buffer): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	try {
		const existing = await readFile(path);
		if (existing.equals(bytes)) return;
		throw new Error(`Immutable canary artifact conflicts: ${path}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(temporary, path);
		await syncDirectory(dirname(path));
		await unlink(temporary);
		await syncDirectory(dirname(path));
	} catch (error) {
		await unlink(temporary).catch(() => {});
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			const existing = await readFile(path);
			if (existing.equals(bytes)) return;
		}
		throw error;
	}
}

function extractArtifactFile(artifactPath: string, member: string): Buffer {
	for (const command of ["bsdtar", "tar"]) {
		const result = spawnSync(command, ["-xOf", artifactPath, member], {
			encoding: "buffer",
			maxBuffer: 32 * 1024 * 1024,
		});
		if (result.status === 0 && Buffer.isBuffer(result.stdout))
			return result.stdout;
		if (
			result.error &&
			(result.error as NodeJS.ErrnoException).code === "ENOENT"
		)
			continue;
	}
	throw new Error(`Canary preparation could not extract ${member}.`);
}

export async function prepareCanary(input: {
	readonly repositoryRoot: string;
	readonly artifactPath: string;
	readonly expectedArtifact?: ArtifactIdentity;
	readonly outputDirectory: string;
	readonly preparedAt?: Date;
}): Promise<PreparedCanary> {
	const inspectedArtifact = await inspectArtifact({
		repositoryRoot: input.repositoryRoot,
		tarballPath: input.artifactPath,
	});
	if (
		input.expectedArtifact &&
		!samePackedArtifact(input.expectedArtifact, inspectedArtifact)
	) {
		throw new Error(
			"Canary artifact does not match the measured campaign artifact.",
		);
	}
	const artifact = input.expectedArtifact ?? inspectedArtifact;
	const fixture = join(input.outputDirectory, "fixture");
	await mkdir(join(fixture, ".opencode", "plugins"), { recursive: true });
	const copiedArtifactPath = join(input.outputDirectory, "artifact.tgz");
	await copyFile(input.artifactPath, copiedArtifactPath);
	const copiedArtifact = await inspectArtifact({
		repositoryRoot: input.repositoryRoot,
		tarballPath: copiedArtifactPath,
	});
	if (!samePackedArtifact(artifact, copiedArtifact)) {
		throw new Error(
			"Copied canary artifact does not match its campaign bytes.",
		);
	}
	const pluginEntry = extractArtifactFile(
		copiedArtifactPath,
		"package/dist/index.js",
	);
	const packageMetadata = PackageMetadataSchema.parse(
		await packedPackageManifest(copiedArtifactPath),
	);
	await writeFile(
		join(fixture, ".opencode", "plugins", "flow.js"),
		pluginEntry,
	);
	await writeFile(
		join(fixture, ".opencode", "package.json"),
		`${JSON.stringify(
			{
				private: true,
				dependencies: {
					"@opencode-ai/plugin":
						packageMetadata.devDependencies["@opencode-ai/plugin"],
					zod: packageMetadata.dependencies.zod,
				},
			},
			null,
			2,
		)}\n`,
	);
	await mkdir(join(fixture, "src"), { recursive: true });
	await writeFile(
		join(fixture, "src", "canary.ts"),
		"export const canary = true;\n",
	);
	await writeFile(
		join(fixture, "README.md"),
		`# Flow exact-artifact canary\n\nArtifact: ${artifact.tarballSha256}\n\nRun every checklist item and export sanitized JSON session and transcript evidence.\n`,
	);
	const base: Omit<PreparedCanary, "sha256"> = {
		schemaVersion: 1 as const,
		releaseTag: `v${artifact.packageVersion}`,
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: (input.preparedAt ?? new Date()).toISOString(),
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: sha256(pluginEntry),
	};
	const prepared: PreparedCanary = {
		...base,
		sha256: preparedCanarySha256(base),
	};
	PreparedCanarySchema.parse(prepared);
	await writeImmutable(
		join(input.outputDirectory, "prepared.json"),
		Buffer.from(canonicalJson(prepared)),
	);
	return prepared;
}

export async function prepareCanaryFromReport(input: {
	readonly repositoryRoot: string;
	readonly reportPath: string;
	readonly outputDirectory: string;
	readonly preparedAt?: Date;
}): Promise<PreparedCanary> {
	const reportArtifact = await reportArtifactForCanary({
		repositoryRoot: input.repositoryRoot,
		reportPath: input.reportPath,
	});
	return prepareCanary({
		repositoryRoot: input.repositoryRoot,
		artifactPath: reportArtifact.artifactPath,
		expectedArtifact: reportArtifact.artifact,
		outputDirectory: input.outputDirectory,
		...(input.preparedAt ? { preparedAt: input.preparedAt } : {}),
	});
}

function redactEvidence(value: unknown, projectPath: string): unknown {
	const normalized = normalizeRecorded(value, projectPath);
	return mapStrings(normalized, (text) =>
		scrubSecrets(text).replace(
			/\b(?:ses_[A-Za-z0-9]+|(?:session|review):[A-Za-z0-9-]+)\b/g,
			"<redacted-id>",
		),
	);
}

async function writeEvidence(input: {
	readonly repositoryRoot: string;
	readonly version: string;
	readonly kind: "session" | "transcript";
	readonly value: unknown | null;
	readonly projectPath: string;
}): Promise<z.infer<typeof EvidenceRefSchema> | null> {
	if (input.value === null) return null;
	const bytes = Buffer.from(
		canonicalJson(redactEvidence(input.value, input.projectPath)),
	);
	const artifact = `artifacts/${input.version}-${input.kind}.json`;
	await writeImmutable(
		join(input.repositoryRoot, "evals", "canary", artifact),
		bytes,
	);
	return { path: artifact, sha256: sha256(bytes), bytes: bytes.byteLength };
}

export async function recordCanary(input: {
	readonly repositoryRoot: string;
	readonly prepared: PreparedCanary;
	readonly status: "passed" | "failed" | "incomplete";
	readonly operator: string;
	readonly hostConfig: unknown;
	readonly actors: readonly ActorIdentity[];
	readonly checks: z.infer<typeof ChecksSchema>;
	readonly projectPath: string;
	readonly session: unknown | null;
	readonly transcript: unknown | null;
	readonly recordedAt?: Date;
}): Promise<{ readonly path: string; readonly record: CanaryRecord }> {
	const prepared = parsePreparedCanary(input.prepared);
	const recordedAt = input.recordedAt ?? new Date();
	const parsedChecks = ChecksSchema.parse(input.checks);
	const parsedActors = z.array(ActorIdentitySchema).parse(input.actors);
	const checkValues = Object.values(parsedChecks);
	if (input.status === "passed" && !checkValues.every(Boolean)) {
		throw new Error("Passed canaries require every check.");
	}
	if (input.status === "failed" && !checkValues.some((value) => !value)) {
		throw new Error("Failed canaries require a failed check.");
	}
	if (
		input.status === "passed" &&
		(parsedActors.length === 0 ||
			input.session === null ||
			input.transcript === null)
	) {
		throw new Error(
			"Passed canaries require actors, session, and transcript evidence.",
		);
	}
	const session = await writeEvidence({
		repositoryRoot: input.repositoryRoot,
		version: prepared.artifact.packageVersion,
		kind: "session",
		value: input.session,
		projectPath: input.projectPath,
	});
	const transcript = await writeEvidence({
		repositoryRoot: input.repositoryRoot,
		version: prepared.artifact.packageVersion,
		kind: "transcript",
		value: input.transcript,
		projectPath: input.projectPath,
	});
	const base: Omit<CanaryRecord, "recordSha256"> = {
		schemaVersion: 1 as const,
		status: input.status,
		artifact: prepared.artifact,
		artifactSha256: prepared.artifactSha256,
		releaseTag: prepared.releaseTag,
		operator: input.operator,
		recordedAt: recordedAt.toISOString(),
		expiresAt: new Date(recordedAt.getTime() + CANARY_MAX_AGE_MS).toISOString(),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		checks: parsedChecks,
		hostConfigSha256: canonicalSha256(
			"flow-canary-host-config-v1",
			input.hostConfig,
		),
		actors: parsedActors.map((actor) => ({
			...actor,
			sessionIds: actor.sessionIds.map(() => "<redacted-id>"),
		})),
		artifacts: { session, transcript },
	};
	const record: CanaryRecord = {
		...base,
		recordSha256: canaryRecordSha256(base),
	};
	const parsed = parseCanaryRecord(record);
	if (!parsed.ok) throw new Error(parsed.issues.join("; "));
	const path = join(
		input.repositoryRoot,
		"evals",
		"canary",
		`${prepared.artifact.packageVersion}.json`,
	);
	await writeImmutable(path, Buffer.from(canonicalJson(record)));
	return { path, record };
}

function insideCanaryDirectory(directory: string, path: string): string | null {
	if (isAbsolute(path)) return null;
	const root = resolve(directory);
	const target = resolve(join(root, path));
	const within = relative(root, target);
	return within && !within.startsWith("..") && !isAbsolute(within)
		? target
		: null;
}

async function evidenceIssue(
	directory: string,
	ref: z.infer<typeof EvidenceRefSchema> | null,
): Promise<string | null> {
	if (!ref) return "Canary evidence artifact is missing.";
	const target = insideCanaryDirectory(directory, ref.path);
	if (!target) return "Canary evidence path escapes its directory.";
	try {
		const bytes = await readFile(target);
		const info = await stat(target);
		return bytes.byteLength === ref.bytes &&
			sha256(bytes) === ref.sha256 &&
			info.isFile()
			? null
			: "Canary evidence digest or size does not match.";
	} catch {
		return "Canary evidence artifact is unreadable.";
	}
}

export async function canaryRecordIssue(input: {
	readonly version: string;
	readonly record: unknown;
	readonly expectedArtifact: ArtifactIdentity;
	readonly directory: string;
	readonly now?: Date;
}): Promise<string | null> {
	const parsed = parseCanaryRecord(input.record);
	if (!parsed.ok) return parsed.issues[0] ?? "Canary record is invalid.";
	const record = parsed.value;
	if (record.artifact.packageVersion !== input.version)
		return "Canary artifact version does not match the release.";
	if (!samePackedArtifact(record.artifact, input.expectedArtifact))
		return "Canary artifact does not match the rebuilt artifact.";
	if (record.status !== "passed") return `Canary status is ${record.status}.`;
	const now = (input.now ?? new Date()).getTime();
	if (Date.parse(record.recordedAt) > now) return "Canary is future-dated.";
	if (Date.parse(record.expiresAt) <= now) return "Canary is expired.";
	const sessionIssue = await evidenceIssue(
		input.directory,
		record.artifacts.session,
	);
	if (sessionIssue) return sessionIssue;
	return evidenceIssue(input.directory, record.artifacts.transcript);
}

export async function verifyCanary(input: {
	readonly repositoryRoot: string;
	readonly artifactPath: string;
	readonly mode: "dry-run" | "strict";
	readonly now?: Date;
}): Promise<{
	readonly verdict: "VERIFIED" | "NOT VERIFIED" | "INCONCLUSIVE";
	readonly issue: string | null;
	readonly record: CanaryRecord | null;
}> {
	const artifact = await inspectArtifact({
		repositoryRoot: input.repositoryRoot,
		tarballPath: input.artifactPath,
	});
	const directory = join(input.repositoryRoot, "evals", "canary");
	let raw: unknown;
	try {
		raw = JSON.parse(
			await readFile(
				join(directory, `${artifact.packageVersion}.json`),
				"utf8",
			),
		);
	} catch {
		const issue = "Canary record is missing.";
		return { verdict: "INCONCLUSIVE", issue, record: null };
	}
	const issue = await canaryRecordIssue({
		version: artifact.packageVersion,
		record: raw,
		expectedArtifact: artifact,
		directory,
		...(input.now ? { now: input.now } : {}),
	});
	const parsed = parseCanaryRecord(raw);
	const record = parsed.ok ? parsed.value : null;
	if (!issue) return { verdict: "VERIFIED", issue: null, record };
	const inconclusive = /missing|incomplete/i.test(issue);
	const verdict = inconclusive ? "INCONCLUSIVE" : "NOT VERIFIED";
	if (input.mode === "strict") return { verdict, issue, record };
	return { verdict, issue, record };
}

function option(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

function required(args: readonly string[], name: string): string {
	const value = option(args, name);
	if (!value || value.startsWith("--"))
		throw new Error(`${name} requires a value.`);
	return value;
}

function hasOption(args: readonly string[], name: string): boolean {
	return args.some(
		(argument) => argument === name || argument.startsWith(`${name}=`),
	);
}

async function json(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

async function main(args: readonly string[]): Promise<void> {
	const command = args[0];
	const repositoryRoot = join(import.meta.dir, "..");
	if (command === "--help" || command === "-h") {
		process.stdout.write(
			"Usage: eval:canary <prepare|record|verify> [options]\n",
		);
		return;
	}
	if (command === "prepare") {
		if (hasOption(args, "--artifact")) {
			throw new Error(
				"prepare requires --report; free artifact paths are refused.",
			);
		}
		const prepared = await prepareCanaryFromReport({
			repositoryRoot,
			reportPath: required(args, "--report"),
			outputDirectory: required(args, "--out"),
		});
		process.stdout.write(
			`INCONCLUSIVE: manual canary pending\n${canonicalJson(prepared)}\n`,
		);
		return;
	}
	if (command === "record") {
		const status = required(args, "--status");
		if (status !== "passed" && status !== "failed" && status !== "incomplete")
			throw new Error("--status must be passed, failed, or incomplete.");
		const result = await recordCanary({
			repositoryRoot,
			prepared: PreparedCanarySchema.parse(
				await json(required(args, "--prepared")),
			),
			status,
			operator: required(args, "--operator"),
			hostConfig: await json(required(args, "--host-config")),
			actors: z
				.array(ActorIdentitySchema)
				.parse(await json(required(args, "--actors"))),
			checks: ChecksSchema.parse(await json(required(args, "--checks"))),
			projectPath: required(args, "--project-path"),
			session: option(args, "--session")
				? await json(required(args, "--session"))
				: null,
			transcript: option(args, "--transcript")
				? await json(required(args, "--transcript"))
				: null,
		});
		process.stdout.write(`${result.record.status}: ${result.path}\n`);
		return;
	}
	if (command === "verify") {
		const mode = option(args, "--mode") ?? "strict";
		if (mode !== "dry-run" && mode !== "strict")
			throw new Error("Invalid --mode.");
		const result = await verifyCanary({
			repositoryRoot,
			artifactPath: required(args, "--artifact"),
			mode,
		});
		process.stdout.write(
			`${result.verdict}: ${result.issue ?? "exact canary verified"}\n`,
		);
		if (mode === "strict" && result.verdict !== "VERIFIED")
			process.exitCode = 1;
		return;
	}
	throw new Error("Usage: eval:canary <prepare|record|verify> [options]");
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
