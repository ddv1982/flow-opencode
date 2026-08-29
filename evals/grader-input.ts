import { z } from "zod";
import { canonicalSha256 } from "./canonical-json.js";
import { mapStrings } from "./cassette.js";
import type { ObservedToolCall, Outcome } from "./harness.js";

const TextSchema = z
	.string()
	.min(1)
	.max(4 * 1024 * 1024)
	.regex(/\S/);
const JsonRecordSchema = z.record(z.string(), z.unknown());
const ProviderErrorEnvelopeSchema = z
	.object({
		sessionId: TextSchema,
		name: TextSchema,
		message: TextSchema,
	})
	.strict();
const ToolCallSchema: z.ZodType<ObservedToolCall> = z
	.object({
		tool: TextSchema,
		status: z.enum(["pending", "running", "completed", "error"]),
		sessionIndex: z.number().int().safe().nonnegative(),
		agent: TextSchema,
		input: JsonRecordSchema,
		output: z.unknown(),
		rawOutput: z.string().max(4 * 1024 * 1024),
		metadata: JsonRecordSchema,
	})
	.strict();

export const ScenarioGradeInputSchema = z
	.object({
		schemaVersion: z.literal(1),
		flowCalls: z.array(ToolCallSchema).max(4096),
		allCalls: z.array(ToolCallSchema).max(4096),
		session: JsonRecordSchema.nullable(),
		archives: z.array(JsonRecordSchema).max(512),
		finalText: z.string().max(4 * 1024 * 1024),
		providerErrors: z.array(ProviderErrorEnvelopeSchema).max(64).default([]),
	})
	.strict();

const ObservedModelSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("observed"),
			value: z.object({ providerID: TextSchema, modelID: TextSchema }).strict(),
		})
		.strict(),
	z.object({ kind: z.literal("unobserved"), reason: TextSchema }).strict(),
]);
const RequestedModelSchema = z
	.object({
		routeProvider: TextSchema,
		gateway: TextSchema.nullable(),
		family: TextSchema,
		model: TextSchema,
		revision: TextSchema.nullable(),
	})
	.strict();
const RetainedActorSchema = z
	.object({
		role: z.enum(["manager", "reviewer"]),
		sessionIds: z.array(TextSchema).min(1),
		actualModel: ObservedModelSchema,
		requestedModelId: TextSchema,
		requestedModel: RequestedModelSchema,
	})
	.strict();
const GuidanceLoadSchema = z
	.object({
		sequence: z.number().int().safe().nonnegative(),
		sessionIndex: z.number().int().safe().nonnegative(),
		agent: TextSchema,
		id: TextSchema.nullable(),
		rawOutput: z.string().max(4 * 1024 * 1024),
		utf8Bytes: z.number().int().safe().nonnegative(),
	})
	.strict();
const RetainedFailureSchema = z
	.object({
		origin: z.enum(["host", "provider", "evaluator"]),
		code: TextSchema,
		retryable: z.boolean(),
	})
	.strict();
const FailureObservationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("host-phase"),
			code: z.enum([
				"host-start-failed",
				"session-create-failed",
				"command-aborted",
			]),
			pendingTools: z.array(TextSchema).max(4096),
		})
		.strict(),
	z
		.object({
			kind: z.literal("provider-error"),
			...ProviderErrorEnvelopeSchema.shape,
		})
		.strict(),
]);

export const RetainedScenarioEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		attempt: z
			.object({
				attemptId: TextSchema,
				cellId: TextSchema,
				caseId: TextSchema,
				repetition: z.number().int().safe().nonnegative(),
				model: RequestedModelSchema,
			})
			.strict(),
		actors: z.array(RetainedActorSchema).max(64),
		guidanceLoads: z.array(GuidanceLoadSchema).max(4096),
		gradeInput: ScenarioGradeInputSchema,
		usage: z
			.object({
				durationMs: z.number().int().safe().nonnegative(),
				outputTokens: z.number().int().safe().nonnegative(),
				costUsd: z.number().finite().nonnegative().nullable(),
			})
			.strict(),
		failure: RetainedFailureSchema.nullable().optional(),
		failureObservation: FailureObservationSchema.nullable().optional(),
	})
	.strict();

export type ScenarioGradeInput = Pick<
	Outcome,
	"flowCalls" | "allCalls" | "session" | "archives" | "finalText"
>;
export type RetainedScenarioGradeInput = z.infer<
	typeof ScenarioGradeInputSchema
>;
export type RetainedScenarioEvidence = z.infer<
	typeof RetainedScenarioEvidenceSchema
>;

export function retainedFailureEvidence(input: {
	readonly attempt: RetainedScenarioEvidence["attempt"];
	readonly durationMs: number;
	readonly outputTokens?: number;
	readonly costUsd?: number | null;
	readonly actors?: RetainedScenarioEvidence["actors"];
	readonly guidanceLoads?: RetainedScenarioEvidence["guidanceLoads"];
	readonly gradeInput?: RetainedScenarioEvidence["gradeInput"];
	readonly failure?: NonNullable<RetainedScenarioEvidence["failure"]>;
	readonly failureObservation?: NonNullable<
		RetainedScenarioEvidence["failureObservation"]
	>;
}): RetainedScenarioEvidence {
	const emptyGradeInput: RetainedScenarioEvidence["gradeInput"] = {
		schemaVersion: 1,
		flowCalls: [],
		allCalls: [],
		session: null,
		archives: [],
		finalText: "",
		providerErrors: [],
	};
	const usage = {
		durationMs:
			Number.isSafeInteger(input.durationMs) && input.durationMs >= 0
				? input.durationMs
				: 0,
		outputTokens:
			Number.isSafeInteger(input.outputTokens) &&
			(input.outputTokens ?? -1) >= 0
				? (input.outputTokens ?? 0)
				: 0,
		costUsd:
			input.costUsd === null ||
			(typeof input.costUsd === "number" &&
				Number.isFinite(input.costUsd) &&
				input.costUsd >= 0)
				? input.costUsd
				: null,
	};
	const common = {
		schemaVersion: 1,
		attempt: input.attempt,
		usage,
		failure: input.failure ?? null,
		failureObservation: input.failureObservation ?? null,
	};
	const retained = RetainedScenarioEvidenceSchema.safeParse({
		...common,
		actors: input.actors ?? [],
		guidanceLoads: input.guidanceLoads ?? [],
		gradeInput: input.gradeInput ?? emptyGradeInput,
	});
	if (retained.success) return retained.data;
	return RetainedScenarioEvidenceSchema.parse({
		...common,
		actors: [],
		guidanceLoads: [],
		gradeInput: emptyGradeInput,
	});
}

