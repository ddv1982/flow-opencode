# Troubleshooting

## Flow commands are missing

Rerun OpenCode's exact-version npm plugin command:

```bash
opencode plugin opencode-plugin-flow@6.2.0 --global --force
```

Or confirm that the relevant `opencode.json` contains the exact npm plugin
entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@6.2.0"]
}
```

Restart OpenCode and inspect its plugin-loading logs. Flow has no installer,
cache cleaner, or configuration-repair CLI. Follow the official
[OpenCode plugin documentation](https://opencode.ai/docs/plugins/) for npm or
configuration failures.

## Flow reports a duplicate runtime

More than one Flow copy loaded for the same project. Remove duplicate global,
project, local-file, or cached configuration entries, then restart OpenCode.
Flow deliberately disables every conflicting copy instead of choosing a
winner. Projects with only one copy remain independent.

## A mutation reports a stale revision

Run `/flow-status` and retry with the returned revision and a fresh operation ID.
Use the same operation ID only when replaying the exact same accepted request.

An exact replay identifies the same durable entity and returns its current
projection. It does not preserve a snapshot of how that entity looked when the
operation first succeeded.

## Flow cannot fingerprint the workspace

Flow requires a readable Git worktree because validation and review are bound
to effective Git workspace content. Initialize or repair Git before starting a
Flow session.

Tracked Git submodules are intentionally unsupported. Use one repository for a
Flow session, or run separate sessions inside the relevant repositories.

## Flow reports that the project lock is busy

Flow never steals `.flow/session.lock` automatically. First confirm that no
OpenCode or Flow process is still operating on the project. Only then remove
that exact lock directory manually and retry. Do not remove it merely because a
wait timed out; a live writer may still own it.

## Validation capture was cancelled

`flow_validation_start` arms the exact next Bash command. Any different Bash
command cancels capture. Arm it again, run the displayed command unchanged, and
wait for the `[flow-validation]` marker.

An armed capture expires if its matching command does not begin within 15
minutes. Once that exact command begins, it remains eligible for the after-hook
even when the command runs past the original waiting deadline. Do not re-arm a
long-running command that is already in progress.

An absent structured exit code, truncated output, nonzero exit, source edit, or
session/run change is recorded as unusable or fails closed. Run the final
command again after the workspace is stable.

## Review cannot start

Check execution status. The active run needs passing, complete validation for
the current workspace-content digest. The final feature needs broad validation.
There is only one review assignment per run; recover a pending assignment rather
than creating another.

## Completion says workspace content changed

The files changed after review started. Reset the feature, begin a fresh full
run, validate the final content, and request one new review. Flow does not reuse
a narrow correction result.

## A review blocked the feature

Inspect the blocking findings, fix the problem, then call
`flow_feature_reset`. Reset supersedes the old attempt and any dependent work;
the next run starts with no validation or review carried forward.

## The session cannot close as completed

Every planned feature must have a current passing run and no active work.
Inspect `/flow-status`, complete or reset the remaining feature, then close. Use
deferred or abandoned only when that is the intended terminal disposition.

## Status shows a closed session still awaiting archive publication

An interrupted close remains durably recorded in active state. Compact status
returns `nextAction: "flow_session_close"` and an `archiveRetry.request`. Replay
that request exactly. A fresh operation ID or the current closed revision is a
different request and is rejected.

## Session state is unreadable

Flow refuses to overwrite malformed state and attempts to quarantine it under
`.flow/`. Inspect the reported quarantine path. Restore a known-good Session v5
document only if its provenance is trusted; otherwise begin a new session after
preserving the file for diagnosis.

Do not hand-edit revision, operation, run, validation, review, or closure fields
to bypass a gate.

## Upgrading from Flow v5 or earlier

Flow v6 does not migrate active pre-v6 sessions. Finish or explicitly close the
session with its original Flow version before upgrading. Historical archives
may be retained as inert files, but Flow v6 does not load them to authorize
replay or continuation.
