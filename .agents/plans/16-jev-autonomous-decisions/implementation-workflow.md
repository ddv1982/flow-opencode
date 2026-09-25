# Implementation workflow

- [x] Read the Principles section in full.

## Figure it out phases

- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

## Feature steps

1. `how` over the affected subsystem.
2. `architect` for parallel design exploration. Skipping stays as `architect skipped: <reason>`; do not fold the design decision silently into implementation.
3. Write the throughput checkpoint as four todo items. A dimension that genuinely does not apply (single file, no fan-out) keeps its item with `n/a: <reason>` rather than being dropped:
   - **Blocking first steps.** Gates run before fan-out.
   - **Independent workstreams.** Disjoint files, services, or layers parallelize. Shared writes serialize.
   - **Shared mutable state.** Default to splitting the target (the **separate-before-serializing-shared-state** principle skill). Serialize only for real invariants.
   - **Smallest safe decomposition.** If one worker is best, name why.
4. Delegate code-writing to a subagent using your configured feature model (default the configured fast profile) with a specific scope (file paths, named data shape and its organizing structure per **principle-model-the-domain** — a state machine over scattered booleans, a table/registry over branching, a typed model over repeated shape assumptions, chosen before the delegate writes logic — and success criteria); review its diff yourself. When the implementation admits multiple valid shapes (error handling, abstraction layer, test structure), delegate via the **arena** skill instead so the runners surface the alternatives and the cross-judge guards the pick. Mandatory: no skip-with-reason escape, and Laziness Protocol does not override it (the gain is review separation, not lines saved). You can spawn a subagent even though you are one; "the app is small" and "a subagent cannot spawn one" are both wrong. A subagent forbidden to spawn satisfies this by owning the diff directly with the same review separation; no "standing by" reply that waits on a nested agent. Comments per **Comments**. Surgical edits, re-ground against the source for upstream-derived files. Port shared-primitive improvements to all consumers and verify each. Commit liberally.
5. Verify on the matching surface. "Inconclusive" or wrong-surface is not a pass; flag it.
6. Rebase into small, ordered commits; stack follow-ups.
   Use the **sequence-verifiable-units** principle skill, building, verifying, and committing each small unit before the next.
7. If the design is contested, `interrogate` before shipping.
8. Run **Opening a PR**.

## Throughput checkpoint

- [x] Blocking first steps. Inspect current eval contracts, establish isolated worktree, install pinned toolchain, and compare two independent designs before writes.
- [x] Independent workstreams. Design candidates are read-only. One implementation owner owns coupled evaluation code. Parent owns plan records and ADR prose.
- [x] Shared mutable state. Separate design outputs are returned in messages. Implementation uses /Users/vriesd/projects/flow-jev-evaluation on feat/jev-blocker-evaluation. The original checkout and .flow state remain untouched.
- [x] Smallest safe decomposition. One code owner keeps transport, episode schemas, and report semantics coherent. Parent verifies and independently reviews.

## Current scope and stop conditions

The user authorized implementation of the saved plan. Build JEV-1 tooling, verify deterministic behavior, and prepare the result for review. Advance only after its live promotion evidence passes. Missing credentials are an unmeasured gate, not a negative model finding. No key is currently available. A budget and approved credential setup were requested asynchronously while reversible implementation continues.

This is a foreground implementation task. No persistent goal or heartbeat is created without an explicit lifecycle request. The operator owns merge. No deploy or release is authorized.

## Task checklist

- [x] Synthesize design candidates and independent judge.
- [x] Implement typed corpus, deterministic eligibility, Jev advice parsing, bounded transport, report, and CLI.
- [x] Preserve alignment evaluator semantics while pinning model and recording provenance.
- [x] Test invalid data, response errors, cancellation, budgets, evidence provenance, and no-promotion with missing data.
- [x] Run repository checks and independent diff audit.
- [x] Record exact evidence and unresolved live gates.

JEV-1 tooling is verified offline. The phase is not live-qualified or merge-ready under the full plan. JEV-2 through JEV-4 remain unstarted. No negative model-quality verdict was inferred from unavailable credentials.
