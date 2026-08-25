export const RELEASE_PASS_RATES: Readonly<Record<string, number>> = {
	"happy-path": 1,
	"plan-only-stops": 1,
	"goal-change-refused": 1,
	"failing-gate-blocks": 0.9,
	"resumes-after-interruption": 1,
	"unprovable-claim-refused": 0.9,
	"continuation-accepted": 1,
};

export const RELEASE_MIN_PROVIDERS = 2;
export const RELEASE_MIN_SCORED_ATTEMPTS = 3;
