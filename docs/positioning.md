# What Flow is, and what it is not

Flow is an **opinionated durable workflow for consequential multi-step changes**,
in preview, for people who will read the review.

That sentence is the product boundary and the honest limit at the same time. Flow
adds ceremony — a plan you approve, one feature at a time, host-observed validation,
an independent review, an explicit close — and that ceremony is worth paying for
only when a wrong change is expensive. For anything else it is overhead.

## Use Flow when

- The change spans several files or steps and has an order that matters.
- Being wrong is costly: a migration, a lifecycle invariant, a security boundary,
  a release path.
- You want durable state that survives a restart, a compaction, or a lost
  transcript, and a record of what was actually observed.
- You will read the plan before approving it and the findings before accepting a
  pass.

## Do not use Flow when

- **The change is small.** A one-file fix, a rename, a typo. Flow will plan it,
  validate it, review it, and close it, and every one of those steps costs a model
  turn you did not need.
- **You are exploring.** Flow locks a plan on approval and refuses to fold a
  materially different request into an active goal. That is the wrong shape for
  "let's see what happens if". Independent review is a gate on a change: a
  codebase survey needs inspect-shaped planning (no repair features) or an
  ordinary non-Flow chat.
- **You want speed above all.** A serial lifecycle with an independent review is
  slower than asking directly, by design.
- **You will not read the review.** Flow's review is a real model judgment, not a
  proof. Treating a passing verdict as a guarantee is the one way to be worse off
  than not using Flow at all — see [guarantees](guarantees.md) for exactly which
  parts the runtime enforces and which parts are judgment.
- **You need parallel features, multiple repositories, or team orchestration.**
  Flow runs one durable feature at a time in one project. Parallelism is bounded
  to workers inside a single feature.
- **Your host cannot carry `/flow-auto` continuation.** It still works, one
  `/flow-run` at a time; Flow tells you at startup when it detects this.

## Preview, and what that means

Flow is pre-1.0 in the sense that matters: its reliability is measured, but not yet
measured enough to promise. What that means concretely:

- Evals run against multiple providers on a schedule, and the numbers are published
  with the release rather than described. Absent numbers mean unmeasured.
- Session v5 is the only active state contract. There is no migration or rollback
  layer: finish or close active work before changing versions, in either direction.
- The public surface is frozen while the guarantees are measured. See the release
  policy in [release qualification](release-qualification.md).
- External validation is thin. Flow has been used seriously by its author and
  little else, so "it works" currently means "it worked here".

Claims about Flow should be traceable to a test, a scheduled eval, or nothing. If
a claim is in the last category, this document is the place it gets said out loud.
