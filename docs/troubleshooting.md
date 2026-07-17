# Troubleshooting Flow setup

Flow v5 loads its command and helper guidance directly from the installed
plugin package. Plugin startup never writes to `~/.config/opencode/skills`, so
there is no skill sync, setup-health state, or second-restart requirement.

## Install and update

Install or replace the pinned plugin version:

```bash
opencode plugin opencode-plugin-flow@5.0.0 --global --force
```

Start or restart OpenCode once after changing the installed package. Core
command instructions are compiled into the plugin, and optional guides are
returned by `flow_guidance` using stable ids such as `flow-test` or
`flow-ui-quality/references/ui-rubric.md`.

If your OpenCode version does not expose `opencode plugin`, replace the existing
Flow entry in `opencode.json` instead of adding a duplicate:

```json
{
  "plugin": ["opencode-plugin-flow@5.0.0"]
}
```

## Guidance is unavailable

If `flow_guidance` is missing, the Flow plugin did not load completely. Check
the OpenCode plugin configuration and startup log, then restart OpenCode. Do
not copy Flow Markdown into the global skill directory as a repair: that creates
a second, independently versioned instruction source.

If one stable guidance id is rejected, the requesting prompt and installed
package are inconsistent. Confirm the pinned package version and reinstall it.
`flow_status` intentionally contains workflow state only; it no longer reports
distribution or restart health.

## Remove v4 global Flow skills

Versions before v5 could copy Flow skills into
`~/.config/opencode/skills`. They are not used by v5 and may shadow unrelated
future guidance. Preview migration explicitly:

```bash
npx -y opencode-plugin-flow@5.0.0 legacy-cleanup --dry-run
```

Apply only after reviewing the report:

```bash
npx -y opencode-plugin-flow@5.0.0 legacy-cleanup --apply
```

The command never deletes a folder. It moves only marker-proven Flow folders to
`~/.config/opencode/flow-legacy-skills/`, outside OpenCode skill discovery, then
verifies them again before reporting success. Foreign folders, edited files,
extra files, malformed markers, regular files in place of directories, and
symbolic links are refused and left untouched. If content changes during the
move, it remains quarantined at the printed recovery path.

## Stuck session state

- **"Timed out waiting for Flow session lock"**: another OpenCode session may
	 be using the workspace. Flow deliberately does not steal locks based on age
	 or process-liveness guesses. If the recorded owner has definitely ended,
	 inspect `.flow/session.lock/owner.json` before removing the lock directory.
- **Unreadable session file**: if `.flow/session.json` is corrupt or from an
  unsupported plugin version, a Flow tool call quarantines it into
  `.flow/history/quarantine-*.json` and tells you how to start fresh. Nothing
  is silently deleted.

## Uninstall

Remove `opencode-plugin-flow` from OpenCode configuration and restart OpenCode.
Flow v5 has no global runtime files to uninstall. Workspace `.flow/` state is
project data and is never removed by the package CLI. Use `legacy-cleanup` only
for old global skill folders as described above.
