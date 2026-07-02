# Configuration

Flow configuration is split between package scripts, OpenCode plugin config injection, environment variables, and CI workflows.

## OpenCode config injection

`applyFlowConfig` in `src/config-shared.ts` mutates OpenCode config by adding:

- hidden worker agents from `FLOW_CORE_AGENTS`,
- public commands from `FLOW_CORE_COMMANDS`,
- the generated `.flow/opencode-instructions.md` path when available.

If a user already defines one of Flow's reserved command or agent ids, `createConfigHook` in `src/adapters/opencode/config.ts` logs a warning and Flow replaces it while the plugin is enabled.

## Environment variables

| Variable | Purpose | Source |
| --- | --- | --- |
| `FLOW_EXPERIMENTAL_COMPACTION=1` | Enables the optional `experimental.session.compacting` hook. | `src/adapters/opencode/plugin.ts` |
| `FLOW_LIVE_SMOKE=1` | Enables the live OpenCode smoke test. | `package.json`, `tests/live-opencode-smoke.test.ts` |
| `HOME` / `USERPROFILE` | Used to resolve the OpenCode skills root. | `src/distribution/sync.ts` |

## Project config files

| File | Purpose |
| --- | --- |
| `package.json` | Scripts, package exports, binary, files, dependencies, peer dependencies. |
| `tsconfig.json` | Strict TypeScript settings for source and tests. |
| `tsconfig.types.json` | Declaration output settings. |
| `biome.json` | Format and lint rules. |
| `.github/dependabot.yml` | Weekly GitHub Actions and npm update config with manual ignores. |
| `.github/CODEOWNERS` | Ownership map for repo paths. |

## Key source files

| File | Purpose |
| --- | --- |
| `src/config-shared.ts` | Config entries for commands and agents. |
| `src/adapters/opencode/config.ts` | Runtime config hook. |
| `src/adapters/opencode/plugin.ts` | Experimental compaction opt-in. |
| `src/distribution/sync.ts` | Skills root resolution. |

Related pages: [OpenCode commands](../api/open-code-commands.md), [Parallel orchestration](../features/parallel-orchestration.md), and [Tooling](../how-to-contribute/tooling.md).
