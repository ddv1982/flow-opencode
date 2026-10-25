import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	JsonValue,
	SessionInfo,
	SessionMessageAssistantTool,
	SessionTransferData,
} from "@opencode/client";
import {
	canaryRecordIssue,
	deriveCanaryResult,
} from "../scripts/eval-canary.js";
import {
	collectNativeCanary,
	type NativeCanaryExport,
} from "../scripts/export-canary-native.js";
import {
	assuranceProjection,
	deliveryProjection,
} from "../src/application/delivery.js";
import { operationResult } from "../src/application/flow-response.js";
import { SessionSchema } from "../src/application/schema.js";
import { archivedProjection } from "../src/application/session-projection.js";
import {
	closureRetryRequest,
	operationInputDigest,
} from "../src/domain/operation.js";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporary
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
const hash = (text: string) =>
	`sha256:${createHash("sha256").update(text).digest("hex")}`;
function flowSession() {
	const session = JSON.parse(
		readFileSync(
			join(import.meta.dir, "../evals/canary/artifacts/8.1.2-session.json"),
			"utf8",
		),
	);
	for (const run of session.runs)
		for (const validation of run.validations)
			for (const assertion of validation.observedAssertions ?? [])
				assertion.status = "passed";
	const closure = session.closure;
	const operation = session.operations.find(
		(item: { id: string }) => item.id === closure.operationId,
	);
	operation.inputDigest = operationInputDigest({
		operationId: closure.operationId,
		expectedRevision: closure.recordedRevision - 1,
		sessionId: session.id,
		kind: closure.kind,
		summary: closure.summary,
	});
	return SessionSchema.parse(session);
}
function tool(
	name: string,
	output: JsonValue,
	input: Record<string, JsonValue> = {},
): SessionMessageAssistantTool {
	return {
		type: "tool",
		id: `call_${name}`,
		name,
		time: { created: 1, completed: 2 },
		state: {
			status: "completed",
			input,
			content: [{ type: "text", text: JSON.stringify(output) }],
		},
	};
}
function sessionInfo(
	id: string,
	directory: string,
	parentID?: string,
): SessionInfo {
	return {
		id,
		...(parentID === undefined ? {} : { parentID }),
		projectID: "project",
		agent: parentID === undefined ? "build" : "flow-reviewer",
		model: { providerID: "openai", id: "gpt-6.1-sol" },
		location: { directory },
		cost: 0,
		tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
		time: { created: 1, updated: 2 },
	};
}
function native(
	directory = "<flow-eval-workspace>",
	session = flowSession(),
): NativeCanaryExport {
	const closeRequest = closureRetryRequest(session);
	if (!closeRequest) throw new Error("Missing closure request");
	return {
		schemaVersion: 2,
		host: {
			version: "2.1.4",
			pid: 99,
			urls: [],
			paths: { tmp: "/tmp/fixture" },
			location: { directory },
		},
		sessions: [
			{
				info: sessionInfo("ses_manager", directory),
				messages: [
					{
						id: "msg_manager",
						type: "assistant",
						agent: "build",
						model: { providerID: "openai", id: "gpt-6.1-sol" },
						time: { created: 1, completed: 2 },
						content: [
							tool("flow_status", {
								status: "ok",
								workflowData: {
									runtimeIdentity: {
										packageVersion: "10.0.0",
										pluginEntrySha256: hash("plugin"),
									},
									recovery: { mode: "off" },
								},
							}),
							tool("flow_plan_save", { status: "ok" }),
							tool("flow_validation_start", { status: "ok" }),
							tool("flow_review_start", { status: "ok" }),
							tool(
								"flow_session_close",
								JSON.parse(
									JSON.stringify({
										status: "ok",
										workflowData: {
											operation: operationResult(
												session,
												closeRequest.operationId,
												false,
												session.closure,
											),
											projection: archivedProjection(session),
											delivery: deliveryProjection(session),
										},
									}),
								),
								{ request: JSON.parse(JSON.stringify(closeRequest)) },
							),
						],
					},
				],
			},
			{
				info: sessionInfo("ses_reviewer", directory, "ses_manager"),
				messages: [
					{
						id: "msg_reviewer",
						type: "assistant",
						agent: "flow-reviewer",
						model: { providerID: "openai", id: "gpt-6.1-sol" },
						time: { created: 1, completed: 2 },
						content: session.runs
							.filter((run) => run.state === "completed")
							.map((run) => {
								const review = run.reviews.find(
									(review) => review.result?.verdict === "passed",
								);
								const operation = session.operations.find(
									(operation) =>
										operation.kind === "feature-complete" &&
										operation.entityId === run.id,
								);
								if (!review?.result || !operation || run.summary === null)
									throw new Error("Missing accepted reviewer operation");
								const { recordedRevision, ...result } = review.result;
								return {
									...tool(
										"flow_feature_complete",
										JSON.parse(
											JSON.stringify({
												status: "ok",
												workflowData: {
													operation: {
														operationId: operation.id,
														revision: operation.committedRevision,
														replayed: false,
														entity: run,
													},
													projection: {
														sessionId: session.id,
														revision: operation.committedRevision,
													},
												},
											}),
										),
										{
											request: JSON.parse(
												JSON.stringify({
													operationId: operation.id,
													expectedRevision: recordedRevision - 1,
													featureId: run.featureId,
													assignmentId: review.id,
													summary: run.summary,
													result,
												}),
											),
										},
									),
									id: `complete_${run.id}`,
								};
							}),
					},
				],
			},
		],
	};
}
function derive(transcript: unknown = native(), session = flowSession()) {
	return deriveCanaryResult({
		packageVersion: "10.0.0",
		artifactSha256: hash("identity"),
		tarballSha256: hash("archive"),
		preparedSha256: hash("prepared"),
		pluginEntrySha256: hash("plugin"),
		installation: {
			schemaVersion: 2,
			preparedSha256: hash("prepared"),
			artifactSha256: hash("identity"),
			tarballSha256: hash("archive"),
			pluginEntrySha256: hash("plugin"),
			installedPluginSha256: hash("plugin"),
			sourcePackageSha256: hash("manifest"),
			tuiEntrySha256: hash("tui"),
			pluginPackageSha256: hash("local-manifest"),
			configSha256: hash("config"),
		},
		session,
		transcript,
	});
}

