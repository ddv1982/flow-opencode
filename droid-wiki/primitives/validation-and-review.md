# Validation and review

Active contributors: ddv1982

## Purpose

Validation and review records are the evidence that lets a feature complete. They are not advisory prose: the runtime requires specific passing payloads before `flow_feature_complete` can mark a feature done.

## Directory layout

```text
src/application/schema.ts
src/domain/transitions.ts
skills/flow-test/SKILL.md
skills/flow-review/SKILL.md
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `ValidationObservationSchema` | `src/application/schema.ts` | Caller-attested validation result accepted at assignment creation. |
| `ValidationEvidenceSchema` | `src/application/schema.ts` | Durable source- and feature-run-bound validation evidence. |
| `FeatureReviewDepthSchema` | `src/application/schema.ts` | `quick`, `standard`, or `detailed` feature-review depth. |
| `ReviewAssignmentSchema` | `src/application/schema.ts` | Runtime-owned feature or final review assignment. |
| `ReviewExecutionSchema` | `src/application/schema.ts` | Durable verdict and typed findings derived from an assignment result. |
| `ExecutionHistoryEntrySchema` | `src/application/schema.ts` | V4-native outcome record containing ledger references, not duplicate review summaries. |
| `completeAssignedFeature` | `src/domain/transitions.ts` | Gate that checks evidence and assignment results before one atomic mutation. |

## How it works

`flow_review_start.request` accepts passing validation observations, binds them to the
current source and feature run, and creates a durable assignment whose required
depth comes from the approved plan. `flow_feature_complete.request` accepts only
the small result for that assignment. A final assignment stores the exact
passing feature result as a bound prerequisite. A broad final outcome submits
only the final-assignment result; the runtime records it atomically with the
durable prerequisite. Source-changed pending
assignments record invalidation before replacement. History stores assignment
ids and validation evidence refs; detail status derives summaries from the
canonical ledgers.

Validation and review timestamps are reported time. They must be ordered from
active-execution start through validation, assignment start, and result, and
cannot postdate runtime acceptance. Broad final validation starts no earlier
than the passing feature-assignment result.

## Integration points

`skills/flow-test/SKILL.md` produces validation observations for the manager.
The manager creates assignments with `flow_review_start`, and
`skills/flow-review/SKILL.md` returns an assignment-id-bound verdict and typed
findings. Only the manager records those results through
`flow_feature_complete`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/application/schema.ts` | Evidence schemas. |
| `src/domain/transitions.ts` | Evidence enforcement. |
| `skills/flow-test/SKILL.md` | Validation evidence guidance. |
| `skills/flow-review/SKILL.md` | Assignment-result guidance. |
| `tests/runtime-gates.test.ts` | Evidence rejection and acceptance tests. |

## Entry points for modification

Adjust `skills/flow-test/SKILL.md` or `skills/flow-review/SKILL.md` for judgment changes. Adjust `src/application/schema.ts` and `src/domain/transitions.ts` only when persisted or enforced evidence changes.

Related pages: [Review and validation](../features/review-and-validation.md), [Flow tools](../api/flow-tools.md), and [Testing](../how-to-contribute/testing.md).
