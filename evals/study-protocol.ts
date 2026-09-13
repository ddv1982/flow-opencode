import { z } from "zod";
import { canonicalJson, canonicalSha256 } from "./canonical-json.js";
import {
	ArtifactIdentitySchema,
	ModelIdentitySchema,
	ReportDigestSchema,
	ReportTextSchema,
} from "./report-identities.js";
import { STUDY_STATISTICS_VERSION_SHA256 } from "./study-statistics.js";

const Count = z.number().int().safe().nonnegative();
const Positive = Count.positive();
const Usd = z.number().finite().nonnegative().nullable();

export const StudyArmSchema = z
	.object({
		artifact: z.union([
			ArtifactIdentitySchema,
			z.object({ kind: z.literal("ordinary-opencode") }).strict(),
		]),
		manager: ModelIdentitySchema,
		reviewer: z
			.object({
				model: ModelIdentitySchema.nullable(),
				steps: z.number().int().min(1).max(1000).nullable(),
			})
			.strict()
			.nullable(),
	})
	.strict()
	.refine((arm) => !("kind" in arm.artifact) || arm.reviewer === null, {
		message: "Ordinary OpenCode cannot declare a Flow reviewer.",
		path: ["reviewer"],
	});

export const StudyBudgetSchema = z
	.object({
		maxUsd: Usd,
		unknownCostPolicy: z.enum(["stop", "token-wall-clock-bounds"]),
		maxOutputTokens: Count,
		maxWallClockMs: Positive,
		maxAttempts: Positive,
	})
	.strict();

const PreflightSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("none") }).strict(),
	z
		.object({
			kind: z.literal("entitlement"),
			maxRequests: Positive,
			maxGeneratedOutputTokens: Positive,
			maxWallClockMs: Positive,
			maxUsd: Usd,
			unknownCostPolicy: z.enum(["stop", "token-wall-clock-bounds"]),
		})
		.strict(),
]);

export const STUDY_PROTOCOL_VERSION_SHA256 = canonicalSha256(
	"flow-paired-study-protocol-v1",
	{
		artifact: "exact-arm-artifact-and-requested-profile",
		accounting: "host-categories-v1-generated-output-plus-reasoning",
		budgets: "observed-stop-thresholds-not-invoice-caps",
		preflight: "separate-explicit-allowance",
		cancellation: "operator-cause-retains-budget-observations",
		statistics: STUDY_STATISTICS_VERSION_SHA256,
	},
);

export const PairedStudyPolicySchema = z
	.object({
		kind: z.literal("paired-study"),
		schemaVersion: z.literal(1),
		purpose: z.enum(["smoke", "exploratory", "confirmatory"]),
		comparison: z.enum([
			"artifact",
			"manager",
			"reviewer-workflow-effect",
			"total-effect",
		]),
		method: z.enum([
			"descriptive",
			"equal-task-cluster-bootstrap-v1",
			"legacy-fixed-task-bounded-pair-v1",
		]),
		opencodeVersion: ReportTextSchema,
		arms: z
			.object({ baseline: StudyArmSchema, candidate: StudyArmSchema })
			.strict(),
		bootstrapSeed: ReportTextSchema,
		alpha: z.literal(0.05),
		targetPower: z.number().finite().gt(0).lt(1).optional(),
		minimumDetectableEffect: z.number().finite().gt(0).lte(1).optional(),
		accounting: z
			.object({
				schemaVersion: z.literal(1),
				hostContract: z.literal("opencode-1.18.6-disjoint-output-v1"),
				maxGeneratedOutputTokens: Positive,
				estimate: z
					.object({
						generatedOutputTokensPerAttempt: Positive,
						wallClockMsPerAttempt: Positive,
						costUsdPerAttempt: Usd,
						basis: ReportTextSchema,
					})
					.strict(),
				preflight: PreflightSchema,
			})
			.strict(),
		versionSha256: ReportDigestSchema,
	})
	.strict()
	.superRefine((policy, context) => {
		const { baseline, candidate } = policy.arms;
		const equal = (left: unknown, right: unknown) =>
			canonicalJson(left) === canonicalJson(right);
		const comparable =
			policy.comparison === "total-effect" ||
			(policy.comparison === "artifact" &&
				equal(baseline.manager, candidate.manager) &&
				equal(baseline.reviewer, candidate.reviewer)) ||
			(policy.comparison === "manager" &&
				equal(baseline.artifact, candidate.artifact) &&
				equal(studyReviewerModel(baseline), studyReviewerModel(candidate)) &&
				baseline.reviewer?.steps === candidate.reviewer?.steps) ||
			(policy.comparison === "reviewer-workflow-effect" &&
				equal(baseline.artifact, candidate.artifact) &&
				equal(baseline.manager, candidate.manager));
		if (!comparable)
			context.addIssue({
				code: "custom",
				path: ["comparison"],
				message:
					"Arm differences exceed the declared comparison; pin other settings or declare total-effect.",
			});
		if (policy.opencodeVersion !== "1.18.6") {
			context.addIssue({
				code: "custom",
				path: ["opencodeVersion"],
				message: "Versioned accounting is verified only for OpenCode 1.18.6.",
			});
		}
		const methods = {
			smoke: "descriptive",
			exploratory: "equal-task-cluster-bootstrap-v1",
			confirmatory: "legacy-fixed-task-bounded-pair-v1",
		};
		if (policy.method !== methods[policy.purpose]) {
			context.addIssue({
				code: "custom",
				message: "Study purpose and method disagree.",
			});
		}
		const powered =
			policy.targetPower !== undefined &&
			policy.minimumDetectableEffect !== undefined;
		if (
			(policy.purpose === "confirmatory") !== powered ||
			(policy.purpose !== "confirmatory" &&
				(policy.targetPower !== undefined ||
					policy.minimumDetectableEffect !== undefined))
		) {
			context.addIssue({
				code: "custom",
				message:
					"Only fixed-task confirmatory studies declare power parameters.",
			});
		}
		if (policy.versionSha256 !== STUDY_PROTOCOL_VERSION_SHA256) {
			context.addIssue({
				code: "custom",
				message: "Unsupported paired-study protocol version.",
			});
		}
	});

