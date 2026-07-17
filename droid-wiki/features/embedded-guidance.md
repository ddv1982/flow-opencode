# Embedded guidance

Active contributors: ddv1982

## Purpose

Flow packages its planning, execution, validation, review, cleanup, UI, and Git
guidance as embedded Markdown. Users install one plugin package; Flow never
copies instruction files into OpenCode's global skill registry.

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
src/guidance/
├── ids.ts
└── catalog.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| `FLOW_GUIDANCE_IDS` | `src/guidance/ids.ts` | Stable ids accepted by the plugin tool. |
| `FLOW_GUIDANCE_DOCUMENTS` | `src/guidance/catalog.ts` | Typed embedded Markdown documents. |
| `getFlowGuidance` | `src/guidance/catalog.ts` | Exact id lookup used by `flow_guidance`. |
| `flow_guidance` | `src/platform/opencode/tools.ts` | Read-only progressive disclosure for managers. |

## How it works

The catalog imports each Markdown file with a text import. Bun embeds those
strings in `dist/index.js`. Public commands compile selected core sections from
the same catalog, while optional helpers and references are retrieved on demand
by stable id. Hidden workers deny `flow_guidance` through `flow_*`; their
role-specific prompt already contains the bounded material they need.

Plugin initialization performs no global skill reads or writes. There are no
markers, backups, setup status, sync races, or restart-after-sync behavior.
`tests/package-smoke.test.ts` proves content is in the tarball, and
`tests/distribution-and-surface.test.ts` proves concurrent initialization leaves
hostile links untouched.

## Entry points for modification

Add or edit source Markdown under `skills/`, then update the id list in
`src/guidance/ids.ts` and import table in `src/guidance/catalog.ts`. Keep ids stable once published and update
prompt/compiler tests when a core section changes.

Related pages: [CLI and package](../systems/cli-and-package.md), [Configuration](../reference/configuration.md), and [OpenCode commands](../api/open-code-commands.md).
