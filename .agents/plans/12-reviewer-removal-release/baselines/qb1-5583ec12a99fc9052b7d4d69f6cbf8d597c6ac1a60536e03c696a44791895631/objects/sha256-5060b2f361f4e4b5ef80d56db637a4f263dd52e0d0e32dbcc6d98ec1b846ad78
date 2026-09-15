import { z } from "zod";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };
export type BenchmarkProbe = Readonly<{
	id: string;
	module: string;
	exportName: string;
	args: readonly JsonValue[];
	preserveArgs?: true;
	expected:
		| Readonly<{ kind: "return"; value: JsonValue }>
		| Readonly<{ kind: "throw" }>;
}>;

export type DevelopmentCase = Readonly<{
	id: string;
	caseVersion: number;
	description: string;
	files: Readonly<Record<string, string>>;
	prompt: string;
	probes: readonly BenchmarkProbe[];
	knownBadMutations: readonly Readonly<{
		id: string;
		fileOverrides: Readonly<Record<string, string>>;
	}>[];
	provenance: Readonly<{
		kind: "synthetic-development" | "repository-derived";
		source: string;
	}>;
}>;

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const EvidenceRefSchema = z
	.object({
		artifact: z.string().regex(/^objects\/sha256-[a-f0-9]{64}$/),
		sha256: Digest,
		bytes: z.number().int().safe().nonnegative(),
	})
	.strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const BenchmarkCaseBindingSchema = z
	.object({
		caseId: z.string().min(1).max(256),
		caseVersion: z.number().int().safe().positive(),
		baseSha256: Digest,
		oracleSha256: Digest,
		runtimeSha256: Digest,
	})
	.strict();
export type BenchmarkCaseBinding = z.infer<typeof BenchmarkCaseBindingSchema>;

export const CompletionDeclarationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("declared"),
			complete: z.boolean(),
			evidence: z.string().max(128),
		})
		.strict(),
	z
		.object({
			kind: z.literal("unassessed"),
			reason: z.string().min(1).max(512),
		})
		.strict(),
]);
export type CompletionDeclaration = z.infer<typeof CompletionDeclarationSchema>;

export const RetainedBenchmarkInputsSchema = z
	.object({
		schemaVersion: z.literal(1),
		caseId: z.string().min(1).max(256),
		caseVersion: z.number().int().safe().positive(),
		base: EvidenceRefSchema,
		final: EvidenceRefSchema,
		oracle: EvidenceRefSchema,
		runtime: EvidenceRefSchema,
	})
	.strict();
export type RetainedBenchmarkInputs = z.infer<
	typeof RetainedBenchmarkInputsSchema
>;

export const RetainedBenchmarkEvidenceSchema = z
	.object({
		schemaVersion: z.literal(1),
		inputs: RetainedBenchmarkInputsSchema,
		receipt: EvidenceRefSchema,
		completion: CompletionDeclarationSchema,
		workflowCompleted: z.boolean(),
		containment: z.literal("credential-free-subprocess-no-os-sandbox"),
	})
	.strict();
export type RetainedBenchmarkEvidence = z.infer<
	typeof RetainedBenchmarkEvidenceSchema
>;
