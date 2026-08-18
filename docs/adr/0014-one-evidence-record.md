# ADR 0014: One Evidence Record

Date: 2026-08-18

## Status

Accepted. Closes the collapse [ADR 0012](0012-named-results-over-exit-codes.md)
and the documentation contract recorded as owed.

## Context

`gate`, `externalEvidence`, `platform`, and `assertions` were four writings of
one idea. Each closed a measured cheat. Together they made the approved plan a
legal instrument and forced documentation-ceiling raises.

## Decision

Session v5 plans declare `evidence`. Exactly one entry has `scope: "gate"`.
Extra entries are observations this host may be unable to produce. Satisfaction
is one function: exact command, declared platform, named cases, eligible
observation. Broad observations must still run the gate command.

`gate` and `externalEvidence` are removed. This is a hard cutover. Finish or
close active sessions before upgrading. No dual reader.

## Consequences

A 7.x Session document that still names `gate` or `externalEvidence` does not
hydrate. Replay of recorded `flow_plan_save` arguments uses the new shape.

## Rejected alternatives

Keep stacking fields. Rejected: the next cheat does not fit without another
ceiling raise.

A dual reader during deprecation. Rejected: two shapes for one question.

Delete the runtime and keep skills. Rejected: models invent state again.
