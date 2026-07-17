# Parallel pass decisions

Read this reference after serial orientation and before creating a pass
manifest. It decides whether fan-out is worth its coordination cost and records
why implementation stays serial or uses candidate workers.

<!-- flow-prompt:manager-parallel-core:start -->
## Conditional parallel pass

Use a parallel pass only when independent coverage is worth its coordination
cost. Orient serially first. Before fan-out record a stable pass id, purpose,
bounded worker count, exact non-overlapping slices, expected coverage, named
Flow worker roles, dependencies, write scope, handoff kind, verification plan,
and stop condition.

Use `flow-evidence-worker` for discovery, `flow-validation-worker` for commands,
`flow-audit-worker` for adversarial findings, `flow-verifier-worker` for
high-impact claim checks, and `flow-reviewer` for independent review. Account
for every manifest row. A missing, empty, malformed, partial, or blocked
handoff is a coverage gap, not success. Verify high-impact or single-source
claims, then let only the manager synthesize the result and mutate Flow state.
<!-- flow-prompt:manager-parallel-core:end -->

## Choose a pass

| Situation | Flow pass | Manager-owned result |
| --- | --- | --- |
| Repo shape is unclear before planning | Discovery | Evidenced requirements, decisions, targets, validation, or a review-first feature |
| A broad finding set needs refutation | Audit | Findings that survive guard and counterexample checks |
| Changed files or risk lenses exceed one review pass | Review | One feature review or final review payload |
| Test strategy or route coverage is unclear | Validation | Candidate commands or authorized raw command evidence |
| A claim is surprising, high-stakes, single-source, or payload-bound | Verification | Per-claim keep, narrow, rewrite, or remove decisions |
| Multiple independent implementation paths are plausible | Candidate | Inspected candidate patches, never direct Flow completion |

Discovery, audit, review, validation, and verification passes are read-only.
Validation workers run only manager-authorized commands. Verification workers
judge atomic claims rather than redesigning the work. Candidate passes require
explicit user authorization plus an isolated worktree or exact non-overlapping
path ownership; patches remain proposals until manager inspection and
validation.

## Implementation pass decision

Before editing a broad, risky, or multi-target feature, record one manager
decision even when implementation stays serial. Keep `candidateEligibility`,
`candidateDecision`, and `decision` as distinct fields.

Classify candidate eligibility separately from the decision:

| Eligibility | Meaning |
| --- | --- |
| `eligible` | At least one slice has independent ownership and practical validation. |
| `not_eligible` | Shared state, files, tests, or judgment make isolation unsafe or wasteful. |
| `unknown` | Orientation is incomplete; never use this on an `implementation-decision` record. |

Use only these pairings on `implementation-decision` records:

| Eligibility | Candidate decision | Implementation decision |
| --- | --- | --- |
| `eligible` | `used` | `candidate-exact-path`, `candidate-worktree`, or `tournament` |
| `eligible` | `skipped` | `skipped` |
| `not_eligible` | `serial_required` | `serial` |

Candidate-shaped decisions and `candidateDecision: "used"` require execution
evidence on the same record: `kind: "candidate"`, `modes` containing
`candidate-implementation`, or `candidateWorkerCount > 0`. Keep
`candidateWorkerCount <= workerCount` and
`verifierWorkerCount <= workerCount`; one worker may fill both subtype counts.
Never use `parallel` as an implementation decision. Reserve `parallel` for
multi-worker read, audit, review, validation, or verification passes.

Implementation decision meanings:

- `serial`: the manager implements directly because work overlaps or depends on
  one shared contract or mental model.
- `candidate-exact-path`: workers own exact, disjoint path sets in one checkout.
- `candidate-worktree`: isolated workers propose patches for manager integration.
- `tournament`: isolated candidates compete; the manager selects using source
  inspection, validation, and review.
- `skipped`: candidate work was eligible, but coordination cost outweighed its
  value. Do not use it for unsafe ownership; those cases are `serial`.

Record `decisionReason` plus the applicable structured `decisionFactors`:
`shared_state`, `overlapping_files`, `small_slice`,
`needs_manager_judgment`, `independent_surface`, and
`validation_available`. Also record a stable pass id, write scope, expected
verification, and the handoff or synthesis location. Carry the bounded record
into `flow_feature_complete.orchestrationPasses` when it materially shaped the
feature; keep full handoffs and logs outside Flow state.

## Candidate judgment

Consider candidate workers when ownership is additive or localized, validation
can run per slice, and the manager can safely inspect or reject the result.
Separate frontend, core, docs, release, test, or binding surfaces are useful
signals, but the actual path and contract boundaries decide eligibility.

Stay serial when any of these apply:

- One file, command, contract, migration, or design question determines the
  next step.
- Slices share state, callers, fixtures, generated output, lockfiles, tests, or
  edit targets.
- Persistence or lifecycle behavior requires one mental model.
- Iterative debugging must happen in one checkout.
- Prompt, handoff, merge, and verification cost exceeds direct work.
- The manager would still need the same full synthesis with no coverage gain.

Do not fan out to keep workers busy. Every worker must reduce a named
uncertainty.

## Worker count defaults

Use bounded caps rather than worker-count targets:

- Small implementation: zero or one worker.
- Medium independent implementation: at most two workers.
- Broad audit: three to five workers.
- Broad implementation: two to four candidate workers with non-overlapping
  ownership.
- Medium- or high-risk final verification: one verifier.

Use more only when the manifest remains countable and non-overlapping.
