#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	link,
	mkdir,
	open,
	readFile,
	realpath,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "../evals/canonical-json.js";
import {
	mapStrings,
	normalizeRecorded,
	scrubSecrets,
} from "../evals/cassette.js";
import {
	nativeAuthSourceSha256,
	stageNativeAuthClient,
	verifyNativeAuthClient,
} from "../evals/native-auth/host.js";
import { OPENCODE_HOST_VERSION } from "../evals/opencode-host.js";
import { inspectArtifact, samePackedArtifact } from "../evals/provenance.js";
import {
	releaseHostPolicy,
	releaseReviewerModel,
	targetsOpenCodeV2,
} from "../evals/release-policy.js";
import type { ActorIdentity, ArtifactIdentity } from "../evals/report.js";
import { reportArtifactForCanary } from "../evals/report-artifact.js";
import {
	assuranceProjection,
	deliveryProjection,
} from "../src/application/delivery.js";
import {
	FeatureCompleteInputSchema,
	SessionCloseInputSchema,
	SessionSchema,
} from "../src/application/schema.js";
import { archivedProjection } from "../src/application/session-projection.js";
import { MAX_TEST_REPORT_BYTES } from "../src/domain/limits.js";
import {
	closureRetryRequest,
	operationInputDigest,
} from "../src/domain/operation.js";
import { currentRun } from "../src/domain/session.js";
import { readWorkspaceTestReport } from "../src/infrastructure/fs/workspace-validation.js";
import {
	assertCanaryWorkspace,
	prepareCanaryWorkspace,
} from "./canary-workspace.js";

export const CANARY_CHECKLIST_VERSION = "phase9-canary-v1";
export const CANARY_DERIVATION_VERSION = "canary-evidence-v1";
export const CANARY_V2_DERIVATION_VERSION = "canary-evidence-v2";
export function canaryDerivationVersion(
	packageVersion: string,
): typeof CANARY_DERIVATION_VERSION | typeof CANARY_V2_DERIVATION_VERSION {
	return targetsOpenCodeV2(packageVersion)
		? CANARY_V2_DERIVATION_VERSION
		: CANARY_DERIVATION_VERSION;
}
export const CANARY_CHECK_IDS = [
	"installs-packed-artifact",
	"loads-flow-tools",
	"saves-plan",
	"captures-validation",
	"dispatches-reviewer",
	"closes-with-delivery",
] as const;
export const CANARY_MAX_AGE_MS = 72 * 60 * 60 * 1_000;
export const CANARY_PLUGIN_LOADER =
	'export { default } from "./dist/index.js";\n';
export const CANARY_PLUGIN_LOADER_SHA256 = sha256(
	Buffer.from(CANARY_PLUGIN_LOADER),
);

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
export const CANARY_NATIVE_AUTH_DIRECTORY =
	"fixture/.opencode/plugins/native-auth-client";
const CANARY_NATIVE_AUTH_FILES = [
	"index.ts",
	"package.json",
	"protocol.ts",
	"client-plugin.ts",
] as const;
const NativeAuthFilesSchema = z
	.object({
		"index.ts": DigestSchema,
		"package.json": DigestSchema,
		"protocol.ts": DigestSchema,
		"client-plugin.ts": DigestSchema,
	})
	.strict();
export const CanaryNativeAuthSchema = z
	.object({
		kind: z.literal("native-account-source-v1"),
		pluginDirectory: z.literal(CANARY_NATIVE_AUTH_DIRECTORY),
		entrySha256: DigestSchema,
		sourceSha256: DigestSchema,
		files: NativeAuthFilesSchema,
	})
	.strict()
	.refine(
		(value) =>
			value.entrySha256 === value.files["index.ts"] &&
			value.sourceSha256 === nativeAuthSourceSha256(value.files),
		"Native auth closure digest is invalid.",
	);
export type CanaryNativeAuth = z.infer<typeof CanaryNativeAuthSchema>;
const CanaryNativeModelSchema = z
	.object({
		providerID: TextSchema,
		id: TextSchema,
		variant: TextSchema.optional(),
	})
	.strict();
export const CanaryAuthLaunchReceiptSchema = z
	.object({
		schemaVersion: z.literal(2),
		warming: z.literal(false),
		preparedSha256: DigestSchema,
		model: CanaryNativeModelSchema,
		rootSessionID: TextSchema,
		host: z
			.object({
				pid: z.number().int().positive(),
				version: z.literal(OPENCODE_HOST_VERSION),
			})
			.strict(),
		provider: z
			.object({ id: TextSchema, transport: z.literal("http") })
			.strict(),
		providerPolicySha256: DigestSchema,
		nativeAuth: CanaryNativeAuthSchema,
		native: z
			.object({ path: z.literal("native.json"), sha256: DigestSchema })
			.strict(),
		outcome: TextSchema,
	})
	.strict();
export type CanaryAuthLaunchReceipt = z.infer<
	typeof CanaryAuthLaunchReceiptSchema
>;
const NativeAuthInstallationSchema = CanaryNativeAuthSchema.safeExtend({
	sourceFiles: z
		.object({
			"index.ts": z.string().max(1024 * 1024),
			"package.json": z.string().max(1024 * 1024),
			"protocol.ts": z.string().max(1024 * 1024),
			"client-plugin.ts": z.string().max(1024 * 1024),
		})
		.strict(),
	launchReceipt: CanaryAuthLaunchReceiptSchema.optional(),
}).refine(
	(value) =>
		CANARY_NATIVE_AUTH_FILES.every(
			(name) =>
				sha256(Buffer.from(value.sourceFiles[name])) === value.files[name],
		),
	"Native auth source bytes do not match their seal.",
);
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
		actor.sessionIds.every(
			(sessionId) =>
				sessionId === "<redacted-id>" || /^id_[a-f0-9]{16}$/.test(sessionId),
		),
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
const HistoricalInstallationEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		preparedSha256: DigestSchema,
		artifactSha256: DigestSchema,
		tarballSha256: DigestSchema,
		pluginEntrySha256: DigestSchema,
		installedPluginSha256: DigestSchema,
	})
	.strict();
const NativeInstallationEvidenceSchema =
	HistoricalInstallationEvidenceSchema.extend({
		schemaVersion: z.literal(2),
		sourcePackageSha256: DigestSchema,
		tuiEntrySha256: DigestSchema,
		pluginPackageSha256: DigestSchema,
		loaderEntrySha256: z.literal(CANARY_PLUGIN_LOADER_SHA256),
		configSha256: DigestSchema,
		nativeAuth: NativeAuthInstallationSchema.optional(),
	}).strict();
export const InstallationEvidenceSchema = z.discriminatedUnion(
	"schemaVersion",
	[HistoricalInstallationEvidenceSchema, NativeInstallationEvidenceSchema],
);

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

type Checks = z.infer<typeof ChecksSchema>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function records(values: readonly unknown[]): Record<string, unknown>[] {
	return values.flatMap((value) => {
		const entry = record(value);
		return entry ? [entry] : [];
	});
}

function parsedJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

type ObservedCall = Readonly<{
	tool: string;
	status: string;
	sessionId: string | null;
	input: Record<string, unknown>;
	output: unknown;
	metadata: Record<string, unknown>;
}>;

