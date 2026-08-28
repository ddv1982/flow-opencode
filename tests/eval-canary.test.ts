import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	artifactIdentitySha256,
	CANARY_CHECKLIST_SHA256,
	CANARY_CHECKLIST_VERSION,
	CANARY_DERIVATION_VERSION,
	CANARY_MAX_AGE_MS,
	type CanaryRecord,
	canaryRecordIssue,
	canaryRecordSha256,
	deriveCanaryResult,
	type PreparedCanary,
	parseCanaryRecord,
	prepareCanary,
	preparedCanarySha256,
	recordCanary,
} from "../scripts/eval-canary.js";
import { assuranceProjection } from "../src/application/delivery.js";
import { SessionSchema } from "../src/application/schema.js";
import { MAX_TEST_REPORT_BYTES } from "../src/domain/limits.js";
import { operationInputDigest } from "../src/domain/operation.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;
const sha256 = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;
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

function canarySession() {
	const session = JSON.parse(
		readFileSync(
			join(import.meta.dir, "../evals/canary/artifacts/8.1.2-session.json"),
			"utf8",
		),
	) as {
		id: string;
		closure: {
			kind: "completed";
			summary: string;
			operationId: string;
			recordedRevision: number;
		};
		operations: Array<{ id: string; inputDigest: string }>;
		runs: Array<{
			validations: Array<{
				observedAssertions?: Array<{ status: string }>;
			}>;
		}>;
	};
	for (const run of session.runs) {
		for (const validation of run.validations) {
			for (const assertion of validation.observedAssertions ?? []) {
				assertion.status = "passed";
			}
		}
	}
	const closureOperation = session.operations.find(
		(operation) => operation.id === session.closure.operationId,
	);
	if (!closureOperation)
		throw new Error("Canary closure operation is missing.");
	closureOperation.inputDigest = operationInputDigest({
		operationId: session.closure.operationId,
		expectedRevision: session.closure.recordedRevision - 1,
		sessionId: session.id,
		kind: session.closure.kind,
		summary: session.closure.summary,
	});
	return SessionSchema.parse(session);
}

function canaryTranscript(
	conclusion = "completion-supported",
	directory = "<flow-eval-workspace>",
	packageVersion = "1.2.3",
	pluginEntrySha256 = digest("d"),
) {
	const calls = [
		"flow_status",
		"flow_plan_save",
		"flow_validation_start",
		"flow_review_start",
	].map((tool) => ({
		type: "tool",
		tool,
		state: {
			status: "completed",
			input: {},
			output:
				tool === "flow_status"
					? {
							workflowData: {
								runtimeIdentity: { packageVersion, pluginEntrySha256 },
							},
						}
					: {},
		},
	}));
	return {
		info: { directory, version: "1.18.6" },
		messages: [
			{
				info: {
					role: "assistant",
					agent: "build",
					providerID: "provider",
					modelID: "model",
					sessionID: "ses_manager",
				},
				parts: [
					...calls,
					{
						type: "tool",
						tool: "task",
						state: {
							status: "completed",
							input: { subagent_type: "flow-reviewer" },
							output: {},
							metadata: {
								model: { providerID: "provider", modelID: "model" },
								parentSessionId: "ses_manager",
								sessionId: "ses_reviewer",
							},
						},
					},
					{
						type: "tool",
						tool: "flow_session_close",
						state: {
							status: "completed",
							input: {},
							output: {
								workflowData: {
									delivery: {
										assurance: {
											conclusion,
											checks: assuranceProjection(canarySession()).checks,
										},
									},
								},
							},
						},
					},
				],
			},
			{
				info: {
					role: "assistant",
					agent: "flow-reviewer",
					providerID: "provider",
					modelID: "model",
					sessionID: "ses_reviewer",
				},
				parts: [],
			},
		],
	};
}

function installation(value: PreparedCanary) {
	return {
		schemaVersion: 1,
		preparedSha256: value.sha256,
		artifactSha256: value.artifactSha256,
		tarballSha256: value.artifact.tarballSha256,
		pluginEntrySha256: value.pluginEntrySha256,
		installedPluginSha256: value.pluginEntrySha256,
	};
}

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