test("V2 canary uses native completed Flow tools and server session parentage", () => {
	const result = derive();
	expect(result.status).toBe("passed");
	expect(result.checks).toEqual({
		"installs-packed-artifact": true,
		"loads-flow-tools": true,
		"saves-plan": true,
		"captures-validation": true,
		"dispatches-reviewer": true,
		"closes-with-delivery": true,
	});
	expect(
		result.actors.map((actor) => [
			actor.role,
			actor.requestedModel.routeProvider,
			actor.sessionIds,
		]),
	).toEqual([
		["manager", "openai", ["ses_manager"]],
		["reviewer", "openai", ["ses_reviewer"]],
	]);
});

function managerTool(value: NativeCanaryExport, name: string) {
	const message = value.sessions[0]?.messages[0];
	if (message?.type !== "assistant")
		throw new Error("Missing native assistant");
	const part = message.content.find(
		(part) => part.type === "tool" && part.name === name,
	);
	if (part?.type !== "tool" || part.state.status !== "completed")
		throw new Error("Missing native completed tool");
	return part.state;
}
for (const mutation of [
	"wrong-host",
	"wrong-parent",
	"missing-parent",
	"wrong-model",
	"assistant-model",
	"assistant-agent",
	"wrong-directory",
	"reviewer-without-completion",
	"application-error",
	"missing-content",
	"truncated-content",
	"unknown-completeness",
	"recovery-on",
	"runtime-identity",
	"unsupported-delivery",
	"unknown-message",
	"task-metadata-only",
	"old-wire-shape",
] as const)
	test(`V2 canary rejects ${mutation}`, () => {
		const value = structuredClone(native());
		const manager = value.sessions[0],
			reviewer = value.sessions[1];
		if (!manager || !reviewer) throw new Error("Missing native sessions");
		switch (mutation) {
			case "wrong-host":
				value.host.version = "1.18.31";
				break;
			case "wrong-parent":
				reviewer.info.parentID = "ses_unknown";
				break;
			case "missing-parent":
				delete reviewer.info.parentID;
				break;
			case "wrong-model":
				reviewer.info.model = { providerID: "unapproved", id: "model" };
				break;
			case "assistant-model": {
				const message = reviewer.messages[0];
				if (message?.type === "assistant") message.model.id = "different";
				break;
			}
			case "assistant-agent": {
				const message = reviewer.messages[0];
				if (message?.type === "assistant") message.agent = "build";
				break;
			}
			case "wrong-directory":
				reviewer.info.location.directory = "/elsewhere";
				break;
			case "reviewer-without-completion": {
				const message = reviewer.messages[0];
				if (message?.type === "assistant") message.content = [];
				break;
			}
			case "application-error":
				managerTool(value, "flow_plan_save").content = [
					{ type: "text", text: '{"status":"error"}' },
				];
				break;
			case "missing-content":
				managerTool(value, "flow_plan_save").content = [
					{ type: "text", text: "unknown output" },
				];
				break;
			case "truncated-content":
				managerTool(value, "flow_plan_save").metadata = { truncated: true };
				break;
			case "unknown-completeness":
				managerTool(value, "flow_plan_save").metadata = {
					truncated: "unknown",
				};
				break;
			case "recovery-on":
				managerTool(value, "flow_status").content = [
					{
						type: "text",
						text: JSON.stringify({
							status: "ok",
							workflowData: {
								runtimeIdentity: {
									packageVersion: "10.0.0",
									pluginEntrySha256: hash("plugin"),
								},
								recovery: { mode: "shadow" },
							},
						}),
					},
				];
				break;
			case "runtime-identity":
				managerTool(value, "flow_status").content = [
					{
						type: "text",
						text: '{"status":"ok","workflowData":{"runtimeIdentity":{"packageVersion":"10.0.0","pluginEntrySha256":"changed"}}}',
					},
				];
				break;
			case "unsupported-delivery":
				managerTool(value, "flow_session_close").content = [
					{
						type: "text",
						text: '{"status":"ok","workflowData":{"delivery":{"assurance":{"conclusion":"unsupported"}}}}',
					},
				];
				break;
			case "unknown-message":
				return expect(
					derive({
						...value,
						sessions: [
							{
								...manager,
								messages: [
									...manager.messages,
									{ id: "unknown", type: "future" },
								],
							},
							reviewer,
						],
					}).status,
				).not.toBe("passed");
			case "task-metadata-only":
				return expect(
					derive({
						schemaVersion: 2,
						host: value.host,
						sessions: [manager],
						messages: [
							{
								tool: "task",
								metadata: {
									parentSessionId: "ses_manager",
									sessionId: "ses_reviewer",
									model: { providerID: "openai", id: "gpt-6.1-sol" },
								},
							},
						],
					}).status,
				).not.toBe("passed");
			case "old-wire-shape":
				return expect(
					derive({
						info: { version: "2.1.4", directory: "<flow-eval-workspace>" },
						messages: [
							{
								info: { role: "assistant", sessionID: "ses_manager" },
								parts: [],
							},
						],
					}).status,
				).not.toBe("passed");
		}
		expect(derive(value).status).not.toBe("passed");
	});

