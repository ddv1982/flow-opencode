# Phase 0 Interrogate review

## Intent

The probe must establish manager identity, reviewer identity, child lineage, and
host version through a real packed OpenCode 1.18.6 run. It must distinguish a
failed observation from an unsupported host capability and retain no raw values.

## Reviewers

- `gpt-5.6-terra` raised four findings.
- `gpt-5.6-luna` raised six findings and one test limitation.
- `gpt-5.5` raised two warnings and one consistency nit.
- `gpt-5.4-mini` raised two warnings and one verification consideration.

## Acted on

- Only a transient child row with `agent: flow-reviewer` can become reviewer
  evidence.
- Parent and reviewer identity require a successful completed assistant message.
- An empty or non-reviewer child set is an inconclusive run, not an unsupported
  host capability.
- `/session/:id/command` delivery is observed directly instead of swallowed by
  the general harness wait loop.
- The session-reported host version must match the requested version.
- Compound sensitive field names are redacted by tokenized key matching.
- The CLI requires explicit acknowledgement of live credential use and limits the
  reviewer to eight steps.
- Model-field recognition and its acceptance predicate use the same path set.

## Noted

- `GET /session/:id/children` exposes configured reviewer model fields, but the
  probe intentionally requires message evidence because the claim concerns a
  model that actually answered.
- The credentialed packed-host path cannot run in ordinary CI. The checked-in
  redacted artifact is the Phase 0 runtime evidence, while pure classification
  branches stay credential-free.
- A hard process kill can bypass the existing eval harness cleanup. Live
  credential use is now opt-in, but process supervision is a harness-wide concern
  for a later phase rather than a probe-only patch.

## Verdict

`VERIFIED`. Focused tests, the real packed-host probe, the redaction scan, and the
full repository gate pass after the accepted findings were fixed.
