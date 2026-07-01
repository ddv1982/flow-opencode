# Parallel pass patterns

Flow uses parallel workers to reduce uncertainty, not to delegate decisions.
Each pass has a bounded purpose, an explicit coverage rule, and one
manager-owned synthesis result.

## Choose a pass

| Situation | Flow pass | Output the manager may synthesize |
| --- | --- | --- |
| Repo shape is unclear before planning | Discovery pass | Requirements, decisions, targets, validation entries, or a review-first feature |
| A broad finding set needs refutation | Audit pass | Surviving findings with guards checked and gaps named |
| Changed files or risk lenses are too broad for one review pass | Review pass | One `featureReview` or `finalReview` payload owned by the manager |
| Test strategy or route coverage is unclear | Validation pass | Candidate commands or authorized raw command evidence |
| A claim is single-source, surprising, high-stakes, or payload-bound | Verification pass | Per-claim keep, narrow, rewrite, or remove decisions |
| Multiple implementation paths are plausible | Candidate pass | Candidate patches inspected and validated by the manager before use |

Prefer serial work when one file, command, or design question determines the
next step. A parallel pass should reduce a named planning, validation, review,
audit, or implementation uncertainty.

## Pass Shapes

### Discovery pass

Use before planning when the manager has oriented enough to name disjoint slices
but not enough to write reliable plan fields. Workers read specific modules,
routes, docs, commands, or risk lenses. The manager turns only evidenced claims
into plan fields.

### Audit pass

Use when a report starts from candidate findings. Workers actively look for
guards, lifecycle resets, deployment constraints, and counterexamples before
reporting a finding. A finding that lacks refutation work stays advisory or
becomes a follow-up question.

### Review pass

Use when changed files or risks can be reviewed independently. Review workers
separate blocking findings from advisory notes. The manager resolves conflicts,
checks cited artifacts, and returns one review payload.

### Validation pass

Use when coverage is unclear or command evidence can be gathered independently.
Validation workers may run only manager-authorized commands and must report
exact command, status, raw outcome summary, coverage, confidence, and gaps.

### Verification pass

Use for atomic claims. Give the verifier claim ids, cited sources or commands,
and the acceptance question. Do not ask a verifier to redesign the work or
review the whole feature.

### Candidate pass

Use only with explicit user authorization plus isolated worktrees or exact
non-overlapping path ownership. Candidate patches are proposals until the
manager inspects, merges or rejects them, and validates the main workspace.

## Effort Defaults

- Start with two to five workers. Use more only when the coverage gate is
  countable and the manager can verify every handoff.
- Run at most one routine follow-up pass. Extra passes need a stated reason,
  such as a high-stakes verification check or a newly discovered bounded slice.
- Spend effort where being wrong costs more: public API, persistence, security,
  permissions, release behavior, data loss, and Flow payload claims.
- Do not fan out to keep agents busy. Worker setup and synthesis have real cost.

## Stop And Extend

Stop after a pass when:

- the coverage rule is satisfied.
- accepted claims are evidenced, scoped, and confidence-labeled.
- material single-source, contested, high-stakes, or payload-bound claims have
  been verified or downgraded.
- remaining gaps are explicit and do not block the Flow artifact being produced.

Start a bounded follow-up pass only when:

- the original slice map missed material scope.
- workers disagree on a claim that affects the Flow decision.
- a high-stakes or payload-bound claim needs verification.
- a first pass exposes a narrower implementation or validation slice worth
  isolating.

After every pass, the manager synthesis barrier from `verification-gates.md`
applies before any handoff content moves forward.
