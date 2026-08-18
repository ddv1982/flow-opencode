# Troubleshooting

## Flow commands are missing

Rerun OpenCode's exact-version npm plugin command:

```bash
opencode plugin opencode-plugin-flow@8.0.0 --global --force
```

Or confirm that the relevant `opencode.json` contains the exact npm plugin
entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-plugin-flow@8.0.0"]
}
```

Restart OpenCode and inspect its plugin-loading logs. Flow has no installer,
cache cleaner, or configuration-repair CLI. Follow the official
[OpenCode plugin documentation](https://opencode.ai/docs/plugins/) for npm or
configuration failures.

## `/flow-auto` stops after every feature

Continuation is anchored to the assistant message that owns the lease, so a host
that reports no assistant message parentage cannot carry it. Flow says so at
`/flow-auto` startup when it has observed that, and `flow_status` reports
`autoContinuation.support`. Nothing is broken: drive each feature with `/flow-run`.

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

Pending-review status also fails closed when it cannot fingerprint the current
workspace. Repair fingerprinting before recovery; do not redispatch the review
until Flow can check its source binding.

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

`recordedRevision` is only a concurrency token. When the marker reports
`passed: true`, use that revision for `flow_review_start` only if every runtime
review gate still holds; it may also arm the next validation. A `passed: false`
marker—failed, incomplete, or source-drifted—may use its revision only to arm
fresh validation, never review. No status refresh is needed solely to recover an
eligible token. Refresh compact status if the marker is missing or malformed,
the capture was rejected, or routing state must be reconfirmed.
`ineligibleReason: "source-drift"` means the digest recomputed at persistence
differed from the armed digest, so the result was recorded but is not passing
evidence. This endpoint comparison cannot detect a transient edit that returns
to the armed bytes before persistence.
`exit-code-unavailable` and `output-completeness-unknown` mean the host reported
no structured exit code or truncation flag. The observation is still recorded and
never passes, so such a host degrades visibly instead of failing the capture. To
get passing validation there, wrap the gate in a command whose exit code the host
does surface.
Returning the workspace to an older digest does not revive a pass recorded
before that drift. New review admission needs a current-source pass recorded
after the latest relevant failed or source-drifted observation. A review that
Flow already accepted remains grandfathered.

An armed capture expires if its matching command does not begin within 15
minutes. Once that exact command begins, it remains eligible for the after-hook
even when the command runs past the original waiting deadline. Do not re-arm a
long-running command that is already in progress.

An absent structured exit code, truncated output, nonzero exit, persistence-time
digest mismatch, or session/run change is recorded as unusable or fails closed.
Run the final command again after the workspace is stable.

## Validation was refused for claiming broad scope

Two rules refuse the claim, and the message names which. A command that selects
which tests it runs — by test file or by test-name filter — cannot be broad at all;
record it as `focused`. Any command other than the plan's declared `gate` is refused
because the plan already answered what breadth means for this repository. Arm the
declared gate, or record this command as focused.

The plan is immutable, so a gate that turns out to be wrong cannot be edited: finish
or explicitly close the session, then plan again with the right command. A gate that
genuinely cannot run in this environment is a blocker to report, not a reason to
relabel something smaller.

## Review cannot start

Check execution status. The active run needs passing, complete validation for
the current workspace-content digest. The final feature needs broad validation.
There is only one review assignment per run; recover a pending assignment rather
than creating another.

## Completion says workspace content changed

The files changed after review started. Reset the feature, begin a fresh full
run, validate the final content, and request one new review. Do not redispatch
the source-stale assignment; Flow does not reuse a narrow correction result.

## A review blocked the feature

Inspect the blocking findings and the compact failed-review count. A feature
whose latest relevant reviewed outcome remains failed is not selected
implicitly. `/flow-auto` may continue an untouched dependency-independent
feature; if only retry-required candidates remain, status is ready and projects
`await-user-direction`.

If status is blocked, call `flow_feature_reset` after the retry or independent
feature is authorized, with that exact feature as optional `nextFeatureId`.
Reset supersedes the failed attempt and affected dependent work, then starts the
chosen run atomically with no validation or review carried forward. Do not
perform reset first and rely on a later default `flow_run_start`; interruption
between those operations could lose the user's exact choice.

If status is ready with `await-user-direction`, the failed run was already
superseded while independent and untouched work continued. Read detail once to
identify the exact retry-required feature, then call `flow_run_start` with its
explicit `featureId` after user authorization. Do not call
`flow_feature_reset`: there is no blocked run left, and the failed feature
remains ineligible for default selection.

## The session cannot close as completed

Every planned feature must have a current passing run and no active work.
Inspect `/flow-status`, complete or reset the remaining feature, then close. Use
deferred or abandoned only when that is the intended terminal disposition.

## Status shows a closed session still awaiting archive publication

An interrupted close remains durably recorded in active state. Compact status
returns `nextAction: "flow_session_close"` and an `archiveRetry.request`. Replay
that request exactly once. A fresh operation ID or the current closed revision
is a different request and is rejected. The replay confirms the existing active
document without rewriting it and re-confirms archive publication and cleanup.

If the response instead sets `manualRecoveryRequired`, Flow found conflicting
active or archived state. It deliberately returns no `archiveRetry`. Preserve
both documents, inspect the collision, and do not overwrite, delete, or loop the
close request automatically.

## Session state is unreadable

Flow refuses to overwrite malformed state and attempts to quarantine it under
`.flow/`. Inspect the reported quarantine path. Restore a known-good Session v5
document only if its provenance is trusted; otherwise begin a new session after
preserving the file for diagnosis.

Do not hand-edit revision, operation, run, validation, review, or closure fields
to bypass a gate.

## Upgrading from Flow v5 or earlier

Flow does not migrate active pre-v6 sessions. Finish or explicitly close the
session with its original Flow version before upgrading. Historical archives
may be retained as inert files, but Flow does not load them to authorize
replay or continuation.
