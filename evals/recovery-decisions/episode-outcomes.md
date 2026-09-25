# Whole-episode comparisons

An episode comparison measures a task from its frozen starting state to its
terminal outcome. A task can contain several recovery decisions. Decision
selection, decision latency, and recovery-case counts cannot establish episode
completion, active runtime, or the number of independent episodes.

The episode protocol freezes the task roster, starting conditions, arm settings,
measurement definitions, and analysis settings. Each independence group supplies
one scheduled episode. Separate manager and Jev evidence files bind observations
to that registration. Missing observations remain in the scheduled roster.
Both arms use the same manager model and prompt. Their retained harness digests
allow operators to review differences in execution.

Failed, cancelled, and timed-out episodes remain outcomes under the frozen
completion definition. An unavailable observation means the outcome is unknown.
Unknown telemetry stays null. Human wait and active runtime are separate
measurements. A short failed run does not become a completed task.

## Paired measurements

The report compares both arms on the same episodes. It calculates interruption
reduction as one minus the ratio of Jev interruptions to manager interruptions.
Completion difference compares the fractions of episodes completed by each arm.
Active-runtime growth compares the arm medians. It does not calculate the median
of individual episode ratios.

Each metric records its paired sample count and exclusions. Available observations
can produce descriptive estimates when data is missing, but incomplete coverage
prevents an uncertainty interval. A zero manager baseline makes a relative
comparison undefined.

## Exploratory uncertainty

The bootstrap resamples whole pairs with replacement. Both arms use the same
sampled episode indexes. Every replicate recalculates the statistic. This preserves
the pairing described in the [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html).

The protocol freezes the random seed and resampling settings. Reports identify
the percentile method and its limitations. An undefined replicate cannot be
dropped to produce a narrower interval. Insufficient or degenerate samples cannot
establish improvement.

These intervals are exploratory. Reproducibility does not prove statistical
coverage, representative sampling, or independence. Live qualification still
requires review of the experiment and the plan's other gates.

## Evidence limits

Digests bind the supplied protocol and evidence. Imported origins, reviewer
identities, and registration timestamps are attestations. They do not authenticate
execution or establish that registration preceded collection. Safety measurements
need separate review evidence. Decision acceptability labels cannot establish
whether an action was unsafe.
Each protocol contains one split. Cross-protocol task separation requires review
of the retained calibration and holdout rosters.

Every report remains qualification-inconclusive. The plan requires at least 100
distinct paired live episodes and separate evidence for each promoted action
class. The episode count cannot replace the 300 accepted holdout cases per class.
The reporting commands make no paid calls and grant no spending authority.