type TranscriptShape = Readonly<{
	supported: boolean;
	entries: readonly Record<string, unknown>[];
}>;

function transcriptShape(value: unknown): TranscriptShape {
	const root = record(value);
	if (!root || !Array.isArray(root.messages)) {
		return { supported: false, entries: [] };
	}
	const messages = records(root.messages);
	return {
		supported:
			messages.length === root.messages.length &&
			messages.every(
				(message) => record(message.info) && Array.isArray(message.parts),
			),
		entries: [root, ...messages],
	};
}

function observedCall(
	entry: Record<string, unknown>,
	messageSessionId: string | null,
): ObservedCall | null {
	if (typeof entry.tool !== "string") return null;
	const state = record(entry.state);
	const flatMetadata = record(entry.metadata);
	const metadata =
		state?.metadata === undefined ? flatMetadata : record(state.metadata);
	const canonicalIdentity = metadata ? modelIdentity(metadata) : null;
	const modelClaims =
		flatMetadata &&
		["providerID", "modelID", "model"].some((key) =>
			Object.hasOwn(flatMetadata, key),
		);
	const conflicting =
		state?.metadata !== undefined &&
		flatMetadata &&
		(["sessionId", "parentSessionId"].some(
			(key) =>
				Object.hasOwn(flatMetadata, key) &&
				flatMetadata[key] !== metadata?.[key],
		) ||
			(modelClaims &&
				[
					flatMetadata,
					...(Object.hasOwn(flatMetadata, "model")
						? [{ model: flatMetadata.model }]
						: []),
				].some((claim) => {
					const identity = modelIdentity(claim);
					return (
						!identity ||
						!canonicalIdentity ||
						identity.provider !== canonicalIdentity.provider ||
						identity.model !== canonicalIdentity.model
					);
				})));
	return {
		tool: entry.tool,
		sessionId:
			typeof entry.sessionID === "string" ? entry.sessionID : messageSessionId,
		status:
			(typeof entry.status === "string" ? entry.status : null) ??
			(typeof state?.status === "string" ? state.status : "unknown"),
		input: record(entry.input) ?? record(state?.input) ?? {},
		output: parsedJson(
			entry.output ?? state?.output ?? entry.rawOutput ?? state?.error,
		),
		metadata: conflicting ? {} : (metadata ?? {}),
	};
}

function observedCalls(
	entries: readonly Record<string, unknown>[],
): ObservedCall[] {
	return entries.flatMap((entry) =>
		records(array(entry.parts)).flatMap((part) => {
			if (part.type !== "tool") return [];
			const info = record(entry.info);
			const call = observedCall(
				part,
				typeof info?.sessionID === "string" ? info.sessionID : null,
			);
			return call ? [call] : [];
		}),
	);
}

function completed(calls: readonly ObservedCall[], tool: string): boolean {
	return calls.some(
		(call) =>
			call.tool === tool &&
			(call.status === "completed" || call.status === "ok"),
	);
}

function loadedPluginMatches(
	calls: readonly ObservedCall[],
	packageVersion: string,
	pluginEntrySha256: string,
): boolean {
	return calls.some((call) => {
		if (call.tool !== "flow_status" || call.status !== "completed")
			return false;
		const output = record(call.output);
		const workflowData = record(output?.workflowData);
		const identity = record(workflowData?.runtimeIdentity);
		return (
			identity?.packageVersion === packageVersion &&
			identity.pluginEntrySha256 === pluginEntrySha256
		);
	});
}

function completionSupportedFromDelivery(
	calls: readonly ObservedCall[],
	expected: ReturnType<typeof assuranceProjection>,
): boolean {
	return calls.some((call) => {
		if (call.tool !== "flow_session_close" || call.status !== "completed") {
			return false;
		}
		const output = record(call.output);
		const workflowData = record(output?.workflowData);
		const delivery = record(workflowData?.delivery);
		const assurance = record(delivery?.assurance);
		const checks = array(assurance?.checks).map(record).filter(Boolean);
		return (
			assurance?.conclusion === "completion-supported" &&
			expected.conclusion === "completion-supported" &&
			checks.length === expected.checks.length &&
			expected.checks.every((expectedCheck) =>
				checks.some(
					(check) =>
						check?.id === expectedCheck.id &&
						check.status === expectedCheck.status,
				),
			)
		);
	});
}

function nativeClosedSessionMatches(
	calls: readonly ObservedCall[],
	session: z.infer<typeof SessionSchema>,
): boolean {
	const request = closureRetryRequest(session);
	if (
		request?.kind !== "completed" ||
		session.revision !== session.closure?.recordedRevision
	)
		return false;
	return calls.some((call) => {
		if (call.tool !== "flow_session_close" || call.status !== "completed")
			return false;
		const parsed = SessionCloseInputSchema.safeParse(call.input);
		if (
			!parsed.success ||
			canonicalJson(parsed.data.request) !== canonicalJson(request)
		)
			return false;
		const workflow = record(record(call.output)?.workflowData);
		const operation = record(workflow?.operation);
		const projection = record(workflow?.projection);
		const delivery = record(workflow?.delivery);
		return (
			operation !== null &&
			projection !== null &&
			delivery !== null &&
			operation.operationId === request.operationId &&
			operation.revision === session.revision &&
			typeof operation.replayed === "boolean" &&
			canonicalJson(operation.entity ?? null) ===
				canonicalJson(session.closure) &&
			canonicalJson(projection) ===
				canonicalJson(archivedProjection(session)) &&
			canonicalJson(delivery) === canonicalJson(deliveryProjection(session)) &&
			workflow?.closeState === undefined
		);
	});
}

function nativeCompletedRunsMatch(
	reviewerCalls: readonly ObservedCall[],
	session: z.infer<typeof SessionSchema>,
): boolean {
	const runs = (session.plan?.features ?? []).map((feature) =>
		currentRun(session, feature.id),
	);
	return (
		runs.length > 0 &&
		runs.every(
			(run) =>
				run?.state === "completed" &&
				reviewerCalls.some((call) => {
					if (
						call.tool !== "flow_feature_complete" ||
						call.status !== "completed"
					)
						return false;
					const parsed = FeatureCompleteInputSchema.safeParse(call.input);
					if (!parsed.success) return false;
					const request = parsed.data.request;
					const assignment = run.reviews.find(
						(review) => review.id === request.assignmentId,
					);
					if (!assignment?.result) return false;
					const { recordedRevision, ...result } = assignment.result;
					const committed = session.operations.find(
						(operation) => operation.id === request.operationId,
					);
					const workflow = record(record(call.output)?.workflowData);
					const operation = record(workflow?.operation);
					const projection = record(workflow?.projection);
					return (
						request.featureId === run.featureId &&
						request.summary === run.summary &&
						request.expectedRevision === recordedRevision - 1 &&
						canonicalJson(request.result) === canonicalJson(result) &&
						committed?.kind === "feature-complete" &&
						committed.entityId === run.id &&
						committed.committedRevision === recordedRevision &&
						operation?.operationId === committed.id &&
						operation.revision === committed.committedRevision &&
						operation.replayed === false &&
						projection?.sessionId === session.id &&
						projection.revision === recordedRevision &&
						canonicalJson(operation.entity ?? null) === canonicalJson(run)
					);
				}),
		)
	);
}

