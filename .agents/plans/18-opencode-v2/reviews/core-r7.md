# Round 7 core source review

## Verdict

Bounded PASS on the current core source.

This is a source review of the frozen private entry. It is not release approval, not a packed 10.0.0 claim, and not proof of Linux CI, the visual gate, paid qualification, or a final archive.

No blocking source defect remained in the reviewed matrix. One classifier boundary is recorded below and stays outside the verdict.

## Source identity

Workspace head is `8103f1cd42e1b4d111f25d2a311935d4e41fb997` on `feat/opencode-v2`. The dirty tree was left untouched.

Freeze is `/tmp/flow-v2-manual-compaction-check-su6aydtb/freeze-final.json`.

| File | SHA256 | Delimiter lines |
| --- | --- | --- |
| `src/platform/opencode/lifecycle.ts` | `b9b0f73ca1adb6b0ae927ba8fed6f385cd52ba57cba7d926df8397df3b79241c` | 993 |
| `src/platform/opencode/auto-compaction.ts` | `22992613ba7763141145f77136172530a0eea82e5b8ac639081e7b2fa548ea22` | 129 |
| `src/platform/opencode/execution-attribution.ts` | `eb40ecfc0dbbffa7fed954a9af407896555d4a9360944873b1cb1d0dd9a5691f` | 632 |
| `src/platform/opencode/auto-drive.ts` | `4b482e848c43b44506870c03c03612eb023f833296b439a67a3071baf163da4f` | 998 |
| `src/platform/opencode/command-hook.ts` | `94fff32cf1cb63ffd7903db76b38615f7afe50eeb3ef488676be86058eaeba68` | 247 |
| `src/application/recovery-policy.ts` | `f616bd10908d49c55e44c3bcfc3315d675cdac8164c65b775f7869e138541b75` | 1000 |
| `src/platform/opencode/auto-drive-messages.ts` | `262002ccf54a74d2a1b2106bde420d96ba279fb7b00d449d95350acca5fc29c3` | 39 |
| `tests/lifecycle.test.ts` | `8700196a86a7561c8544bd31965fca13c4bd25f8daa4fef179d91cdd3499af71` | 3305 |

`initial-hashes.json` recorded `matchFreeze: true` before the probes. The close rehash of these eight files returned `drift []`.

Private entry SHA256 `2933a7d739742518905ba6ca41d05ef628dafc34b9d1a39c8c716f8a57518f7c`. Source map SHA256 `7a280c7b8e2ea45c045971eae7dbb83daffdde5deae7451513479b5adb74a371`. Both native runs bound 74 `sourcesContent` entries with that map. Observed `packageVersion` is `0.0.0`.

The tarball SHA256 `d3d46d92148a34d829536c939a528f52c3ef6adeb612230afab860b003c09292` was the dependency cache. The loaded plugin path was the copied current entry. That archive stays rejected.

## Design that the source implements

Checked native controls keep the accepted input origin. `checkRunningAutoCompaction` in `auto-compaction.ts` throws at lines 38-45 when the last compaction is absent, not running, or manual while authority is non-null. Manual with null authority returns reason `manual` and authority null at lines 46-52. Every other running reason is stored as reason `auto` with the passed authority at line 53.

`checkCompletedAutoCompaction` requires the same id, the same stored reason, status completed, and a consumed prefix of that single id, with no later user or synthetic message.

`isUnattributedManualSummary` is true only for a running manual control whose prefix matches `nativeInputIDs`. The compaction hook in `lifecycle.ts` lines 733-746 uses that path only when the consumed source has no admission epoch and `compactionContext` is null. The return stores no `compactions` entry and no `compactionOrigins` entry. The catch at lines 790-792 calls `failOwned` only after `owner` is assigned, which is after that return. An unknown summary callback therefore has no host cleanup owner.

`contextPending` removal at lines 707-709 deletes only the slot whose owner object is still current. `rememberCodingModel` runs at line 702 after `assertOwned` and `assertLive`.

`compactedInputOrigin` copies authority from the source. A truthy authority forces `automatic: true`. It does not read the current host grant.

Grantless completion calls `recovery.observeMessage(session, checked.id, true, true)` from the existing resolver. The lifecycle tests that passed expect recovery mode `off`, no new repository save, and no advice lease.

The public registration surface is unchanged by this delta. `command-hook.ts` and `auto-drive.ts` are outside the current patch and remain under the 1000-line counter. `recovery-policy.ts` is 1000 and was not part of the patch.

## Independent native manual proof

OpenCode `v2.1.4` listened on `127.0.0.1`. Home, XDG, and TMPDIR were under each run directory. Provider traffic stayed on the paired loopback port. Copied runner base is `/tmp/flow-v2-core-review-r7/native-runner`. The entry file is a byte copy. `node_modules` is a symlink used only so `zod` resolves. Owner freeze files were not written.

