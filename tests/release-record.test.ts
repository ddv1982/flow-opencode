import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json" with { type: "json" };
import {
	claimDraftCreation,
	loadRelease,
	type ReleaseRecord,
	releaseStatus,
	resumeRelease,
} from "../scripts/release.js";
import type { PublicationRuntime } from "../scripts/release-publish.js";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const directories: string[] = [];
const previous = { ...process.env };
afterEach(async () => {
	for (const key of [
		"GITHUB_RUN_ID",
		"GITHUB_RUN_ATTEMPT",
		"GITHUB_REF_TYPE",
		"GITHUB_REF_NAME",
		"GITHUB_SHA",
	]) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
async function fixture() {
	delete process.env.GITHUB_RUN_ID;
	delete process.env.GITHUB_RUN_ATTEMPT;
	process.env.GITHUB_REF_TYPE = "tag";
	process.env.GITHUB_REF_NAME = `v${packageJson.version}`;
	process.env.GITHUB_SHA = COMMIT;
	const directory = await mkdtemp(join(tmpdir(), "flow-release-record-"));
	directories.push(directory);
	const bytes = Buffer.from("qualified fixture");
	const hash = (value: Buffer) =>
		`sha256:${createHash("sha256").update(value).digest("hex")}`;
	const file = async (name: string, value: Buffer) => {
		await writeFile(join(directory, name), value);
		return { name, sha256: hash(value) };
	};
	const record: ReleaseRecord = {
		schemaVersion: 1,
		repository: "fixture/repo",
		tag: `v${packageJson.version}`,
		commit: COMMIT,
		packageName: packageJson.name,
		version: packageJson.version,
		artifact: await file("package.tgz", bytes),
		checksum: await file("package.tgz.sha256", Buffer.from("checksum")),
		notes: await file("release-notes.md", Buffer.from("exact notes")),
		canary: "unused",
		bundles: "unused",
		bundleSha256: `sha256:${"a".repeat(64)}`,
		creationOwner: "local",
	};
	await writeFile(join(directory, "release.json"), JSON.stringify(record));
	return { directory, record, bytes };
}
function transport(input: Awaited<ReturnType<typeof fixture>>) {
	const releases: Array<{
		id: number;
		tag_name: string;
		name: string;
		body: string;
		target_commitish: string;
		draft: boolean;
		prerelease: boolean;
		assets: Array<{ name: string; size: number; digest: string }>;
	}> = [];
	let creates = 0;
	let publishes = 0;
	let hidden = true;
	let npmExact = false;
	const runtime: PublicationRuntime = {
		fetch: async (url, init) => {
			const path = String(url);
			const method = init?.method ?? "GET";
			if (path.includes("registry.npmjs.org"))
				return npmExact
					? Response.json({
							dist: {
								integrity: `sha512-${createHash("sha512").update(input.bytes).digest("base64")}`,
							},
						})
					: new Response(null, { status: 404 });
			if (method === "GET") return Response.json(hidden ? [] : releases);
			if (path.endsWith("/releases") && method === "POST") {
				creates++;
				releases.push({
					id: 7,
					tag_name: input.record.tag,
					name: input.record.tag,
					body: "exact notes",
					target_commitish: COMMIT,
					draft: true,
					prerelease: false,
					assets: [],
				});
				throw new Error("response lost after creation");
			}
			const release = releases[0];
			if (!release) throw new Error("No draft");
			if (method === "PATCH") {
				release.draft = false;
				return Response.json(release);
			}
			const name = new URL(path).searchParams.get("name");
			if (!name) throw new Error("Missing asset name");
			const bytes = await readFile(join(input.directory, name));
			release.assets.push({
				name,
				size: bytes.length,
				digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			});
			return Response.json({});
		},
		run: async (command, args) => {
			if (command === "npm") {
				publishes++;
				npmExact = true;
			}
			return {
				exitCode: 0,
				stdout: args[0] === "rev-parse" ? COMMIT : "",
				stderr: "",
				timedOut: false,
			};
		},
		sleep: async () => {},
	};
	return {
		runtime,
		releases,
		show: () => {
			hidden = false;
		},
		counts: () => ({ creates, publishes }),
	};
}
test("restart reconciles an uncertain draft, publishes remaining assets, and then stays read-only", async () => {
	const input = await fixture();
	const remote = transport(input);
	let verifications = 0;
	const verify = async () => {
		verifications++;
	};
	await expect(
		resumeRelease(input.directory, remote.runtime, verify),
	).rejects.toThrow("did not become observable");
	expect(remote.counts()).toEqual({ creates: 1, publishes: 0 });
	await expect(
		resumeRelease(input.directory, remote.runtime, verify),
	).rejects.toThrow("already attempted");
	expect(remote.counts().creates).toBe(1);
	remote.show();
	await resumeRelease(input.directory, remote.runtime, verify);
	expect(remote.counts()).toEqual({ creates: 1, publishes: 1 });
	expect(remote.releases[0]?.assets).toHaveLength(2);
	await resumeRelease(input.directory, remote.runtime, verify);
	expect(remote.counts()).toEqual({ creates: 1, publishes: 1 });
	expect(verifications).toBe(4);
	expect((await releaseStatus(input.directory)).next).toBe("verify-remote");
});
test("a restored record from a prior CI attempt cannot create a draft from an empty listing", async () => {
	const input = await fixture();
	process.env.GITHUB_RUN_ID = "123";
	process.env.GITHUB_RUN_ATTEMPT = "2";
	await writeFile(
		join(input.directory, "release.json"),
		JSON.stringify({ ...input.record, creationOwner: "123/1" }),
	);
	const remote = transport(input);
	await expect(
		resumeRelease(input.directory, remote.runtime, async () => {}),
	).rejects.toThrow("previous workflow attempt");
	expect(remote.counts()).toEqual({ creates: 0, publishes: 0 });
});
test("creation intent is exclusive across callers", async () => {
	const { directory, record } = await fixture();
	const results = await Promise.allSettled(
		Array.from({ length: 5 }, () => claimDraftCreation(directory, record)),
	);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
});
test("changed payloads and failed qualification cannot cause remote mutations", async () => {
	const input = await fixture();
	const remote = transport(input);
	await expect(
		resumeRelease(input.directory, remote.runtime, async () => {
			throw new Error("Evidence expired");
		}),
	).rejects.toThrow("Evidence expired");
	await writeFile(join(input.directory, input.record.artifact.name), "changed");
	await expect(
		resumeRelease(input.directory, remote.runtime, async () => {}),
	).rejects.toThrow("payload changed");
	expect(remote.counts()).toEqual({ creates: 0, publishes: 0 });
});
test("a copied record retains its package identity and consumed creation intent", async () => {
	const input = await fixture();
	await claimDraftCreation(input.directory, input.record);
	const copy = await mkdtemp(join(tmpdir(), "flow-release-copy-"));
	directories.push(copy);
	await cp(input.directory, copy, { recursive: true });
	expect(await loadRelease(copy)).toEqual(input.record);
	await expect(claimDraftCreation(copy, input.record)).rejects.toThrow(
		"already attempted",
	);
});
