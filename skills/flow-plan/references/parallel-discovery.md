# Parallel discovery

Use this only after a serial orientation pass has identified the repo shape and the likely slices. Workers are read-only evidence gatherers; the planner owns the plan.

## Good slices

- Independent modules or packages.
- Frontend route and backend endpoint pairs.
- Test, CI, and release surfaces.
- Risk lenses such as security, persistence, accessibility, migration, or performance.
- Documentation and operator-contract checks.

## Flow repo default slices

For this repository, good first-wave slices are:

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

## Worker prompt

```text
Inspect <slice> for <goal>. Read-only. Do not edit files or call Flow tools.
Return: scope inspected; files/commands checked; evidence-backed facts or findings; gaps; suggested feature targets and validation.
```

For validation-oriented discovery:

```text
Inspect <slice> for validation risk. Read-only. Do not edit files or call Flow
tools. You may report commands that should be run, and include raw output only
for commands you actually ran. Return: scope inspected; validation-relevant
facts; suggested targeted checks; broad-gate implications; gaps.
```

## Synthesis

Convert only evidence-backed work into plan fields:

- `requirements`: user promises and externally visible acceptance criteria.
- `decisions`: architecture boundaries, rejected approaches, and scope cuts.
- feature `targets`: files, modules, routes, commands, docs, or workflows the feature owns.
- feature `validation`: checks expected to prove the feature.

If workers disagree, inspect the source artifact yourself. If a candidate finding lacks a concrete citation or refutation pass, make it a review-first deliverable rather than a fix feature.