test("retained 9.6 evidence still verifies offline without freshness rewriting", async () => {
	const directory = join(import.meta.dir, "../evals/canary");
	const record = JSON.parse(
		await readFile(join(directory, "9.6.0.json"), "utf8"),
	);
	expect(
		await canaryRecordIssue({
			version: "9.6.0",
			record,
			expectedArtifact: record.artifact,
			directory,
			now: new Date("2030-01-01"),
			freshness: "retained",
		}),
	).toBeNull();
});

async function collectionFixture() {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "flow-native-collector-")),
	);
	temporary.push(directory);
	const exported = native(directory);
	const sessions = [...exported.sessions];
	const client = {
		server: { info: async () => exported.host },
		session: {
			list: async () => ({
				data: sessions.map((session) => session.info),
				cursor: {},
			}),
			export: async ({ sessionID }: { sessionID: string }) => {
				const found = sessions.find((session) => session.info.id === sessionID);
				if (!found) throw new Error("Missing session");
				return found;
			},
			active: async () => ({}),
		},
	};
	return { directory, exported, sessions, client };
}

test("native collector retains all descendant reviewer exports and server facts", async () => {
	const fixture = await collectionFixture();
	fixture.sessions.push({
		info: {
			...sessionInfo("ses_worker", fixture.directory, "ses_manager"),
			agent: "flow-worker",
		},
		messages: [],
	});
	const result = await collectNativeCanary(fixture.client, {
		directory: fixture.directory,
		rootSessionID: "ses_manager",
	});
	expect(result).toEqual({ ...fixture.exported, sessions: fixture.sessions });
	await writeFile(
		join(fixture.directory, "native.json"),
		JSON.stringify(result),
	);
	expect(
		JSON.parse(
			await readFile(join(fixture.directory, "native.json"), "utf8"),
		).sessions.map((session: SessionTransferData) => session.info.id),
	).toEqual(["ses_manager", "ses_reviewer", "ses_worker"]);
});

