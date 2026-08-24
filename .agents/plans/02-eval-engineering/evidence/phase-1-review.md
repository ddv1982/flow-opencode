# Phase 1 Interrogate review

## Intent

Phase 1 must add a fail-closed, schema-derived v2 boundary for frozen campaign
plans, atomic attempts, completion records, and case policy. It must reject
malformed, legacy, summary-only, cross-record, budget, and paired-design drift
without changing the runner or release qualifier.

## Reviewers

- `gpt-5.6-terra` reviewed the first implementation and the final corrected diff.
- `gpt-5.6-luna` reviewed the first implementation and the final corrected diff.
- `gpt-5.5` reviewed the first implementation and the final corrected diff.
- `gpt-5.4` reviewed the first implementation and the final corrected diff.

## Acted on

- Declared attempt, token, wall-clock, cost, and unknown-cost budgets now constrain
  completion state. Wall-clock evidence has timestamp and longest-attempt lower
  bounds.
- Complete and stopped states now follow scored outcomes. Failure rows cannot
  satisfy fixed targets.
- Paired plans now require complete scored pairs and atomic reserve activation.
  Non-paired plans cannot use the paired replacement policy.
- Paired hidden evidence and reviewer fixed-label evidence now agree with their
  top-level scored outcome.
- Validated reports and catalogs are deeply readonly and recursively frozen.
- Canonical JSON rejects malformed Unicode, sparse arrays, and non-JSON objects.
  Catalog identifiers use the same Unicode scalar boundary.
- Canonicalization, immutable validation, and paired-plan rules moved into small
  reusable modules. No changed TypeScript file exceeds 1,000 lines.

## Deferred by phase boundary

- Catalog sample floors belong to Phase 2 decision analysis. A structurally valid
  under-sampled report must remain analyzable as `INCONCLUSIVE`.
- Expected artifact, evaluator, host, and actor comparison belongs to Phase 3.
  Paired campaigns intentionally contain different candidate and baseline
  artifacts, so one report-wide artifact equality rule would be wrong.

## Dismissed

- Opaque arm tokens are treatment keys and are intentionally reused across
  blocks. They must differ within a block, not across the full plan.
- A budget stop may occur below an observed ceiling when the next atomic attempt
  cannot safely start. Exact budget exhaustion is not a valid completion
  invariant.
- An unsubmitted reviewer result is valid failed evidence, not malformed data.
  The explicit nullable verdict and submitted flag preserve it for Phase 2
  qualification.
- Global collection limits do not protect the JSON parse allocation and would
  introduce arbitrary campaign caps. Frozen plan budgets constrain executable
  work instead.

## Verdict

`VERIFIED`. The final four-model recheck found no unresolved blocker after lead
judgment. Focused tests pass with 19 cases. The full repository gate passes with
430 tests, one intentional live-host skip, and zero failures.
