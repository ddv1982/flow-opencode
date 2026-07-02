# Development workflow

Flow development is a standard Bun and TypeScript workflow with a small number of source boundaries. The key local loop is read, edit, run focused checks, then run `bun run check`.

## Branch and edit

The repo does not define a custom branch process in source files. Local work should preserve unrelated changes and avoid broad `.flow/**` staging, matching the Git safety guidance in `skills/flow-commit/SKILL.md`.

## Source ownership

| Path | Change here when |
| --- | --- |
| `src/runtime/**` | Session schema, transition gates, filesystem persistence, and tool-facing runtime API change. |
| `src/adapters/**` | OpenCode config, hooks, command preflight, or tool registration changes. |
| `src/distribution/**` | Managed skill sync, doctor, uninstall, or bundled skill imports change. |
| `src/config-shared.ts` | Command ids, hidden workers, permissions, or bundled command templates change. |
| `skills/**` | Planning, execution, validation, review, cleanup, UI, or commit guidance changes. |
| `tests/**` | Behavior and package contract coverage changes. |

`docs/architecture/allowed-cross-layer-dependencies.md` states the import rule: runtime does not import adapters or distribution, distribution does not import runtime behavior, adapters bind OpenCode to both, and `src/config-shared.ts` stays host-neutral.

## Local loop

```bash
bun run typecheck
bun run lint
bun test tests/runtime-gates.test.ts
bun run check
```

Use the narrow test that matches the changed area during development. Run `bun run check` before handing work off or preparing a release.

## Review and merge

The CI workflow in `.github/workflows/ci.yml` runs actionlint, checks on Ubuntu and macOS across Node 20, 22, and 24, runs a live OpenCode smoke on Ubuntu Node 22, and runs a non-blocking Windows check. The release workflow in `.github/workflows/release.yml` reruns checks and package smoke before publishing.

Related pages: [Tooling](tooling.md), [Deployment](../deployment.md), and [Source map](../reference/source-map.md).