test("native collector refuses wrong host, active sessions, pagination loops and changing trees", async () => {
	const fixture = await collectionFixture();
	const input = { directory: fixture.directory, rootSessionID: "ses_manager" };
	await expect(
		collectNativeCanary(
			{
				...fixture.client,
				server: {
					info: async () => ({ ...fixture.exported.host, version: "2.1.5" }),
				},
			},
			input,
		),
	).rejects.toThrow("pinned");
	await expect(
		collectNativeCanary(
			{
				...fixture.client,
				session: {
					...fixture.client.session,
					active: async () => ({
						ses_manager: {
							type: "running",
							agent: "build",
							model: { providerID: "openai", id: "gpt-6.1-sol" },
							messageID: "msg_manager",
							started: 1,
						},
					}),
				},
			},
			input,
		),
	).rejects.toThrow("idle");
	await expect(
		collectNativeCanary(
			{
				...fixture.client,
				session: {
					...fixture.client.session,
					list: async () => ({ data: [], cursor: { next: "repeat" } }),
				},
			},
			input,
		),
	).rejects.toThrow("converge");
	let lists = 0;
	await expect(
		collectNativeCanary(
			{
				...fixture.client,
				session: {
					...fixture.client.session,
					list: async () => ({
						data:
							lists++ === 0
								? fixture.sessions.map((session) => session.info)
								: [fixture.sessions[0]?.info].filter(
										(info): info is SessionInfo => info !== undefined,
									),
						cursor: {},
					}),
				},
			},
			input,
		),
	).rejects.toThrow("tree changed");
});

async function preparedFixture(directory: string) {
	const { canonicalJson } = await import("../evals/canonical-json.js");
	const {
		artifactIdentitySha256,
		CANARY_CHECKLIST_VERSION,
		CANARY_CHECKLIST_SHA256,
		preparedCanarySha256,
	} = await import("../scripts/eval-canary.js");
	const { mkdir } = await import("node:fs/promises");
	const sourcePackage = JSON.stringify({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		dependencies: {},
		devDependencies: { "@opencode/plugin": "2.1.4" },
	});
	const pluginPackage = canonicalJson({
		name: "opencode-plugin-flow",
		version: "10.0.0",
		type: "module",
		exports: { ".": "./index.js", "./tui": "./tui.js" },
		dependencies: { "@opencode/plugin": "2.1.4" },
	});
	const config = canonicalJson({
		plugins: [
			{
				package: "./.opencode/plugins/flow",
				options: { recovery: { mode: "off" } },
			},
		],
		update: "disable",
		share: "disabled",
	});
	await mkdir(join(directory, "package/dist"), { recursive: true });
	await mkdir(join(directory, "fixture/.opencode/plugins/flow"), {
		recursive: true,
	});
	for (const [path, bytes] of [
		["package/package.json", sourcePackage],
		["package/dist/index.js", "plugin"],
		["package/dist/tui.js", "tui"],
		["fixture/.opencode/plugins/flow/index.js", "plugin"],
		["fixture/.opencode/plugins/flow/tui.js", "tui"],
		["fixture/.opencode/plugins/flow/package.json", pluginPackage],
		["fixture/opencode.json", config],
	] as const)
		await writeFile(join(directory, path), bytes);
	const packed = Bun.spawn(
		["tar", "-czf", join(directory, "artifact.tgz"), "package"],
		{ cwd: directory, stderr: "pipe" },
	);
	if (await packed.exited)
		throw new Error(await new Response(packed.stderr).text());
	const archiveHash = `sha256:${createHash("sha256")
		.update(await readFile(join(directory, "artifact.tgz")))
		.digest("hex")}`;
	const artifact = {
		packageVersion: "10.0.0",
		sourceCommit: "fixture",
		sourceTreeSha256: hash("source"),
		tarballSha256: archiveHash,
		unpackedManifestSha256: hash("manifest"),
	};
	const base = {
		schemaVersion: 2 as const,
		releaseTag: "v10.0.0",
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion:
			CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		preparedAt: "2026-10-24T00:00:00Z",
		artifactFile: "artifact.tgz" as const,
		pluginEntrySha256: hash("plugin"),
		runtime: {
			hostVersion: "2.1.4" as const,
			sourcePackageSha256: hash(sourcePackage),
			tuiEntrySha256: hash("tui"),
			pluginPackageSha256: hash(pluginPackage),
			configSha256: hash(config),
		},
	};
	const prepared = { ...base, sha256: preparedCanarySha256(base) };
	await writeFile(join(directory, "prepared.json"), JSON.stringify(prepared));
	return prepared;
}