export function retainedPendingTools(
	gradeInput: RetainedScenarioGradeInput,
): string[] {
	return gradeInput.allCalls
		.filter(
			(call) =>
				call.status === "pending" ||
				call.status === "running" ||
				(call.status === "error" && call.metadata.interrupted === true),
		)
		.map((call) => call.tool)
		.sort();
}

export function isRetainableEnvironmentFailure(failure: {
	readonly origin: "host" | "provider" | "evaluator";
	readonly code: string;
	readonly retryable: boolean;
}): boolean {
	if (!failure.retryable) return false;
	if (failure.origin === "provider")
		return failure.code === "provider-rejected-turn";
	return (
		failure.origin === "host" &&
		(failure.code === "host-start-failed" ||
			failure.code === "session-create-failed" ||
			failure.code === "command-aborted")
	);
}

export function retainedFailureObservation(input: {
	readonly origin: "host" | "provider" | "evaluator";
	readonly code: string;
	readonly retryable: boolean;
	readonly detail: string;
	readonly gradeInput: RetainedScenarioGradeInput;
	readonly providerErrorObservation?: {
		readonly sessionId: string;
		readonly name: string;
		readonly message: string;
	} | null;
}): RetainedScenarioEvidence["failureObservation"] {
	if (!isRetainableEnvironmentFailure(input)) return null;
	if (input.origin === "provider") {
		return input.providerErrorObservation
			? { kind: "provider-error", ...input.providerErrorObservation }
			: null;
	}
	if (
		input.origin !== "host" ||
		(input.code !== "host-start-failed" &&
			input.code !== "session-create-failed" &&
			input.code !== "command-aborted")
	)
		return null;
	return {
		kind: "host-phase",
		code: input.code,
		pendingTools: retainedPendingTools(input.gradeInput),
	};
}

export function deriveRetainedFailure(
	evidence: RetainedScenarioEvidence,
): RetainedScenarioEvidence["failure"] {
	const observation = evidence.failureObservation;
	if (!observation) return null;
	if (observation.kind === "provider-error") {
		if (
			!evidence.gradeInput.providerErrors.some(
				(error) =>
					canonicalSha256("flow-provider-error-v1", error) ===
					canonicalSha256("flow-provider-error-v1", {
						sessionId: observation.sessionId,
						name: observation.name,
						message: observation.message,
					}),
			) ||
			!evidence.actors.some((actor) =>
				actor.sessionIds.includes(observation.sessionId),
			)
		)
			return null;
		return {
			origin: "provider",
			code: "provider-rejected-turn",
			retryable: true,
		};
	}
	const pendingTools = retainedPendingTools(evidence.gradeInput);
	if (observation.code === "command-aborted") {
		if (
			evidence.gradeInput.providerErrors.length !== 0 ||
			pendingTools.length === 0 ||
			canonicalSha256("flow-pending-tools-v1", pendingTools) !==
				canonicalSha256("flow-pending-tools-v1", observation.pendingTools)
		)
			return null;
	} else if (
		evidence.gradeInput.flowCalls.length !== 0 ||
		evidence.gradeInput.allCalls.length !== 0 ||
		evidence.gradeInput.session !== null ||
		evidence.gradeInput.archives.length !== 0 ||
		evidence.gradeInput.providerErrors.length !== 0 ||
		evidence.actors.length !== 0 ||
		evidence.guidanceLoads.length !== 0 ||
		evidence.gradeInput.finalText !== ""
	) {
		return null;
	}
	return {
		origin: "host",
		code: observation.code,
		retryable: true,
	};
}

export function pseudonymousEvalId(id: string): string {
	return `id_${canonicalSha256("flow-eval-redacted-id-v1", id).slice("sha256:".length, "sha256:".length + 16)}`;
}

export function pseudonymizeEvalIds<T>(value: T): T {
	return mapStrings(value, (text) =>
		text.replace(
			/\b(?:ses_[A-Za-z0-9]+|(?:session|review):[A-Za-z0-9-]+)\b/g,
			pseudonymousEvalId,
		),
	) as T;
}

export function actorsWithSessions<
	Actor extends { readonly sessionIds: readonly string[] },
>(actors: readonly Actor[]): Actor[] {
	return actors.filter((actor) => actor.sessionIds.length > 0);
}

export function scenarioGradeInput(
	outcome: Outcome,
): RetainedScenarioGradeInput {
	return ScenarioGradeInputSchema.parse({
		schemaVersion: 1,
		flowCalls: outcome.flowCalls,
		allCalls: outcome.allCalls,
		session: outcome.session,
		archives: outcome.archives,
		finalText: outcome.finalText,
		providerErrors: outcome.providerErrorObservation
			? [outcome.providerErrorObservation]
			: [],
	});
}
