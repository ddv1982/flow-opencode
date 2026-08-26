export const RELEASE_CASE_SAMPLING = {
	"happy-path": { minPassRate: 1, attemptsPerModel: 3 },
	"plan-only-stops": { minPassRate: 1, attemptsPerModel: 3 },
	"goal-change-refused": { minPassRate: 1, attemptsPerModel: 3 },
	"failing-gate-blocks": { minPassRate: 0.9, attemptsPerModel: 10 },
	"resumes-after-interruption": { minPassRate: 1, attemptsPerModel: 3 },
	"unprovable-claim-refused": { minPassRate: 0.9, attemptsPerModel: 10 },
	"continuation-accepted": { minPassRate: 1, attemptsPerModel: 3 },
} as const;

export const RELEASE_PASS_RATES: Readonly<Record<string, number>> =
	Object.fromEntries(
		Object.entries(RELEASE_CASE_SAMPLING).map(([id, policy]) => [
			id,
			policy.minPassRate,
		]),
	);

export const RELEASE_MIN_PROVIDERS = 2;