async function writePreparedFixture(root: string): Promise<{
	readonly directory: string;
	readonly prepared: PreparedCanary;
}> {
	const directory = join(root, "prepared");
	await mkdir(join(directory, "fixture/.opencode/plugins"), {
		recursive: true,
	});
	const artifactBytes = "packed artifact";
	const pluginBytes = "export const FlowPlugin = true;";
	const initial = prepared();
	const artifactValue = {
		...initial.artifact,
		tarballSha256: sha256(artifactBytes),
	};
	const { sha256: _initialSha256, ...initialBase } = initial;
	const base: Omit<PreparedCanary, "sha256"> = {
		...initialBase,
		artifact: artifactValue,
		artifactSha256: artifactIdentitySha256(artifactValue),
		pluginEntrySha256: sha256(pluginBytes),
	};
	const preparedValue = {
		...base,
		sha256: preparedCanarySha256(base),
	};
	await writeFile(
		join(directory, "prepared.json"),
		JSON.stringify(preparedValue),
	);
	await writeFile(join(directory, "artifact.tgz"), artifactBytes);
	await writeFile(
		join(directory, "fixture/.opencode/plugins/flow.js"),
		pluginBytes,
	);
	return { directory, prepared: preparedValue };
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
		derivationVersion: CANARY_DERIVATION_VERSION,
		preparedSha256: prepared().sha256,
		pluginEntrySha256: prepared().pluginEntrySha256,
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
		actors: [
			{ ...actor, sessionIds: ["<redacted-id>"] },
			{ ...actor, role: "reviewer", sessionIds: ["<redacted-id>"] },
		],
		artifacts: {
			installation: {
				path: "artifacts/1.2.3-installation.json",
				sha256: digest("8"),
				bytes: 1,
			},
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
	test("derives the committed unsupported completion as failed", async () => {
		const repositoryRoot = join(import.meta.dir, "..");
		const session = JSON.parse(
			await readFile(
				join(repositoryRoot, "evals/canary/artifacts/8.1.2-session.json"),
				"utf8",
			),
		);
		const transcript = JSON.parse(
			await readFile(
				join(repositoryRoot, "evals/canary/artifacts/8.1.2-transcript.json"),
				"utf8",
			),
		);
		const derived = deriveCanaryResult({
			packageVersion: prepared().artifact.packageVersion,
			artifactSha256: digest("a"),
			tarballSha256: prepared().artifact.tarballSha256,
			preparedSha256: prepared().sha256,
			pluginEntrySha256: prepared().pluginEntrySha256,
			installation: installation(prepared()),
			session,
			transcript,
		});
		expect(derived.status).toBe("failed");
		expect(derived.checks["closes-with-delivery"]).toBe(false);
		expect(derived.actors.map(({ role }) => role).sort()).toEqual([
			"manager",
			"reviewer",
		]);
	});

	test("derives every passed claim from complete structural evidence", () => {
		const value = prepared();
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session: canarySession(),
			transcript: canaryTranscript(),
		});
		expect(derived.status).toBe("passed");
		expect(Object.values(derived.checks).every(Boolean)).toBe(true);
		expect(derived.actors.map(({ role }) => role).sort()).toEqual([
			"manager",
			"reviewer",
		]);
	});

	test("refuses empty validation and delivery assertion sets", () => {
		const value = prepared();
		const session = structuredClone(canarySession()) as unknown as {
			runs: Array<{
				validations: Array<{
					scope: string;
					observedAssertions?: Array<unknown>;
				}>;
			}>;
		};
		const validations =
			session.runs
				.at(0)
				?.validations.filter(({ scope }) => scope === "broad") ?? [];
		if (validations.length === 0)
			throw new Error("Canary validation fixture is missing.");
		for (const validation of validations) validation.observedAssertions = [];
		const transcript = canaryTranscript();
		const close = transcript.messages
			.at(0)
			?.parts.find(({ tool }) => tool === "flow_session_close") as {
			state: {
				output: {
					workflowData: { delivery: { assurance: { checks: unknown[] } } };
				};
			};
		};
		close.state.output.workflowData.delivery.assurance.checks = [];
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session,
			transcript,
		});
		expect(derived.checks["captures-validation"]).toBe(false);
		expect(derived.checks["closes-with-delivery"]).toBe(false);
		expect(derived.status).toBe("failed");
	});

	test("ignores tool-shaped data nested in outputs and text", () => {
		const value = prepared();
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session: canarySession(),
			transcript: {
				info: { directory: "<flow-eval-workspace>", version: "1.18.6" },
				messages: [
					{
						info: {
							role: "assistant",
							agent: "build",
							providerID: "provider",
							modelID: "model",
							sessionID: "ses_manager",
						},
						parts: [
							{
								type: "tool",
								tool: "read",
								state: {
									status: "completed",
									input: {},
									output: { forged: canaryTranscript() },
								},
							},
							{ type: "text", text: JSON.stringify(canaryTranscript()) },
						],
					},
				],
			},
		});
		expect(derived.status).toBe("failed");
		expect(Object.values(derived.checks).every((check) => !check)).toBe(true);
	});

	test("classifies malformed retained evidence as incomplete", () => {
		const value = prepared();
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session: { plan: {}, operations: [], runs: [], closure: {} },
			transcript: canaryTranscript(),
		});
		expect(derived.status).toBe("incomplete");
	});

	test("requires OpenCode to run from the exact prepared fixture", () => {
		const value = prepared();
		const transcript = canaryTranscript(
			"completion-supported",
			"/other/project",
		);
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session: canarySession(),
			transcript,
		});
		expect(derived.checks["installs-packed-artifact"]).toBe(false);
		expect(derived.checks["loads-flow-tools"]).toBe(false);
	});

	test("requires reviewer task lineage to match both observed actors", () => {
		const value = prepared();
		const transcript = structuredClone(canaryTranscript()) as unknown as {
			messages: Array<{
				parts: Array<{
					tool?: string;
					state?: { metadata?: { sessionId?: string } };
				}>;
			}>;
		};
		const task = transcript.messages
			.at(0)
			?.parts.find(({ tool }) => tool === "task");
		if (!task?.state?.metadata)
			throw new Error("Canary reviewer task fixture is missing.");
		task.state.metadata.sessionId = "ses_unrelated";
		const derived = deriveCanaryResult({
			packageVersion: value.artifact.packageVersion,
			artifactSha256: value.artifactSha256,
			tarballSha256: value.artifact.tarballSha256,
			preparedSha256: value.sha256,
			pluginEntrySha256: value.pluginEntrySha256,
			installation: installation(value),
			session: canarySession(),
			transcript,
		});
		expect(derived.checks["dispatches-reviewer"]).toBe(false);
		expect(derived.status).toBe("failed");
	});

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
		const oversized = record();
		const oversizedBase = {
			...oversized,
			artifacts: {
				...oversized.artifacts,
				session: {
					...oversized.artifacts.session,
					bytes: MAX_TEST_REPORT_BYTES + 1,
				},
			},
		};
		expect(parseCanaryRecord(oversizedBase).ok).toBe(false);
	});
});

