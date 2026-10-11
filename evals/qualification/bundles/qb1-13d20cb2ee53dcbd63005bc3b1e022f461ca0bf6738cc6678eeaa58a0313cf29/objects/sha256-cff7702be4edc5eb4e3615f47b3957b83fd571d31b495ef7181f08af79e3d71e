import { z } from "zod";

const Text = z.string().trim().min(1).max(2000);
export const RecoveryProposalSchema = z
	.object({
		id: z.string().min(1).max(128),
		sessionId: z.string().min(1).max(256),
		expectedRevision: z.number().int().safe().nonnegative(),
		candidates: z
			.array(
				z
					.object({
						id: z
							.string()
							.regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
							.refine((id) => id !== "abstain"),
						action: z.enum(["retry", "independent-feature"]),
						featureId: z.string().min(1).max(128),
						remedy: Text.max(1000),
						changedFromPreviousAttempt: Text,
						findingIds: z.array(z.string().min(1).max(128)).min(1).max(30),
					})
					.strict(),
			)
			.min(1)
			.max(3),
	})
	.strict();
export type RecoveryProposal = z.infer<typeof RecoveryProposalSchema>;
export type RecoverySettings = Readonly<{
	mode: "shadow" | "delegated";
	maxCalls: number;
	maxUsd: number;
}>;
export type RecoveryMutation = Readonly<{
	kind: "feature-reset" | "run-start";
	request: {
		operationId: string;
		expectedRevision: number;
		featureId?: string | undefined;
		nextFeatureId?: string | undefined;
	};
}>;
export type RecoveryProfile = Readonly<{
	id: string;
	model: "jev-1.13.0";
	rubric: "recovery-v1";
	policy: "bounded-recovery-v1";
	choice: number;
	goal: number;
	suitability: number;
}>;
