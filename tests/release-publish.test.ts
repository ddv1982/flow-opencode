import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	type CommandResult,
	convergeGithubRelease,
	convergeNpmPublication,
	type PublicationRuntime,
	type ReleaseRefEvidence,
	releaseRefIssue,
} from "../scripts/release-publish.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const TAG_OBJECT = "89abcdef0123456789abcdef0123456789abcdef";

function refEvidence(
	overrides: Partial<ReleaseRefEvidence> = {},
): ReleaseRefEvidence {
	return {
		expectedTag: "v1.2.3",
		eventTag: "v1.2.3",
		eventSha: COMMIT,
		headSha: COMMIT,
		localTagObjectSha: TAG_OBJECT,
		localTagCommitSha: COMMIT,
		remoteTagObjectSha: TAG_OBJECT,
		remoteTagCommitSha: COMMIT,
		mainCommitSha: COMMIT,
		...overrides,
	};
}

function result(exitCode: number, stdout = "", stderr = ""): CommandResult {
	return { exitCode, stdout, stderr, timedOut: false };
}

async function artifactFixture() {
	const root = await mkdtemp(join(tmpdir(), "flow-release-publish-"));
	const artifactPath = join(root, "package.tgz");
	await writeFile(artifactPath, "exact package bytes");
	const bytes = await readFile(artifactPath);
	return {
		artifactPath,
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(body === null ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("release ref proof", () => {
	test("documents the required tag on the npm command", () => {
		const help = spawnSync(
			"bun",
			["run", "scripts/release-publish.ts", "--help"],
			{ cwd: process.cwd(), encoding: "utf8" },
		);
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("npm --artifact <tarball> --tag <tag>");
	});

	test("accepts an annotated tag at the exact event and main commit", () => {
		expect(releaseRefIssue(refEvidence())).toBeNull();
	});

	test("accepts a lightweight tag at the exact event and main commit", () => {
		expect(
			releaseRefIssue(
				refEvidence({
					localTagObjectSha: COMMIT,
					remoteTagObjectSha: COMMIT,
				}),
			),
		).toBeNull();
	});

	test("rejects a stale tag even when it is an ancestor of main", () => {
		expect(
			releaseRefIssue(
				refEvidence({
					mainCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				}),
			),
		).toContain("current origin/main");
	});

	test("rejects moved remote tags and mismatched workflow refs", () => {
		expect(
			releaseRefIssue(
				refEvidence({
					remoteTagObjectSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				}),
			),
		).toContain("remote tag");
		expect(releaseRefIssue(refEvidence({ eventTag: "v1.2.2" }))).toContain(
			"tag/version",
		);
	});
});

describe("npm publication reconciliation", () => {
	test("skips an exact immutable package and refuses a conflict", async () => {
		const fixture = await artifactFixture();
		let publishes = 0;
		const exactRuntime: PublicationRuntime = {
			fetch: async () =>
				jsonResponse(200, { dist: { integrity: fixture.integrity } }),
			run: async () => {
				publishes += 1;
				return result(0);
			},
			sleep: async () => {},
		};
		expect(
			await convergeNpmPublication(
				{
					packageName: "opencode-plugin-flow",
					packageVersion: "1.2.3",
					artifactPath: fixture.artifactPath,
				},
				exactRuntime,
			),
		).toEqual({ state: "exact", integrity: fixture.integrity });
		expect(publishes).toBe(0);

		const conflictRuntime = {
			...exactRuntime,
			fetch: async () =>
				jsonResponse(200, { dist: { integrity: "sha512-conflict" } }),
		};
		await expect(
			convergeNpmPublication(
				{
					packageName: "opencode-plugin-flow",
					packageVersion: "1.2.3",
					artifactPath: fixture.artifactPath,
				},
				conflictRuntime,
			),
		).rejects.toThrow("different integrity");
	});

	test("reconciles an ambiguous publish only after exact registry evidence", async () => {
		const fixture = await artifactFixture();
		let observations = 0;
		let publishes = 0;
		let refChecks = 0;
		const runtime: PublicationRuntime = {
			fetch: async () => {
				observations += 1;
				return observations === 1
					? jsonResponse(404, { error: "not_found" })
					: jsonResponse(200, { dist: { integrity: fixture.integrity } });
			},
			run: async () => {
				publishes += 1;
				return { ...result(1, "", "connection closed"), timedOut: true };
			},
			sleep: async () => {},
		};
		expect(
			await convergeNpmPublication(
				{
					packageName: "opencode-plugin-flow",
					packageVersion: "1.2.3",
					artifactPath: fixture.artifactPath,
					beforePublish: async () => {
						refChecks += 1;
					},
				},
				runtime,
			),
		).toEqual({ state: "exact", integrity: fixture.integrity });
		expect(publishes).toBe(1);
		expect(refChecks).toBe(1);
	});

	test("never treats a registry failure as package absence", async () => {
		const fixture = await artifactFixture();
		let publishes = 0;
		const runtime: PublicationRuntime = {
			fetch: async () => jsonResponse(503, { error: "unavailable" }),
			run: async () => {
				publishes += 1;
				return result(0);
			},
			sleep: async () => {},
		};
		await expect(
			convergeNpmPublication(
				{
					packageName: "opencode-plugin-flow",
					packageVersion: "1.2.3",
					artifactPath: fixture.artifactPath,
				},
				runtime,
			),
		).rejects.toThrow("could not determine npm state");
		expect(publishes).toBe(0);
	});
});

describe("GitHub release reconciliation", () => {
	test("reconciles an ambiguous draft creation before publishing", async () => {
		let release:
			| {
					id: number;
					tag_name: string;
					name: string;
					body: string;
					target_commitish: string;
					draft: boolean;
					prerelease: boolean;
					assets: never[];
			  }
			| undefined;
		let mutations = 0;
		let mainProofs = 0;
		let tagProofs = 0;
		const runtime: PublicationRuntime = {
			fetch: async (_url, init) => {
				const method = init?.method ?? "GET";
				if (method === "GET") {
					return jsonResponse(200, release ? [release] : []);
				}
				mutations += 1;
				if (method === "POST") {
					release = {
						id: 8,
						tag_name: "v1.2.3",
						name: "v1.2.3",
						body: "exact notes\n",
						target_commitish: COMMIT,
						draft: true,
						prerelease: false,
						assets: [],
					};
					throw new Error("connection closed after create");
				}
				if (!release) throw new Error("Expected a draft before publishing.");
				release = { ...release, draft: false };
				return jsonResponse(200, release);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		expect(
			await convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [],
					mode: "prepare",
					beforeMutation: async () => {
						mainProofs += 1;
					},
				},
				runtime,
			),
		).toEqual({ state: "prepared", releaseId: 8 });
		expect(mutations).toBe(1);
		expect(mainProofs).toBe(1);
		await convergeGithubRelease(
			{
				repository: "owner/repo",
				token: "token",
				tag: "v1.2.3",
				commitSha: COMMIT,
				notes: "exact notes\n",
				assets: [],
				mode: "prepare",
				beforeMutation: async () => {
					throw new Error("current main advanced after the exact draft");
				},
			},
			runtime,
		);
		expect(mutations).toBe(1);
		expect(
			await convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [],
					mode: "publish",
					beforeMutation: async () => {
						tagProofs += 1;
					},
				},
				runtime,
			),
		).toEqual({ state: "exact", releaseId: 8 });
		expect(mutations).toBe(2);
		expect(tagProofs).toBe(2);
	});

	test("recovers a partial exact draft without clobbering assets", async () => {
		const fixture = await artifactFixture();
		const checksumPath = `${fixture.artifactPath}.sha256`;
		await writeFile(
			checksumPath,
			`${fixture.sha256}  ${basename(fixture.artifactPath)}\n`,
		);
		const checksumBytes = await readFile(checksumPath);
		const checksumDigest = createHash("sha256")
			.update(checksumBytes)
			.digest("hex");
		let release = {
			id: 7,
			tag_name: "v1.2.3",
			name: "v1.2.3",
			body: "exact notes\n",
			target_commitish: COMMIT,
			draft: true,
			prerelease: false,
			assets: [
				{
					name: basename(fixture.artifactPath),
					size: (await readFile(fixture.artifactPath)).byteLength,
					digest: `sha256:${fixture.sha256}`,
				},
			],
		};
		let uploads = 0;
		let publishes = 0;
		const runtime: PublicationRuntime = {
			fetch: async (url, init) => {
				const method = init?.method ?? "GET";
				if (method === "GET") return jsonResponse(200, [release]);
				if (String(url).includes("/assets?")) {
					uploads += 1;
					release = {
						...release,
						assets: [
							...release.assets,
							{
								name: basename(checksumPath),
								size: checksumBytes.byteLength,
								digest: `sha256:${checksumDigest}`,
							},
						],
					};
					return jsonResponse(201, release.assets[1]);
				}
				publishes += 1;
				release = { ...release, draft: false };
				return jsonResponse(200, release);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		await convergeGithubRelease(
			{
				repository: "owner/repo",
				token: "token",
				tag: "v1.2.3",
				commitSha: COMMIT,
				notes: "exact notes\n",
				assets: [fixture.artifactPath, checksumPath],
				mode: "publish",
			},
			runtime,
		);
		expect(uploads).toBe(1);
		expect(publishes).toBe(1);
	});

	test("reconciles a stale observation after publishing the draft", async () => {
		let patches = 0;
		let readsAfterPatch = 0;
		const draft = {
			id: 12,
			tag_name: "v1.2.3",
			name: "v1.2.3",
			body: "exact notes\n",
			target_commitish: COMMIT,
			draft: true,
			prerelease: false,
			assets: [],
		};
		const runtime: PublicationRuntime = {
			fetch: async (_url, init) => {
				if ((init?.method ?? "GET") === "PATCH") {
					patches += 1;
					return jsonResponse(200, { ...draft, draft: false });
				}
				if (patches > 0) readsAfterPatch += 1;
				return jsonResponse(200, [
					readsAfterPatch >= 2 ? { ...draft, draft: false } : draft,
				]);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		await convergeGithubRelease(
			{
				repository: "owner/repo",
				token: "token",
				tag: "v1.2.3",
				commitSha: COMMIT,
				notes: "exact notes\n",
				assets: [],
				mode: "publish",
			},
			runtime,
		);
		expect(patches).toBe(2);
	});

	for (const postPublishState of ["missing", "pending"] as const) {
		test(`reconciles an asset that is ${postPublishState} after draft publication`, async () => {
			const fixture = await artifactFixture();
			const bytes = await readFile(fixture.artifactPath);
			let phase: "draft" | "unsettled" | "settled" = "draft";
			let uploads = 0;
			const release = (
				draft: boolean,
				assetState: typeof postPublishState | "exact",
			) => ({
				id: 13,
				tag_name: "v1.2.3",
				name: "v1.2.3",
				body: "exact notes\n",
				target_commitish: COMMIT,
				draft,
				prerelease: false,
				assets:
					assetState === "missing"
						? []
						: [
								{
									name: basename(fixture.artifactPath),
									size: bytes.byteLength,
									digest:
										assetState === "pending"
											? null
											: `sha256:${fixture.sha256}`,
								},
							],
			});
			const runtime: PublicationRuntime = {
				fetch: async (url, init) => {
					const method = init?.method ?? "GET";
					if (method === "PATCH") {
						phase = "unsettled";
						return jsonResponse(200, release(false, postPublishState));
					}
					if (method === "POST" && String(url).includes("/assets?")) {
						uploads += 1;
						phase = "settled";
						return jsonResponse(201, release(false, "exact").assets[0]);
					}
					if (phase === "draft")
						return jsonResponse(200, [release(true, "exact")]);
					if (phase === "unsettled") {
						const observed = release(false, postPublishState);
						if (postPublishState === "pending") phase = "settled";
						return jsonResponse(200, [observed]);
					}
					return jsonResponse(200, [release(false, "exact")]);
				},
				run: async () => result(0),
				sleep: async () => {},
			};
			await convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [fixture.artifactPath],
					mode: "publish",
				},
				runtime,
			);
			expect(uploads).toBe(postPublishState === "missing" ? 1 : 0);
		});
	}

	test("refuses conflicting release assets without uploading or clobbering", async () => {
		const fixture = await artifactFixture();
		let mutations = 0;
		const runtime: PublicationRuntime = {
			fetch: async (_url, init) => {
				if ((init?.method ?? "GET") !== "GET") mutations += 1;
				return jsonResponse(200, [
					{
						id: 7,
						tag_name: "v1.2.3",
						name: "v1.2.3",
						body: "exact notes\n",
						target_commitish: COMMIT,
						draft: true,
						prerelease: false,
						assets: [
							{
								name: basename(fixture.artifactPath),
								size: 1,
								digest: "sha256:conflict",
							},
						],
					},
				]);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		await expect(
			convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [fixture.artifactPath],
					mode: "prepare",
				},
				runtime,
			),
		).rejects.toThrow("conflicting GitHub release asset");
		expect(mutations).toBe(0);
	});

	test("recovers a published release that is missing an exact asset", async () => {
		const fixture = await artifactFixture();
		let release = {
			id: 9,
			tag_name: "v1.2.3",
			name: "v1.2.3",
			body: "exact notes\n",
			target_commitish: COMMIT,
			draft: false,
			prerelease: false,
			assets: [] as Array<{ name: string; size: number; digest: string }>,
		};
		let mutations = 0;
		let refChecks = 0;
		const runtime: PublicationRuntime = {
			fetch: async (url, init) => {
				if ((init?.method ?? "GET") === "GET") {
					return jsonResponse(200, [release]);
				}
				mutations += 1;
				if (!String(url).includes("/assets?")) {
					throw new Error(
						"Published recovery must only upload the missing asset.",
					);
				}
				const bytes = await readFile(fixture.artifactPath);
				release = {
					...release,
					assets: [
						{
							name: basename(fixture.artifactPath),
							size: bytes.byteLength,
							digest: `sha256:${fixture.sha256}`,
						},
					],
				};
				return jsonResponse(201, release.assets[0]);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		expect(
			await convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [fixture.artifactPath],
					mode: "prepare",
					beforeMutation: async () => {
						throw new Error("main advanced after npm publication");
					},
				},
				runtime,
			),
		).toEqual({ state: "prepared", releaseId: 9 });
		expect(mutations).toBe(0);
		const npmRuntime: PublicationRuntime = {
			fetch: async () =>
				jsonResponse(200, { dist: { integrity: fixture.integrity } }),
			run: async () => {
				throw new Error("Exact npm state must skip publication.");
			},
			sleep: async () => {},
		};
		await convergeNpmPublication(
			{
				packageName: "opencode-plugin-flow",
				packageVersion: "1.2.3",
				artifactPath: fixture.artifactPath,
				beforePublish: async () => {
					throw new Error("Exact npm state must skip the current-main proof.");
				},
			},
			npmRuntime,
		);
		await convergeGithubRelease(
			{
				repository: "owner/repo",
				token: "token",
				tag: "v1.2.3",
				commitSha: COMMIT,
				notes: "exact notes\n",
				assets: [fixture.artifactPath],
				mode: "publish",
				beforeMutation: async () => {
					refChecks += 1;
				},
			},
			runtime,
		);
		expect(mutations).toBe(1);
		expect(refChecks).toBe(2);
	});

	test("waits for a pending digest without uploading the asset again", async () => {
		const fixture = await artifactFixture();
		const bytes = await readFile(fixture.artifactPath);
		let observations = 0;
		let mutations = 0;
		const runtime: PublicationRuntime = {
			fetch: async (_url, init) => {
				if ((init?.method ?? "GET") !== "GET") mutations += 1;
				observations += 1;
				return jsonResponse(200, [
					{
						id: 10,
						tag_name: "v1.2.3",
						name: "v1.2.3",
						body: "exact notes\n",
						target_commitish: COMMIT,
						draft: true,
						prerelease: false,
						assets: [
							{
								name: basename(fixture.artifactPath),
								size: bytes.byteLength,
								digest: observations === 1 ? null : `sha256:${fixture.sha256}`,
							},
						],
					},
				]);
			},
			run: async () => result(0),
			sleep: async () => {},
		};
		await convergeGithubRelease(
			{
				repository: "owner/repo",
				token: "token",
				tag: "v1.2.3",
				commitSha: COMMIT,
				notes: "exact notes\n",
				assets: [fixture.artifactPath],
				mode: "prepare",
			},
			runtime,
		);
		expect(mutations).toBe(0);
		expect(observations).toBe(2);
	});

	test("refuses unexpected assets and prerelease metadata", async () => {
		const fixture = await artifactFixture();
		const input = {
			repository: "owner/repo",
			token: "token",
			tag: "v1.2.3",
			commitSha: COMMIT,
			notes: "exact notes\n",
			assets: [fixture.artifactPath],
			mode: "prepare" as const,
		};
		const release = {
			id: 11,
			tag_name: "v1.2.3",
			name: "v1.2.3",
			body: "exact notes\n",
			target_commitish: COMMIT,
			draft: true,
			prerelease: false,
			assets: [{ name: "unexpected.txt", size: 1, digest: "sha256:conflict" }],
		};
		const runtime = (value: typeof release): PublicationRuntime => ({
			fetch: async () => jsonResponse(200, [value]),
			run: async () => result(0),
			sleep: async () => {},
		});
		await expect(
			convergeGithubRelease(input, runtime(release)),
		).rejects.toThrow("unexpected asset");
		await expect(
			convergeGithubRelease(
				input,
				runtime({ ...release, prerelease: true, assets: [] }),
			),
		).rejects.toThrow("metadata conflicts");
	});

	test("requires a remote tag proof even when the published release is exact", async () => {
		const runtime: PublicationRuntime = {
			fetch: async () =>
				jsonResponse(200, [
					{
						id: 14,
						tag_name: "v1.2.3",
						name: "v1.2.3",
						body: "exact notes\n",
						target_commitish: COMMIT,
						draft: false,
						prerelease: false,
						assets: [],
					},
				]),
			run: async () => result(0),
			sleep: async () => {},
		};
		await expect(
			convergeGithubRelease(
				{
					repository: "owner/repo",
					token: "token",
					tag: "v1.2.3",
					commitSha: COMMIT,
					notes: "exact notes\n",
					assets: [],
					mode: "publish",
					beforeMutation: async () => {
						throw new Error("remote tag moved");
					},
				},
				runtime,
			),
		).rejects.toThrow("remote tag moved");
	});
});
