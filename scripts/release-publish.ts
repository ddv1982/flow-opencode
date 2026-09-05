import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const LOCAL_COMMAND_TIMEOUT_MS = 10_000;
const REMOTE_COMMAND_TIMEOUT_MS = 45_000;
const NPM_PUBLISH_TIMEOUT_MS = 180_000;
const REQUEST_TIMEOUT_MS = 30_000;
const OBSERVATION_ATTEMPTS = 4;
const MUTATION_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;
const MAX_COMMAND_OUTPUT_BYTES = 1_000_000;
const MAX_RELEASE_PAGES = 10;

export type CommandResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;
};

type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type PublicationRuntime = {
	readonly fetch: Fetch;
	readonly run: (
		command: string,
		args: readonly string[],
		timeoutMs: number,
	) => Promise<CommandResult>;
	readonly sleep: (milliseconds: number) => Promise<void>;
};

export type ReleaseRefEvidence = {
	readonly expectedTag: string;
	readonly eventTag: string;
	readonly eventSha: string;
	readonly headSha: string;
	readonly localTagObjectSha: string;
	readonly localTagCommitSha: string;
	readonly remoteTagObjectSha: string;
	readonly remoteTagCommitSha: string;
	readonly mainCommitSha: string;
};

type NpmPublicationInput = {
	readonly packageName: string;
	readonly packageVersion: string;
	readonly artifactPath: string;
	readonly beforePublish?: () => Promise<void>;
};

type NpmState =
	| { readonly state: "absent" }
	| { readonly state: "unknown"; readonly reason: string }
	| { readonly state: "exact"; readonly integrity: string }
	| { readonly state: "conflict"; readonly integrity: string };

type GithubReleaseInput = {
	readonly repository: string;
	readonly token: string;
	readonly tag: string;
	readonly commitSha: string;
	readonly notes: string;
	readonly assets: readonly string[];
	readonly mode: "prepare" | "publish";
	readonly beforeMutation?: () => Promise<void>;
};

type ReleaseAsset = {
	readonly name: string;
	readonly size: number;
	readonly digest: string | null;
};

type Release = {
	readonly id: number;
	readonly tag_name: string;
	readonly name: string | null;
	readonly body: string | null;
	readonly target_commitish: string;
	readonly draft: boolean;
	readonly prerelease: boolean;
	readonly assets: readonly ReleaseAsset[];
};

type DesiredAsset = {
	readonly path: string;
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly digest: string;
};

function usage(): string {
	return [
		"usage: bun run scripts/release-publish.ts <command> [options]",
		"",
		"commands:",
		"  verify-ref --tag <tag>",
		"  npm --artifact <tarball> --tag <tag>",
		"  github-prepare --tag <tag> --commit <sha> --notes <file> --asset <file>...",
		"  github-publish --tag <tag> --commit <sha> --notes <file> --asset <file>...",
	].join("\n");
}

function appendOutput(current: string, chunk: Buffer): string {
	const remaining = MAX_COMMAND_OUTPUT_BYTES - Buffer.byteLength(current);
	if (remaining <= 0) return current;
	return current + chunk.subarray(0, remaining).toString("utf8");
}

async function runCommand(
	command: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<CommandResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		child.stdout.on("data", (chunk: Buffer) => {
			stdout = appendOutput(stdout, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = appendOutput(stderr, chunk);
		});
		child.once("error", reject);
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
		}, timeoutMs);
		child.once("close", (code) => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			resolve({
				exitCode: code ?? 1,
				stdout,
				stderr,
				timedOut,
			});
		});
	});
}

