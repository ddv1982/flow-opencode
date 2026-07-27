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
veto; the two sets are unioned in one rule. A command that names the tests it
runs is refused the claim at all.

## Consequences

Substituting a different gate after a failure was already refused for planned
commands and now is refused for any claimed-broad command. Prompt guidance no
longer carries this rule alone.

What remains is narrowing the runtime cannot see: a test-name filter, or a gate
never armed at all.
