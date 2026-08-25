import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_MAX_AGE_MS,
	type CanaryRecord,
	canaryRecordIssue,
	canaryRecordSha256,
	type PreparedCanary,
	parseCanaryRecord,
	prepareCanary,
	preparedCanarySha256,
	recordCanary,
} from "../scripts/eval-canary.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const artifact = {
	packageVersion: "1.2.3",
	sourceCommit: "commit",
	sourceTreeSha256: digest("a"),
	tarballSha256: digest("b"),
	unpackedManifestSha256: digest("c"),
};
const checks = {
	"installs-packed-artifact": true,
	"loads-flow-tools": true,
	"saves-plan": true,
	"captures-validation": true,
	"dispatches-reviewer": true,
	"closes-with-delivery": true,
};
const actor = {
	role: "manager" as const,
	requestedModel: {
		routeProvider: "provider",
		gateway: null,
		family: "family",
		model: "model",
		revision: null,
	},
	actualModel: {
		kind: "unobserved" as const,
		reason: "full identity unavailable",
	},
	sessionIds: ["ses_secret"],
};

function prepared(): PreparedCanary {
	const base: Omit<PreparedCanary, "sha256"> = {
		schemaVersion: 1 as const,
		releaseTag: "v1.2.3",
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: "2026-08-25T00:00:00.000Z",
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: digest("d"),
	};
	return { ...base, sha256: preparedCanarySha256(base) };
}

function record(
	input: {
		readonly status?: "passed" | "failed" | "incomplete";
		readonly checks?: typeof checks;
		readonly recordedAt?: string;
		readonly expiresAt?: string;
		readonly artifactValue?: typeof artifact;
	} = {},
): CanaryRecord {
	const recordedAt = input.recordedAt ?? "2026-08-25T00:00:00.000Z";
	const artifactValue = input.artifactValue ?? artifact;
	const base: Omit<CanaryRecord, "recordSha256"> = {
		schemaVersion: 1 as const,
		status: input.status ?? ("passed" as const),
		artifact: artifactValue,
		artifactSha256: artifactIdentitySha256(artifactValue),
		releaseTag: `v${artifactValue.packageVersion}`,
		operator: "maintainer",
		recordedAt,
		expiresAt:
			input.expiresAt ??
			new Date(Date.parse(recordedAt) + CANARY_MAX_AGE_MS).toISOString(),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		checks: input.checks ?? checks,
		hostConfigSha256: digest("e"),
		actors: [{ ...actor, sessionIds: ["<redacted-id>"] }],
		artifacts: {
			session: {
				path: "artifacts/1.2.3-session.json",
				sha256: digest("f"),
				bytes: 1,
			},
			transcript: {
				path: "artifacts/1.2.3-transcript.json",
				sha256: digest("9"),
				bytes: 1,
			},
		},
	};
	return { ...base, recordSha256: canaryRecordSha256(base) };
}

describe("canary record boundary", () => {
	test("accepts strict passed, failed, and incomplete records", () => {
		expect(parseCanaryRecord(record()).ok).toBe(true);
		expect(
			parseCanaryRecord(
				record({
					status: "failed",
					checks: { ...checks, "closes-with-delivery": false },
				}),
			).ok,
		).toBe(true);
		expect(parseCanaryRecord(record({ status: "incomplete" })).ok).toBe(true);
	});

	test("rejects wrong status/check combinations and unknown checklist keys", () => {
		expect(
			parseCanaryRecord(
				record({ checks: { ...checks, "closes-with-delivery": false } }),
			).ok,
		).toBe(false);
		expect(parseCanaryRecord(record({ status: "failed" })).ok).toBe(false);
		expect(
			parseCanaryRecord({ ...record(), checks: { ...checks, extra: true } }).ok,
		).toBe(false);
	});

	test("rejects tag, artifact, checklist, record hash, and expiry drift", () => {
		for (const changed of [
			{ ...record(), releaseTag: "v9.9.9" },
			{ ...record(), artifactSha256: digest("0") },
			{ ...record(), checklistSha256: digest("0") },
			{ ...record(), recordSha256: digest("0") },
			record({ expiresAt: "2026-08-29T00:00:00.000Z" }),
		]) {
			expect(parseCanaryRecord(changed).ok).toBe(false);
		}
	});
});

async function evidenceDirectory(value: CanaryRecord): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "flow-canary-evidence-"));
	temporary.push(directory);
	await mkdir(join(directory, "artifacts"), { recursive: true });
	await writeFile(join(directory, value.artifacts.session?.path ?? ""), "x");
	await writeFile(join(directory, value.artifacts.transcript?.path ?? ""), "y");
	return directory;
}

