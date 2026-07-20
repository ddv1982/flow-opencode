# Troubleshooting Flow setup

Flow v5 loads its command and helper guidance directly from the installed
plugin package. Plugin startup never writes to `~/.config/opencode/skills`, so
there is no skill sync, setup-health state, or second-restart requirement.

## Install and update

Install npm's latest release as the one exact active version, then verify it:

```bash
npx -y opencode-plugin-flow@latest install \
  --project "$PWD" --scope global
```

`install` applies immediately. It uses the fetched package's embedded exact
version, refuses a downgrade when a newer installed Flow is detected, removes
recognized older activation entries, and permanently deletes proven obsolete
Flow wrappers and OpenCode package-cache artifacts. Its internal final check
must say `satisfied`; it uses the same embedded exact target and requires one
target activation, one total Flow activation source, and no proven inactive
Flow cache artifact. Do not run a second `@latest` command for that verification,
because npm could resolve it to a newer release. Use `--scope project` for a
project-local canonical pin. Do not retain a global and project copy together.

Coverage is global sources plus the selected `--project`; unrelated project
trees are not scanned. Run install separately from every project that contains
project-local OpenCode configuration. A successful install for one selected
project makes no claim about a different project's config.

For a read-only preview, invoke an exact package version with
`activation-apply` and omit `--apply`. An explicit `--target` also accepts only
an exact semantic version; tags and ranges are refused rather than resolved
implicitly.

Start or restart OpenCode once after activation changes. Core command
instructions are compiled into the plugin, and optional guides are returned by
`flow_guidance` using stable ids such as `flow-test` or
`flow-ui-quality/references/ui-rubric.md`.

`activation-check` inventories readable OpenCode global, project,
`.opencode`, custom, inline, and managed JSON/JSONC configuration; singular and
plural plugin directories; and package-cache artifacts. Authenticated remote
configuration and some managed preferences cannot be decoded offline. They are
reported as limitations, and project-scoped runtime leadership is the final
fail-closed duplicate guard.

## Activation was refused

Refusal means Flow could not prove that automatic mutation was safe. The report
names the exact source and reason. Common cases are:

- an unmarked, edited, absent, oversized, or symbolic-link local Flow wrapper;
- malformed or unsafe JSON/JSONC, plugin directories, or path ancestors;
- a JSONC file that contains a Flow entry requiring mutation (inventory is
  supported, but apply refuses lossy comment-stripping rewrites);
- a cache artifact whose nested package manifest does not prove its identity;
- Flow entries supplied by `OPENCODE_CONFIG_CONTENT`, administrator-managed
  config, or another source outside the chosen canonical scope.

Do not delete an entire config, plugin directory, or OpenCode cache. Remove or
repair only the reported Flow entry after inspecting it, then repeat the
dry-run. A manual config repair retains unrelated entries and ends with exactly
one exact pin, for example:

```json
{
  "plugin": ["opencode-plugin-flow@5.3.4"]
}
```

An applied activation writes owner-restricted config backups and
`flow-activation-journal-v2` under the printed recovery path before changing
recognized sources. Proven obsolete wrappers and cache artifacts are moved to
run-scoped staging while config changes are verified. A failed activation moves
them back; a successful installation permanently deletes them before reporting
success. A `rolled-back` journal means the recorded mutations were restored;
rerun `activation-check` before retrying. A `rollback-failed` journal means a
concurrent edit or another safety condition prevented exact restoration. A
`cleanup-failed` journal means the newest activation was committed but permanent
deletion did not finish; follow its narrow staging-path guidance without
restoring an older activation. Never treat an incomplete journal as permission
to remove ambiguous content. A later `install` inspects v2 journals before
planning: it safely rolls back an interrupted pre-commit run or finishes
verified deletion for a committed run. `activation-check` remains read-only and
reports any unresolved journal as blocking.

## Duplicate runtime leadership error

When more than one Flow runtime registers for the same OpenCode project context,
that project's Flow commands and tools fail closed. A global plugin is normally
initialized once for every open project; those independent project instances do
not conflict. The diagnostic reports every conflicting identity in the affected
project and labels one deterministic highest-semantic-version copy as the
diagnostic leader. That label is not authority: no conflicting copy operates
until only one remains.

Close OpenCode, run `activation-check` for the affected project, converge config
and proven cache/wrapper state with `activation-apply`, resolve any reported
remote or managed source with its owner, then restart. Do not work around the
guard by selecting a lower or higher loaded copy in the running process.

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
npx -y opencode-plugin-flow@5.3.4 legacy-cleanup --dry-run
```

Apply only after reviewing the report:

```bash
npx -y opencode-plugin-flow@5.3.4 legacy-cleanup --apply
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
- **The pinned filesystem helper cannot start**: install Flow 5.2.1 or newer
  and restart OpenCode. Preserve `.flow/session.json` and `.flow/history`, then
  retry the exact `closure.retryOperationId` exposed by compact status; a helper
  runtime failure is not evidence that canonical history is corrupt.
- **Archive publication interrupted**: call
  `flow_status { request: { view: "compact" } }`, read the complete
  `closure.retryOperationId`, and call
  `flow_session_close { request: { mode: "retry", operationId } }`. Do not
  recreate the original summary or causal guards.
- **Timestamp chronology rejected**: preserve the runtime-attested validation
  interval and a truthful reviewer-reported completion time. They must follow
  active-execution start, validation, review-assignment start, and result order,
  and cannot postdate runtime acceptance.
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

## Validation receipt was rejected

- **No receipt marker appeared**: the armed command must be the exact next Bash
  call in the same OpenCode session. Any command mismatch cancels capture. Idle
  or compaction also cancels an uncompleted capture.
- **Structured exit status unavailable**: Flow requires OpenCode's structured
  Bash `metadata.exit`; text that merely says a command passed is not evidence.
- **Incomplete receipt**: truncated or unknown output, or any nonzero exit,
  cannot become review evidence. Rerun a command whose complete host result is
  observable.
- **Stale or wrong scope**: capture again after the latest source edit and for
  the active feature run. Final review requires a `broad` or `artifact`
  coverage receipt.
- **Missing or altered artifact**: receipt refs are exact digest-and-length
  identities in `.flow/evidence/**`. Preserve the workspace, rerun validation,
  and pass the newly emitted reference; do not hand-edit restricted artifacts.

Rejected review start remains mutation-free and leaves its operation id
unconsumed, so a corrected request may reuse the same id.

## Correction review fell back to full review

`correctionOfAssignmentId` must name the immediately preceding recorded failure
for the same active run, review kind, and logical pass. Flow derives the source
manifest delta itself. It deliberately selects full review when the review is
final/broad, source metadata changed, the delta touches security or persistence,
the correction request declares known `public-contract` or `cross-layer` scope,
or required manifests/delta/projection context are missing, unavailable, or too
large. `correctionScopeHint` is valid only beside `correctionOfAssignmentId`, and
can only elevate to full. This is safe fallback, not lost reviewer state.

Same-source correction is accepted only for an `evidence_gap` blocker with
genuinely distinct validation evidence. An implementation defect requires a
source change. After two accepted failed reviews in one feature run, the retry
budget is exhausted; continue only through explicit reset or replan direction.

## Uninstall

Remove `opencode-plugin-flow` from OpenCode configuration and restart OpenCode.
Run `activation-check` to find every remaining recognized source instead of
assuming one config file was sufficient. Flow v5 has no global runtime files to
uninstall. Workspace `.flow/` state is project data and is never removed by the
package CLI. Use `legacy-cleanup` only for old global skill folders as described
above.
