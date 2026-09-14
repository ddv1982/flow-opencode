import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { inspectArtifact } from "../evals/provenance.js";
import packageJson from "../package.json" with { type: "json" };
import { writeBytesExclusive, writeExclusive } from "./lib/exclusive-json.js";
import { assertPatchReleaseEvidence } from "./patch-release.js";
import {
	assertStrictReleaseEvidence,
	releaseEvidenceMarkdown,
	validateReleaseMetadata,
} from "./release-metadata.js";
import {
	convergeGithubRelease,
	convergeNpmPublication,
	defaultRuntime,
	type PublicationRuntime,
	verifyReleaseRef,
} from "./release-publish.js";

const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const File = z
	.object({
		name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
		sha256: Hash,
	})
	.strict();
export const ReleaseRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
		tag: z.string().regex(/^v[\w.+-]+$/),
		commit: z.string().regex(/^[a-f0-9]{40}$/),
		packageName: z.string().min(1),
		version: z.string().min(1),
		artifact: File,
		checksum: File,
		notes: File,
		canary: z.string().min(1),
		patch: z.string().min(1).optional(),
		bundles: z.string().min(1),
		bundleSha256: Hash,
		creationOwner: z.string().min(1),
	})
	.strict();
export type ReleaseRecord = z.infer<typeof ReleaseRecordSchema>;
const owner = () =>
	process.env.GITHUB_RUN_ID
		? `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`
		: "local";
const digest = (bytes: Uint8Array) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function optionalJson(path: string): Promise<unknown | null> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
async function receipt(directory: string, name: string, value: unknown) {
	try {
		await writeExclusive(join(directory, name), value);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		if (
			JSON.stringify(await optionalJson(join(directory, name))) !==
			JSON.stringify(value)
		)
			throw new Error(`Conflicting release receipt ${name}.`);
	}
}
export async function loadRelease(directory: string): Promise<ReleaseRecord> {
	const record = ReleaseRecordSchema.parse(
		await optionalJson(join(directory, "release.json")),
	);
	if (
		record.artifact.name === record.notes.name ||
		record.notes.name !== "release-notes.md" ||
		!record.artifact.name.endsWith(".tgz") ||
		record.checksum.name !== `${record.artifact.name}.sha256`
	)
		throw new Error("Invalid release payload names.");
	if (record.tag !== `v${record.version}`)
		throw new Error("Release tag/version mismatch.");
	for (const file of [record.artifact, record.checksum, record.notes]) {
		if (digest(await readFile(join(directory, file.name))) !== file.sha256)
			throw new Error(`Release payload changed: ${file.name}`);
	}
	return record;
}

export async function releaseStatus(directory: string) {
	const record = await loadRelease(directory);
	const creation = await optionalJson(join(directory, "creation-sent.json"));
	const prepared = await optionalJson(join(directory, "github-prepared.json"));
	const npm = await optionalJson(join(directory, "npm.json"));
	const published = await optionalJson(
		join(directory, "github-published.json"),
	);
	return {
		record,
		receipts: { creation, prepared, npm, published },
		next: published
			? "verify-remote"
			: npm
				? "publish-github"
				: prepared
					? "publish-npm"
					: creation || record.creationOwner !== owner()
						? "reconcile-github-creation"
						: "prepare-github",
		note: "Local receipts describe prior observations. Resume rechecks remote state and qualification before publication.",
	};
}