test("native canary recording redacts, reopens offline, rejects mutations and replays only exact bytes", async () => {
	const {
		recordCanary,
		parseCanaryRecord,
		canaryRecordSha256,
		CANARY_V2_DERIVATION_VERSION,
	} = await import("../scripts/eval-canary.js");
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), "flow-native-record-")),
	);
	temporary.push(directory);
	const prepared = await preparedFixture(directory);
	const originalSession = flowSession();
	const id = "session:1234-abcd";
	const closure = originalSession.closure;
	if (!closure) throw new Error("Missing closure");
	const session = {
		...originalSession,
		id,
		operations: originalSession.operations.map((operation) =>
			operation.id === closure.operationId
				? {
						...operation,
						inputDigest: operationInputDigest({
							operationId: closure.operationId,
							expectedRevision: closure.recordedRevision - 1,
							sessionId: id,
							kind: closure.kind,
							summary: closure.summary,
						}),
					}
				: operation,
		),
	};

	SessionSchema.parse(session);
	const input = {
		repositoryRoot: directory,
		prepared,
		preparedDirectory: directory,
		operator: "fixture",
		session,
		transcript: native(join(directory, "fixture"), session),
		recordedAt: new Date("2026-10-24T01:00:00Z"),
	};
	const result = await recordCanary(input);
	expect(result.record.status).toBe("passed");
	expect(result.record.derivationVersion).toBe(CANARY_V2_DERIVATION_VERSION);
	expect((await recordCanary(input)).record).toEqual(result.record);
	const verify = (record: unknown) =>
		canaryRecordIssue({
			version: "10.0.0",
			record,
			expectedArtifact: prepared.artifact,
			directory: join(directory, "evals/canary"),
			now: new Date("2026-10-24T02:00:00Z"),
		});
	expect(await verify(result.record)).toBeNull();
	const transcript = result.record.artifacts.transcript;
	if (!transcript) throw new Error("Missing native transcript reference");
	const retained = await readFile(
		join(directory, "evals/canary", transcript.path),
		"utf8",
	);
	expect(retained).not.toContain(directory);
	expect(retained).not.toContain("ses_manager");
	expect(
		JSON.parse(retained).sessions.map(
			(session: SessionTransferData) => session.info.location.directory,
		),
	).toEqual(["<flow-eval-workspace>", "<flow-eval-workspace>"]);
	const { recordSha256: _recordHash, ...base } = result.record;
	const altered = { ...base, derivationVersion: "canary-evidence-v1" as const };
	expect(
		parseCanaryRecord({ ...altered, recordSha256: canaryRecordSha256(altered) })
			.ok,
	).toBe(false);
	await expect(
		recordCanary({ ...input, operator: "different" }),
	).rejects.toThrow("conflicts");
	await writeFile(
		join(directory, "evals/canary", transcript.path),
		retained.replace('"version":"2.1.4"', '"version":"2.1.5"'),
	);
	expect(await verify(result.record)).toContain("digest or size");
	await writeFile(
		join(directory, "fixture/.opencode/plugins/flow/tui.js"),
		"mutated",
	);
	await expect(recordCanary(input)).rejects.toThrow(
		"installation bytes changed",
	);
});

for (const field of [
	"sessionId",
	"operationId",
	"expectedRevision",
	"kind",
	"summary",
] as const)
	test(`native close rejects a different accepted request ${field}`, () => {
		const value = native();
		const close = managerTool(value, "flow_session_close");
		const request = JSON.parse(JSON.stringify(close.input.request));
		request[field] =
			field === "expectedRevision"
				? 0
				: field === "kind"
					? "deferred"
					: "session:unrelated";
		close.input = { request };
		const result = derive(value);
		expect(result.status).toBe("failed");
		expect(result.checks["closes-with-delivery"]).toBe(false);
	});