function modelIdentity(value: Record<string, unknown>): {
	readonly provider: string;
	readonly model: string;
} | null {
	const nested = record(value.model);
	const provider =
		typeof value.providerID === "string"
			? value.providerID
			: typeof nested?.providerID === "string"
				? nested.providerID
				: null;
	const model =
		typeof value.modelID === "string"
			? value.modelID
			: typeof nested?.modelID === "string"
				? nested.modelID
				: typeof nested?.id === "string"
					? nested.id
					: null;
	return provider && model ? { provider, model } : null;
}

function derivedActors(
	entries: readonly Record<string, unknown>[],
	calls: readonly ObservedCall[],
): {
	readonly actors: readonly ActorIdentity[];
	readonly complete: boolean;
	readonly managerSessionId: string | null;
} {
	const actors = new Map<string, ActorIdentity>();
	const lineages: Array<{
		readonly parent: string;
		readonly child: string;
		readonly identity: { readonly provider: string; readonly model: string };
	}> = [];
	let consistent = true;
	const add = (
		role: "manager" | "reviewer",
		identity: { readonly provider: string; readonly model: string },
		sessionId: string,
	): void => {
		const model = {
			routeProvider: identity.provider,
			gateway: null,
			family: identity.model,
			model: identity.model,
			revision: null,
		};
		const prior = actors.get(role);
		if (prior && canonicalJson(prior.requestedModel) !== canonicalJson(model)) {
			consistent = false;
			return;
		}
		actors.set(role, {
			role,
			requestedModel: model,
			actualModel: { kind: "observed", value: model },
			sessionIds: [...new Set([...(prior?.sessionIds ?? []), sessionId])],
		});
	};
	for (const entry of entries) {
		const info = record(entry.info);
		const identity = info ? modelIdentity(info) : null;
		if (info?.role === "assistant" && identity) {
			add(
				info.agent === "flow-reviewer" ? "reviewer" : "manager",
				identity,
				typeof info.sessionID === "string" ? info.sessionID : "<redacted-id>",
			);
		}
	}
	for (const call of calls) {
		if (
			call.tool !== "task" ||
			call.status !== "completed" ||
			call.input.subagent_type !== "flow-reviewer"
		)
			continue;
		const identity = modelIdentity(call.metadata);
		const sessionId = call.metadata.sessionId;
		const parentSessionId = call.metadata.parentSessionId;
		if (
			identity &&
			typeof sessionId === "string" &&
			typeof parentSessionId === "string" &&
			call.sessionId === parentSessionId
		) {
			const observedReviewer = actors.get("reviewer");
			if (
				observedReviewer &&
				!observedReviewer.sessionIds.includes(sessionId)
			) {
				consistent = false;
				continue;
			}
			add("reviewer", identity, sessionId);
			lineages.push({ parent: parentSessionId, child: sessionId, identity });
		} else {
			consistent = false;
		}
	}
	const manager = actors.get("manager");
	const reviewer = actors.get("reviewer");
	const distinct =
		manager !== undefined &&
		reviewer !== undefined &&
		manager.sessionIds.every((id) => !reviewer.sessionIds.includes(id));
	const linkedLineages =
		manager && reviewer
			? lineages.filter(
					(lineage) =>
						manager.sessionIds.includes(lineage.parent) &&
						reviewer.sessionIds.includes(lineage.child) &&
						reviewer.requestedModel.routeProvider ===
							lineage.identity.provider &&
						reviewer.requestedModel.model === lineage.identity.model,
				)
			: [];
	const managerSessionId =
		manager?.sessionIds.length === 1 &&
		reviewer !== undefined &&
		reviewer.sessionIds.every((child) =>
			linkedLineages.some(
				(lineage) =>
					lineage.parent === manager.sessionIds[0] && lineage.child === child,
			),
		)
			? (manager.sessionIds[0] ?? null)
			: null;
	return {
		actors: [...actors.values()],
		complete: consistent && distinct && managerSessionId !== null,
		managerSessionId,
	};
}

function observedHost(entries: readonly Record<string, unknown>[]): {
	readonly versions: readonly string[];
	readonly preparedFixture: boolean;
} {
	const versions = new Set<string>();
	let preparedFixture = false;
	for (const entry of entries) {
		const info = record(entry.info);
		if (typeof info?.version === "string") versions.add(info.version);
		if (
			info?.directory === "<flow-eval-workspace>" ||
			info?.path === "<flow-eval-workspace>"
		) {
			preparedFixture = true;
		}
	}
	return { versions: [...versions].sort(), preparedFixture };
}

function parseSessionRepairingClosureDigest(
	value: unknown,
):
	| { readonly ok: true; readonly value: z.infer<typeof SessionSchema> }
	| { readonly ok: false } {
	const direct = SessionSchema.safeParse(value);
	if (direct.success) return { ok: true, value: direct.data };
	const candidate = structuredClone(value);
	const session = record(candidate);
	const closure = record(session?.closure);
	if (!session || !closure || !Array.isArray(session.operations)) {
		return { ok: false };
	}
	const operation = session.operations
		.map(record)
		.find((entry) => entry?.id === closure.operationId);
	if (
		!operation ||
		typeof closure.operationId !== "string" ||
		typeof closure.recordedRevision !== "number" ||
		typeof session.id !== "string" ||
		(closure.kind !== "completed" &&
			closure.kind !== "deferred" &&
			closure.kind !== "abandoned") ||
		typeof closure.summary !== "string"
	) {
		return { ok: false };
	}
	operation.inputDigest = operationInputDigest({
		operationId: closure.operationId,
		expectedRevision: closure.recordedRevision - 1,
		sessionId: session.id,
		kind: closure.kind,
		summary: closure.summary,
	});
	const repaired = SessionSchema.safeParse(session);
	return repaired.success ? { ok: true, value: repaired.data } : { ok: false };
}

function assuranceSatisfied(
	assurance: ReturnType<typeof assuranceProjection>,
	id: string,
): boolean {
	return assurance.checks.some(
		(check) => check.id === id && check.status === "satisfied",
	);
}

const NativeModelSchema = z
	.object({
		providerID: TextSchema,
		id: TextSchema,
		variant: TextSchema.optional(),
	})
	.passthrough();
const NativeLocationSchema = z.object({ directory: TextSchema }).passthrough();
const NativeSessionSchema = z
	.object({
		info: z
			.object({
				id: TextSchema,
				parentID: TextSchema.optional(),
				agent: TextSchema,
				model: NativeModelSchema,
				location: NativeLocationSchema,
			})
			.passthrough(),
		messages: z.array(
			z.object({ id: TextSchema, type: TextSchema }).passthrough(),
		),
	})
	.strict();
const NativeTranscriptSchema = z
	.object({
		schemaVersion: z.literal(2),
		host: z
			.object({
				version: TextSchema,
				pid: z.number().int().positive(),
				location: NativeLocationSchema,
			})
			.passthrough(),
		sessions: z.array(NativeSessionSchema).min(2),
	})
	.strict();
