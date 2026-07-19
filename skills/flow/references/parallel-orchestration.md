# Parallel orchestration

Use this index after a serial orientation pass shows that independent slices
may reduce a named discovery, validation, review, audit, verification, or
implementation uncertainty. The root manager owns the Flow session and every
state-changing `flow_*` call throughout the pass.

## Load only the selected branch

1. Read `parallel-decision.md` whenever deciding whether work should fan out.
2. Stop loading parallel references when the decision is serial. Record the
   implementation decision when the active execution requires one.
3. After selecting a parallel or candidate pass, read
   `parallel-manifest.md`, then `parallel-execution.md`.
4. When handoffs return, read `parallel-synthesis.md` before accepting claims,
   recording evidence, or presenting a result.
5. Copy exactly one matching worker response template from `handoff-format.md`
   into each worker prompt. Hidden workers cannot load skills or references.
6. Read `parallel-pass-example.md` only when a concrete end-to-end example is
   needed.

Do not preload the manifest, worker, and synthesis runbooks merely because a
task could be parallel. The decision reference is enough to keep serial work
serial.

## Pass routing

| Situation | Pass | Typical worker |
| --- | --- | --- |
| Repo shape is unclear before planning | Discovery | `flow-evidence-worker` |
| A broad finding set needs refutation | Audit | `flow-audit-worker` |
| Changed files or risk lenses exceed one review pass | Review | `flow-reviewer` |
| Test strategy or route coverage is unclear | Validation | `flow-validation-worker` |
| A claim is surprising, high-stakes, single-source, or payload-bound | Verification | `flow-verifier-worker` |
| An authorized independent implementation slice exists | Candidate | `flow-candidate-worker` |

Only the manager synthesizes the pass, decides whether evidence is sufficient,
integrates candidate patches, records Flow state, or returns the final verdict.
