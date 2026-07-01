# Parallel discovery

Use this only after a serial orientation pass has identified the repo shape and the likely slices. Workers are read-only evidence gatherers; the planner owns the plan.

For broad parallel passes, also load `../../flow/references/parallel-orchestration.md`.
Use its pre-fan-out coverage gate and
`../../flow/references/handoff-format.md` response shapes.

## Good slices

- Independent modules or packages.
- Frontend route and backend endpoint pairs.
- Test, CI, and release surfaces.
- Risk lenses such as security, persistence, accessibility, migration, or performance.
- Documentation and operator-contract checks.

## Deriving first-pass slices

Derive slices from the repo shape found during the serial orientation pass:
top-level packages or source directories, the test tree, CI and release
config, and docs. Name each slice by the paths it owns, for example "runtime:
`src/core/**` plus its tests" or "release contract: CI workflows,
`package.json`, and the changelog".

Treat derived slices as starting points, not a simultaneous coverage map.
Before fan-out, choose the relevant entries and de-overlap shared docs,
config, or release surfaces in the coverage gate.

## Coverage gate

Before spawning workers, state the total discovery scope and one line per slice.
For countable scopes, confirm that slice counts add back to the total and that
there are no overlaps, gaps, or empty slices. If the scope is not countable,
state the completeness rule, such as "all changed files plus callers."

## Worker prompt

```text
Inspect <slice> for <goal>. Read-only. Do not edit files or call
state-changing Flow tools. Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

For validation-oriented discovery:

```text
Inspect <slice> for validation risk. Read-only. Do not edit files or call
state-changing Flow tools. You may report commands that should be run, and
include raw output only for commands you actually ran. Return only the Flow
handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

Workers cannot read reference files themselves; paste the matching handoff
template from `../../flow/references/handoff-format.md` into the prompt.

## Synthesis

Convert only evidence-backed work into plan fields:

- `requirements`: user promises and externally visible acceptance criteria.
- `decisions`: architecture boundaries, rejected approaches, and scope cuts.
- feature `targets`: files, modules, routes, commands, docs, or workflows the feature owns.
- feature `validation`: checks expected to prove the feature.

If workers disagree, inspect the source artifact yourself. If a candidate finding lacks a concrete citation or refutation pass, make it a review-first deliverable rather than a fix feature.

Apply the manager synthesis barrier from
`../../flow/references/verification-gates.md`: only distilled, evidence-backed
claims become plan fields.
