# Plan quality checklist

Use this checklist before `flow_plan_save` and again before approval if the plan
changed during discussion. The goal is not a long planning artifact; it is a
concise plan another agent can execute without rediscovering the work.

## Must pass

- Outcome: `summary` names the user-visible result, not an internal activity.
- Requirements: acceptance criteria, constraints, and non-goals that affect
  implementation are captured in `requirements`.
- Decisions: assumptions, scope choices, and architecture choices already made
  are captured in `decisions`.
- Uncertainty: specification uncertainty is resolved by a decision or a user
  question; environment uncertainty is resolved by inspection, discovery, or a
  first evidence-producing feature.
- Feature shape: each feature has one coherent outcome and can be reviewed on
  its own.
- Targets: each feature names bounded files, modules, routes, commands, docs, or
  generated surfaces. Whole-repo targets are allowed only for explicit broad
  audits or final validation.
- Validation: each feature names expected check levels, such as targeted unit,
  integration, browser/e2e, package/build, docs/static, cleanup preservation, or
  broad project gate.
- Dependencies: `dependsOn` captures true ordering and avoids hidden dependency
  chains.
- Review policy: `finalReviewPolicy` is `detailed` when the work changes
  behavior, persistence, public contracts, security posture, release surfaces,
  or multiple modules.

## Revise when you see this

- A feature title describes a step like "update files" instead of a result.
- A validation entry says only "manual testing" or "run tests".
- A feature has targets but no behavior or artifact that can be judged.
- A feature claims cleanup or simplification without an evidence-producing
  audit or cited smell.
- A docs feature depends on behavior that is not yet implemented but lacks
  `dependsOn`.
- A low-risk `finalReviewPolicy: "broad"` is used while the plan crosses runtime,
  schema, persistence, security, or release boundaries.

## Approval summary

When presenting the plan for approval, include:

- The promised outcome.
- The feature order and any dependencies that matter.
- The main validation levels.
- Material assumptions in `decisions`.
- Any known gaps that remain intentional.