describe("canary release verification", () => {
	test("rejects stale, future, failed, incomplete, and artifact-mismatched records", async () => {
		const valid = record();
		const directory = await evidenceDirectory(valid);
		for (const [value, now, pattern] of [
			[valid, new Date("2026-08-29T00:00:00.000Z"), /expired/],
			[valid, new Date("2026-08-24T00:00:00.000Z"), /future/],
			[
				record({ status: "incomplete" }),
				new Date("2026-08-25T01:00:00.000Z"),
				/incomplete/,
			],
			[
				record({
					status: "failed",
					checks: { ...checks, "saves-plan": false },
				}),
				new Date("2026-08-25T01:00:00.000Z"),
				/failed/,
			],
		] as const) {
			expect(
				await canaryRecordIssue({
					version: "1.2.3",
					record: value,
					expectedArtifact: artifact,
					directory,
					now,
				}),
			).toMatch(pattern);
		}
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: valid,
				expectedArtifact: { ...artifact, tarballSha256: digest("0") },
				directory,
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toMatch(/does not match/);
	});

	test("checks sanitized evidence bytes, sizes, and digests", async () => {
		const valid = record();
		const directory = await evidenceDirectory(valid);
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: valid,
				expectedArtifact: artifact,
				directory,
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toMatch(/digest or size/);
	});
});

describe("canary recording", () => {
	test("redacts evidence and allows only byte-identical replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-canary-record-"));
		temporary.push(root);
		const input = {
			repositoryRoot: root,
			prepared: prepared(),
			status: "passed" as const,
			operator: "maintainer",
			hostConfig: { opencode: "1.18.6" },
			actors: [actor],
			checks,
			projectPath: "/secret/project",
			session: {
				id: "ses_secret",
				path: "/secret/project",
				apiKey: "sk-proj-1234567890123456",
			},
			transcript: {
				session: "session:1234-abcd",
				text: "Bearer abcdefghijklmnop",
			},
			recordedAt: new Date("2026-08-25T00:00:00.000Z"),
		};
		const first = await recordCanary(input);
		const second = await recordCanary(input);
		expect(second.record).toEqual(first.record);
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: first.record,
				expectedArtifact: artifact,
				directory: join(root, "evals", "canary"),
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toBeNull();
		const stored = [
			await readFile(
				join(root, "evals/canary/artifacts/1.2.3-session.json"),
				"utf8",
			),
			await readFile(
				join(root, "evals/canary/artifacts/1.2.3-transcript.json"),
				"utf8",
			),
			await readFile(first.path, "utf8"),
		].join("\n");
		expect(stored).not.toContain("/secret/project");
		expect(stored).not.toContain("ses_secret");
		expect(stored).not.toContain("1234-abcd");
		expect(stored).not.toContain("sk-proj-");
		expect(stored).not.toContain("Bearer abcdef");
		await expect(recordCanary({ ...input, operator: "other" })).rejects.toThrow(
			"conflicts",
		);
	});

	test("passed recording requires actors and both artifacts", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-canary-record-"));
		temporary.push(root);
		await expect(
			recordCanary({
				repositoryRoot: root,
				prepared: prepared(),
				status: "passed",
				operator: "maintainer",
				hostConfig: {},
				actors: [],
				checks,
				projectPath: root,
				session: null,
				transcript: null,
			}),
		).rejects.toThrow(/require actors/);
	});
});

async function run(command: readonly string[], cwd: string): Promise<void> {
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "ignore",
		stderr: "pipe",
	});
	if ((await child.exited) !== 0)
		throw new Error(await new Response(child.stderr).text());
}

describe("canary preparation", () => {
	test("builds an exact local-plugin fixture from the tarball", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-canary-package-"));
		const output = await mkdtemp(join(tmpdir(), "flow-canary-output-"));
		temporary.push(root, output);
		await mkdir(join(root, "dist"), { recursive: true });
		await writeFile(
			join(root, "dist/index.js"),
			"export default async () => ({});\n",
		);
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "opencode-plugin-flow",
				version: "1.2.3",
				files: ["dist/index.js"],
				dependencies: { zod: "4.4.3" },
				devDependencies: { "@opencode-ai/plugin": "1.18.6" },
			}),
		);
		for (const args of [
			["git", "init", "--initial-branch=main"],
			["git", "config", "user.email", "canary@example.com"],
			["git", "config", "user.name", "Canary"],
			["git", "add", "-A"],
			["git", "commit", "-m", "fixture"],
		])
			await run(args, root);
		await run(["bun", "pm", "pack", "--destination", output], root);
		const artifactPath = join(output, "opencode-plugin-flow-1.2.3.tgz");
		const prepared = await prepareCanary({
			repositoryRoot: root,
			artifactPath,
			outputDirectory: join(output, "prepared"),
			preparedAt: new Date("2026-08-25T00:00:00.000Z"),
		});
		expect(prepared.releaseTag).toBe("v1.2.3");
		expect(
			await readFile(
				join(output, "prepared/fixture/.opencode/plugins/flow.js"),
				"utf8",
			),
		).toContain("export default");
		expect(await readFile(join(output, "prepared/artifact.tgz"))).toEqual(
			await readFile(artifactPath),
		);
	});
});