Setup misses retained as misses. A symlinked entry failed the owned-path assertion. Run `run-20261024-141941-648312` then failed plugin load with `Cannot find package 'zod'`. Those processes were stopped before the successful runs.

### no-prior

Run `/tmp/flow-v2-core-review-r7/native-runner/native/run-20261024-142027-385044`. Session `ses_e92250ce9ffek05ghlEQVmDpzF`. Server PID 38063 exit 130. Provider PID 38062 exit -15. `bothAwaited` true.

During the summary window, `contexts`, `requests`, `tools`, and `prompts` are empty. The API receipt type is `compaction` and has no `reason` field. The native running control `msg_16ddaf62d001VEmvlUFQYnCF2l` has status `running` and reason `manual`. The completed context message has the same id, status `completed`, and reason `manual`. `.flow/session.json` was absent. The compaction system text does not contain the in-memory `/flow-auto` continuation.

A later inbox user, text `Fresh ordinary coding input after completed manual summary.`, metadata `{}`, was consumed together with that compaction id. `flow_status` call `call_manual_fresh` completed. Parsed status is `ok`, summary `No active Flow session.`, revision 0, recovery `{mode: off}`, and `autoDrive` is absent. The script writes `successAfterFreshUser: true` only after those assertions.

### ended

Run `/tmp/flow-v2-core-review-r7/native-runner/native/run-20261024-142035-536385`. Session `ses_e9224ed17ffeJQ38f0fkabShUK`. Server PID 38086 exit 130. Provider PID 38085 exit -15. The same summary and fresh-tool facts hold for control `msg_16ddb14a7001fCmvb9HLwlwRcq`.

After both runs, `pgrep` for this review runner printed no processes. PID 76572 was still present and was not signaled.

Index of the parsed fields is `native-independent.json`.

## Focused tests

Command, cwd `/Users/vriesd/projects/flow-opencode`, `PATH` pinned to `/tmp/flow-v2-toolchain/node_modules/.bin` first, `HOME` `/tmp/flow-v2-core-review-r7/home`, `TMPDIR` and `XDG_*` under the same review directory:

```
/tmp/flow-v2-toolchain/node_modules/.bin/bun test \
  tests/auto-drive.test.ts \
  tests/auto-drive-decision.test.ts \
  tests/auto-drive-validation.test.ts \
  tests/execution-attribution.test.ts \
  tests/lifecycle.test.ts \
  tests/recovery-host.test.ts \
  tests/recovery-authority.test.ts \
  tests/recovery-policy.test.ts \
  tests/opencode-native-core.test.ts \
  tests/validation-capture.test.ts \
  tests/tool-parentage.test.ts \
  tests/config-shared.test.ts \
  tests/model-preferences.test.ts \
  tests/model-preferences-store.test.ts \
  tests/model-picker.test.ts \
  tests/architecture-boundaries.test.ts \
  --test-name-pattern '^(?!registered tools share)'
```

Bun `1.4.0` (`34cbb9a40`). Log `focused-tests.log`. Result is 475 pass, 1 filtered, 0 fail, 2396 `expect()` calls, 16 files, 814ms, EXIT 0.

475 counts this file list and this filter. The filtered test is the Git-backed `registered tools share` case. The count is not the owner 336, not root's earlier 4643+27, and not a whole-suite result. The owner 336 and the nine owner native cases stay owner evidence except for the two manual cases rerun here.

The passing lifecycle names cover pre-primary pending receipts, ordinary none and ended-manual first and retry, grantless plan and reviewer, declassify paths, prefix and reason and model mismatches, grantless recovery bookkeeping, known manual checkpoint identity, unattributed summary then a later real input, synthetic and prefix history, delayed read resolve and reject, unload, late callbacks, and the 128-model bound.

## R6 probes copied into this output

`probes/regressions.test.ts` imports the workspace checker and the freeze fixture. It does not modify `/tmp/flow-v2-core-review-r6`.

Nine behavioral rows passed and are in `probes/regressions.json`.

- Four ordinary rows, prior none and ended-manual, with and without the automatic control. Each has `toolRan` true, authority null, `saveCount` 0, advice mode `off`, and `contextError` null.
- Four same-epoch rows. Old context reject and resolve, including the old read settling before the fresh context. The fresh protected tool ran. Authority object stayed `{hostSessionId: session-lifecycle, token: local-token, epoch: 2}`.
- One live-lease manual row. Error text is `Flow cannot retain authority through unverified or manual compaction.` Authority is null. The guidance string is present on `input.system` because `lifecycle.ts` lines 715-716 push `compactionContext` before the running check. The hook then throws, so that push is not a committed grantless summary.

The tenth expect failed on purpose as a reviewer hypothesis. `checkRunningAutoCompaction` accepted running reason `other` and returned reason `auto` with the same authority object. See the residual below. Probe log exit is 1 because of that expect.