export async function claimDraftCreation(
	directory: string,
	record: ReleaseRecord,
): Promise<void> {
	if (record.creationOwner !== owner())
		throw new Error(
			"A previous workflow attempt may have created the draft. Reconcile GitHub state; creation is blocked while the listing is empty.",
		);
	try {
		await writeExclusive(join(directory, "creation-sent.json"), {
			tag: record.tag,
			commit: record.commit,
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error(
				"Draft creation was already attempted. Reconcile GitHub state before another creation request.",
			);
		throw error;
	}
}

export async function resumeRelease(
	directory: string,
	runtime: PublicationRuntime = defaultRuntime,
	verify: (record: ReleaseRecord) => Promise<void> = async (record) => {
		if (
			record.packageName !== packageJson.name ||
			record.version !== packageJson.version
		)
			throw new Error("Release record package identity differs from checkout.");
		const artifact = await inspectArtifact({
			repositoryRoot: process.cwd(),
			tarballPath: join(directory, record.artifact.name),
		});
		const result = await verifyReleaseEvidence({
			...(record.patch ? { patch: record.patch } : {}),
			version: record.version,
			tag: record.tag,
			canaryPath: record.canary,
			bundlesDirectory: record.bundles,
			expectedArtifact: artifact,
		});
		if (result.bundleSha256 !== record.bundleSha256)
			throw new Error("Qualification bundle changed.");
	},
): Promise<void> {
	const record = await loadRelease(directory);
	await verify(record);
	const github = {
		repository: record.repository,
		token: process.env.GH_TOKEN ?? "",
		tag: record.tag,
		commitSha: record.commit,
		notes: await readFile(join(directory, record.notes.name), "utf8"),
		assets: [
			join(directory, record.artifact.name),
			join(directory, record.checksum.name),
		],
	};
	const proof = async (currentMain: boolean) => {
		const evidence = await verifyReleaseRef(record.tag, runtime, currentMain);
		if (evidence.headSha !== record.commit)
			throw new Error("Release record commit differs from checkout.");
	};
	const prepared = await convergeGithubRelease(
		{
			...github,
			mode: "prepare",
			beforeMutation: () => proof(true),
			beforeCreate: () => claimDraftCreation(directory, record),
		},
		runtime,
	);
	await receipt(directory, "github-prepared.json", prepared);
	const npm = await convergeNpmPublication(
		{
			packageName: record.packageName,
			packageVersion: record.version,
			artifactPath: join(directory, record.artifact.name),
			beforePublish: () => proof(true),
		},
		runtime,
	);
	await receipt(directory, "npm.json", npm);
	const published = await convergeGithubRelease(
		{ ...github, mode: "publish", beforeMutation: () => proof(false) },
		runtime,
	);
	await receipt(directory, "github-published.json", published);
}

export async function verifyReleaseEvidence(
	input: Parameters<typeof assertStrictReleaseEvidence>[0] & { patch?: string },
) {
	if (input.patch)
		return assertPatchReleaseEvidence({
			path: input.patch,
			expectedArtifact: input.expectedArtifact,
			bundlesDirectory: input.bundlesDirectory ?? "evals/qualification/bundles",
		});
	const result = await assertStrictReleaseEvidence(input);
	return {
		bundleSha256: result.bundleSha256,
		notes: releaseEvidenceMarkdown(result.summary),
	};
}

async function initialize(directory: string, options: Map<string, string>) {
	const required = (key: string) => {
		const value = options.get(key);
		if (!value) throw new Error(`${key} is required.`);
		return value;
	};
	const repository = process.env.GITHUB_REPOSITORY;
	if (!repository) throw new Error("GITHUB_REPOSITORY is required.");
	const commit = required("--commit");
	const artifactPath = required("--artifact");
	const patch = options.get("--patch");
	if (patch && options.has("--canary"))
		throw new Error("Choose full or patch qualification, not both.");
	const canary = patch
		? "not-run:baseline-qualified-patch"
		: required("--canary");
	const bundles =
		options.get("--bundles") ??
		(patch
			? "evals/qualification/patch-baselines"
			: "evals/qualification/bundles");
	const metadata = JSON.parse(await readFile("package.json", "utf8"));
	const tag = `v${metadata.version}`;
	const artifact = await inspectArtifact({
		repositoryRoot: process.cwd(),
		tarballPath: artifactPath,
	});
	const evidence = await verifyReleaseEvidence({
		...(patch ? { patch } : {}),
		version: metadata.version,
		tag,
		canaryPath: canary,
		bundlesDirectory: bundles,
		expectedArtifact: artifact,
	});
	const existing = await optionalJson(join(directory, "release.json"));
	if (existing) {
		const record = await loadRelease(directory);
		if (
			record.repository !== repository ||
			record.commit !== commit ||
			record.tag !== tag ||
			record.artifact.sha256 !== digest(await readFile(artifactPath)) ||
			record.bundleSha256 !== evidence.bundleSha256 ||
			record.canary !== canary ||
			record.patch !== patch ||
			record.bundles !== bundles
		)
			throw new Error(
				"Existing release record conflicts with requested inputs.",
			);
		return;
	}
	const notes = validateReleaseMetadata({
		packageVersion: metadata.version,
		tag,
		changelog: await readFile("CHANGELOG.md", "utf8"),
	}).releaseNotes;
	await mkdir(directory, { recursive: true });
	const artifactName = basename(artifactPath);
	const checksumName = `${artifactName}.sha256`;
	if (["release.json", "release-notes.md"].includes(artifactName))
		throw new Error("Invalid artifact name.");
	if (!artifactName.endsWith(".tgz"))
		throw new Error("Release artifact must be a .tgz file.");
	const store = async (name: string, bytes: Buffer) => {
		const target = join(directory, name);
		try {
			await writeBytesExclusive(target, bytes);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!(await readFile(target)).equals(bytes))
				throw new Error(`Existing release payload conflicts: ${name}`);
		}
	};
	const bytes = await readFile(artifactPath);
	await store(artifactName, bytes);
	await store(
		checksumName,
		Buffer.from(`${digest(bytes).slice(7)}  ${artifactName}\n`),
	);
	await store(
		"release-notes.md",
		Buffer.from(`${notes}\n\n${evidence.notes}\n`),
	);
	const file = async (name: string) => ({
		name,
		sha256: digest(await readFile(join(directory, name))),
	});
	const record = ReleaseRecordSchema.parse({
		schemaVersion: 1,
		repository,
		tag,
		commit,
		packageName: metadata.name,
		version: metadata.version,
		artifact: await file(artifactName),
		checksum: await file(checksumName),
		notes: await file("release-notes.md"),
		canary,
		...(patch ? { patch } : {}),
		bundles,
		bundleSha256: evidence.bundleSha256,
		creationOwner: owner(),
	});
	await writeExclusive(join(directory, "release.json"), record);
}

async function main(args: string[]) {
	const [command, path, ...rest] = args;
	if (!command || command === "--help") {
		console.log(
			"release init <directory> --artifact <tgz> (--canary <json> | --patch <json>) --commit <sha> [--bundles <directory>] | status <directory> | resume <directory>",
		);
		return;
	}
	if (!path) throw new Error("Release record directory is required.");
	const directory = resolve(path);
	if (command === "init") {
		const options = new Map<string, string>();
		for (let index = 0; index < rest.length; index += 2) {
			const key = rest[index];
			const value = rest[index + 1];
			if (
				!key ||
				![
					"--artifact",
					"--canary",
					"--patch",
					"--commit",
					"--bundles",
				].includes(key) ||
				!value ||
				options.has(key)
			)
				throw new Error("Invalid release options.");
			options.set(key, value);
		}
		await initialize(directory, options);
		console.log(`Release record verified: ${join(directory, "release.json")}`);
	} else {
		if (rest.length) throw new Error("Unexpected release options.");
		if (command === "status")
			console.log(JSON.stringify(await releaseStatus(directory), null, 2));
		else if (command === "resume") {
			if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required.");
			const record = await loadRelease(directory);
			if (record.repository !== process.env.GITHUB_REPOSITORY)
				throw new Error("GITHUB_REPOSITORY differs from release record.");
			await resumeRelease(directory);
		} else throw new Error("Unknown release command.");
	}
}
if (import.meta.main)
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
