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
	});
}
