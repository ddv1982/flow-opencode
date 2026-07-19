import { mock } from "bun:test";
import * as childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { type Mode, type PathLike, renameSync, symlinkSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const actualModule = { ...fsPromises };
const actualChildProcessModule = { ...childProcess };
const actualSpawn = childProcess.spawn.bind(childProcess);
const actualLink = fsPromises.link.bind(fsPromises);
const actualLstat = fsPromises.lstat.bind(fsPromises);
const actualMkdir = fsPromises.mkdir.bind(fsPromises);
const actualMkdtemp = fsPromises.mkdtemp.bind(fsPromises);
const actualOpen = fsPromises.open.bind(fsPromises);
const actualRealpath = fsPromises.realpath.bind(fsPromises);
const actualRename = fsPromises.rename.bind(fsPromises);
const actualRm = fsPromises.rm.bind(fsPromises);
const actualSymlink = fsPromises.symlink.bind(fsPromises);
const actualTruncate = fsPromises.truncate.bind(fsPromises);
const actualWriteFile = fsPromises.writeFile.bind(fsPromises);

type Swap = {
	target: string;
	ancestor: string;
	heldAncestor: string;
	replacement: string;
	armed: boolean;
	swapped: boolean;
};

type HelperPause = {
	cwd: string;
	needle: string;
	readyPath: string;
	releasePath: string;
	hit: boolean;
};

let swap: Swap | undefined;
let helperPause: HelperPause | undefined;
let sourceDotGitChecks = 0;

const interceptedSpawn = ((
	command: Parameters<typeof childProcess.spawn>[0],
	args: Parameters<typeof childProcess.spawn>[1],
	options: Parameters<typeof childProcess.spawn>[2],
) => {
	let spawnedArgs = args;
	if (
		helperPause &&
		typeof options?.cwd === "string" &&
		options.cwd === helperPause.cwd &&
		Array.isArray(args) &&
		typeof args[1] === "string"
	) {
		const pauseSource = [
			`fs.writeFileSync(${JSON.stringify(helperPause.readyPath)}, "ready");`,
			"const flowRaceWait = new Int32Array(new SharedArrayBuffer(4));",
			`while (!fs.existsSync(${JSON.stringify(helperPause.releasePath)})) {`,
			"  Atomics.wait(flowRaceWait, 0, 0, 10);",
			"}",
			helperPause.needle,
		].join("\n");
		const instrumented = args[1].replace(helperPause.needle, pauseSource);
		if (instrumented === args[1]) {
			throw new Error("Pinned helper race probe could not place its pause.");
		}
		helperPause.hit = true;
		spawnedArgs = args.map((value, index) =>
			index === 1 ? instrumented : value,
		);
	}
	const child = actualSpawn(command, spawnedArgs, options);
	if (
		process.argv[2] === "evidence-publish" &&
		swap?.armed &&
		!swap.swapped &&
		typeof options?.cwd === "string" &&
		options.cwd === swap.ancestor
	) {
		child.stdout?.once("data", (chunk: Buffer | string) => {
			if (
				!swap ||
				swap.swapped ||
				!String(chunk).includes('"event":"pinned"')
			) {
				return;
			}
			swap.swapped = true;
			renameSync(swap.ancestor, swap.heldAncestor);
			symlinkSync(swap.replacement, swap.ancestor, "dir");
		});
	}
	return child;
}) as typeof childProcess.spawn;

async function interceptedOpen(
	path: PathLike,
	flags: string | number,
	mode?: Mode,
) {
	if (
		swap?.armed &&
		!swap.swapped &&
		typeof path === "string" &&
		path === swap.target
	) {
		swap.swapped = true;
		await actualRename(swap.ancestor, swap.heldAncestor);
		await actualSymlink(swap.replacement, swap.ancestor, "dir");
	}
	return actualOpen(path, flags, mode);
}

async function interceptedLstat(path: PathLike) {
	if (
		process.argv[2] === "source" &&
		typeof path === "string" &&
		path.endsWith("/.git")
	) {
		sourceDotGitChecks += 1;
		if (sourceDotGitChecks === 2 && swap?.swapped) {
			await actualRm(swap.ancestor, { force: true });
			await actualRename(swap.heldAncestor, swap.ancestor);
		}
	}
	return actualLstat(path);
}

mock.module("node:fs/promises", () => ({
	...actualModule,
	lstat: interceptedLstat,
	open: interceptedOpen,
}));
mock.module("node:child_process", () => ({
	...actualChildProcessModule,
	spawn: interceptedSpawn,
}));

function errorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

async function waitForHelperPause(): Promise<void> {
	if (!helperPause) throw new Error("Pinned helper pause was not configured.");
	for (let attempt = 0; attempt < 2000; attempt += 1) {
		try {
			await actualLstat(helperPause.readyPath);
			return;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Pinned helper race probe timed out before its pause.");
}

async function restoreAncestor(): Promise<void> {
	if (!swap?.swapped) return;
	await actualRm(swap.ancestor, { force: true });
	try {
		await actualRename(swap.heldAncestor, swap.ancestor);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

async function probeSourceRace(parent: string): Promise<void> {
	const root = join(parent, "source-root");
	const nested = join(root, "nested");
	const held = join(root, "nested-held");
	const replacement = join(parent, "source-replacement");
	const target = join(nested, "source.txt");
	await actualMkdir(nested, { recursive: true });
	await actualMkdir(replacement);
	await actualWriteFile(target, "stable source\n", "utf8");
	await actualLink(target, join(replacement, "source.txt"));
	swap = {
		target,
		ancestor: nested,
		heldAncestor: held,
		replacement,
		armed: true,
		swapped: false,
	};

	const { createFileSourceIdentityProvider } = await import(
		"../../src/infrastructure/fs/source-identity.js"
	);
	let failure: unknown;
	try {
		await createFileSourceIdentityProvider(root).computeSourceIdentity();
	} catch (error) {
		failure = error;
	}
	if (!swap.swapped) {
		throw new Error("Source race probe did not swap the ancestor directory.");
	}
	if (errorCode(failure) !== "FLOW_SOURCE_IDENTITY_RACE") {
		throw new Error(
			`Source ancestor substitution was not rejected as a race: ${String(failure)}`,
		);
	}
}

async function probeEvidenceRace(parent: string): Promise<void> {
	const workspace = join(parent, "evidence-root");
	await actualMkdir(workspace);
	const { createFileEvidenceArtifactStore, evidenceArtifactPath } =
		await import("../../src/infrastructure/fs/evidence-artifact-store.js");
	const store = createFileEvidenceArtifactStore(workspace);
	const content = Buffer.from("stable restricted evidence\n", "utf8");
	const ref = await store.publishEvidenceArtifact(content);
	const target = evidenceArtifactPath(workspace, ref);
	const ancestor = dirname(target);
	const heldAncestor = `${ancestor}-held`;
	const replacement = join(parent, "evidence-replacement");
	await actualMkdir(replacement, { mode: 0o700 });
	await actualLink(
		target,
		join(
			replacement,
			createHash("sha256").update(content).digest("hex").slice(2),
		),
	);
	swap = {
		target,
		ancestor,
		heldAncestor,
		replacement,
		armed: true,
		swapped: false,
	};

	let failure: unknown;
	try {
		await store.readEvidenceArtifact(ref);
	} catch (error) {
		failure = error;
	}
	if (!swap.swapped) {
		throw new Error("Evidence race probe did not swap the ancestor directory.");
	}
	if (
		errorCode(failure) !== "FLOW_EVIDENCE_INTEGRITY" &&
		errorCode(failure) !== "UNSAFE_FLOW_WORKSPACE_LAYOUT"
	) {
		throw new Error(
			`Evidence ancestor substitution was not rejected: ${String(failure)}`,
		);
	}
}

async function probeEvidencePublishRace(parent: string): Promise<void> {
	const workspaceCandidate = join(parent, "evidence-publish-root");
	const replacement = join(parent, "evidence-publish-replacement");
	await actualMkdir(workspaceCandidate);
	const workspace = await actualRealpath(workspaceCandidate);
	await actualMkdir(replacement, { mode: 0o700 });
	await actualWriteFile(join(replacement, "marker"), "outside\n", "utf8");
	const content = Buffer.from("publication must stay pinned\n", "utf8");
	const hex = createHash("sha256").update(content).digest("hex");
	const shard = join(
		workspace,
		".flow",
		"evidence",
		"v1",
		"sha256",
		hex.slice(0, 2),
	);
	swap = {
		target: join(shard, hex.slice(2)),
		ancestor: shard,
		heldAncestor: `${shard}-held`,
		replacement,
		armed: true,
		swapped: false,
	};
	const { createFileEvidenceArtifactStore } = await import(
		"../../src/infrastructure/fs/evidence-artifact-store.js"
	);

	let failure: unknown;
	try {
		await createFileEvidenceArtifactStore(workspace).publishEvidenceArtifact(
			content,
		);
	} catch (error) {
		failure = error;
	}
	if (!swap.swapped) {
		throw new Error(
			`Evidence publication probe did not swap the shard: ${String(failure)}`,
		);
	}
	if (errorCode(failure) !== "UNSAFE_FLOW_WORKSPACE_LAYOUT") {
		throw new Error(
			`Evidence shard substitution was not rejected: ${String(failure)}`,
		);
	}
	const outsideEntries = await fsPromises.readdir(replacement);
	if (outsideEntries.length !== 1 || outsideEntries[0] !== "marker") {
		throw new Error(
			`Evidence publication escaped its pinned shard: ${outsideEntries.join(",")}`,
		);
	}
	const heldEntries = await fsPromises.readdir(swap.heldAncestor);
	if (heldEntries.length !== 0) {
		throw new Error(
			`Failed publication left residue in its pinned shard: ${heldEntries.join(",")}`,
		);
	}
}

async function probeEvidenceReplayRace(parent: string): Promise<void> {
	const workspaceCandidate = join(parent, "evidence-replay-root");
	const replacement = join(parent, "evidence-replay-replacement");
	await actualMkdir(workspaceCandidate);
	const workspace = await actualRealpath(workspaceCandidate);
	await actualMkdir(replacement, { mode: 0o700 });
	await actualWriteFile(join(replacement, "marker"), "outside\n", "utf8");
	const content = Buffer.from("existing evidence must stay pinned\n", "utf8");
	const { createFileEvidenceArtifactStore, evidenceArtifactPath } =
		await import("../../src/infrastructure/fs/evidence-artifact-store.js");
	const store = createFileEvidenceArtifactStore(workspace);
	const ref = await store.publishEvidenceArtifact(content);
	const target = evidenceArtifactPath(workspace, ref);
	const shard = dirname(target);
	const readyPath = join(parent, "evidence-replay-ready");
	const releasePath = join(parent, "evidence-replay-release");
	helperPause = {
		cwd: shard,
		needle:
			'\t\t  requireExactDirectoryEntry(".", target);\n\t\t  validatePinned(request);',
		readyPath,
		releasePath,
		hit: false,
	};
	swap = {
		target,
		ancestor: shard,
		heldAncestor: `${shard}-held`,
		replacement,
		armed: false,
		swapped: false,
	};

	let failure: unknown;
	let probeFailure: unknown;
	const publication = store.publishEvidenceArtifact(content).catch((error) => {
		failure = error;
	});
	try {
		await waitForHelperPause();
		renameSync(swap.ancestor, swap.heldAncestor);
		symlinkSync(swap.replacement, swap.ancestor, "dir");
		swap.swapped = true;
	} catch (error) {
		probeFailure = error;
	} finally {
		try {
			await actualWriteFile(releasePath, "release");
		} finally {
			await publication;
		}
	}
	if (probeFailure) throw probeFailure;
	if (!helperPause.hit || !swap.swapped) {
		throw new Error(
			"Evidence replay probe did not reach its final validation.",
		);
	}
	if (errorCode(failure) !== "UNSAFE_FLOW_WORKSPACE_LAYOUT") {
		throw new Error(
			`Evidence replay ancestor substitution was not rejected: ${String(failure)}`,
		);
	}
	const outsideEntries = await fsPromises.readdir(replacement);
	if (outsideEntries.length !== 1 || outsideEntries[0] !== "marker") {
		throw new Error(
			`Evidence replay escaped its pinned shard: ${outsideEntries.join(",")}`,
		);
	}
	const heldEntries = await fsPromises.readdir(swap.heldAncestor);
	if (heldEntries.length !== 1 || heldEntries[0] !== basename(target)) {
		throw new Error(
			`Evidence replay left unexpected pinned-shard entries: ${heldEntries.join(",")}`,
		);
	}
}

async function probeEvidenceGrowthRace(parent: string): Promise<void> {
	const workspaceCandidate = join(parent, "evidence-growth-root");
	await actualMkdir(workspaceCandidate);
	const workspace = await actualRealpath(workspaceCandidate);
	const content = Buffer.from("growth after fstat must stay bounded\n", "utf8");
	const { MAX_EVIDENCE_ARTIFACT_BYTES } = await import(
		"../../src/application/ports/evidence-artifact-store.js"
	);
	const { createFileEvidenceArtifactStore, evidenceArtifactPath } =
		await import("../../src/infrastructure/fs/evidence-artifact-store.js");
	const store = createFileEvidenceArtifactStore(workspace);
	const ref = await store.publishEvidenceArtifact(content);
	const target = evidenceArtifactPath(workspace, ref);
	await actualTruncate(target, 1);
	const shard = dirname(target);
	const readyPath = join(parent, "evidence-growth-ready");
	const releasePath = join(parent, "evidence-growth-release");
	helperPause = {
		cwd: shard,
		needle: "\tconst byteLength = Number(opened.size);",
		readyPath,
		releasePath,
		hit: false,
	};

	let failure: unknown;
	let probeFailure: unknown;
	const publication = store.publishEvidenceArtifact(content).catch((error) => {
		failure = error;
	});
	try {
		await waitForHelperPause();
		await actualTruncate(target, MAX_EVIDENCE_ARTIFACT_BYTES + 1);
	} catch (error) {
		probeFailure = error;
	} finally {
		try {
			await actualWriteFile(releasePath, "release");
		} finally {
			await publication;
		}
	}
	if (probeFailure) throw probeFailure;
	if (!helperPause.hit) {
		throw new Error("Evidence growth probe did not pause after fstat.");
	}
	if (errorCode(failure) !== "FLOW_EVIDENCE_COLLISION") {
		throw new Error(
			`Evidence growth after fstat was not rejected: ${String(failure)}`,
		);
	}
	const shardEntries = await fsPromises.readdir(shard);
	if (shardEntries.length !== 1 || shardEntries[0] !== basename(target)) {
		throw new Error(
			`Evidence growth replay left temporary residue: ${shardEntries.join(",")}`,
		);
	}
}

const mode = process.argv[2];
const parent = await actualMkdtemp(join(tmpdir(), "flow-ancestor-race-"));
try {
	if (mode === "source") await probeSourceRace(parent);
	else if (mode === "evidence") await probeEvidenceRace(parent);
	else if (mode === "evidence-publish") {
		await probeEvidencePublishRace(parent);
	} else if (mode === "evidence-replay") {
		await probeEvidenceReplayRace(parent);
	} else if (mode === "evidence-grow") {
		await probeEvidenceGrowthRace(parent);
	} else throw new Error(`Unknown ancestor race probe '${String(mode)}'.`);
} finally {
	await restoreAncestor();
	await actualRm(parent, { recursive: true, force: true });
}