const defaultRuntime: PublicationRuntime = {
	fetch: globalThis.fetch,
	run: runCommand,
	sleep: async (milliseconds) => {
		await Bun.sleep(milliseconds);
	},
};

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function sha512Integrity(bytes: Uint8Array): string {
	return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function commandFailure(
	command: string,
	args: readonly string[],
	result: CommandResult,
): Error {
	const detail = result.timedOut
		? "timed out"
		: result.stderr.trim() || result.stdout.trim() || "failed";
	return new Error(`${command} ${args.join(" ")} ${detail}`);
}

async function checkedCommand(
	runtime: PublicationRuntime,
	command: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<string> {
	const result = await runtime.run(command, args, timeoutMs);
	if (result.exitCode !== 0 || result.timedOut) {
		throw commandFailure(command, args, result);
	}
	return result.stdout.trim();
}

export function releaseTagIssue(evidence: ReleaseRefEvidence): string | null {
	if (evidence.eventTag !== evidence.expectedTag) {
		return `Release tag/version mismatch: expected ${evidence.expectedTag}, received ${evidence.eventTag}.`;
	}
	if (evidence.localTagObjectSha !== evidence.remoteTagObjectSha) {
		return "The remote tag object no longer matches the checked-out release tag.";
	}
	if (evidence.localTagCommitSha !== evidence.remoteTagCommitSha) {
		return "The remote tag commit no longer matches the checked-out release tag.";
	}
	if (
		evidence.eventSha !== evidence.localTagCommitSha ||
		evidence.headSha !== evidence.localTagCommitSha
	) {
		return "The workflow event, checkout, and release tag do not identify one commit.";
	}
	return null;
}

export function releaseRefIssue(evidence: ReleaseRefEvidence): string | null {
	const tagIssue = releaseTagIssue(evidence);
	if (tagIssue) return tagIssue;
	if (evidence.mainCommitSha !== evidence.localTagCommitSha) {
		return "The release tag is not the current origin/main commit.";
	}
	return null;
}

async function revParse(
	runtime: PublicationRuntime,
	revision: string,
): Promise<string> {
	return await checkedCommand(
		runtime,
		"git",
		["rev-parse", "--verify", revision],
		LOCAL_COMMAND_TIMEOUT_MS,
	);
}

async function verifyReleaseRef(
	tag: string,
	runtime: PublicationRuntime,
	requireCurrentMain = true,
): Promise<ReleaseRefEvidence> {
	const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
		version?: unknown;
	};
	if (typeof packageJson.version !== "string") {
		throw new Error("package.json does not contain a release version.");
	}
	const expectedTag = `v${packageJson.version}`;
	const eventTag = process.env.GITHUB_REF_NAME;
	const eventSha = process.env.GITHUB_SHA;
	if (process.env.GITHUB_REF_TYPE !== "tag" || !eventTag || !eventSha) {
		throw new Error("Release ref verification requires a GitHub tag event.");
	}
	if (tag !== eventTag) {
		throw new Error(
			`Release tag argument ${tag} does not match event tag ${eventTag}.`,
		);
	}
	const runIdentity = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
	const mainRef = `refs/flow-release/${runIdentity}/main`;
	const tagRef = `refs/flow-release/${runIdentity}/tag`;
	const fetchArgs = [
		"fetch",
		"--force",
		"--no-tags",
		"origin",
		`+refs/tags/${tag}:${tagRef}`,
	];
	if (requireCurrentMain) {
		fetchArgs.splice(5, 0, `+refs/heads/main:${mainRef}`);
	}
	await checkedCommand(runtime, "git", fetchArgs, REMOTE_COMMAND_TIMEOUT_MS);
	try {
		const evidence: ReleaseRefEvidence = {
			expectedTag,
			eventTag,
			eventSha,
			headSha: await revParse(runtime, "HEAD^{commit}"),
			localTagObjectSha: await revParse(runtime, `refs/tags/${tag}`),
			localTagCommitSha: await revParse(runtime, `refs/tags/${tag}^{commit}`),
			remoteTagObjectSha: await revParse(runtime, tagRef),
			remoteTagCommitSha: await revParse(runtime, `${tagRef}^{commit}`),
			mainCommitSha: requireCurrentMain
				? await revParse(runtime, `${mainRef}^{commit}`)
				: "",
		};
		const issue = requireCurrentMain
			? releaseRefIssue(evidence)
			: releaseTagIssue(evidence);
		if (issue) throw new Error(issue);
		return evidence;
	} finally {
		for (const ref of requireCurrentMain ? [mainRef, tagRef] : [tagRef]) {
			await runtime.run(
				"git",
				["update-ref", "-d", ref],
				LOCAL_COMMAND_TIMEOUT_MS,
			);
		}
	}
}

async function fetchBounded(
	runtime: PublicationRuntime,
	input: string,
	init: RequestInit = {},
): Promise<Response> {
	try {
		return await runtime.fetch(input, {
			...init,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(
			`Network request failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function observeNpm(
	input: NpmPublicationInput,
	localIntegrity: string,
	runtime: PublicationRuntime,
): Promise<NpmState> {
	const packagePath = input.packageName
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("%2F");
	let lastReason = "registry observation did not run";
	for (let attempt = 1; attempt <= OBSERVATION_ATTEMPTS; attempt += 1) {
		try {
			const response = await fetchBounded(
				runtime,
				`https://registry.npmjs.org/${packagePath}/${encodeURIComponent(input.packageVersion)}`,
				{ headers: { accept: "application/json" } },
			);
			if (response.status === 404) return { state: "absent" };
			if (!response.ok) {
				lastReason = `registry returned HTTP ${response.status}`;
			} else {
				const body = (await response.json()) as {
					dist?: { integrity?: unknown };
				};
				const integrity = body.dist?.integrity;
				if (typeof integrity !== "string") {
					lastReason = "registry response omitted dist.integrity";
				} else if (integrity === localIntegrity) {
					return { state: "exact", integrity };
				} else {
					return { state: "conflict", integrity };
				}
			}
		} catch (error) {
			lastReason = error instanceof Error ? error.message : String(error);
		}
		if (attempt < OBSERVATION_ATTEMPTS) await runtime.sleep(RETRY_DELAY_MS);
	}
	return { state: "unknown", reason: lastReason };
}

function assertNpmState(state: NpmState): void {
	if (state.state === "conflict") {
		throw new Error(
			`npm already contains this package version with different integrity: ${state.integrity}`,
		);
	}
	if (state.state === "unknown") {
		throw new Error(`Release could not determine npm state: ${state.reason}`);
	}
}

export async function convergeNpmPublication(
	input: NpmPublicationInput,
	runtime: PublicationRuntime = defaultRuntime,
): Promise<{ readonly state: "exact"; readonly integrity: string }> {
	const artifact = await readFile(input.artifactPath);
	const localIntegrity = sha512Integrity(artifact);
	const before = await observeNpm(input, localIntegrity, runtime);
	assertNpmState(before);
	if (before.state === "exact") return before;

	await input.beforePublish?.();
	const publish = await runtime.run(
		"npm",
		["publish", input.artifactPath, "--access", "public"],
		NPM_PUBLISH_TIMEOUT_MS,
	);
	const after = await observeNpm(input, localIntegrity, runtime);
	assertNpmState(after);
	if (after.state === "exact") return after;
	throw commandFailure("npm", ["publish", input.artifactPath], publish);
}

function githubHeaders(token: string): Record<string, string> {
	return {
		accept: "application/vnd.github+json",
		authorization: `Bearer ${token}`,
		"x-github-api-version": "2026-03-10",
	};
}

function githubApi(input: GithubReleaseInput, path: string): string {
	return `https://api.github.com/repos/${input.repository}${path}`;
}

async function observeGithubRelease(
	input: GithubReleaseInput,
	runtime: PublicationRuntime,
): Promise<Release | null> {
	const matches: Release[] = [];
	for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
		let releases: Release[] | null = null;
		let lastReason = "GitHub release observation did not run";
		for (let attempt = 1; attempt <= OBSERVATION_ATTEMPTS; attempt += 1) {
			try {
				const response = await fetchBounded(
					runtime,
					githubApi(input, `/releases?per_page=100&page=${page}`),
					{ headers: githubHeaders(input.token) },
				);
				if (response.ok) {
					const body = (await response.json()) as unknown;
					if (!Array.isArray(body)) {
						throw new Error("GitHub release listing was not an array.");
					}
					releases = body as Release[];
					break;
				}
				lastReason = `GitHub returned HTTP ${response.status}`;
			} catch (error) {
				lastReason = error instanceof Error ? error.message : String(error);
			}
			if (attempt < OBSERVATION_ATTEMPTS) await runtime.sleep(RETRY_DELAY_MS);
		}
		if (!releases) {
			throw new Error(
				`Release could not determine GitHub state: ${lastReason}`,
			);
		}
		matches.push(
			...releases.filter((release) => release.tag_name === input.tag),
		);
		if (releases.length < 100) break;
		if (page === MAX_RELEASE_PAGES) {
			throw new Error(
				"GitHub release listing exceeded the bounded page limit.",
			);
		}
	}
	if (matches.length > 1) {
		throw new Error(`GitHub contains multiple releases for tag ${input.tag}.`);
	}
	return matches[0] ?? null;
}

function assertReleaseIdentity(
	release: Release,
	input: GithubReleaseInput,
): void {
	if (
		release.tag_name !== input.tag ||
		release.name !== input.tag ||
		release.body !== input.notes ||
		release.target_commitish !== input.commitSha ||
		release.prerelease
	) {
		throw new Error(
			"Existing GitHub release metadata conflicts with this release.",
		);
	}
}

async function desiredAssets(
	paths: readonly string[],
): Promise<DesiredAsset[]> {
	const assets = await Promise.all(
		paths.map(async (path) => {
			const bytes = await readFile(path);
			return {
				path,
				name: basename(path),
				bytes,
				digest: `sha256:${sha256(bytes)}`,
			};
		}),
	);
	if (new Set(assets.map((asset) => asset.name)).size !== assets.length) {
		throw new Error("GitHub release assets must have unique names.");
	}
	return assets;
}

function assertNoUnexpectedAssets(
	release: Release,
	desired: readonly DesiredAsset[],
): void {
	const desiredNames = new Set(desired.map((asset) => asset.name));
	const actualNames = release.assets.map((asset) => asset.name);
	if (new Set(actualNames).size !== actualNames.length) {
		throw new Error("GitHub release contains duplicate asset names.");
	}
	const unexpected = actualNames.filter((name) => !desiredNames.has(name));
	if (unexpected.length > 0) {
		throw new Error(
			`GitHub release contains unexpected asset ${unexpected[0]}.`,
		);
	}
}

function assetIssue(
	release: Release,
	desired: DesiredAsset,
): "missing" | "pending" | null {
	const matches = release.assets.filter((asset) => asset.name === desired.name);
	if (matches.length === 0) return "missing";
	if (matches.length !== 1) {
		throw new Error(`GitHub release has duplicate asset ${desired.name}.`);
	}
	const actual = matches[0];
	if (actual?.size !== desired.bytes.byteLength) {
		throw new Error(`Found conflicting GitHub release asset ${desired.name}.`);
	}
	if (actual.digest === null) return "pending";
	if (actual.digest !== desired.digest) {
		throw new Error(`Found conflicting GitHub release asset ${desired.name}.`);
	}
	return null;
}

async function createDraft(
	input: GithubReleaseInput,
	runtime: PublicationRuntime,
	beforeMutation: () => Promise<void>,
): Promise<Release> {
	for (let attempt = 1; attempt <= MUTATION_ATTEMPTS; attempt += 1) {
		await beforeMutation();
		await fetchBounded(runtime, githubApi(input, "/releases"), {
			method: "POST",
			headers: {
				...githubHeaders(input.token),
				"content-type": "application/json",
			},
			body: JSON.stringify({
				tag_name: input.tag,
				target_commitish: input.commitSha,
				name: input.tag,
				body: input.notes,
				draft: true,
			}),
		}).catch(() => null);
		const observed = await observeGithubRelease(input, runtime);
		if (observed) return observed;
		if (attempt < MUTATION_ATTEMPTS) await runtime.sleep(RETRY_DELAY_MS);
	}
	throw new Error("GitHub release draft did not become observable.");
}

async function uploadAsset(
	input: GithubReleaseInput,
	release: Release,
	asset: DesiredAsset,
	runtime: PublicationRuntime,
	beforeMutation: () => Promise<void>,
): Promise<Release> {
	for (let attempt = 1; attempt <= MUTATION_ATTEMPTS; attempt += 1) {
		if (assetIssue(release, asset) === "missing") {
			await beforeMutation();
			const url = `https://uploads.github.com/repos/${input.repository}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`;
			await fetchBounded(runtime, url, {
				method: "POST",
				headers: {
					...githubHeaders(input.token),
					"content-type": "application/octet-stream",
				},
				body: asset.bytes,
			}).catch(() => null);
		}
		const observed = await observeGithubRelease(input, runtime);
		if (!observed) {
			throw new Error("GitHub release disappeared while uploading assets.");
		}
		assertReleaseIdentity(observed, input);
		if (assetIssue(observed, asset) === null) return observed;
		if (attempt < MUTATION_ATTEMPTS) await runtime.sleep(RETRY_DELAY_MS);
	}
	throw new Error(
		`GitHub release asset ${asset.name} did not become observable.`,
	);
}

async function publishDraft(
	input: GithubReleaseInput,
	release: Release,
	runtime: PublicationRuntime,
	beforeMutation: () => Promise<void>,
): Promise<Release> {
	let current = release;
	for (let attempt = 1; attempt <= MUTATION_ATTEMPTS; attempt += 1) {
		if (current.draft) {
			await beforeMutation();
			await fetchBounded(runtime, githubApi(input, `/releases/${release.id}`), {
				method: "PATCH",
				headers: {
					...githubHeaders(input.token),
					"content-type": "application/json",
				},
				body: JSON.stringify({ draft: false }),
			}).catch(() => null);
		}
		const observed = await observeGithubRelease(input, runtime);
		if (!observed)
			throw new Error("GitHub release disappeared while publishing.");
		assertReleaseIdentity(observed, input);
		if (!observed.draft) return observed;
		current = observed;
		if (attempt < MUTATION_ATTEMPTS) await runtime.sleep(RETRY_DELAY_MS);
	}
	throw new Error("GitHub release did not become published.");
}

export async function convergeGithubRelease(
	input: GithubReleaseInput,
	runtime: PublicationRuntime = defaultRuntime,
): Promise<{
	readonly state: "prepared" | "exact";
	readonly releaseId: number;
}> {
	const assets = await desiredAssets(input.assets);
	const beforeMutation = input.beforeMutation ?? (async () => {});
	if (input.mode === "publish") await beforeMutation();
	let release = await observeGithubRelease(input, runtime);
	if (!release) {
		if (input.mode === "publish") {
			throw new Error("GitHub release draft proof is missing.");
		}
		release = await createDraft(input, runtime, beforeMutation);
	}
	assertReleaseIdentity(release, input);
	assertNoUnexpectedAssets(release, assets);
	if (input.mode === "prepare" && !release.draft) {
		for (const asset of assets) {
			if (assetIssue(release, asset) !== null) {
				throw new Error(
					`Published GitHub release asset ${asset.name} is not exact.`,
				);
			}
		}
		return { state: "prepared", releaseId: release.id };
	}
	for (const asset of assets) {
		if (assetIssue(release, asset) === null) continue;
		release = await uploadAsset(input, release, asset, runtime, beforeMutation);
		assertNoUnexpectedAssets(release, assets);
	}
	if (input.mode === "prepare") {
		return {
			state: "prepared",
			releaseId: release.id,
		};
	}
	if (release.draft) {
		release = await publishDraft(input, release, runtime, beforeMutation);
	}
	assertReleaseIdentity(release, input);
	assertNoUnexpectedAssets(release, assets);
	for (const asset of assets) {
		if (assetIssue(release, asset) === null) continue;
		release = await uploadAsset(input, release, asset, runtime, beforeMutation);
	}
	assertNoUnexpectedAssets(release, assets);
	for (const asset of assets) {
		if (assetIssue(release, asset) !== null) {
			throw new Error(`GitHub release asset ${asset.name} is not exact.`);
		}
	}
	return { state: "exact", releaseId: release.id };
}

function valuesFor(argv: readonly string[], flag: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] !== flag) continue;
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${flag} requires a value.`);
		}
		values.push(value);
	}
	return values;
}

function rejectUnknownOptions(
	argv: readonly string[],
	allowed: ReadonlySet<string>,
): void {
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		if (!flag || !allowed.has(flag)) {
			throw new Error(
				`Unknown release publication option: ${flag ?? "(missing)"}`,
			);
		}
		if (!argv[index + 1] || argv[index + 1]?.startsWith("--")) {
			throw new Error(`${flag} requires a value.`);
		}
	}
}

function valueFor(argv: readonly string[], flag: string): string {
	const values = valuesFor(argv, flag);
	if (values.length !== 1)
		throw new Error(`${flag} must be provided exactly once.`);
	return values[0] as string;
}

async function main(argv: readonly string[]): Promise<void> {
	const [command, ...options] = argv;
	if (!command || command === "--help" || command === "-h") {
		process.stdout.write(`${usage()}\n`);
		return;
	}
	if (command === "verify-ref") {
		rejectUnknownOptions(options, new Set(["--tag"]));
		const evidence = await verifyReleaseRef(
			valueFor(options, "--tag"),
			defaultRuntime,
		);
		process.stdout.write(
			`Release ref verified at current origin/main commit ${evidence.mainCommitSha}.\n`,
		);
		return;
	}
	if (command === "npm") {
		rejectUnknownOptions(options, new Set(["--artifact", "--tag"]));
		const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
			name?: unknown;
			version?: unknown;
		};
		if (
			typeof packageJson.name !== "string" ||
			typeof packageJson.version !== "string"
		) {
			throw new Error(
				"package.json does not contain a package name and version.",
			);
		}
		const result = await convergeNpmPublication({
			packageName: packageJson.name,
			packageVersion: packageJson.version,
			artifactPath: valueFor(options, "--artifact"),
			beforePublish: async () => {
				await verifyReleaseRef(valueFor(options, "--tag"), defaultRuntime);
			},
		});
		process.stdout.write(`npm publication verified at ${result.integrity}.\n`);
		return;
	}
	if (command === "github-prepare" || command === "github-publish") {
		rejectUnknownOptions(
			options,
			new Set(["--tag", "--commit", "--notes", "--asset"]),
		);
		const token = process.env.GH_TOKEN;
		const repository = process.env.GITHUB_REPOSITORY;
		if (!token || !repository) {
			throw new Error(
				"GitHub publication requires GH_TOKEN and GITHUB_REPOSITORY.",
			);
		}
		const result = await convergeGithubRelease({
			repository,
			token,
			tag: valueFor(options, "--tag"),
			commitSha: valueFor(options, "--commit"),
			notes: await readFile(valueFor(options, "--notes"), "utf8"),
			assets: valuesFor(options, "--asset"),
			mode: command === "github-prepare" ? "prepare" : "publish",
			beforeMutation: async () => {
				await verifyReleaseRef(
					valueFor(options, "--tag"),
					defaultRuntime,
					command === "github-prepare",
				);
			},
		});
		process.stdout.write(
			`GitHub release publication verified at release ${result.releaseId}.\n`,
		);
		return;
	}
	throw new Error(`Unknown release publication command: ${command}`);
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