const NativeAssistantSchema = z
	.object({
		id: TextSchema,
		type: z.literal("assistant"),
		agent: TextSchema,
		model: NativeModelSchema,
		time: z
			.object({ created: z.number().finite(), completed: z.number().finite() })
			.passthrough(),
		content: z.array(
			z.discriminatedUnion("type", [
				z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
				z
					.object({ type: z.literal("reasoning"), text: z.string() })
					.passthrough(),
				z
					.object({
						type: z.literal("tool"),
						id: TextSchema,
						name: TextSchema,
						time: z
							.object({
								created: z.number().finite(),
								completed: z.number().finite().optional(),
							})
							.passthrough(),
						state: z
							.object({
								status: z.enum(["streaming", "running", "completed", "error"]),
								input: z.unknown(),
								content: z.array(z.unknown()).optional(),
								metadata: z.record(z.string(), z.unknown()).optional(),
							})
							.passthrough(),
					})
					.passthrough(),
			]),
		),
	})
	.passthrough();

function nativeObservation(value: unknown): {
	readonly supported: boolean;
	readonly calls: readonly ObservedCall[];
	readonly actors: ReturnType<typeof derivedActors>;
	readonly host: ReturnType<typeof observedHost>;
} {
	const parsed = NativeTranscriptSchema.safeParse(value);
	const empty = {
		supported: false,
		calls: [],
		actors: { actors: [], complete: false, managerSessionId: null },
		host: { versions: [], preparedFixture: false },
	};
	if (!parsed.success) return empty;
	const { sessions, host } = parsed.data;
	const roots = sessions.filter(
		(session) => session.info.parentID === undefined,
	);
	if (
		roots.length !== 1 ||
		new Set(sessions.map((session) => session.info.id)).size !== sessions.length
	)
		return empty;
	const manager = roots[0];
	if (!manager || manager.info.agent.startsWith("flow-")) return empty;
	const byID = new Map(sessions.map((session) => [session.info.id, session]));
	const calls: ObservedCall[] = [];
	const actors = new Map<"manager" | "reviewer", ActorIdentity>();
	let consistent = true;
	const messageIDs = new Set<string>();
	for (const session of sessions) {
		const info = session.info;
		const ancestry = new Set([info.id]);
		let parent = info.parentID;
		while (parent !== undefined) {
			if (ancestry.has(parent)) return empty;
			ancestry.add(parent);
			const ancestor = byID.get(parent);
			if (!ancestor) return empty;
			parent = ancestor.info.parentID;
		}
		if (
			!ancestry.has(manager.info.id) ||
			info.location.directory !== host.location.directory ||
			(info.model.variant !== undefined && info.model.variant !== "default")
		)
			consistent = false;
		const role =
			info.id === manager.info.id
				? "manager"
				: info.agent === "flow-reviewer"
					? "reviewer"
					: null;
		if (role === "reviewer" && info.parentID !== manager.info.id)
			consistent = false;
		let assistants = 0;
		for (const message of session.messages) {
			if (messageIDs.has(message.id)) consistent = false;
			messageIDs.add(message.id);
			if (message.type !== "assistant") {
				if (
					![
						"user",
						"synthetic",
						"system",
						"compaction",
						"idle",
						"agent-switched",
						"model-switched",
						"location-switched",
						"shell",
						"skill",
					].includes(message.type)
				)
					consistent = false;
				continue;
			}
			const assistant = NativeAssistantSchema.safeParse(message);
			if (!assistant.success) {
				consistent = false;
				continue;
			}
			assistants++;
			if (
				assistant.data.agent !== info.agent ||
				canonicalJson(assistant.data.model) !== canonicalJson(info.model) ||
				assistant.data.error !== undefined
			)
				consistent = false;
			const callIDs = new Set<string>();
			for (const part of assistant.data.content) {
				if (part.type !== "tool") continue;
				if (callIDs.has(part.id)) consistent = false;
				callIDs.add(part.id);
				const state = part.state;
				const content = records(state.content ?? []);
				const output =
					content.length === 1 &&
					content[0]?.type === "text" &&
					typeof content[0].text === "string"
						? parsedJson(content[0].text)
						: null;
				const flowOutput = record(output);
				const completed =
					state.status === "completed" &&
					content.length === state.content?.length &&
					record(state.input) !== null &&
					(state.metadata?.truncated === undefined ||
						state.metadata.truncated === false) &&
					(!part.name.startsWith("flow_") || flowOutput?.status === "ok");
				calls.push({
					tool: part.name,
					status: completed ? "completed" : "unknown",
					sessionId: info.id,
					input: record(state.input) ?? {},
					output,
					metadata: {},
				});
				if (part.name.startsWith("flow_") && role === null) consistent = false;
			}
		}
		if (role !== null) {
			if (assistants === 0) consistent = false;
			const model = {
				routeProvider: info.model.providerID,
				gateway: null,
				family: info.model.id,
				model: info.model.id,
				revision: null,
			};
			const prior = actors.get(role);
			if (prior && canonicalJson(prior.requestedModel) !== canonicalJson(model))
				consistent = false;
			actors.set(role, {
				role,
				requestedModel: model,
				actualModel: { kind: "observed", value: model },
				sessionIds: [...(prior?.sessionIds ?? []), info.id],
			});
		}
	}
	const reviewer = actors.get("reviewer");
	const managerActor = actors.get("manager");
	if (
		!reviewer ||
		!managerActor ||
		canonicalJson(reviewer.requestedModel) !==
			canonicalJson(managerActor.requestedModel)
	)
		consistent = false;
	return {
		supported: true,
		calls: consistent ? calls : [],
		actors: {
			actors: [...actors.values()],
			complete: consistent && reviewer !== undefined,
			managerSessionId: consistent ? manager.info.id : null,
		},
		host: {
			versions: [host.version],
			preparedFixture:
				host.location.directory === "<flow-eval-workspace>" && consistent,
		},
	};
}

