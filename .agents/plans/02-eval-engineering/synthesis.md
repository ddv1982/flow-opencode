# Architecture arena synthesis

## Pick

Atlas is the base. Both the independent judge and lead review selected it. Its
frozen campaign plan defines the denominator, bounded reserve cells prevent
selective reruns, write-once attempt files make crash recovery auditable, and all
release decisions derive from one validated ledger.

## Grafts

- Delta contributed the `ValidatedReport` boundary and structured parse issues
  with path, code, and message.
- Beacon contributed the operator-facing split between cheap smoke, release
  conformance, reviewer calibration, paired comparison, and canary commands.
- Cinder contributed a smaller public API and the rule that family-specific data
  belongs in an attempt union rather than optional fields.

## Rejections

- Report-carried summaries remain display artifacts only. They cannot influence
  qualification.
- An incomplete pair never donates one arm to a marginal pass rate.
- A scored failure is immutable. A frozen plan may replace only a host, provider,
  or evaluator failure, and paired work replaces the whole block.
- Manual canaries cannot be waived for a release whose packed bytes changed.
- Package version equality cannot bind evidence to a release artifact.
- Reviewer quality cannot be inferred from a manager-led path. It needs fixed
  defect and clean states.
- No external eval framework replaces the current packed OpenCode harness.

## Settled policy

- Malformed or internally inconsistent evidence is `NOT VERIFIED`.
- A declared provider, host, evaluator, or budget stop that leaves required cells
  unmeasured is `INCONCLUSIVE`.
- A complete product or oracle failure is `NOT VERIFIED`.
- Cost, token, attempt, wall-clock, and replacement ceilings live in the frozen
  campaign plan.
- Every release that changes packed bytes needs exact-artifact conformance evidence
  and a matching manual canary. Product-value and reviewer gates remain advisory
  until calibrated.
- Publication is tag-only. A push to `main` verifies but does not publish.

## Verification

All four candidates covered the six architecture criteria. The independent judge
scored Atlas highest in every category except simplicity, where the Cinder and
Delta grafts reduce its public surface. The synthesized architecture keeps Atlas's
invariants while trimming its module map to the smallest phase currently needed.
