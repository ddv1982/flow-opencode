import { z } from "zod";
import { VALIDATION_STATUSES } from "./constants";

const EvidencePacketValidationStatusSchema = z.enum([
	...VALIDATION_STATUSES,
	"not_run",
] as const);

const EvidencePacketValidationRunSchema = z.object({
	command: z.string().min(1),
	status: EvidencePacketValidationStatusSchema,
	summary: z.string().min(1),
});

const EvidencePacketPurposeSchema = z.enum([
	"planning",
	"review",
	"audit",
	"validation",
	"general",
]);

const FLOW_CONTEXT_PRODUCER_LANES = [
	"planning",
	"auto_planning",
	"execution",
	"review",
] as const;

const FLOW_CONTEXT_CONSUMER_LANES = [
	"status",
	"history",
	"session",
	"reset",
	"doctor",
	"control",
] as const;

const FLOW_CONTEXT_LANES = [
	...FLOW_CONTEXT_PRODUCER_LANES,
	...FLOW_CONTEXT_CONSUMER_LANES,
] as const;

const FlowContextLaneSchema = z.enum(FLOW_CONTEXT_LANES);

export const EvidencePacketSchema = z
	.object({
		id: z.string().min(1),
		purpose: EvidencePacketPurposeSchema.optional(),
		contextLane: FlowContextLaneSchema.optional(),
		summary: z.string().min(1),
		sourceRefs: z.array(z.string().min(1)).optional(),
		highlights: z.array(z.string().min(1)).optional(),
		selectedContext: z.array(z.string().min(1)).optional(),
		excludedContext: z.array(z.string().min(1)).optional(),
		codemapSummaries: z.array(z.string().min(1)).optional(),
		sliceSummaries: z.array(z.string().min(1)).optional(),
		relationshipHypotheses: z.array(z.string().min(1)).optional(),
		ambiguities: z.array(z.string().min(1)).optional(),
		knownExclusions: z.array(z.string().min(1)).optional(),
		alreadyCoveredFindings: z.array(z.string().min(1)).optional(),
		validationEvidence: z.array(EvidencePacketValidationRunSchema).optional(),
	})
	.strict()
	.readonly();

export const EvidencePacketArraySchema = z.array(EvidencePacketSchema);

export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;
