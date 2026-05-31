# OpenCode Plugin Rebuild Registry/Stability Notes — 2026-05-31

Scope: Work Items 7–8 from `docs/plans/opencode-plugin-rebuild-2026-05-31.md`.

## Item 7 consumer inventory

Inventory taken before cleanup:

| Surface | Consumers found | Decision |
| --- | --- | --- |
| `src/adapters/opencode/tool-guidance.generated.ts` | Production import from `src/adapters/opencode/plugin.ts` for the `tool.definition` hook; current-doc references | Keep as a thin registry projection. It now reads `OPENCODE_TOOL_REGISTRY` directly and renders optional core summaries through `core-action-projection.ts`. |
| `src/adapters/opencode/tool-projections.generated.ts` | Only the guidance module plus parity tests/current docs; no package export or direct production runtime consumer | Removed. The production guidance consumer now projects directly from the registry. Tests were rewritten around registry/runtime/schema consistency. |
| `src/adapters/opencode/tool-surface/docs-rows.generated.ts` | `tests/docs-tool-parity.test.ts` and `tests/descriptor-family-parity.test.ts` only | Removed. Docs rows are projected inline from registry `docsRowMetadata` in parity tests. |
| `src/adapters/opencode/tool-surface/descriptors.ts` | `tests/descriptor-family-parity.test.ts` and two focused schema tests only; current docs referenced it as an authority | Removed. Parity now compares `OPENCODE_TOOL_REGISTRY` directly with runtime tool registration, runtime action catalogs, mode contracts, docs rows, and schema owners. Current docs now name the registry as authority. |

Historical docs under `docs/investigations/**`, `docs/releases/**`, and `CHANGELOG.md` may still mention old descriptor/projection files as archive evidence.

## Item 8 stability notes

- Package/install surfaces remain unchanged: `opencode-plugin-flow`, `dist/index.js`, `exports["."] = "./dist/index.js"`, and canonical plugin file `~/.config/opencode/plugins/flow.js`.
- Generated skill path remains `~/.config/opencode/skills/<flow-skill>/SKILL.md`; generated skills remain `flow-plan`, `flow-run`, and `flow-review`.
- No dependency changes were made. `@opencode-ai/plugin` and `zod` alignment remains covered by `tests/config/tool-schemas.test.ts`.
- User-managed plugin/skill overwrite safety remains in `src/installer.ts` and `src/adapters/opencode/skill-bundle.ts`; install lifecycle tests still cover refusal/rollback paths.
- Tool arg schemas were not widened. Runtime-owned payload schemas still import runtime schemas and strict unknown-key coverage remains in `tests/config/tool-schemas.test.ts`.
