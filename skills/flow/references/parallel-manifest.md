# Parallel pass manifest

Read this only after `parallel-decision.md` selects a parallel or candidate
pass. The manifest is the pre-fan-out coverage gate and the accounting contract
for every worker result.

## Orient and slice

Call `flow_status` when a Flow session may exist. Read enough code, schemas,
docs, tests, commands, or artifacts to identify real slices. Keep the question
that determines whether fan-out is valid in manager context.

Split by an axis that keeps work independent: modules or paths, routes or
endpoints, risk lenses, commands, data ranges, or atomic claims. Give each slice
a one-line scope, expected coverage, checkable output, dependencies, write
scope, and verification tier. Shared files, fixtures, schemas, and public
contracts normally stay serial unless candidate work uses isolated worktrees.

## Write the manifest

Before spawning, write one row per slice plus a totals or completeness check.
Use stable pass and row ids so later handoffs, verification, synthesis, and
completion accounting refer to the same work without replaying conversation
history.

| Row id | Slice | Expected coverage | Mode | Depends on | Write scope | Verification tier | Handoff ref | Verification status | Synthesis ref |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `runtime-read` | `src/core/**` plus tests | 14 files | `evidence` | none | none | accept locally | pending | pending | pending |
| `release-read` | CI, package metadata, changelog | 6 files | `audit` | none | none | verify once | pending | pending | pending |

Use runtime `writeScope` values exactly: `none`, `manager-serial`, `exact-path`,
`isolated-worktree`, or `mixed`.

Before launch:

- Reconcile countable work such as files, routes, commands, rows, findings,
  screenshots, or claims. Slice totals must have no overlaps, gaps, or empty
  rows.
- When scope is not countable, state a completeness rule such as "all changed
  files plus callers" or "all public commands plus release docs."
- Assign a verification tier before handoffs arrive.
- Record dependency edges. Spawn a dependent row only after its prerequisite
  has a verified handoff or manager synthesis that settles the dependency.
- Fix an unreconciled slice map centrally before fan-out.

N spawned rows require N collected and checked handoffs before synthesis.

## Implementation decision rows

Add an implementation decision row even when no worker is spawned. Record:

- `kind: "implementation-decision"`
- the valid decision, eligibility, and candidate-decision pairing from
  `parallel-decision.md`
- `decisionFactors`, `decisionReason`, and `writeScope: "manager-serial"`
- `workerCount: 0`, a stable row id, verification status, and outcome

When `candidateDecision` is `used`, record actual candidate execution evidence
and raise worker counts accordingly. A zero-worker record cannot claim candidate
use. Subtype counts may not exceed total worker count.

## Persistence

The conversation is sufficient for one bounded pass. When a follow-up pass or
session resume is plausible, persist the accounted manifest with the synthesis
in a manager-owned temporary artifact outside `.flow/**` and outside the repo
worktree. The runtime stores bounded accounting, not complete worker handoffs.