export type StudyArm = z.infer<typeof StudyArmSchema>;
export type PairedStudyPolicy = z.infer<typeof PairedStudyPolicySchema>;

export function studyReviewerModel(
	arm: StudyArm,
): z.infer<typeof ModelIdentitySchema> | null {
	if ("kind" in arm.artifact) return null;
	if (arm.reviewer?.model) return arm.reviewer.model;
	const { variant: _variant, ...model } = arm.manager;
	return model;
}

export function studyHostConfig(policy: PairedStudyPolicy, arm: StudyArm) {
	return {
		opencodeVersion: policy.opencodeVersion,
		manager: arm.manager,
		artifact: arm.artifact,
		reviewer: arm.reviewer,
		reviewerEnvironment: "disabled",
		nativeLlm: false,
		ambientConfig: "disabled",
		syntheticGit: "isolated-project-identity-no-hooks-or-signing",
	};
}

export function studyHostConfigSha256(
	policy: PairedStudyPolicy,
	arm: StudyArm,
): string {
	return canonicalSha256(
		"flow-eval-host-config-v1",
		studyHostConfig(policy, arm),
	);
}

export function studyArmMatches(
	policy: PairedStudyPolicy,
	arm: StudyArm,
	attempt: {
		artifact: unknown;
		hostConfigSha256: string;
		actors: readonly { role: string; requestedModel: unknown }[];
	},
): boolean {
	return (
		canonicalJson(attempt.artifact) === canonicalJson(arm.artifact) &&
		attempt.hostConfigSha256 === studyHostConfigSha256(policy, arm) &&
		attempt.actors.every(
			(actor) =>
				canonicalJson(actor.requestedModel) ===
				canonicalJson(
					actor.role === "manager" ? arm.manager : studyReviewerModel(arm),
				),
		)
	);
}

export function studyObservedProfileIssues(
	arm: StudyArm,
	actors: readonly {
		role: string;
		hostObservation?:
			| {
					model: {
						kind: string;
						value?: { providerID: string; modelID: string };
					};
					variant: { kind: string; value?: string };
			  }
			| undefined;
	}[],
): string[] {
	return actors.flatMap((actor) => {
		const expected =
			actor.role === "manager" ? arm.manager : studyReviewerModel(arm);
		const actual = actor.hostObservation;
		if (!expected)
			return [`Unexpected ${actor.role} in an ordinary OpenCode arm.`];
		const model =
			actual?.model.kind === "observed" ? actual.model.value : undefined;
		const variant =
			actual?.variant.kind === "observed" ? actual.variant.value : undefined;
		return [
			...(model &&
			(model.providerID !== expected.routeProvider ||
				model.modelID !== expected.model)
				? [`Observed ${actor.role} model differs from the declared profile.`]
				: []),
			...(expected.variant !== undefined &&
			variant !== undefined &&
			variant !== expected.variant
				? [`Observed ${actor.role} variant differs from the declared profile.`]
				: []),
		];
	});
}

export function assertStudyBudget(
	policy: PairedStudyPolicy,
	budget: z.infer<typeof StudyBudgetSchema>,
	primaryAttempts: number,
): void {
	StudyBudgetSchema.parse(budget);
	const estimate = policy.accounting.estimate;
	if (
		!Number.isSafeInteger(primaryAttempts) ||
		primaryAttempts < 1 ||
		budget.maxAttempts < primaryAttempts ||
		estimate.generatedOutputTokensPerAttempt * primaryAttempts >
			policy.accounting.maxGeneratedOutputTokens ||
		estimate.wallClockMsPerAttempt * primaryAttempts > budget.maxWallClockMs ||
		(budget.maxUsd !== null &&
			(estimate.costUsdPerAttempt === null ||
				estimate.costUsdPerAttempt * primaryAttempts > budget.maxUsd))
	) {
		throw new Error(
			"Declared estimates and limits cannot cover the fixed primary sample. Limits are observation-based stop thresholds, not invoice caps.",
		);
	}
}
