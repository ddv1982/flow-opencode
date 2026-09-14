# Release operations

## Implemented

PR #73 merged the one-request draft fix. The remaining implementation adds
persistent dispatch authorization, a shared release record, and restart recovery.
No paid evals or canaries ran during implementation.

`EvalHost` guards probes, slash commands, and ordinary prompts immediately before
model dispatch. The eval, legacy benchmark, and study CLIs check authorization
before host preparation. `canary-run.ts` guards the supported prepared-fixture
launcher. Prepare, record, replay, grade, and release commands remain offline
with respect to model providers.

Each dispatch claims one immutable numbered file before work starts. Exclusive
file creation bounds concurrent processes. Files survive failure and restart,
and consumption has no automatic refund. Complete JSON is linked into place
atomically after flushing its bytes. POSIX directory entries are flushed too.
Windows retains process-restart protection, without a power-loss guarantee.

A dispatch is one top-level probe, command, prompt, or canary launch. It is not
one scenario, token, dollar, internal model turn, or reviewer session. A command
can start several internal model requests. Existing campaign limits remain in
force. The dispatch budget adds a start limit, not a billing ceiling.

The ledger is an operator guard against accidental repeats. It is not a sandbox
against a process that can edit its files. Direct OpenCode calls and old ad hoc
launch scripts bypass it. Use the maintained launchers and preserve the ledger.

## Authorize paid work

Only create an authorization after the operator approves its purpose, models,
dispatch count, and expiry. This example names placeholders, not an approval.

```sh
bun run scripts/paid-budget.ts authorize .paid-budget \
  --models provider/model --max-dispatches COUNT \
  --purpose 'APPROVED PURPOSE' --expires FUTURE_ISO_TIMESTAMP
export FLOW_EVAL_AUTHORIZATION="$PWD/.paid-budget"
bun run scripts/paid-budget.ts status .paid-budget
```

Keep the same directory across retries. Authorization cannot overwrite an
existing ledger. Creating another directory is a new authorization decision.

For a prepared canary, use the existing fixture setup and then:

```sh
bun run scripts/canary-run.ts path/to/prepared.json provider/model prompt.txt
```

The launcher validates preparation bindings and packed/plugin bytes before
consumption. A failed or interrupted launch stays consumed. Recording the
result remains a separate offline command.

Scheduled CI requires `FLOW_EVAL_AUTHORIZE_SCHEDULE=true` and
`FLOW_EVAL_MAX_DISPATCHES`. Manual dispatch requires `max_dispatches`.
A workflow attempt after the first cannot start paid work. Launching a new
workflow run is a new budget decision. CI retains the ledger with report
artifacts. Model configuration and credentials alone no longer authorize a run.

## Recovery

The release workflow verifies retained qualification and canary evidence offline.
Its pinned OpenCode smoke does not call a model provider. Evidence must still
meet freshness and exact-artifact policy. Expiration stops publication for an
explicit decision and never starts a paid rerun.

```sh
bun run scripts/release.ts init .release-state \
  --artifact opencode-plugin-flow-VERSION.tgz \
  --canary evals/canary/VERSION.json --commit COMMIT_SHA
bun run scripts/release.ts status .release-state
bun run scripts/release.ts resume .release-state
```

Initialization requires `GITHUB_REPOSITORY`. Resume also requires `GH_TOKEN` and
the existing GitHub tag-event environment used for ref verification.
`release.json` binds the repository, tag, commit, artifact, checksum, notes,
canary location, qualification bundle digest, and creation owner. The current
qualification verifier remains the authority. Resume rechecks it and the remote
npm/GitHub state even if local receipts claim completion.

Status reads local payloads and receipts without network access. Its next action
is a recovery hint, not a claim about current remote state.

The workflow saves the record and payload before the first publication request.
It restores that artifact on retries. A record from a previous workflow attempt
cannot create a draft from an empty listing. Locally, an exclusive creation
receipt prevents a second POST after a crash. Once the exact draft is visible,
resume adopts it and completes remaining assets/publication.

If a creation outcome remains unknown, inspect GitHub and the previous run.
Do not delete duplicate drafts automatically. If no creation happened, an
operator can explicitly initialize a new record after resolving the uncertainty.
Missing CI records fail closed. The durable artifact intentionally precedes
publication, so later receipts may exist only in runner storage; remote
reconciliation recovers them. An interruption before that artifact was saved
also requires an explicit recovery decision.

## Removed coordination

The old publisher CLI with separate `github-prepare`, `npm`, and `github-publish`
argument sets was removed. Its tested convergence functions remain the single
publication implementation. The workflow now passes one record directory to
initialization, status, and resume. Separate notes generation in the publication
job was removed. Historical qualification formats and evidence stay readable.

## Verification

Offline tests cover concurrent budget claims, exhaustion, corrupt records,
unauthorized dispatch, uncertain draft creation, repeated resume, partial
assets, changed payloads, and prior-CI-attempt records. Workflow checks preserve
publication ordering and the separation of paid work from release recovery.
The new initializer also verified the retained 8.3.0 tarball and evidence.
Its old seal correctly rejected the changed verifier source. Offline qualification
created a new seal in `.release-artifacts/release-operations-final-bundles` from the
original campaign and canary. Initialization then passed with that bundle.
The original campaign, published package, and tracked seal were unchanged.

When verifier-only changes require a new authority seal, run the existing
qualifier against retained evidence into a separate staging directory. Never
replace provider runs or weaken checks to resolve an authority mismatch.
Production plugin code, package version, and qualification thresholds are unchanged.

## Deferred product changes

Task-proportional workflows and prompt reductions change agent behavior. They
remain separate from release operations and need their own evidence.
