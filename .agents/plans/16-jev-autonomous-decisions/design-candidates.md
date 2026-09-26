# JEV-1 design candidates

Both candidates were produced by independent read-only agents with inherited, unverified model settings. No cross-model diversity is claimed.

## Candidate A

Expose `parseBlockerCampaign` and async `evaluateBlockers`. Use one immutable campaign with corpus, split manifest, preregistration, and manager observations. Support explicit offline, live, and simulation execution modes. Put schemas, eligibility, scoring, collection coordination, comparison, and promotion in one evaluation module. Keep CLI file handling separate. Add bounded shared transport to the current Jev evaluator.

The episode separates facts, candidate judgments, authority, and hidden labels. Advice is a candidate choice or abstention with complete distributions and independent suitability scores. An observation is a decision or unavailable result. Operational outcomes are optional and never inferred from classification.

Validate split isolation, candidate references, provenance, response shape, and frozen thresholds. Count one canonical holdout sample per originating task per action class. Simulated evidence cannot promote. Require imported manager observations to match packets and policy. Keep absent comparator data explicit.

The design hides coordination behind two entry points. It accepts a large evaluation module. Regrading imported observations is less direct because collection and assessment share an async entry point.

## Candidate B

Expose `parseCampaign`, `parseEvidence`, `evaluateCampaign`, and separate `collectJevEvidence`. Freeze a manifest with corpus and rubric identity, task split assignments, policy, model versions, thresholds, sample requirements, and budgets. Persist arm-independent observation records. The evaluator has no network access.

Use four modules for schemas, pure evaluation, Jev collection, and CLI. Support check, report, and explicit collect commands. Keep transport shared with the old alignment evaluator. Import real manager observations without implementing another provider integration.

The episode separates factual state, candidate proposals, authority, and hidden labels. Evidence distinguishes live, imported, and simulated provenance. Outcome records are optional. Parsing binds evidence to campaign, packet, episode, arm, and producer. Conflicting duplicates reject. Missing samples remain missing.

Count one designated primary holdout episode per independent task and action class. Never count variants or repeats as independent. Require fixed tested model, rubric, policy, and thresholds before promotion. Missing credentials or comparator evidence returns inconclusive. Self-declared imported provenance remains an audit limitation.

Both candidates require a fixed official endpoint, a total deadline, bounded streamed bodies, bounded retries, conservative spend reservation, no raw response logging, and no Flow mutations. Both preserve the separate goal-alignment experiment.

## Selection rubric

Score each criterion from zero to two.

- The caller can regrade retained evidence without a network call.
- Missing, simulated, duplicated, or incompatible evidence cannot promote Jev.
- Authority and labels remain separate from provider judgment.
- The implementation has a short call chain without a generic framework.
- Shared transport preserves alignment semantics and bounds requests.
- Offline work produces a useful artifact while live qualification remains explicit.

## Synthesis decision

Choose B. Parent and independent cross-judge agree. The independent rubric total was 12 for B and 11 for A. These scores compare designs, not model quality.

Graft A's unavailable outcome with distinct missing-key, missing-comparator, and transport-failure reasons. Keep optional operational outcomes separate from classification. Record capture provenance independently of import method.

Keep explicit packet allowlisting, immutable parsed records, full distributions for regrading, and per-action independent sample counts. Share only HTTP transport with the alignment experiment. Reject a provider registry and runtime changes in this phase.

The single code owner writes evaluation code and tests in the isolated worktree. Parent writes the ADR and execution evidence. Both design candidates and the judge used inherited, unverified model settings. No claim of cross-model diversity is made.
