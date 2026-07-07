# Troubleshooting Flow setup

This page collects the install, update, and repair details that most users
never need. The short version: install the plugin, run `sync`, restart
OpenCode, and `/flow-status` tells you if anything is off.

## How skill sync works

On startup, the plugin syncs its managed skills into
`~/.config/opencode/skills/`:

```text
flow/  flow-plan/  flow-run/  flow-test/  flow-review/  flow-deslop/
flow-ui-quality/  flow-commit/
```

OpenCode scans the skill registry once per process. If Flow installs or
updates skills during a startup, that process may not see them yet — Flow
reports this through `flow_status` as `setup.skills.status: "restart_required"`.
Restart OpenCode once more and the refreshed registry is loaded.

Project-local skill overrides work through OpenCode's normal lookup:

```text
.opencode/skills/flow-plan/SKILL.md
```

## Doctor

Inspect the installed skill set at any time:

```bash
npx -y opencode-plugin-flow@4.3.4 doctor
```

For automation, opt into machine behavior explicitly:

```bash
npx -y opencode-plugin-flow@4.3.4 doctor --json
npx -y opencode-plugin-flow@4.3.4 doctor --check
```

`doctor --check` and `doctor --strict` exit nonzero when the health status is
`sync_required` or `action_required`; plain `doctor` is advisory and exits
successfully.

Setup states you may see:

- `restart_required`: startup sync changed skills; restart OpenCode before
  Flow skills load.
- `action_required`: a managed skill folder is foreign or user-edited. Flow
  will not overwrite it silently; move it aside to let Flow recreate it, or
  keep it deliberately as a local override. Doctor also reports
  `action_required` when a managed folder still holds Flow-created `.backup`
  files from earlier edits — for those, review and delete the `.backup` files
  themselves (do not move the whole folder aside) to clear the state.
- `sync_failed`: skill sync raised an error; skill instructions may be stale.

## Repairing skills

Missing, incomplete, or outdated managed skills are repaired with:

```bash
npx -y opencode-plugin-flow@4.3.4 sync
```

Then restart OpenCode. If a command reports `Skill "flow-review" not found`
or a similar skill-loading error after upgrading, it is usually an older
OpenCode process or a stale resolved command body. Public Flow commands are
self-contained: command preflight replaces resolved Flow command bodies with
the current bundled instructions, so `/flow-auto`, `/flow-plan`, `/flow-run`,
and `/flow-review` continue working even when native skill discovery lags.
Run `/flow-status` or `doctor` first, then `sync` and restart.

## Install fallback for older OpenCode versions

If your OpenCode version does not have `opencode plugin`, add Flow to your
OpenCode config manually:

```json
{
  "plugin": ["opencode-plugin-flow@4.3.4"]
}
```

When updating through this fallback, replace the older pinned entry instead of
adding a duplicate. Then run the pre-start skill sync and restart OpenCode:

```bash
npx -y opencode-plugin-flow@4.3.4 sync
```

Why `--force` in the recommended installer command: OpenCode keeps an existing
same-package plugin entry unless replacement is requested, so the flag avoids
leaving an older pinned version in your global `opencode.json`.

## Stuck session state

- **"Timed out waiting for Flow session lock"**: another OpenCode session may
  be using the workspace. If none is, the lock is left over from a crash; Flow
  expires stale locks automatically (dead process on the same host, or a lock
  older than ten minutes), and the error message names the exact directory to
  delete manually if needed.
- **Unreadable session file**: if `.flow/session.json` is corrupt or from an
  older plugin version, any Flow tool call quarantines it into
  `.flow/history/quarantine-*.json` and tells you how to start fresh. Nothing
  is deleted.

## Uninstall

First remove `opencode-plugin-flow` from your OpenCode plugin config so future
startups stop loading Flow. Then remove Flow-owned synced skills:

```bash
npx -y opencode-plugin-flow@4.3.4 uninstall --dry-run   # preview
npx -y opencode-plugin-flow@4.3.4 uninstall
```

Restart OpenCode after both steps. Uninstall removes Flow-owned skill folders
that are pristine — including folders whose only extra files are Flow-created
`.backup` copies of your earlier edits, which are deleted together with the
folder and named individually in the output. Folders that still contain your
own (non-backup) files, user-edited folders, and foreign skill folders are
kept. Run `uninstall --dry-run` first to preview exactly what is removed.
