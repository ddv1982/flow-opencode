import { canonicalSha256 } from "./canonical-json.js";
import type { CampaignPlan } from "./report.js";

export const PAIRED_BOOTSTRAP_SAMPLES = 2_000;
export const PAIRED_ANALYSIS_VERSION_SHA256 = canonicalSha256(
	"flow-paired-analysis-implementation-v1",
	{
		bootstrapSamples: PAIRED_BOOTSTRAP_SAMPLES,
		estimand: "equal-task-weighted-hidden-correctness-difference",
		interval: "task-stratified-paired-bootstrap",
		powerBound: "2*ln(2/(alpha*(1-power)))/mde^2",
	},
);

export function requiredPairedPowerPairs(
	policy: Extract<CampaignPlan["analysis"], { kind: "paired" }>,
): number {
	return Math.ceil(
		(2 * Math.log(2 / (policy.alpha * (1 - policy.targetPower)))) /
			(policy.minimumDetectableEffect * policy.minimumDetectableEffect),
	);
}
