# Development workflow

Flow development is a standard Bun and TypeScript workflow with a small number of source boundaries. The key local loop is read, edit, run focused checks, then run `bun run check`.

## Branch and edit

The repo does not define a custom branch process in source files. Local work should preserve unrelated changes and avoid broad `.flow/**` staging, matching the Git safety guidance in `skills/flow-commit/SKILL.md`.

## Source ownership

| Path | Change here when |
| --- | --- |
| `src/domain/**` | Session types, invariants, or pure transition gates change. |
| `src/application/**` | Use cases, repository ports, typed results, or core schemas change. |
| `src/infrastructure/**` | Filesystem persistence, locks, strict JSON, or system services change. |
| `src/platform/**` | OpenCode host schemas, config, hooks, command preflight, or tools change. |
| `src/guidance/**` | Stable ids or embedded Markdown imports change. |
| `src/distribution/**` | Explicit legacy-cleanup safety changes. |
| `src/prompt-surfaces.ts` | Prompt fragments, source selection, role contracts, or offline handoff validators change. |
| `src/prompt-quality.ts` | Prompt metrics, static contracts, or repetition classifications change. |
| `src/prompt-model-evaluation.ts` | Model-decision packets, schemas, or graders change. |
| `src/config-shared.ts` | Command ids, hidden workers, permissions, or compiled prompt wiring changes. |
| `skills/**` | Planning, execution, validation, review, cleanup, UI, or commit guidance changes. |
| `tests/**` | Behavior and package contract coverage changes. |

`docs/architecture/allowed-cross-layer-dependencies.md` states the inward import
rule. `tests/architecture-boundaries.test.ts` rejects legacy source trees and
imports from inner layers to infrastructure or platform code.

## Local loop

```bash
bun run typecheck
bun run lint
bun run prompt:quality
bun test tests/runtime-gates.test.ts
bun run check
```

Use the narrow test that matches the changed area during development. Prompt
changes must preserve all 18 static scenarios and 52 criteria. Update
`tests/fixtures/prompt-quality-baseline.json` only when a surface grows by more
than the larger of eight words or 2%, and record a specific justification. Run
`bun run check` before handing work off or preparing a release.

## Review and merge

The CI workflow in `.github/workflows/ci.yml` runs actionlint, checks on Ubuntu
and macOS across Node 24 and 26, runs a pinned OpenCode 1.18.3 live smoke on
Ubuntu Node 24, and runs a blocking Windows check. A non-blocking scheduled
job probes the latest OpenCode release separately. The release workflow reruns
checks and package smoke before publishing.

Related pages: [Tooling](tooling.md), [Deployment](../deployment.md), and [Source map](../reference/source-map.md).
