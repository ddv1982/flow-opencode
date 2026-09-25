# Runtime implementation workflow

- [x] Read the Principles section in full.

## Session pickup steps

1. Locate the prior trail through supported Codex task APIs, a task link, a user-supplied handoff digest, or a pushed branch. Scope task reads to the active project. For a long history, use a read-only subagent and keep the reduced timeline in the parent. If task APIs are unavailable, use git and pull-request state plus the digest. Never search a private history store.
2. Reconstruct operational state. The branch and worktree, what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. The prior trail is authoritative input. Resist the bias to re-derive it.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. A "let me verify from scratch" pass is the tell that you're treating the trail as untrustworthy when it's actually authoritative.
4. Route the remaining work to the matching playbook and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. The pickup playbook ends here; the routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact (the **principle-prove-it-works** skill). A passing prior self-report is not the proof.

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

## Progress

- [x] Reconstruct the committed JEV-1 worktree and verify that no implementation edits were lost.
- [x] Check the supplied credential path without reading values into output. It is still absent.
- [x] Compare application-owned and coordinator-owned recovery designs with an independent judge.
- [x] Select explicit status proposals, a shared controller, and transaction-bound authorization.
- [x] Implement runtime policy, provider adapter, host wiring, and bounded continuation.
- [x] Verify default-off compatibility and simulated delegated mechanics.
- [x] Review code independently and exercise available host controls.
- [x] Record remaining live gates and prepare the verified implementation for its local commit.

## Throughput checkpoint

- Blocking first steps. The existing baseline is inherited, not rerun. Architecture exploration precedes schema and host changes.
- Independent workstreams. One owner writes coupled product code, tests, and product documentation. Parent writes the plan and audit records.
- Shared mutable state. The one intentional controller belongs to one plugin instance. Every service factory shares it. The worktree has one code writer.
- Smallest safe decomposition. Reuse the existing status, start, reset, replay, and validation paths. No new public tool or Session schema.

## Sequencing amendment

The user asked to continue implementation after learning that only JEV-1 tooling was built. Continue default-off construction before live qualification. Do not promote or enable production delegated recovery. The release-owned qualification registry stays empty.

No live provider calls, external publication, merge, or release are authorized by this change in construction order. A live evaluation budget remains unspecified. No lifecycle goal or heartbeat is created for this foreground task.
