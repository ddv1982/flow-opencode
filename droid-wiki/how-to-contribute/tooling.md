# Tooling

Flow's tooling is deliberately small: Bun scripts, TypeScript, Biome, GitHub Actions, and the plugin's own CLI for managed skills.

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

`biome.json` enables formatting and recommended lint rules. `noConsole` is an error outside the allowed test and script areas, which is why adapter logging goes through `createFlowLog` in `src/adapters/opencode/logging.ts`.

## GitHub automation

`.github/workflows/ci.yml` runs actionlint, matrix checks on Ubuntu and macOS, a live OpenCode smoke, and a non-blocking Windows check. `.github/workflows/release.yml` validates tags, changelog, install pins, checks, package smoke, npm publishing, and GitHub release assets.

## Flow CLI

The CLI in `src/cli.ts` implements:

- `opencode-plugin-flow doctor`
- `opencode-plugin-flow sync`
- `opencode-plugin-flow uninstall`

Those commands call `inspectFlowSkillInstall`, `syncFlowSkills`, and `uninstallFlowSkills` from `src/distribution/sync.ts`.

Related pages: [CLI and package](../systems/cli-and-package.md), [Configuration](../reference/configuration.md), and [Deployment](../deployment.md).
