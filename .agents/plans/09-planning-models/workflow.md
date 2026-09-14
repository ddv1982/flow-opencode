# Planning model feature workflow

- [x] Read the Principles section in full.

## Feature playbook

Delegation, lifecycle, isolation, history, and capability fallbacks follow `../references/codex-agent-runtime.md`.

### Feature

**You own the design. Plan, review, verify.** Delegate implementation; stay in the lead.

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

Code-coupled work (one feature, one migration) goes to a single owner with the checkpoint inline; that owner fans out internally after the blocking phase. Parent-level fan-out is for slices that produce independent artifacts (audits, cross-subsystem investigations, competing experiments). Rewrite the checkpoint at phase boundaries; spawn a fresh owner rather than chaining interrupts.

**Reply:** what you built, what you chose and why, open decisions. Tables for design alternatives.

## Throughput checkpoint

- [x] Blocking first steps. Trace manager ownership and compare phase switching with a read-only planning specialist.
- [x] Independent workstreams. The delegate owns src, tests, and planning guidance. The parent owns product docs, Git, and authoritative verification.
- [x] Shared mutable state. Exclusive file ownership separates edits. Only the parent commits and publishes repository changes.
- [x] Smallest safe decomposition. One owner implements the coupled configuration, agent and menu changes. Parent verification remains independent.

## Architecture phases

- [x] Ground. Existing request anchors and AutoDrive belong to the coding manager.
- [x] Sketch. Compare manager model switching and a read-only planning specialist.
- [x] Agree. Choose the planning specialist. No additional approval checkpoint requested.
- [x] Implement.
- [x] Scrap. Skipped because no repeated design failure remained.

## Decision

The planning model drafts advice in a separate read-only agent. The coding manager
checks, saves and approves the plan, then implements it. The current approval
rules remain authoritative. An explicit handoff names requested roles without
claiming served model identity from configuration. Default planning remains in
the manager and adds no subtask.

Two design lanes ran in parallel. The parent examined phase-switching constraints;
a generic Poteto delegate traced ownership and compared both designs. The custom
pstack-poteto-agent profile was unavailable. Model and effort are inherited;
served model diversity is unverified. Sticky activation hooks are unverified.

No paid eval, canary, release, tag, or personal configuration change is authorized.
The PR deliverable includes an opt-in planning specialist and a shared model menu.

## Verification record

The coding owner implemented the selected design under exclusive src/test/guide
ownership. A separate generic reviewer inspected correctness and comments without
editing. Both used inherited models. No model-family diversity is claimed.

The parent found a planner permission gap and requested deny-by-default with only
read, glob and grep allowed. The owner fixed it and added custom-tool denial checks.
The parent also requested handoff wording before the approval call and corrected
byte accounting after the helper rename. Existing prompt limits stayed unchanged.
New planner and menu code have separate measured source allowances.

The parent built the candidate and used an isolated OpenCode 1.18.6 host with a
local synthetic provider. Its requests were coding, planning, coding. This proves
configured agent routing and preservation of the coding model, not model quality
or real-model compliance with the planning guidance. Probe script and logs remain
in /tmp/flow-planning-candidate-probe.ts and /tmp/flow-planning-candidate-probe.log.

The real TUI opened Flow model settings and the planning-model picker with a
synthetic catalog. No preference write or external model call was made in that UI
probe. The separate provider-free host smoke passed 22 tests, including real
preference enable/reset and native permission checks. Personal configuration was
not changed. An early throwaway routing script had a syntax error; the corrected
script and the candidate-backed probe both passed.

The independent final spot check found no correctness blockers and requested
removal of three lines that narrated a test's budget calculation. No suppressions
or unenforced comment constraints were added. Deslop was unavailable; direct
cleanup checked the diff, old-helper removal, imports, comments, and permissions.

No paid eval, canary, tag, release, or model-quality claim is part of this PR.
