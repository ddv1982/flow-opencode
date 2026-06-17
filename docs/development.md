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
  -> stable OpenCode instructions from .flow/opencode-instructions.md
  -> seven Flow tools
  -> runtime transitions
  -> locked atomic .flow/session.json and instruction projection writes
```

The skills are the product experience. The runtime is only the ledger and hard gate layer.

The OpenCode adapter registers an absolute `.flow/opencode-instructions.md`
path through stable `config.instructions`. The file is generated from
`.flow/session.json`, refreshed on plugin config load and session saves, and
removed when the active session is archived. It replaces the older default of
injecting Flow context through OpenCode experimental chat or compaction hooks.
The path is registered even before the file exists so a session created later in
the same OpenCode process can be picked up without a config reload.

## Editing Skills

Skills are source files under `skills/<name>/`. On plugin startup they sync to `~/.config/opencode/skills/<name>/` with a `.flow-skill-version` marker.

Public install docs should prefer OpenCode's native installer when available and
use one pinned install-or-update command:
`opencode plugin opencode-plugin-flow@<version> --global --force`, followed by
`npx -y opencode-plugin-flow@<version> sync` before the next OpenCode startup.
Keep a manual `opencode.json` fallback for older OpenCode versions that do not
expose `opencode plugin`; that fallback should tell users to replace older
pinned Flow entries instead of adding duplicates.

When startup sync installs or updates managed skills, the running OpenCode
process may still have the old skill registry. Flow records that as sync health
and surfaces `restart_required` through `flow_status` and Flow command
preflight. Public Flow command preflight must still replace stale
resolved command bodies with bundled public command instructions, so
`flow-auto`, `flow-plan`, `flow-run`, and `flow-review` do not depend on native
skill discovery for the required loop. Use
`npx -y opencode-plugin-flow@<version> doctor` to inspect missing, foreign,
edited, or outdated managed skill folders. Use
`npx -y opencode-plugin-flow@<version> sync` to repair missing, incomplete, or
outdated Flow-owned skill folders, then restart OpenCode.

The managed skill set is `flow`, `flow-plan`, `flow-run`, `flow-test`,
`flow-review`, `flow-deslop`, `flow-ui-quality`, and `flow-commit`. Startup
sync, `doctor`, and `sync` must cover all eight uniformly. Foreign or edited
folders require a user decision and must not be overwritten silently.

Flow commands must call `flow_status` first. Public action commands embed the
required public Flow skill lore and must not native-load `flow`, `flow-plan`,
`flow-run`, or `flow-review`; synced skills remain the discoverable/manual form.
If status includes `setup.skills`, public action commands should report setup
state and continue with their bundled public instructions. Optional helpers
degrade to explicit coverage gaps; they are not copied into bundled fallback
prompts.

Skill changes should preserve the v4 tool surface:

- `flow_status`
- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Do not teach direct `.flow/**` edits.
