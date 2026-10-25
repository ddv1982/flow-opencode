# OpenCode v2 core review, round 4

Verdict: **ISSUES**.

The R3 automatic-compaction retry defect is closed. One separate P2 remains. A delayed old context or compaction callback can revoke a newly accepted `/flow-auto` invocation. The new invocation then fails before HTTP. This is a bounded source review, not release approval.

The reviewed branch is `feat/opencode-v2`. HEAD and base are `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. The migration is uncommitted. All reviewer writes are under `/tmp/flow-v2-core-review-r4`.

## Finding

### P2. A stale callback must not revoke a later accepted invocation

Primary locations are `src/platform/opencode/lifecycle.ts:563-564` and `src/platform/opencode/lifecycle.ts:606-608`. Supporting paths are `lifecycle.ts:126-135`, `lifecycle.ts:316-317`, and `lifecycle.ts:367-391`.

Both asynchronous callbacks can retain an old primary while awaiting `ctx.session.context`. Meanwhile a new `/flow-auto` command synchronously revokes that old epoch, receives a matching native admission receipt, activates a fresh lease, and settles its new input origin.

When the old callback resumes, its stale check correctly throws. Its cleanup then revokes the **current** host epoch and deactivates the fresh lease.

- In the context callback, the catch checks only whether `attribution.current(sessionID) === owned`. Command admission ends the old primary but does not replace that object before the new context freezes. This equality therefore still holds across the invocation change. It does not establish ownership of the current epoch.
- In the compaction callback, the catch calls `revoke(sessionID)` unconditionally. The old `assertLive(primary.origin)` fails after the await, and that failure revokes the later invocation.

This is a liveness defect, not an authority grant. The user's newly accepted automatic run loses its lease, and its first valid context then throws `Flow execution epoch was revoked.` The user must issue another command after the stale callback has finished.

The executed reproduction is [challenges.ts](challenges.ts), with literal observations and assertions in [challenges.json](challenges.json). It uses the retained in-memory native lifecycle fixture and current production `registerFlowLifecycle`.

1. Admit the original `/flow-auto`, finish its primary response, and establish the exact running automatic control when testing compaction.
2. Block the old callback's native context read. This retains a snapshot across an actual asynchronous boundary.
3. Admit and await a fresh `/flow-auto` command. Confirm its authority is present.
4. Release the old read. The context case throws the stale-input error. The compaction case throws the revoked-epoch error. Both leave the fresh authority null.
5. Submit the fresh native context. Both cases now reject it with the revoked-epoch error.

A control with no delayed old callback admits the fresh invocation, completes its response, and executes its protected Flow tool successfully. No HTTP request is sent over the network by these scenarios. Request and Response objects remain local.

Run the reproduction with:

```sh
PATH=/tmp/flow-v2-toolchain/node_modules/.bin:$PATH TMPDIR=/tmp/flow-v2-core-review-r4/tmp /tmp/flow-v2-toolchain/node_modules/.bin/bun /tmp/flow-v2-core-review-r4/challenges.ts
```

Minimal recommendation. Capture callback epoch ownership before the first await. On failure, reject the stale callback and end only its own attempt, but revoke the host only if that epoch still belongs to the callback. Pin compaction cleanup to the captured primary and epoch as well. Keep stale-context and stale-tool vetoes intact. Add both delayed-read interleavings as regressions, asserting that the newly admitted context and protected tool succeed.

## R3 closure and adversarial checks

The changed data shape is a private `WeakMap<CheckedAutoCompaction, InputOrigin>` at `lifecycle.ts:93`. The running-control hook records the origin with the original delivery and epoch at lines 595-605. The resumed context validates the exact completed control and full consumed prefix before retrieving that origin at lines 463-477.

This fixes the reported cause. Repeated proven retries now reuse the same origin object. `ExecutionAttribution.freeze` retains its strict `prior.origin === origin` condition at `execution-attribution.ts:280`. Global retry identity was not weakened.

I independently reran the former reproduction twice. [archived-compaction-retry.ts](archived-compaction-retry.ts) uses the lifecycle source from the old `8f29` archive, with only relative imports redirected to the unchanged repository dependencies. Its compacted case rejects the reused assistant and loses authority. The original-input control succeeds. [compaction-retry.ts](compaction-retry.ts) runs current production source. Both cases now execute the protected tool and retain authority. The JSON outputs preserve both results. [r3-to-r4-lifecycle.diff](r3-to-r4-lifecycle.diff) records the actual archive-to-source change.

Additional executed challenges pass three response-less retries in succession, delayed old HTTP responses at each retry, and repeated verification of the same bound call. An already bound assistant cannot justify response-less retry. An assistant removed before a later freeze and then reintroduced cannot bypass immutable binding. The focused matrix rejects revoked origins and exact control, reason, model, and prefix mismatches. The new finding concerns callback cleanup after fresh admission, which that matrix does not cover.

## Prior findings and unchanged boundaries

The R1 stream cancel/read/setup/no-body and R2 pre-response first-fresh-input findings remain closed in their reported sequences. Exact Request finalizers and pinned terminal reads remain present and pass focused tests. This finding does not reopen their specific reproductions.

The R1 missing-marker claim remains unsupported for its recorded lifecycle hash `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772`. I recomputed the retained entry, map, and embedded source identities. That source already allocates and persists the invocation token. The earlier `0e4ba80b...` archive contains lifecycle `188ec484...`, which genuinely lacks those operations. [marker-provenance.json](marker-provenance.json) preserves this distinction. Original reports and trails were not edited.

The unchanged authority boundary remains an admission registry, frozen request context, immutable assistant/call binding, and current epoch. Prompt hooks revoke and record candidates. They do not grant origins. Summary text and asynchronous event-prefix arrival do not grant authority. Primary WebSocket requests still fail closed.

I re-read the current production sources and relevant base diff for permissions, tool registration, validation, reviewer completion, preferences, store, picker, TUI, transport, and composition. No additional causal defect emerged there. Any verified reviewer child in the matching workspace may attempt a new completion when it has a parent. There is no assignment-manager-parent requirement. Other callers use exact accepted replay. Validation retains exact command and execution joins, native shell output proof, completeness refusal, fresh JUnit checks, and source-drift ineligibility at persistence. Preference writes retain atomic revisioned storage and stale/busy checks. Native dependencies remain at the adapters, TUI, and RPC contract, and the builds externalize host packages and Effect. The V1 schema adapter is deleted.

## Tests and artifact identity

Pinned Bun 1.4.0 ran the ten focused files for execution attribution, lifecycle, native core, auto-drive, validation capture, parentage, config, model preferences, preference store, and picker. **272 passed, zero failed**, across those ten files. [focused-tests.log](focused-tests.log) records the exact cases. Preference tests use ordinary local Bun subprocesses. The standalone reproductions are additional component evidence, not additional suite counts.

I independently checked the owner's corrected private-entry receipt. Its entry hashes to `0edcf50fbc98d609c8ce6df6f50c5c167fd348f579baa80d80b96348bede1d87`. The source map hash and all 73 mapped production sources match current source. [source-binding.json](source-binding.json) records those comparisons. The retained receipt reports 24 combined native assertions. That native run belongs to the owner, not this reviewer.

During review the parent supplied the R4 archive. Its raw SHA-256 is `ec8728416e4000657014acee3b3838e2d034189b4cdeda463cb3f4c6248265b7`. I read it without installation or extraction. Both archive entries and maps match the installed cache bytes. All 73 server and five TUI mapped production source entries match the working tree. The server entry equals the corrected private entry above. [archive-source-check.json](archive-source-check.json) and [verify-archive.py](verify-archive.py) record the checks. This binds the source verdict, including the new finding, to the archive. It does not establish a successful exact-packed runtime rerun.

## Identity, drift, and limitations

[reviewed-files.sha256](reviewed-files.sha256) records 44 inspected source, test, package, and surrounding-boundary identities, including the adapter deletion. [initial-hashes.json](initial-hashes.json) and [final-hashes.json](final-hashes.json) inventory all 298 source/test files. There was no production or focused-test drift during review. One outside-scope eval test, `tests/recovery-episode-host.test.ts`, changed concurrently. [drift.json](drift.json) records both hashes. Compared with R3, lifecycle is the only changed production file; lifecycle and release test changes are recorded separately.

Real auxiliary **retry** remains unproved. The reported pending-primary auxiliary generate observation and bounded component negatives do not prove that case. No final-export compaction lineage claim is made. Main eval tooling and the native account prototype were not reviewed as completed work. The supplied comment inventory is separate; no comment-style verdict is given.

No host, provider server, model, paid call, network request, connector, browser, delegate, goal, automation, Git write, root build, package creation, or installation was performed. No whole check, full-suite, Linux CI, visual, official-provider, paid qualification, or release approval is claimed. The separate exact-packed compound rerun remains pending.

## Decision trail audit

[decisions.tsv](decisions.tsv) is this run's append-only trail. I audited it against the active conversation, source, actual command results, and retained evidence. Its paths resolve. An initial archive-cache-path assumption failed and was corrected before making an identity claim. A premature no-drift result was superseded when the printed comparison showed the concurrently edited eval test. Both corrections remain visible.

Model the Domain made the review trace origin, attempt, binding, and epoch ownership separately. Make Operations Idempotent drove the repeated-retry and delayed-callback challenges. Fix Root Causes required reproducing the old failure before accepting the stable-origin fix. Boundary Discipline kept the finding on callback cleanup rather than weakening admission checks. Prove It Works required actual archive/map comparisons and an executed failing interleaving. Test Behavior, Not Implementation made the finding assert fresh-authority loss and rejection of the fresh context against a successful control.

## Attention

reviewed by gpt-6.1-sol

- Scope stale callback cleanup to its captured epoch before treating this source as finding-free.
- The current compaction retry fix passes its independent reproduction. Preserve its strict retry and immutable-binding checks.
- No independent agent audited this run's trail because the task forbids delegates. No cross-model audit is claimed.
- Exact-packed runtime, auxiliary retry, final-export lineage, and release gates retain the limits above.
