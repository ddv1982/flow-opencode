# Parallel discovery

Use this only after a serial orientation pass has identified the repo shape and the likely slices. Workers are read-only evidence gatherers; the planner owns the plan.

## Good slices

- Independent modules or packages.
- Frontend route and backend endpoint pairs.
- Test, CI, and release surfaces.
- Risk lenses such as security, persistence, accessibility, migration, or performance.
- Documentation and operator-contract checks.

## Worker prompt

```text
Inspect <slice> for <goal>. Read-only. Do not edit files or call Flow tools.
Return: scope inspected; files/commands checked; evidence-backed facts or findings; gaps; suggested feature targets and validation.
```

## Synthesis

Convert only evidence-backed work into plan fields:

- `requirements`: user promises and externally visible acceptance criteria.
- `decisions`: architecture boundaries, rejected approaches, and scope cuts.
- feature `targets`: files, modules, routes, commands, docs, or workflows the feature owns.
- feature `validation`: checks expected to prove the feature.

If workers disagree, inspect the source artifact yourself. If a candidate finding lacks a concrete citation or refutation pass, make it a review-first deliverable rather than a fix feature.