`probes/malformed-reason.test.ts` drove the lifecycle with running reason `other` and then rewrote the completed control reason to `auto`. `runningError` is null. `flow_status` ran. Token `local-token` epoch 2 was preserved. That file's expect also failed. The JSON is `probes/malformed-reason.json`.

`probes/stable-unknown-reason.test.ts` kept reason `other` on the completed control. Context error is `Flow automatic compaction control identity changed.` The tool did not run. Authority after the attempt is null. EXIT 0.

## Residual that does not change PASS

`auto-compaction.ts` lines 46-53 label every non-manual running reason as `auto` and return the caller authority.

What that does:

- Manual plus non-null authority still throws at lines 41-44.
- Null authority is not turned into a lease by the label. `compactedInputOrigin` keeps authority null when the source authority is missing.
- A stable unknown reason on the completed control fails the reason match at lines 62-70 and `failOwned` revokes the live lease.
- The component grant needs a running reason outside `manual` and a completed reason of the string `auto`. The probe created that pair by cast and then by mutating the completed snapshot.
- `@opencode/client` types the compaction reason as `"auto" | "manual"` at `types.d.ts` lines 601, 750, 1226, 1999, 2018, and 2041.
- Both independent native cases supplied reason `manual` from `Session.context`. The receipt had no reason field.

A host that can emit a completed reason of `auto` can already emit a running reason of `auto`. The else branch does not add a grant that an in-union auto control lacks. The stated overload for a non-null caller is auto-only. This stays a recorded boundary. A later pack review can still require `reason === "auto"` in the throw condition if it wants unknown runtime strings to fail closed. That change is not required for this source verdict.

## Helper move

`source.patch` deletes the inline model update in lifecycle and adds `rememberCodingModel`. The new guard returns on parent, agent mismatch, or specialist. That is the inverse of the old positive condition. Delete-before-set, variant copy, and eviction of the oldest key above 128 are the same operations. The call remains after ownership and liveness checks. Lifecycle stays at 993 delimiter lines. This is a move across the existing ceiling. It is not a waiver and it is not a byte-identical paste. The bound test in `tests/lifecycle.test.ts` passed.

## Comments

`/tmp/flow-v2-comment-review-r7-final/suppressions.json` is an empty list. `comments.json` has three entries, all in `evals/harness.ts` at starts 189, 355, and 1844. Those are existing public contract keeps and sit outside this core fence. A direct scan of `lifecycle.ts`, `auto-compaction.ts`, and `execution-attribution.ts` found no `//`, block comment, `@ts-`, `biome-ignore`, or `eslint-disable` marker. No comment subagent was started.

## Prior findings left as they were

R1 stream, setup cancel, read, and no-body closures stay closed on their reported sequences. The R1 missing-marker finding does not describe lifecycle `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772`. Archive `0e4ba80b` with lifecycle `188ec48417cef20250e9208cf69e3eaa9225e15f2d6b1331f4b18a630164fd35` is the source that lacked the marker. Those hashes are carried from reconciliation and were not recomputed here.

R2 response-less failures stay closed on their reported sequences. R3 origin recreation stays closed by the R4 checked-fact WeakMap. R5 is a bounded PASS on older source only. R6 remains ISSUES on source `169609bd` and its ordinary no-lease automatic P2. This review reran that component failure as passing on the current bytes, in both no-lease states. The R6 same-epoch component failures also pass on the current bytes. Native overlapping-context reachability stays unproved.

The rejected archive `d3d46d92` and its QA receipts were not rewritten. Root canonical suites from the R6 source are not evidence for this fix. Native-account helper review R3 and client `e8e4bed7` were not re-reviewed.

## Limits

Actual same-model auxiliary generate retry remains unproved. The negative component coverage and the older reentrant attempt are unchanged.

Native overlapping context remains unproved. The same-epoch proof is the component fixture.

Ordinary automatic native cases and the five marked native scenarios were not rerun in this round. Their owner receipts are owner evidence. The two manual native cases above are this review's evidence.

No final archive contains this source. No root typecheck, full suite, build, pack, install, or Git operation ran. CUA visual proof was not available. The future `TYPESAFE_API_KEY` option was not reviewed and does not gate this verdict. Eval and native-auth edits outside the fence were not treated as core proof.

Collection exit 0 is not the product proof. The product proof is the parsed result fields and the assertions that run before `successAfterFreshUser` is written.

## Attention

Cross-model trail review was unavailable. The parent forbade delegates, so critique stayed in this thread. Critic coverage is partial.

Principles that changed a decision were Prove It Works, Attack the Premise, Type System Discipline, Boundary Discipline, Separate Before Serializing Shared State, Test Behavior, Explain the Number, and No-comments.

throughput checkpoint: n/a, read-only investigation.
