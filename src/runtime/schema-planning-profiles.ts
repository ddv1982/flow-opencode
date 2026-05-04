import { z } from "zod";
import { DECISION_DOMAINS, DECISION_MODES } from "./constants";

export const EvidenceConfidenceSchema = z.enum(["low", "medium", "high"]);

export const StackProfileEntrySchema = z
	.object({
		name: z.string().min(1),
		evidenceRefs: z.array(z.string().min(1)).default([]),
		confidence: EvidenceConfidenceSchema.default("medium"),
	})
	.strict();

export const StackProfileSchema = z
	.object({
		languages: z.array(StackProfileEntrySchema).default([]),
		frameworks: z.array(StackProfileEntrySchema).default([]),
		runtimes: z.array(StackProfileEntrySchema).default([]),
		packageManagers: z.array(StackProfileEntrySchema).default([]),
		tools: z.array(StackProfileEntrySchema).default([]),
	})
	.strict();

export const StandardsSourceSchema = z
	.object({
		title: z.string().min(1),
		sourceType: z.enum(["local", "official", "external"]),
		reference: z.string().min(1),
		confidence: EvidenceConfidenceSchema.default("medium"),
	})
	.strict();

export const StandardsRuleSchema = z
	.object({
		summary: z.string().min(1),
		sourceRefs: z.array(z.string().min(1)).default([]),
		priority: z.enum(["user", "local", "official", "external"]),
	})
	.strict();

export const StandardsGapSchema = z
	.object({
		stackItem: z.string().min(1),
		reason: z.string().min(1),
		suggestedResearch: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const StandardsProfileSchema = z
	.object({
		localGuidelines: z.array(StandardsSourceSchema).default([]),
		externalGuidance: z.array(StandardsSourceSchema).default([]),
		rules: z.array(StandardsRuleSchema).default([]),
		gaps: z.array(StandardsGapSchema).default([]),
		precedence: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const ImplementationApproachSchema = z.object({
	chosenDirection: z.string().min(1),
	keyConstraints: z.array(z.string().min(1)).default([]),
	validationSignals: z.array(z.string().min(1)).default([]),
	sources: z.array(z.string().min(1)).default([]),
});

export const PlanningDecisionOptionSchema = z.object({
	label: z.string().min(1),
	tradeoffs: z.array(z.string().min(1)).default([]),
});

export const PlanningDecisionSchema = z.object({
	question: z.string().min(1),
	decisionMode: z.enum(DECISION_MODES).default("recommend_confirm"),
	decisionDomain: z.enum(DECISION_DOMAINS).default("architecture"),
	options: z.array(PlanningDecisionOptionSchema).min(1),
	recommendation: z.string().min(1),
	rationale: z.array(z.string().min(1)).default([]),
});
