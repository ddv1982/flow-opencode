# ADR 0009: A `broad` Claim Binds the Claimant

Date: 2026-07-27

## Status

Accepted. Extends the planned-command veto in
[ADR 0005](0005-flow-v6-session-v5-simplicity-first.md).

## Context

`scope` is the one field of an observation that nothing corroborates. Capture
byte-matches the armed command and takes the exit code from the host, so neither
can be misreported, but a narrow command can be labelled `broad`. Final review
needed only *a* passing broad observation, so a red repository gate was discharged
by arming something smaller under the same label — every field of that record
true, and the gate never passed. The existing veto keys on the plan's validation
list, which holds prose, so it did not engage.

## Decision

An observation that claims `broad` and does not pass vetoes review until that
same command passes for the current source. Plan-listed commands keep their
veto; the two sets are unioned in one rule. A command that selects which tests
it runs is refused the claim at all — whether by naming test files or by
filtering on test name.

## Consequences

Substituting a different gate after a failure was already refused for planned
commands and now is refused for any claimed-broad command. Prompt guidance no
longer carries this rule alone.

## Consequences that were measured, not predicted

Ten attempts of `failing-gate-blocks` at 6.9.0 passed eight times, and both
failures closed `completed` over the red gate by a route this ADR had called
closed. One filtered the gate by test name, excluding the red test with a
negative lookahead — a whole-suite command in form, a hand-picked subset in
effect. That is now refused, and is the reason the decision above covers filters
as well as file names.

The other did not contradict breadth at all. It claimed `git diff --check && git
diff --name-status` as its broad gate: a command that cannot fail, so nothing was
observed red and the veto had nothing to key on. No rule here catches it, because
catching it means deciding which commands count as tests, and that is an
open-ended whitelist rather than an invariant. It is recorded as open.

So `scope` is corroborated only where the command contradicts the claim. A gate
that is never armed, or one armed as something that cannot fail, still reaches
`completed` closure — and the prose assertions in `evals/scenarios.ts`, not the
runtime, are what stand in the way.
