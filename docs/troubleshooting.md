# Troubleshooting Flow setup

Flow v5 loads its command and helper guidance directly from the installed
plugin package. Plugin startup never writes to `~/.config/opencode/skills`, so
there is no skill sync, setup-health state, or second-restart requirement.

## Install and update

Install or replace the pinned plugin version:

```bash
opencode plugin opencode-plugin-flow@5.2.0 --global --force
```

Start or restart OpenCode once after changing the installed package. Core
command instructions are compiled into the plugin, and optional guides are
returned by `flow_guidance` using stable ids such as `flow-test` or
`flow-ui-quality/references/ui-rubric.md`.

If your OpenCode version does not expose `opencode plugin`, replace the existing
Flow entry in `opencode.json` instead of adding a duplicate:

```json
{
  "plugin": ["opencode-plugin-flow@5.2.0"]
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
npx -y opencode-plugin-flow@5.2.0 legacy-cleanup --dry-run
```

Apply only after reviewing the report:

```bash
npx -y opencode-plugin-flow@5.2.0 legacy-cleanup --apply
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
- **Malformed Session v4 file**: Flow rejects state that fails strict JSON,
  schema, or relational-invariant checks. Preserve the file for inspection and
  restore a known-good Session v4 document; Flow never repairs malformed state
  by guessing.
- **Different session version**: only Session v4 can become active state or
  canonical history. Flow rejects every other version as generic unsupported
  input and provides no migration or version-specific recovery path.
- **A different goal is already open**: `flow_plan_save` never archives or
  replaces an unclosed session, even when its draft is unapproved. Close
  unfinished work explicitly as `deferred` or `abandoned`, finish archive
  publication, then save the new goal. Completed progress requires a
  `completed` close.
- **Archive publication interrupted**: call
  `flow_status { request: { view: "compact" } }`, read the complete
  `closure.retryOperationId`, and call
  `flow_session_close { request: { mode: "retry", operationId } }`. Do not
  recreate the original summary or causal guards.
- **Timestamp chronology rejected**: preserve truthful reported times. They must
  follow active-execution start, validation, review-assignment start, and result
  order, and cannot postdate runtime acceptance.
- **Final-review retry lost its prerequisite**: for an unchanged source, call
  `flow_status { request: { view: "detail" } }` and copy
  `workflowData.projection.finalReviewRetry.prerequisite.result` unchanged into
  the next final review start's `request.featureReview`. Compact and reviewer
  status omit it. A mismatch leaves the operation id reusable. If source
  changed, rerun targeted feature review before broad validation.
- **Close operation id collision**: an unaccepted close start must use an id
  absent from the active causal chain and every mutation in canonical Session
  v4 workspace history. If canonical history is malformed, unsupported,
  filename-mismatched, closureless, or ambiguous, preserve and repair it before
  retrying; quarantine files are never retry sources. A Session v4 document
  cannot be canonical history until explicit close has recorded non-null
  closure.

## Uninstall

Remove `opencode-plugin-flow` from OpenCode configuration and restart OpenCode.
Flow v5 has no global runtime files to uninstall. Workspace `.flow/` state is
project data and is never removed by the package CLI. Use `legacy-cleanup` only
for old global skill folders as described above.
