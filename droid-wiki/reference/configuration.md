# Configuration

Flow configuration is split between package scripts, OpenCode plugin config injection, environment variables, and CI workflows.

## OpenCode config injection

`applyFlowConfig` in `src/config-shared.ts` mutates OpenCode config by adding:

- hidden worker agents from `FLOW_CORE_AGENTS`,
- public commands from `FLOW_CORE_COMMANDS`.

The config hook performs no workspace filesystem I/O and leaves
`config.instructions` unchanged.

If a user already defines one of Flow's reserved command or agent ids, `createConfigHook` in `src/platform/opencode/config.ts` logs a warning and Flow replaces it while the plugin is enabled.

## Environment variables

| Variable | Purpose | Source |
| --- | --- | --- |
| `FLOW_LIVE_SMOKE=1` | Enables the live OpenCode smoke test. | `package.json`, `tests/live-opencode-smoke.test.ts` |
| `HOME` / `USERPROFILE` | Used only by the explicit legacy-cleanup CLI to locate old global folders. | `src/distribution/legacy-cleanup.ts` |

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
| `src/prompt-surfaces.ts` | Role/phase-specific prompt compilation and offline handoff validators. |
| `src/prompt-quality.ts` | Prompt inventory metrics and static scenario contracts. |
| `src/prompt-model-evaluation.ts` | Opt-in model-decision packets, schemas, and graders. |
| `src/config-shared.ts` | Config entries for commands and agents. |
| `src/platform/opencode/config.ts` | Runtime config hook. |
| `src/platform/opencode/plugin.ts` | Stable plugin hooks and command preflight. |
| `src/distribution/legacy-cleanup.ts` | Old-folder and recovery-archive resolution for the CLI. |

Related pages: [OpenCode commands](../api/open-code-commands.md), [Parallel orchestration](../features/parallel-orchestration.md), and [Tooling](../how-to-contribute/tooling.md).
