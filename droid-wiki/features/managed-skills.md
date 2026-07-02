# Managed skills

Active contributors: ddv1982

## Purpose

Managed skills make Flow installable as an OpenCode plugin without asking users to copy prompt files by hand. The source skill files live under `skills/`, are imported by `src/distribution/flow-skill-definitions.ts`, and are synced by `src/distribution/sync.ts`.

## Directory layout

```text
skills/
├── flow/
├── flow-plan/
├── flow-run/
├── flow-test/
├── flow-review/
├── flow-deslop/
├── flow-ui-quality/
└── flow-commit/
src/distribution/
├── flow-skill-definitions.ts
└── sync.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `FLOW_SKILL_DEFINITIONS` | `src/distribution/flow-skill-definitions.ts` | Bundled skill names and markdown files. |
| `syncFlowSkills` | `src/distribution/sync.ts` | Installs or updates Flow-owned skill folders. |
| `inspectFlowSkillInstall` | `src/distribution/sync.ts` | Produces doctor status for skill folders. |
| `formatFlowSkillDoctor` | `src/distribution/sync.ts` | Renders human-readable doctor output. |
| `uninstallFlowSkills` | `src/distribution/sync.ts` | Removes pristine Flow-owned skills and keeps user-edited folders. |

## How it works

Each managed folder gets a `.flow-skill-version` marker containing the plugin version and per-file SHA-256 hashes. During sync, Flow updates missing or outdated Flow-owned files, writes backups for edited files it owns, and skips foreign folders with no marker. `getFlowSkillSetupStatus` reports `restart_required`, `action_required`, or `sync_failed` through `flow_status`.

## Integration points

`FlowPlugin` in `src/adapters/opencode/plugin.ts` calls `runFlowSkillSync` at startup. The CLI in `src/cli.ts` exposes the same distribution system through `doctor`, `sync`, and `uninstall`.

## Key source files

| File | Purpose |
| --- | --- |
| `src/distribution/flow-skill-definitions.ts` | Imports bundled markdown as text and lists managed skills. |
| `src/distribution/sync.ts` | Sync, doctor, setup health, and uninstall implementation. |
| `src/cli.ts` | User-facing CLI for skill management. |
| `tests/distribution-and-surface.test.ts` | Managed skill and setup health tests. |

## Entry points for modification

Add a managed skill by adding source files under `skills/`, importing them in `src/distribution/flow-skill-definitions.ts`, and updating tests that assert the expected managed skill set. Keep foreign or edited folder handling conservative.

Related pages: [CLI and package](../systems/cli-and-package.md), [Configuration](../reference/configuration.md), and [OpenCode commands](../api/open-code-commands.md).
