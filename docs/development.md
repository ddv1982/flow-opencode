# Development

Flow v4 is intentionally small. The canonical local gate is:

```bash
bun install
bun run check
```

`bun run check` runs typecheck, Biome, build, and the focused test suite.

## Architecture

```text
OpenCode command / skill-guided agent
  -> seven Flow tools
  -> runtime transitions
  -> locked atomic .flow/session.json write
```

The skills are the product experience. The runtime is only the ledger and hard gate layer.

## Editing Skills

Skills are source files under `skills/<name>/`. On plugin startup they sync to `~/.config/opencode/skills/<name>/` with a `.flow-skill-version` marker.

Skill changes should preserve the v4 tool surface:

- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Do not teach direct `.flow/**` edits.
