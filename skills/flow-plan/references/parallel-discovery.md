# Parallel discovery

Use this only after a serial orientation pass has identified the repo shape and the likely slices. Workers are read-only evidence gatherers; the planner owns the plan.

For broad parallel passes, start with
`flow/references/parallel-orchestration.md`. If it selects fan-out, use
`flow/references/parallel-manifest.md` as the coverage gate,
`flow/references/parallel-execution.md` for worker prompts, and
`flow/references/parallel-synthesis.md` when handoffs return. Copy the
matching `flow/references/handoff-format.md` response shape into each
prompt.

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
config, or release surfaces in the pass manifest.

## Manifest and prompts

Write the pass manifest and worker prompts as
`flow/references/parallel-manifest.md` and
`flow/references/parallel-execution.md` define them: one manifest row
per slice with expected coverage, dependencies, write scope, and a verification
tier, and a self-contained prompt per worker naming the mode (usually
`evidence`), the exact slice, and the expected coverage. Discovery-specific
rules:

- Workers are read-only. For validation-oriented discovery, workers may report
  commands that should be run, and include raw output only for commands they
  actually ran.
- Workers cannot read reference files themselves; paste the matching handoff
  template from `flow/references/handoff-format.md` into the prompt.
- If discovery finds later features with disjoint path ownership, preserve that
  fact in feature `targets` and `dependsOn` so execution can make an explicit
  serial or candidate-pass decision instead of rediscovering ownership.

## Synthesis

Convert only evidence-backed work into plan fields:

- `requirements`: user promises and externally visible acceptance criteria.
- `decisions`: architecture boundaries, rejected approaches, and scope cuts.
- feature `targets`: files, modules, routes, commands, docs, or workflows the feature owns.
- feature `validation`: checks expected to prove the feature.

If workers disagree, inspect the source artifact yourself. If a candidate finding lacks a concrete citation or refutation pass, make it a review-first deliverable rather than a fix feature.

Treat the synthesized audit as an evidence boundary. Preserve refuted candidates
in the audit record, but exclude them from remediation. Do not turn an
interesting hypothesis, a severity label, or a speculative fix shape into a
plan feature before its triggering path and guards have been checked.

Apply the manager synthesis barrier from
`flow/references/parallel-synthesis.md`: only distilled,
evidence-backed claims become plan fields.
