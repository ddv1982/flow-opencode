# Phase 8 Interrogate review and trend proof

Phase 8 adds structured evidence cards and a canonical compatibility key for
longitudinal comparisons. Cards render planned, attempted, missing, product,
failed-product, operational-failure, and unscored counts with Wilson intervals,
completion state, distinct artifacts, evaluator digests, and reviewer or paired
projections.

The compatibility key treats candidate artifact identity and evaluator source
commit as the intended treatment axis. It freezes normalized case/version/
repetition/schedule/model cells, analysis/stopping/abort/budget policy, catalog
oracle and release semantics, evaluator case/policy/grader digests, host
configuration, requested actors, and delivered instruction hashes. Reports must
be complete. Per-case and aggregate deltas are emitted only when the key matches;
a longitudinal chain breaks at the first incompatible adjacent report.

Strictly parsed fixtures prove that equal semantics with different artifact and
evaluator source commits compare. Separate mutations to case version, analysis
version, oracle, evaluator grader digest, host configuration, requested model, and
instruction digest all refuse comparison.

Benchmark coverage grows from three to five cases. The two new tasks require
coordinated changes across multiple source files. All five cases carry versioned
public/withheld contamination notes and at least two executable known-bad
mutations. The hidden graders reject all twelve mutations and pristine fixtures,
while known-good
implementations pass. Model-facing prompts contain no evaluation, arm, oracle, or
grader labels.

All benchmark cases remain report-only. No historical report is backfilled and no
new release regression threshold is claimed. The full repository gate passes 509
tests with one intentional live-smoke skip. The final four-model review found no
unresolved blocker.
