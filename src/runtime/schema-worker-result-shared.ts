import { z } from "zod";
import {
	FEATURE_ID_MESSAGE,
	FEATURE_ID_PATTERN,
	OUTCOME_KINDS,
	REPLAN_REASONS,
	VALIDATION_STATUSES,
	VERIFICATION_STATUSES,
} from "./constants";
import { FollowUpSchema } from "./schema-review-shared";

export const ValidationStatusSchema = z.enum(VALIDATION_STATUSES);
export const OutcomeKindSchema = z.enum(OUTCOME_KINDS);

export const ArtifactSchema = z.object({
	path: z.string().min(1),
	kind: z.string().min(1).optional(),
});

export const ValidationRunSchema = z.object({
	command: z.string().min(1),
	status: ValidationStatusSchema,
	summary: z.string().min(1),
});

export const DecisionSchema = z.object({
	summary: z.string().min(1),
});

export const NoteSchema = z.object({
	note: z.string().min(1),
});

export const OutcomeSchema = z.object({
	kind: OutcomeKindSchema,
	category: z.string().min(1).optional(),
	summary: z.string().min(1).optional(),
	resolutionHint: z.string().min(1).optional(),
	retryable: z.boolean().optional(),
	autoResolvable: z.boolean().optional(),
	needsHuman: z.boolean().optional(),
	replanReason: z.enum(REPLAN_REASONS).optional(),
	failedAssumption: z.string().min(1).optional(),
	recommendedAdjustment: z.string().min(1).optional(),
});

export const FeatureResultSchema = z.object({
	featureId: z.string().regex(FEATURE_ID_PATTERN, FEATURE_ID_MESSAGE),
	verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
	notes: z.array(NoteSchema).optional(),
	followUps: z.array(FollowUpSchema).optional(),
});
