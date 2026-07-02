# Skill distribution

Active contributors: ddv1982

## Purpose

Skill distribution copies the bundled Flow markdown skills into OpenCode's skills root and reports whether the running OpenCode process needs a restart or user action. It is implemented in `src/distribution/sync.ts` and uses bundled text imports from `src/distribution/flow-skill-definitions.ts`.

## Directory layout

```text
src/distribution/
├── sync.ts
├── flow-skill-definitions.ts
└── markdown-modules.d.ts
skills/
└── <managed-skill>/
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `resolveFlowSkillsRoot` | `src/distribution/sync.ts` | Resolves `~/.config/opencode/skills`. |
| `runFlowSkillSync` | `src/distribution/sync.ts` | Startup sync with health tracking. |
| `getFlowSkillSetupStatus` | `src/distribution/sync.ts` | Converts sync health into runtime setup status. |
| `inspectFlowSkillInstall` | `src/distribution/sync.ts` | Doctor report for all managed skills. |
| `FLOW_SKILL_DEFINITIONS` | `src/distribution/flow-skill-definitions.ts` | Managed skill file manifest. |

## How it works

`syncSkill` compares source file content against existing managed skill files and marker hashes. It installs missing Flow-owned files, updates outdated files, backs up edited Flow-owned files, and skips foreign folders. Doctor output lists sync-repairable skills, action-required skills, and unmanaged Flow-like folders.

## Integration points

`src/adapters/opencode/plugin.ts` calls `runFlowSkillSync` at startup. `src/adapters/opencode/tools.ts` includes setup status in `flow_status`. `src/cli.ts` exposes the same distribution logic for manual `doctor`, `sync`, and `uninstall`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/distribution/sync.ts` | Sync, setup health, doctor, and uninstall implementation. |
| `src/distribution/flow-skill-definitions.ts` | Bundled skill list. |
| `src/distribution/markdown-modules.d.ts` | Type declaration for markdown text imports. |
| `tests/distribution-and-surface.test.ts` | Distribution behavior tests. |

## Entry points for modification

Update `src/distribution/flow-skill-definitions.ts` when managed skill files change. Update `src/distribution/sync.ts` when marker, backup, doctor, or uninstall behavior changes. Keep setup status compatible with [Flow tools](../api/flow-tools.md).

Related pages: [Managed skills](../features/managed-skills.md), [CLI and package](cli-and-package.md), and [Debugging](../how-to-contribute/debugging.md).
