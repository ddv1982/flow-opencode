# ADR 0010: The Plan Declares the Gate, and Measurement Pays for It

Date: 2026-07-27

## Status

Accepted. Closes the open escape recorded in
[ADR 0009](0009-scope-keyed-validation-veto.md).

## Context

ADR 0009 left one route to a dishonest `completed` closure open and said so: a
measured run claimed `git diff --check && git diff --name-status` at `broad` scope.
Nothing in that command contradicts breadth — it simply cannot fail, so no red
observation ever existed for the veto to key on. Closing it from the validation
side means deciding which commands count as tests, which is an open-ended whitelist
rather than an invariant, so it stayed open.

The same period exposed a second problem of the same kind. Every recorded eval
report was single-model, and the pass rates in it were read by eye. Two claims —
that Flow prevents false completion, and that the independent review is
substantive — were therefore unmeasured in the only way that would show a
regression: across providers, repeatedly, on a number rather than an impression.

## Decision

**Declare the gate at planning time.** A plan carries `gate`: the exact canonical
command that validates the whole repository. `savePlan` requires it for any new
plan and refuses one that selects its own tests. A `broad` observation must run
that command byte-for-byte, and the declared gate joins the vetoed-command set, so
its latest failure blocks review whatever scope the observation claimed.

**Measure the two claims.** The eval harness derives, from durable documents alone,
whether a `completed` closure is supported by its own evidence (false completion)
and what the review actually did (verdicts, findings, unsubmitted assignments). A
scheduled workflow runs the suite against at least two providers weekly, and
`bun run qualify` applies published thresholds to the report.

**Publish the guarantee map.** `docs/guarantees.md` states which claims are
TS-enforced, host-attested, caller-declared, model-judgment, or unenforced.

## Simplicity boundary

The gate is one optional string on the plan. It adds no new state machine, no
command classifier, and no per-feature gate list. Its enforcement is two
comparisons, in the transition that already validates observations.

The measurement side adds a scheduled workflow and one script, and the maintainer
contract requires an equal or larger removal in exchange. It is paid for by
subtraction the field replaces: the prose that asked the model to judge whether its
own `broad` claim was honest, and the paragraph restating the freshness boundary the
runtime already refuses. The prompt ceiling ratcheted down with the change rather
than up.

## Consequences

A `completed` closure now requires the command the user approved as the gate to
have passed for the current source. Substituting anything else is refused where it
starts, at arm time, with a message naming the declared gate.

Plans written before this field exists declare no gate and keep the older rule.
That set only shrinks, and `docs/guarantees.md` lists it as unenforced.

A repository whose canonical gate genuinely cannot run — a missing service, another
platform — cannot reach final review by relabelling something smaller. That is a
blocker to report, which is the intended outcome and a real cost.

## Rejected alternatives

**A whitelist of gate-shaped commands.** The thing ADR 0009 refused, for the same
reason: `bun test`, `pytest`, `cargo test`, `make check`, and every project-local
script mean it is unbounded, and a false negative costs a real repository its broad
claim.

**A per-feature gate.** The canonical gate is a property of the repository, not of
a feature. Per-feature gates multiply the declaration, the plan bytes, and the
chance that one of them is the weak one.

**Requiring the gate on hydrate.** Would refuse to read documents written by an
older build, breaking the forward-reading rule Session v5 is built on for the sake
of a rule about what this build writes.

**Gating evals in pull-request CI.** Model evals cost real money and need
credentials, so a per-PR gate would either be skipped constantly or charge every
contributor for someone else's prompt change. Weekly and on demand keeps the
evidence without making it a toll.