export function deriveCanaryResult(input: {
	readonly packageVersion: string;
	readonly artifactSha256: string;
	readonly tarballSha256: string;
	readonly preparedSha256: string;
	readonly pluginEntrySha256: string;
	readonly installation: unknown | null;
	readonly session: unknown | null;
	readonly transcript: unknown | null;
}): Readonly<{
	status: "passed" | "failed" | "incomplete";
	checks: Checks;
	actors: readonly ActorIdentity[];
	hostConfigSha256: string;
}> {
	const native = targetsOpenCodeV2(input.packageVersion)
		? nativeObservation(input.transcript)
		: null;
	const transcript = native ?? transcriptShape(input.transcript);
	const calls = native
		? native.calls
		: observedCalls(transcriptShape(input.transcript).entries);
	const installation = (
		native
			? NativeInstallationEvidenceSchema
			: HistoricalInstallationEvidenceSchema
	).safeParse(input.installation);
	const nativeSession = native ? SessionSchema.safeParse(input.session) : null;
	const session = nativeSession
		? nativeSession.success
			? { ok: true as const, value: nativeSession.data }
			: { ok: false as const }
		: parseSessionRepairingClosureDigest(input.session);
	const assurance =
		session.ok && session.value.closure
			? assuranceProjection(session.value)
			: null;
	const actors = native
		? native.actors
		: derivedActors(transcriptShape(input.transcript).entries, calls);
	const managerCalls = actors.managerSessionId
		? calls.filter((call) => call.sessionId === actors.managerSessionId)
		: [];
	const host = native
		? native.host
		: observedHost(transcriptShape(input.transcript).entries);
	const hasCompletedFlowCall = managerCalls.some(
		(call) => call.tool.startsWith("flow_") && call.status === "completed",
	);
	const loadedPlugin =
		loadedPluginMatches(
			managerCalls,
			input.packageVersion,
			input.pluginEntrySha256,
		) &&
		(!native ||
			managerCalls.some(
				(call) =>
					call.tool === "flow_status" &&
					call.status === "completed" &&
					record(record(record(call.output)?.workflowData)?.recovery)?.mode ===
						"off",
			));
	const boundRuns =
		!native ||
		(session.ok &&
			actors.complete &&
			nativeCompletedRunsMatch(
				calls.filter((call) =>
					actors.actors.some(
						(actor) =>
							actor.role === "reviewer" &&
							actor.sessionIds.includes(call.sessionId ?? ""),
					),
				),
				session.value,
			));
	const boundClose =
		!native ||
		(session.ok && nativeClosedSessionMatches(managerCalls, session.value));
	const auth =
		installation.success && installation.data.schemaVersion === 2
			? installation.data.nativeAuth
			: undefined;
	const boundAuth =
		!auth ||
		canaryAuthLaunchMatches({
			preparedSha256: input.preparedSha256,
			nativeAuth: auth,
			receipt: auth.launchReceipt,
			transcript: input.transcript,
		});
	const checks: Checks = {
		"installs-packed-artifact":
			boundAuth &&
			installation.success &&
			installation.data.preparedSha256 === input.preparedSha256 &&
			installation.data.artifactSha256 === input.artifactSha256 &&
			installation.data.tarballSha256 === input.tarballSha256 &&
			installation.data.pluginEntrySha256 === input.pluginEntrySha256 &&
			installation.data.installedPluginSha256 === input.pluginEntrySha256 &&
			host.preparedFixture &&
			loadedPlugin &&
			hasCompletedFlowCall,
		"loads-flow-tools":
			host.preparedFixture &&
			host.versions.length === 1 &&
			host.versions[0] ===
				releaseHostPolicy(input.packageVersion).opencodeVersion &&
			hasCompletedFlowCall &&
			loadedPlugin,
		"saves-plan":
			session.ok &&
			session.value.approval === "approved" &&
			session.value.plan !== null &&
			session.value.operations.some(
				(operation) => operation.kind === "plan-save",
			) &&
			completed(managerCalls, "flow_plan_save"),
		"captures-validation":
			boundRuns &&
			assurance !== null &&
			assuranceSatisfied(assurance, "accepted-validation") &&
			assuranceSatisfied(assurance, "canonical-gate") &&
			assuranceSatisfied(assurance, "declared-evidence") &&
			completed(managerCalls, "flow_validation_start"),
		"dispatches-reviewer":
			boundRuns &&
			assurance !== null &&
			assuranceSatisfied(assurance, "recorded-completion") &&
			actors.complete &&
			completed(managerCalls, "flow_review_start") &&
			(native
				? calls.some(
						(call) =>
							call.tool === "flow_feature_complete" &&
							call.status === "completed" &&
							actors.actors.some(
								(actor) =>
									actor.role === "reviewer" &&
									actor.sessionIds.includes(call.sessionId ?? ""),
							),
					)
				: managerCalls.some(
						(call) =>
							call.tool === "task" &&
							call.status === "completed" &&
							call.input.subagent_type === "flow-reviewer",
					)),
		"closes-with-delivery":
			boundClose &&
			boundRuns &&
			assurance !== null &&
			assurance.conclusion === "completion-supported" &&
			completionSupportedFromDelivery(managerCalls, assurance),
	};
	const missing =
		input.installation === null ||
		input.session === null ||
		input.transcript === null ||
		!installation.success ||
		!session.ok ||
		!transcript.supported;
	const status = missing
		? "incomplete"
		: Object.values(checks).every(Boolean)
			? "passed"
			: "failed";
	return {
		status,
		checks,
		actors: actors.actors,
		hostConfigSha256: canonicalSha256("flow-canary-host-config-v2", {
			artifactSha256: input.artifactSha256,
			installation: installation.success ? installation.data : null,
			actors: actors.actors,
			host,
			platforms: [
				...new Set(
					(session.ok ? session.value.runs : [])
						.flatMap((run) => run.validations)
						.flatMap((validation) =>
							validation.hostPlatform ? [validation.hostPlatform] : [],
						),
				),
			].sort(),
		}),
	};
}
const PackageMetadataSchema = z
	.object({
		name: z.literal("opencode-plugin-flow"),
		version: TextSchema,
		dependencies: z.record(z.string(), TextSchema),
		devDependencies: z
			.object({ "@opencode/plugin": z.literal(OPENCODE_HOST_VERSION) })
			.passthrough(),
	})
	.passthrough();
function canaryPluginPackage(
	metadata: z.infer<typeof PackageMetadataSchema>,
): Buffer {
	return Buffer.from(
		canonicalJson({
			name: metadata.name,
			version: metadata.version,
			type: "module",
			main: "./dist/index.js",
			exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" },
			dependencies: {
				...metadata.dependencies,
				"@opencode/plugin": OPENCODE_HOST_VERSION,
			},
		}),
	);
}
function canaryConfig(): Buffer {
	return Buffer.from(
		canonicalJson({
			plugins: [
				{
					package: "./.opencode/plugins/flow",
					options: { recovery: { mode: "off" } },
				},
			],
			update: "disable",
			share: "disabled",
		}),
	);
}
export function canaryProviderConfiguration(model: {
	providerID: string;
	id: string;
	variant?: string | undefined;
}) {
	return {
		providers: {
			[model.providerID]: {
				settings: { transport: "http" as const },
				models: {
					[model.id]: {
						settings: { transport: "http" as const },
						variants: [
							{
								id: model.variant ?? "default",
								settings: { transport: "http" as const },
							},
						],
					},
				},
			},
		},
	};
}
function nativeAuthDescriptor(value: CanaryNativeAuth): CanaryNativeAuth {
	return {
		kind: value.kind,
		pluginDirectory: value.pluginDirectory,
		entrySha256: value.entrySha256,
		sourceSha256: value.sourceSha256,
		files: value.files,
	};
}
export function canaryAuthLaunchMatches(input: {
	preparedSha256: string;
	nativeAuth: CanaryNativeAuth;
	receipt: unknown;
	transcript: unknown;
}): boolean {
	const parsed = CanaryAuthLaunchReceiptSchema.safeParse(input.receipt);
	if (!parsed.success) return false;
	const receipt = parsed.data;
	const transcript = record(input.transcript);
	const host = record(transcript?.host);
	const root = records(array(transcript?.sessions))
		.map((session) => record(session.info))
		.find(
			(info) =>
				info?.id === receipt.rootSessionID && info.parentID === undefined,
		);
	return (
		receipt.preparedSha256 === input.preparedSha256 &&
		canonicalJson(receipt.nativeAuth) ===
			canonicalJson(nativeAuthDescriptor(input.nativeAuth)) &&
		receipt.native.sha256 ===
			sha256(Buffer.from(canonicalJson(input.transcript))) &&
		host?.pid === receipt.host.pid &&
		host.version === receipt.host.version &&
		root != null &&
		canonicalJson(root.model) === canonicalJson(receipt.model) &&
		root.outcome === receipt.outcome &&
		receipt.provider.id === receipt.model.providerID &&
		receipt.providerPolicySha256 ===
			sha256(
				Buffer.from(canonicalJson(canaryProviderConfiguration(receipt.model))),
			)
	);
}
export const CANARY_PLUGIN_DIRECTORY = "fixture/.opencode/plugins/flow";
const NativePreparationSchema = z
	.object({
		hostVersion: z.literal(OPENCODE_HOST_VERSION),
		sourcePackageSha256: DigestSchema,
		tuiEntrySha256: DigestSchema,
		pluginPackageSha256: DigestSchema,
		loaderEntrySha256: z.literal(CANARY_PLUGIN_LOADER_SHA256),
		configSha256: DigestSchema,
		nativeAuth: CanaryNativeAuthSchema.optional(),
	})
	.strict();