for (const mutation of [
	"missing-operation",
	"operation-id",
	"operation-revision",
	"operation-entity",
	"operation-replayed",
	"projection-session",
	"projection-revision",
	"projection-archive",
	"delivery",
	"generic-assurance",
] as const)
	test(`native close rejects spliced response ${mutation}`, () => {
		const value = native();
		const close = managerTool(value, "flow_session_close");
		const output = JSON.parse(JSON.stringify(close.content[0]));
		const response = JSON.parse(output.text);
		const workflow = response.workflowData;
		switch (mutation) {
			case "missing-operation":
				delete workflow.operation;
				break;
			case "operation-id":
				workflow.operation.operationId = "other-close";
				break;
			case "operation-revision":
				workflow.operation.revision--;
				break;
			case "operation-entity":
				workflow.operation.entity.summary = "Another closure";
				break;
			case "operation-replayed":
				delete workflow.operation.replayed;
				break;
			case "projection-session":
				workflow.projection.sessionId = "session:unrelated";
				break;
			case "projection-revision":
				workflow.projection.revision--;
				break;
			case "projection-archive":
				workflow.projection.archived = false;
				break;
			case "delivery":
				workflow.delivery.goal = "A different goal";
				break;
			case "generic-assurance":
				workflow.delivery = { assurance: workflow.delivery.assurance };
				break;
		}
		close.content = [{ type: "text", text: JSON.stringify(response) }];
		expect(derive(value).status).toBe("failed");
	});

test("native evidence cannot substitute another valid durable session behind unchanged assurance statuses", () => {
	const original = flowSession();
	const closure = original.closure;
	if (!closure) throw new Error("Missing closure");
	const other = SessionSchema.parse({
		...original,
		id: "session:unrelated",
		operations: original.operations.map((operation) =>
			operation.id === closure.operationId
				? {
						...operation,
						inputDigest: operationInputDigest({
							operationId: closure.operationId,
							expectedRevision: closure.recordedRevision - 1,
							sessionId: "session:unrelated",
							kind: closure.kind,
							summary: closure.summary,
						}),
					}
				: operation,
		),
	});
	expect(assuranceProjection(other)).toEqual(assuranceProjection(original));
	const result = derive(native(), other);
	expect(result.status).toBe("failed");
	expect(result.checks["closes-with-delivery"]).toBe(false);
});

test("native reviewer completion binds the durable source and validation bytes, not only assurance labels", () => {
	const original = flowSession();
	const swapped = SessionSchema.parse({
		...original,
		runs: original.runs.map((run) => ({
			...run,
			validations: run.validations.map((validation) => ({
				...validation,
				sourceDigest: hash("unrelated-source"),
				outputDigest: hash("unrelated-output"),
			})),
			reviews: run.reviews.map((review) => ({
				...review,
				sourceDigest: hash("unrelated-source"),
			})),
		})),
	});
	expect(assuranceProjection(swapped)).toEqual(assuranceProjection(original));
	const result = derive(native(), swapped);
	expect(result.status).toBe("failed");
	expect(result.checks["captures-validation"]).toBe(false);
	expect(result.checks["closes-with-delivery"]).toBe(false);
});

for (const mutation of [
	"request-assignment",
	"request-operation",
	"request-revision",
	"request-summary",
	"response-operation",
	"response-revision",
	"response-replay",
	"response-session",
	"response-validation",
] as const)
	test(`native reviewer binding rejects ${mutation}`, () => {
		const value = native();
		const message = value.sessions.find(
			(session) => session.info.agent === "flow-reviewer",
		)?.messages[0];
		if (message?.type !== "assistant")
			throw new Error("Missing native reviewer");
		const part = message.content.find(
			(part) => part.type === "tool" && part.name === "flow_feature_complete",
		);
		if (part?.type !== "tool" || part.state.status !== "completed")
			throw new Error("Missing completion");
		const request = JSON.parse(JSON.stringify(part.state.input.request));
		const content = part.state.content[0];
		if (content.type !== "text") throw new Error("Missing response");
		const response = JSON.parse(content.text);
		switch (mutation) {
			case "request-assignment":
				request.assignmentId = "unrelated-review";
				break;
			case "request-operation":
				request.operationId = "unrelated-operation";
				break;
			case "request-revision":
				request.expectedRevision--;
				break;
			case "request-summary":
				request.summary = "Other work";
				break;
			case "response-operation":
				response.workflowData.operation.operationId = "unrelated-operation";
				break;
			case "response-revision":
				response.workflowData.operation.revision--;
				break;
			case "response-replay":
				response.workflowData.operation.replayed = true;
				break;
			case "response-session":
				response.workflowData.projection.sessionId = "session:unrelated";
				break;
			case "response-validation":
				response.workflowData.operation.entity.validations[0].outputDigest =
					hash("other-output");
				break;
		}
		part.state.input = { request };
		part.state.content = [{ type: "text", text: JSON.stringify(response) }];
		const result = derive(value);
		expect(result.status).toBe("failed");
		expect(result.checks["captures-validation"]).toBe(false);
	});
