# Tooling

Flow's tooling is deliberately small: Bun scripts, TypeScript, Biome, GitHub Actions, and an explicit legacy-cleanup CLI.

## Package scripts

| Script | Definition |
| --- | --- |
| `build` | `bun run build:plugin && bun run build:cli && bun run build:types` |
| `lint` | `bunx biome check src tests --files-ignore-unknown=true --vcs-use-ignore-file=true` |
| `test` | `bun test tests` |
| `typecheck` | `tsc --noEmit` |
| `check` | `bun run typecheck && bun run lint && bun run build && bun run test` |

These scripts are defined in `package.json`.

## TypeScript

`tsconfig.json` uses strict TypeScript settings, including `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters`. `tsconfig.types.json` builds declarations for the published package.

## Biome

`biome.json` enables formatting and recommended lint rules. `noConsole` is an error outside the allowed test and script areas, which is why adapter logging goes through `createFlowLog` in `src/platform/opencode/logging.ts`.

## GitHub automation

`.github/workflows/ci.yml` runs actionlint, matrix checks on Ubuntu and macOS, a live OpenCode smoke, and a non-blocking Windows check. `.github/workflows/release.yml` validates tags, changelog, install pins, checks, package smoke, npm publishing, and GitHub release assets.

## Flow CLI

The CLI in `src/cli.ts` implements only:

- `opencode-plugin-flow legacy-cleanup --dry-run`
- `opencode-plugin-flow legacy-cleanup --apply`

The command calls `cleanupLegacySkills` from `src/distribution/legacy-cleanup.ts`. Dry-run makes no writes; apply moves only pristine marker-owned folders to a recovery archive and never deletes them.

Related pages: [CLI and package](../systems/cli-and-package.md), [Configuration](../reference/configuration.md), and [Deployment](../deployment.md).