const EvidenceRefSchema = z
	.object({
		path: TextSchema,
		sha256: DigestSchema,
		bytes: z.number().int().safe().nonnegative().max(MAX_TEST_REPORT_BYTES),
	})
	.strict();
const HistoricalPreparedCanarySchema = z
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
export const PreparedCanarySchema = z.discriminatedUnion("schemaVersion", [
	HistoricalPreparedCanarySchema,
	HistoricalPreparedCanarySchema.extend({
		schemaVersion: z.literal(2),
		runtime: NativePreparationSchema,
	}).strict(),
]);
export type PreparedCanary = z.infer<typeof PreparedCanarySchema>;

export const CanaryRecordSchema = z
	.object({
		schemaVersion: z.literal(1),
		derivationVersion: z.enum([
			CANARY_DERIVATION_VERSION,
			CANARY_V2_DERIVATION_VERSION,
		]),
		preparedSha256: DigestSchema,
		pluginEntrySha256: DigestSchema,
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
				installation: EvidenceRefSchema,
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
				!record.actors.some((actor) => actor.role === "manager") ||
				!record.actors.some((actor) => actor.role === "reviewer") ||
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
	prepared:
		| Omit<z.infer<typeof HistoricalPreparedCanarySchema>, "sha256">
		| Omit<Extract<PreparedCanary, { schemaVersion: 2 }>, "sha256">,
): string {
	return canonicalSha256("flow-canary-preparation-v1", prepared);
}

export function parsePreparedCanary(input: unknown): PreparedCanary {
	const prepared = PreparedCanarySchema.parse(input);
	const { sha256: _sha256, ...withoutHash } = prepared;
	if (
		prepared.sha256 !== preparedCanarySha256(withoutHash) ||
		prepared.releaseTag !== `v${prepared.artifact.packageVersion}` ||
		prepared.artifactSha256 !== artifactIdentitySha256(prepared.artifact) ||
		prepared.checklistSha256 !== CANARY_CHECKLIST_SHA256 ||
		(prepared.schemaVersion === 2) !==
			targetsOpenCodeV2(prepared.artifact.packageVersion)
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
		...(record.derivationVersion ===
		canaryDerivationVersion(record.artifact.packageVersion)
			? []
			: ["Canary derivation does not match the release host."]),
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
	readonly nativeAuth?: boolean;
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
	await mkdir(join(input.outputDirectory, CANARY_PLUGIN_DIRECTORY, "dist"), {
		recursive: true,
	});
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
	const sourcePackage = extractArtifactFile(
		copiedArtifactPath,
		"package/package.json",
	);
	const packageMetadata = PackageMetadataSchema.parse(
		JSON.parse(sourcePackage.toString("utf8")),
	);
	if (!targetsOpenCodeV2(artifact.packageVersion))
		throw new Error(
			"Active canary preparation requires a Flow release targeting OpenCode v2.",
		);
	const tuiEntry = extractArtifactFile(
		copiedArtifactPath,
		"package/dist/tui.js",
	);
	const pluginPackage = canaryPluginPackage(packageMetadata);
	const config = canaryConfig();
	for (const [name, bytes] of [
		["index.js", Buffer.from(CANARY_PLUGIN_LOADER)],
		["dist/index.js", pluginEntry],
		["dist/tui.js", tuiEntry],
		["package.json", pluginPackage],
	] as const)
		await writeFile(
			join(input.outputDirectory, CANARY_PLUGIN_DIRECTORY, name),
			bytes,
		);
	await writeFile(join(fixture, "opencode.json"), config);
	const runtime: z.infer<typeof NativePreparationSchema> = {
		hostVersion: OPENCODE_HOST_VERSION,
		sourcePackageSha256: sha256(sourcePackage),
		tuiEntrySha256: sha256(tuiEntry),
		pluginPackageSha256: sha256(pluginPackage),
		loaderEntrySha256: CANARY_PLUGIN_LOADER_SHA256,
		configSha256: sha256(config),
	};
	if (input.nativeAuth) {
		const staged = await stageNativeAuthClient(
			resolve(input.outputDirectory, CANARY_NATIVE_AUTH_DIRECTORY),
		);
		await verifyNativeAuthClient(staged);
		runtime.nativeAuth = CanaryNativeAuthSchema.parse({
			...staged,
			kind: "native-account-source-v1",
			pluginDirectory: CANARY_NATIVE_AUTH_DIRECTORY,
		});
	}
	await mkdir(join(fixture, "src"), { recursive: true });
	await writeFile(
		join(fixture, "src", "canary.ts"),
		"export const canary = true;\n",
	);
	await writeFile(
		join(fixture, "README.md"),
		`# Flow exact-artifact canary\n\nArtifact: ${artifact.tarballSha256}\n\nRun every checklist item and export sanitized JSON session and transcript evidence.\n`,
	);
	await prepareCanaryWorkspace(fixture);
	const base = {
		schemaVersion: 2 as const,
		runtime,
		releaseTag: `v${artifact.packageVersion}`,
		artifact,
		artifactSha256: artifactIdentitySha256(artifact),
		checklistVersion:
			CANARY_CHECKLIST_VERSION as typeof CANARY_CHECKLIST_VERSION,
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
	readonly nativeAuth?: boolean;
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
		...(input.nativeAuth ? { nativeAuth: true } : {}),
	});
}

function redactEvidence(value: unknown, projectPath: string): unknown {
	const normalized = normalizeRecorded(value, projectPath);
	return mapStrings(normalized, (text) =>
		scrubSecrets(text).replace(
			/\b(?:ses_[A-Za-z0-9]+|(?:session|review):[A-Za-z0-9-]+)\b/g,
			(id) =>
				`id_${canonicalSha256("flow-canary-redacted-id-v1", id).slice("sha256:".length, "sha256:".length + 16)}`,
		),
	);
}

export async function measureCanaryInstallation(
	prepared: PreparedCanary,
	directory: string,
): Promise<z.infer<typeof InstallationEvidenceSchema>> {
	const retainedPreparation = parsePreparedCanary(
		JSON.parse(await readFile(join(directory, "prepared.json"), "utf8")),
	);
	if (canonicalJson(retainedPreparation) !== canonicalJson(prepared)) {
		throw new Error(
			"Retained canary preparation does not match the recorder input.",
		);
	}
	const [artifactBytes, installedPlugin] = await Promise.all([
		readFile(join(directory, prepared.artifactFile)),
		readFile(
			join(
				directory,
				prepared.schemaVersion === 2
					? `${CANARY_PLUGIN_DIRECTORY}/dist/index.js`
					: "fixture/.opencode/plugins/flow.js",
			),
		),
	]);
	if (sha256(artifactBytes) !== prepared.artifact.tarballSha256) {
		throw new Error("Prepared canary tarball bytes do not match the artifact.");
	}
	const installedPluginSha256 = sha256(installedPlugin);
	if (installedPluginSha256 !== prepared.pluginEntrySha256) {
		throw new Error(
			"Prepared canary installed plugin bytes do not match the artifact.",
		);
	}
	if (prepared.schemaVersion === 2) {
		await assertCanaryWorkspace(join(directory, "fixture"));
		const [sourcePackage, tuiEntry, pluginPackage, config, loaderEntry] =
			await Promise.all([
				Promise.resolve(
					extractArtifactFile(
						join(directory, prepared.artifactFile),
						"package/package.json",
					),
				),
				readFile(join(directory, CANARY_PLUGIN_DIRECTORY, "dist/tui.js")),
				readFile(join(directory, CANARY_PLUGIN_DIRECTORY, "package.json")),
				readFile(join(directory, "fixture/opencode.json")),
				readFile(join(directory, CANARY_PLUGIN_DIRECTORY, "index.js")),
			]);
		const measured = {
			sourcePackageSha256: sha256(sourcePackage),
			tuiEntrySha256: sha256(tuiEntry),
			pluginPackageSha256: sha256(pluginPackage),
			loaderEntrySha256: sha256(loaderEntry),
			configSha256: sha256(config),
		};
		const {
			hostVersion: _hostVersion,
			nativeAuth,
			...expected
		} = prepared.runtime;
		const metadata = PackageMetadataSchema.parse(
			JSON.parse(sourcePackage.toString("utf8")),
		);
		if (
			canonicalJson(measured) !== canonicalJson(expected) ||
			!pluginPackage.equals(canaryPluginPackage(metadata)) ||
			!loaderEntry.equals(Buffer.from(CANARY_PLUGIN_LOADER)) ||
			!config.equals(canaryConfig()) ||
			sha256(
				extractArtifactFile(
					join(directory, prepared.artifactFile),
					"package/dist/index.js",
				),
			) !== installedPluginSha256 ||
			sha256(
				extractArtifactFile(
					join(directory, prepared.artifactFile),
					"package/dist/tui.js",
				),
			) !== measured.tuiEntrySha256
		)
			throw new Error("Prepared canary installation bytes changed.");
		let measuredAuth: z.infer<typeof NativeAuthInstallationSchema> | undefined;
		if (nativeAuth) {
			const staged = {
				...nativeAuth,
				pluginDirectory: await realpath(
					join(directory, nativeAuth.pluginDirectory),
				),
			};
			if (
				staged.pluginDirectory !==
				resolve(await realpath(directory), nativeAuth.pluginDirectory)
			)
				throw new Error("Native auth client path changed.");
			await verifyNativeAuthClient(staged);
			const sourceFiles = Object.fromEntries(
				await Promise.all(
					CANARY_NATIVE_AUTH_FILES.map(async (name) => [
						name,
						await readFile(join(staged.pluginDirectory, name), "utf8"),
					]),
				),
			);
			measuredAuth = NativeAuthInstallationSchema.parse({
				...nativeAuth,
				sourceFiles,
			});
		}
		return {
			schemaVersion: 2,
			preparedSha256: prepared.sha256,
			artifactSha256: prepared.artifactSha256,
			tarballSha256: prepared.artifact.tarballSha256,
			pluginEntrySha256: prepared.pluginEntrySha256,
			installedPluginSha256,
			...measured,
			...(measuredAuth ? { nativeAuth: measuredAuth } : {}),
		};
	}

	return {
		schemaVersion: 1,
		preparedSha256: prepared.sha256,
		artifactSha256: prepared.artifactSha256,
		tarballSha256: prepared.artifact.tarballSha256,
		pluginEntrySha256: prepared.pluginEntrySha256,
		installedPluginSha256,
	};
}

async function writeEvidence(input: {
	readonly repositoryRoot: string;
	readonly version: string;
	readonly kind: "installation" | "session" | "transcript";
	readonly value: unknown | null;
}): Promise<z.infer<typeof EvidenceRefSchema> | null> {
	if (input.value === null) return null;
	const bytes = Buffer.from(canonicalJson(input.value));
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
	readonly preparedDirectory: string;
	readonly operator: string;
	readonly session: unknown | null;
	readonly transcript: unknown | null;
	readonly recordedAt?: Date;
	readonly launchReceipt?: unknown;
}): Promise<{ readonly path: string; readonly record: CanaryRecord }> {
	const prepared = parsePreparedCanary(input.prepared);
	const recordedAt = input.recordedAt ?? new Date();
	const installationValue = await measureCanaryInstallation(
		prepared,
		input.preparedDirectory,
	);
	if (
		input.session !== null &&
		!SessionSchema.safeParse(input.session).success
	) {
		throw new Error(
			"Canary session evidence is not a valid Session v5 document.",
		);
	}
	const fixturePath = resolve(input.preparedDirectory, "fixture");
	const canonicalFixturePath =
		prepared.schemaVersion === 2 ? await realpath(fixturePath) : fixturePath;
	const redact = (value: unknown) =>
		value === null
			? null
			: redactEvidence(
					redactEvidence(value, fixturePath),
					canonicalFixturePath,
				);
	let redactedSession = redact(input.session);
	if (prepared.schemaVersion === 2 && redactedSession !== null) {
		const sanitized = parseSessionRepairingClosureDigest(redactedSession);
		if (!sanitized.ok)
			throw new Error("Redacted canary session violates Session v5.");
		redactedSession = sanitized.value;
	}
	const redactedTranscript = redact(input.transcript);
	if (installationValue.schemaVersion === 2 && installationValue.nativeAuth) {
		if (
			!canaryAuthLaunchMatches({
				preparedSha256: prepared.sha256,
				nativeAuth: installationValue.nativeAuth,
				receipt: input.launchReceipt,
				transcript: input.transcript,
			})
		)
			throw new Error(
				"Native auth canary requires a matching public launch receipt.",
			);
		const receipt = CanaryAuthLaunchReceiptSchema.parse(
			redact(input.launchReceipt),
		);
		installationValue.nativeAuth.launchReceipt = {
			...receipt,
			native: {
				...receipt.native,
				sha256: sha256(Buffer.from(canonicalJson(redactedTranscript))),
			},
		};
	} else if (input.launchReceipt !== undefined)
		throw new Error(
			"Native auth launch receipt supplied without a prepared attachment.",
		);
	const derived = deriveCanaryResult({
		packageVersion: prepared.artifact.packageVersion,
		artifactSha256: prepared.artifactSha256,
		tarballSha256: prepared.artifact.tarballSha256,
		preparedSha256: prepared.sha256,
		pluginEntrySha256: prepared.pluginEntrySha256,
		installation: installationValue,
		session: redactedSession,
		transcript: redactedTranscript,
	});
	const session = await writeEvidence({
		repositoryRoot: input.repositoryRoot,
		version: prepared.artifact.packageVersion,
		kind: "session",
		value: redactedSession,
	});
	const installation = await writeEvidence({
		repositoryRoot: input.repositoryRoot,
		version: prepared.artifact.packageVersion,
		kind: "installation",
		value: installationValue,
	});
	if (!installation)
		throw new Error("Canary installation evidence is missing.");
	const transcript = await writeEvidence({
		repositoryRoot: input.repositoryRoot,
		version: prepared.artifact.packageVersion,
		kind: "transcript",
		value: redactedTranscript,
	});
	const base: Omit<CanaryRecord, "recordSha256"> = {
		schemaVersion: 1 as const,
		derivationVersion: canaryDerivationVersion(
			prepared.artifact.packageVersion,
		),
		preparedSha256: prepared.sha256,
		pluginEntrySha256: prepared.pluginEntrySha256,
		status: derived.status,
		artifact: prepared.artifact,
		artifactSha256: prepared.artifactSha256,
		releaseTag: prepared.releaseTag,
		operator: input.operator,
		recordedAt: recordedAt.toISOString(),
		expiresAt: new Date(recordedAt.getTime() + CANARY_MAX_AGE_MS).toISOString(),
		checklistVersion: CANARY_CHECKLIST_VERSION,
		checklistSha256: CANARY_CHECKLIST_SHA256,
		checks: derived.checks,
		hostConfigSha256: derived.hostConfigSha256,
		actors: [...derived.actors],
		artifacts: { installation, session, transcript },
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

async function evidenceValue(
	directory: string,
	ref: z.infer<typeof EvidenceRefSchema> | null,
): Promise<{ readonly issue: string | null; readonly value: unknown | null }> {
	if (!ref)
		return { issue: "Canary evidence artifact is missing.", value: null };
	try {
		const retained = await readWorkspaceTestReport(directory, ref.path);
		if (!retained)
			return {
				issue: "Canary evidence artifact is unreadable or unstable.",
				value: null,
			};
		const bytes = Buffer.from(retained.text);
		const issue =
			bytes.byteLength === ref.bytes && sha256(bytes) === ref.sha256
				? null
				: "Canary evidence digest or size does not match.";
		return {
			issue,
			value: issue ? null : JSON.parse(bytes.toString("utf8")),
		};
	} catch {
		return { issue: "Canary evidence artifact is unreadable.", value: null };
	}
}

/**
 * Whether a canary must still be inside its validity window.
 *
 * `required` is the rule for the release being published. A canary measures a
 * host and a model that both move underneath it, so a candidate may not lean on
 * one that has gone cold.
 *
 * `retained` is for evidence a later release only cites: the baseline seal a
 * reviewed offline exception measures against and explicitly does not claim as
 * its own measurement. That citation is a statement about the past, so it does
 * not rot, and the record making it already says in its own notes that nothing
 * after the baseline has been measured live. Under the wall-clock rule the same
 * retained evidence stopped verifying seventy-two hours after it was recorded,
 * which made every published offline release unreproducible: re-running its
 * release workflow refused evidence that had not changed.
 */
export type CanaryFreshness = "required" | "retained";

export async function canaryRecordIssue(input: {
	readonly version: string;
	readonly record: unknown;
	readonly expectedArtifact: ArtifactIdentity;
	readonly directory: string;
	readonly now?: Date;
	readonly freshness?: CanaryFreshness;
}): Promise<string | null> {
	const parsed = parseCanaryRecord(input.record);
	if (!parsed.ok) return parsed.issues[0] ?? "Canary record is invalid.";
	const record = parsed.value;
	if (record.artifact.packageVersion !== input.version)
		return "Canary artifact version does not match the release.";
	if (!samePackedArtifact(record.artifact, input.expectedArtifact))
		return "Canary artifact does not match the rebuilt artifact.";
	if (record.status !== "passed") return `Canary status is ${record.status}.`;
	const manager = record.actors.find((actor) => actor.role === "manager");
	if (targetsOpenCodeV2(input.version) && !manager)
		return "Canary is missing its manager identity.";
	const pinned = releaseReviewerModel(input.version, manager?.requestedModel);
	if (pinned) {
		for (const role of ["manager", "reviewer"] as const) {
			const actors = record.actors.filter((item) => item.role === role);
			if (
				!actors.length ||
				actors.some(
					(actor) =>
						canonicalJson(actor.requestedModel) !== canonicalJson(pinned) ||
						(actor.actualModel.kind === "observed" &&
							(actor.actualModel.value.routeProvider !== pinned.routeProvider ||
								actor.actualModel.value.model !== pinned.model)),
				)
			)
				return `Canary ${role} model does not match the pinned release route.`;
		}
	}
	const now = (input.now ?? new Date()).getTime();
	if (Date.parse(record.recordedAt) > now) return "Canary is future-dated.";
	if (
		(input.freshness ?? "required") === "required" &&
		Date.parse(record.expiresAt) <= now
	)
		return "Canary is expired.";
	const session = await evidenceValue(
		input.directory,
		record.artifacts.session,
	);
	if (session.issue) return session.issue;
	const transcript = await evidenceValue(
		input.directory,
		record.artifacts.transcript,
	);
	if (transcript.issue) return transcript.issue;
	const installation = await evidenceValue(
		input.directory,
		record.artifacts.installation,
	);
	if (installation.issue) return installation.issue;
	const derived = deriveCanaryResult({
		packageVersion: record.artifact.packageVersion,
		artifactSha256: record.artifactSha256,
		tarballSha256: record.artifact.tarballSha256,
		preparedSha256: record.preparedSha256,
		pluginEntrySha256: record.pluginEntrySha256,
		installation: installation.value,
		session: session.value,
		transcript: transcript.value,
	});
	if (
		derived.status !== record.status ||
		canonicalJson(derived.checks) !== canonicalJson(record.checks) ||
		canonicalJson(derived.actors) !== canonicalJson(record.actors) ||
		derived.hostConfigSha256 !== record.hostConfigSha256
	) {
		return "Canary derived claims do not match retained evidence.";
	}
	return null;
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
			...(args.includes("--native-auth") ? { nativeAuth: true } : {}),
		});
		process.stdout.write(
			`INCONCLUSIVE: manual canary pending\n${canonicalJson(prepared)}\n`,
		);
		return;
	}
	if (command === "record") {
		const preparedPath = required(args, "--prepared");
		const result = await recordCanary({
			repositoryRoot,
			prepared: PreparedCanarySchema.parse(await json(preparedPath)),
			preparedDirectory: dirname(resolve(preparedPath)),
			operator: required(args, "--operator"),
			session: option(args, "--session")
				? await json(required(args, "--session"))
				: null,
			transcript: option(args, "--transcript")
				? await json(required(args, "--transcript"))
				: null,
			...(option(args, "--launch-receipt")
				? { launchReceipt: await json(required(args, "--launch-receipt")) }
				: {}),
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
