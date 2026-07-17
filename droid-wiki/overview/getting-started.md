# Getting started

This repo uses Bun, TypeScript, Biome, and GitHub Actions. The package builds an OpenCode plugin entrypoint, a small CLI, and declaration files from the TypeScript sources in `src/`.

## Prerequisites

| Tool | Required by |
| --- | --- |
| Node.js `>=24` | `package.json` engine and TypeScript tooling. |
| Bun `1.3.14` | Pinned local scripts and builds in `package.json`. |
| OpenCode `>=1.18.3 <2` | Stable runtime host API for the published plugin. |
| npm | Release publishing and smoke-package consumption checks. |

## Install for local development

```bash
bun install
bun run check
```

`bun run check` runs `bun run typecheck`, `bun run lint`, `bun run prompt:quality`, `bun run build`, and `bun run test` in that order, as defined in `package.json`.

## Build outputs

| Script | Output |
| --- | --- |
| `bun run build:plugin` | Bundles `src/index.ts` to `dist/index.js`. |
| `bun run build:cli` | Bundles `src/cli.ts` to `dist/cli.js` with a Node shebang. |
| `bun run build:types` | Emits declarations from `tsconfig.types.json`. |
| `bun run build` | Runs all three build steps. |

## Install as an OpenCode plugin

The public install path in `README.md` is:

```bash
opencode plugin opencode-plugin-flow@5.0.0 --global --force
```

After restarting OpenCode, a user can start with `/flow-auto <goal>` or split the loop with `/flow-plan`, `/flow-run`, and `/flow-review`. The CLI commands behind the npm binary are implemented in `src/cli.ts`.

## Local validation commands

| Command | Scope |
| --- | --- |
| `bun run typecheck` | TypeScript check using `tsconfig.json`. |
| `bun run lint` | Biome check for `src` and `tests`. |
| `bun run test` | All Bun tests under `tests/`. |
| `bun run package:smoke` | Packed package and consumer import check. |
| `bun run smoke:live` | Real OpenCode server smoke, gated by `FLOW_LIVE_SMOKE=1`. |

Related pages: [Testing](../how-to-contribute/testing.md), [Tooling](../how-to-contribute/tooling.md), and [Deployment](../deployment.md).
