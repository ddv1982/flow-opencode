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

## Flow repo default slices

For this repository, good first-pass slices are:

- Runtime gates: `src/runtime/schema.ts`, `src/runtime/transitions.ts`,
  `src/runtime/api.ts`, and `tests/runtime-gates.test.ts`.
- Workspace persistence: `src/runtime/workspace.ts`,
  `src/runtime/json/strict-object.ts`, and
  `tests/workspace-persistence.test.ts`.
- OpenCode adapter surface: `src/adapters/opencode/**`, `src/config-shared.ts`,
  `src/config.ts`, `src/index.ts`, and surface tests.
- Distribution and synced skills: `src/distribution/**`, `src/cli.ts`,
  `skills/**`, and distribution tests.
- CI, package, and release contract: `.github/workflows/**`, `package.json`,
  `bun.lock`, `README.md`, and `CHANGELOG.md`.
- Docs and operator contract: `docs/**`, `README.md`, and skill references.

Treat these as starting points, not a simultaneous coverage map. Before fan-out,
choose the relevant entries and de-overlap shared docs, skills, or release
surfaces in the coverage gate.

## Coverage gate

Before spawning workers, state the total discovery scope and one line per slice.
For countable scopes, confirm that slice counts add back to the total and that
there are no overlaps, gaps, or empty slices. If the scope is not countable,
state the completeness rule, such as "all changed files plus callers."

## Worker prompt

```text
Inspect <slice> for <goal>. Read-only. Do not edit files or call
state-changing Flow tools. Return the evidence/review/validation/audit handoff
shape from ../../flow/references/handoff-format.md.
```

For validation-oriented discovery:

```text
Inspect <slice> for validation risk. Read-only. Do not edit files or call
state-changing Flow tools. You may report commands that should be run, and
include raw output only for commands you actually ran. Return the
evidence/review/validation/audit handoff shape from
../../flow/references/handoff-format.md.
```

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