async function evidenceDirectory(value: CanaryRecord): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "flow-canary-evidence-"));
	temporary.push(directory);
	await mkdir(join(directory, "artifacts"), { recursive: true });
	await writeFile(
		join(directory, value.artifacts.installation?.path ?? ""),
		"z",
	);
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

	test("rejects symlinked retained evidence", async () => {
		const valid = record();
		const directory = await mkdtemp(join(tmpdir(), "flow-canary-evidence-"));
		const outside = await mkdtemp(join(tmpdir(), "flow-canary-outside-"));
		temporary.push(directory, outside);
		await mkdir(join(directory, "artifacts"), { recursive: true });
		await writeFile(join(outside, "session.json"), "x");
		await symlink(
			join(outside, "session.json"),
			join(directory, valid.artifacts.session?.path ?? ""),
		);
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: valid,
				expectedArtifact: artifact,
				directory,
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toMatch(/unreadable or unstable/);
	});
});

describe("canary recording", () => {
	test("redacts evidence and allows only byte-identical replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-canary-record-"));
		temporary.push(root);
		const fixture = await writePreparedFixture(root);
		const input = {
			repositoryRoot: root,
			prepared: fixture.prepared,
			preparedDirectory: fixture.directory,
			operator: "maintainer",
			session: canarySession(),
			transcript: {
				...canaryTranscript(
					"completion-supported",
					join(fixture.directory, "fixture"),
					fixture.prepared.artifact.packageVersion,
					fixture.prepared.pluginEntrySha256,
				),
				secret: {
					session: "session:1234-abcd",
					path: join(fixture.directory, "fixture"),
					text: "Bearer abcdefghijklmnop sk-proj-1234567890123456",
				},
			},
			recordedAt: new Date("2026-08-25T00:00:00.000Z"),
		};
		const first = await recordCanary(input);
		const second = await recordCanary(input);
		expect(second.record).toEqual(first.record);
		const actorIds = first.record.actors.flatMap(
			({ sessionIds }) => sessionIds,
		);
		expect(actorIds.every((id) => /^id_[a-f0-9]{16}$/.test(id))).toBe(true);
		expect(new Set(actorIds).size).toBe(2);
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: first.record,
				expectedArtifact: first.record.artifact,
				directory: join(root, "evals", "canary"),
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toBeNull();
		const { recordSha256: _recordSha256, ...recordBase } = first.record;
		const tamperedBase = { ...recordBase, hostConfigSha256: digest("0") };
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: {
					...tamperedBase,
					recordSha256: canaryRecordSha256(tamperedBase),
				},
				expectedArtifact: first.record.artifact,
				directory: join(root, "evals/canary"),
				now: new Date("2026-08-25T01:00:00.000Z"),
			}),
		).toMatch(/derived claims/);
		expect(
			await canaryRecordIssue({
				version: "1.2.3",
				record: first.record,
				expectedArtifact: {
					...first.record.artifact,
					sourceCommit: "tag-commit-after-evidence",
					sourceTreeSha256: digest("8"),
				},
				directory: join(root, "evals/canary"),
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
		expect(stored).not.toContain(fixture.directory);
		expect(stored).not.toContain("1234-abcd");
		expect(stored).not.toContain("sk-proj-");
		expect(stored).not.toContain("Bearer abcdef");
		await expect(recordCanary({ ...input, operator: "other" })).rejects.toThrow(
			"conflicts",
		);
		await writeFile(
			join(fixture.directory, "fixture/.opencode/plugins/flow.js"),
			"mutated plugin",
		);
		await expect(recordCanary(input)).rejects.toThrow(/installed plugin/i);
	});

	test("missing evidence derives an incomplete record", async () => {
		const root = await mkdtemp(join(tmpdir(), "flow-canary-record-"));
		temporary.push(root);
		const fixture = await writePreparedFixture(root);
		const result = await recordCanary({
			repositoryRoot: root,
			prepared: fixture.prepared,
			preparedDirectory: fixture.directory,
			operator: "maintainer",
			session: null,
			transcript: null,
		});
		expect(result.record.status).toBe("incomplete");
		expect(Object.values(result.record.checks).every((value) => !value)).toBe(
			true,
		);
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
	test("rejects a free artifact path at the release CLI", async () => {
		for (const argv of [
			["--artifact", "candidate.tgz"],
			["--artifact=candidate.tgz"],
		]) {
			const child = Bun.spawn(
				[
					"bun",
					"run",
					"scripts/eval-canary.ts",
					"prepare",
					...argv,
					"--out",
					"prepared",
				],
				{ cwd: new URL("..", import.meta.url).pathname, stderr: "pipe" },
			);
			const [exitCode, stderr] = await Promise.all([
				child.exited,
				new Response(child.stderr).text(),
			]);
			expect(exitCode).toBe(1);
			expect(stderr).toContain("prepare requires --report");
		}
	});

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
				dependencies: { zod: "4.4.2" },
				devDependencies: { "@opencode-ai/plugin": "1.18.5" },
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
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "opencode-plugin-flow",
				version: "1.2.3",
				dependencies: { zod: "9.9.9" },
				devDependencies: { "@opencode-ai/plugin": "9.9.9" },
			}),
		);
		await expect(
			prepareCanary({
				repositoryRoot: root,
				artifactPath,
				expectedArtifact: artifact,
				outputDirectory: join(output, "mismatched"),
			}),
		).rejects.toThrow(/does not match the measured campaign artifact/);
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
		expect(
			JSON.parse(
				await readFile(
					join(output, "prepared/fixture/.opencode/package.json"),
					"utf8",
				),
			),
		).toEqual({
			private: true,
			dependencies: {
				"@opencode-ai/plugin": "1.18.5",
				zod: "4.4.2",
			},
		});
	});
});
