# OpenCode v2 core review, round 3

Verdict: **ISSUES**.

One new P2 defect remains. A response-less native retry after automatic compaction rejects its legitimate reused assistant and revokes automatic continuation. The original R1 stream/setup paths and R2 first-fresh-input failure are closed. The initial marker is present. This is a bounded production source verdict, not release approval.

The review covers the uncommitted working tree on `feat/opencode-v2`, with HEAD and base `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. All writes by this reviewer are under `/tmp/flow-v2-core-review-r3`. No source or test drift was detected during this run.

## Finding

### P2. Preserve the admitted compaction origin across a proven native retry

Primary location: `src/platform/opencode/lifecycle.ts:473-479`.
Related locations: `src/platform/opencode/execution-attribution.ts:277-295`, `execution-attribution.ts:479`, and `lifecycle.ts:728-733`.

After an exact automatic compaction completes, every subsequent context callback enters the checked-control branch and calls `makeOrigin()` again. That creates a different `InputOrigin` object for the same control ID and live epoch. Normal user/admitted origins instead reuse their registry object.

The new response-less retry path correctly finds a fresh unfinished native assistant with a retry record, retires the old attempt, and marks it for retry. The next `freeze()` preserves the original assistant-exclusion snapshot only when `prior.origin === origin`. The newly allocated compaction origin fails that check. `freeze()` therefore snapshots the reused retry assistant as a previous assistant. When the retried provider produces a valid running Flow call, `verify()` rejects that same assistant at line 479. `beforeTool()` then revokes the current lease. The provider may have recovered, but the user's automatic run stops at its first protected tool. Other native tools under automatic authority use the same verification path.

Reproduction uses the existing in-memory lifecycle fixture and unchanged production `registerFlowLifecycle`. It runs two cases. Both admit `/flow-auto`, freeze a primary, simulate a response-less attempt, add the native unfinished assistant.retry record, freeze the retry, return its successful response, and attempt its exact running `flow_status` call. The second case first completes the existing exact automatic-compaction transition and consumes only that completed control ID.

Observed results:

- Original input control succeeds. `toolError` is null and its authority survives.
- Compacted input fails with `Flow exact assistant identity or frozen input prefix did not match.` Its authority becomes null.
- No network request or native host is launched. HTTP hooks receive local Request/Response objects only.

Run with:

```sh
PATH="/tmp/flow-v2-toolchain/node_modules/.bin:$PATH" TMPDIR=/tmp/flow-v2-core-review-r3/tmp /tmp/flow-v2-toolchain/node_modules/.bin/bun /tmp/flow-v2-core-review-r3/compaction-retry.ts
```

The rerunnable artifact is [compaction-retry.ts](compaction-retry.ts). Actual output is [compaction-retry.json](compaction-retry.json). The counterexample combines two supported transitions already observed separately in native receipts. This review does not claim a newly executed native compaction-plus-refusal run.

Minimal recommendation. Reuse the exact established origin object for the same checked compaction input during the proven retry. Keep the full input, agent, model, live epoch, fresh retry tuple, unbound-assistant, and immutable assistant/call binding requirements. Do not relax the object-identity check or transfer an already bound assistant. Add a regression combining compaction and native response-less retry, including a delayed old response and a stale-epoch negative case.

## Prior findings and objections

1. **R1 stream and setup failures are closed.** Response cancel, read failure, missing or locked body, stale response, and failure after context freeze end the exact primary. Late callbacks cannot end a replacement through the response failure callback. The focused tests cover these cases and pass.
2. **R1 marker behavior is closed, with a provenance correction.** Current `lifecycle.ts:335-346` allocates the token and includes it in the admitted native payload. Activation follows matching receipt acceptance. I recomputed all three historical entry/map/source bindings. R1's recorded lifecycle `1e8d5991...` already has allocation and initial metadata, so its missing-marker claim is unsupported for that identity. The earlier archive `0e4ba80b...` has lifecycle `188ec484...` and actually lacks both. The later `224f3c78...` archive includes them. [evidence-checks.json](evidence-checks.json) retains the comparisons. The parent's reconciliation preserves this distinction and leaves the original R1 report and log unchanged.
3. **R2 response-less failure and interruption are closed for the reported fresh-input sequence.** `revoke()` at lifecycle lines 125-135 ends the captured primary before invalidating its epoch. A fresh command or real prompt retires the old attempt synchronously. Failed/interrupted event cleanup requires a new negative native idle record following the exact frozen input prefix, absent at freeze. The primary object and epoch are checked after the await. The success/idle session read also pins both. Focused tests cover the first fresh input, fresh input before the event, and delayed old reads.
4. **The ambiguous retry-hook objection is addressed in source.** No retry hook grants or retires primary authority. Context reconciliation requires the durable unfinished primary-assistant retry facts at execution-attribution lines 344-372. A consumed tuple cannot excuse another live overlap. The same-model auxiliary retry unit test leaves a healthy primary intact. Real auxiliary retry remains unproven, as the owner states. No concrete auxiliary misattribution was reproduced here. The new compaction finding is separate and demonstrated.

## Architecture and remaining scope

The data model remains a local admission registry, request-scoped frozen primary, immutable assistant/call binding, and current epoch. Prompt hooks revoke and record candidates. They do not grant origins. Context establishes authority through accepted payloads or exact real native input, and stale contexts are vetoed before HTTP. Automatic native tools and Flow tools verify their exact native assistant and running call before side effects. Summary text and event-prefix arrival do not grant authority.

I read the current production sources and the actual base diff, with emphasis on lifetime transitions and retry composition. I verified the complete R2 identity inventory. Only `lifecycle.ts`, `execution-attribution.ts`, and `tests/lifecycle.test.ts` differ from R2. Every changed or added `src/` path is in [reviewed-files.sha256](reviewed-files.sha256), including the deleted V1 adapter. Unchanged HTTP helper, composition, preference/store/picker/TUI, validation, permissions, and loader boundaries retain their exact R2 identities. The relevant current paths were re-read rather than relying solely on a handoff.

No additional finding emerged in those boundaries. The HTTP helper sets provider/model/variant transport before registration and the primary WebSocket hook fails closed. Reserved role rules retain deny-all followed by explicit allowed actions and worker metadata-path denials. Reviewer completion permits a verified reviewer child in the matching workspace with any parent present; other callers receive exact replay only. Validation retains exact command/call/session/role/workspace joins, native shell output proof, unknown-completeness refusal, fresh JUnit checks, and source-drift ineligibility at persistence. Preference storage retains atomic revisioned writes and stale/busy checks. No cross-process atomic prompt barrier is claimed. Native imports remain at adapters, TUI, and RPC, with host dependencies externalized in both builds.

## Verification and artifact binding

I ran the ten focused files from R2 with pinned Bun 1.4.0 and an owned TMPDIR. The result is **244 passed, zero failed**, recorded in [focused-tests.log](focused-tests.log). The files were `execution-attribution`, `lifecycle`, `opencode-native-core`, `auto-drive`, `validation-capture`, `tool-parentage`, `config-shared`, `model-preferences`, `model-preferences-store`, and `model-picker`, each under `tests/` with suffix `.test.ts`. These are offline core and picker unit/component tests. They do not contain the new compaction-plus-retry case. No full suite, build, typecheck, lint, replay, install, audit, Linux CI, or paid qualification was run by this reviewer.

I independently read the new archive `/tmp/flow-v2-candidate-r3/opencode-plugin-flow-10.0.0.tgz`. Its SHA-256 is `8f29a34a33a562e6d289e7c357aee5f8b3863b6375a0a107ddac91fe94daa084`. Its server entry hashes to `65af1f5d951083ddb44d8a6b59b00186cca0cd338dcc01c841de9635cef7be96`. All 73 mapped server and 5 mapped TUI production sources match the working tree. [archive-source-check.json](archive-source-check.json) records both maps and entries. This proves that the new archive contains the reviewed code, including the finding. It is not packed runtime qualification.

The retained private-entry receipts report 30 pre-response checks, 41 continuation/compaction checks, and strict marker lineage with no issues. I independently matched their loaded entry bytes, source map bytes, and all mapped production sources. The private entry is the same server entry now in the R3 archive. I also inspected retained native retry observations, which show the durable unfinished assistant retry record at the next context and an unchanged successful retry policy. [native-retry-observations.json](native-retry-observations.json) records the compact observations and source hash. These are owner-executed local native probes, not host runs by this reviewer. They cover retry and compaction separately. Their honest auxiliary limit remains intact.

The final comparison is [drift.json](drift.json), which is empty. Initial and final hashes inventory 280 source/test files. Parent-reported historical or concurrently running full-suite and exact-package QA results were not promoted to my measurements. Main eval tooling remains another owner's work and was not reviewed as completed implementation. Visual, official-provider, Linux, final packed gates, paid qualification, and release approval remain separate.

## Decision trail audit and principles

[decisions.tsv](decisions.tsv) is this run's canonical trail. I audited its rows against actual tool output, files, and this conversation. [prior-trail-audit.json](prior-trail-audit.json) inventories all 54 actual rows in the supplied parent, R1, and R2 trails. All plain local pointers resolve. This is not independent re-execution of every historical or external claim. The R1 marker rows are superseded explicitly, including the parent row that initially adopted them. Other out-of-scope historical execution and external research remain labeled as historical evidence. No private host history store was accessed.

Model the Domain changed the review to a transition check across compaction, request, retry, and assistant binding. That exposed the new origin-object mismatch. Make Operations Idempotent made the review check repeated retry and terminal delivery. Attack the Premise kept the lifetime census and central revocation change in the closure assessment. Boundary Discipline kept admission authority on accepted native payloads. Prove It Works required an executed counterexample and recomputed archive/map identities. Test Behavior, Not Implementation made the counterexample assert the actual tool rejection and lease loss against a successful control. Explain the Number kept 244 focused tests distinct from native receipt assertions and parent full-suite reports. Minimize Reader Load made the finding trace the two origin paths explicitly.

The requested Poteto Investigation workflow ran sequentially within this independent reviewer. No sibling or nested delegate was launched. No comment-style verdict is given. No network, host, model, paid call, connector, goal, automation, Git write, commit, push, or PR was performed. Trusted sticky hooks were not verified for this turn.

## Attention

reviewed by gpt-6.1-sol

- Fix and independently recheck the compaction retry case before local commit or treating the archive as reviewed without findings.
- Keep the R1 marker provenance correction. The earlier packed counterexample and the unsupported recorded-source claim are different facts.
- No independent agent reviewed this run's own trail because the task forbids delegation. No new cross-model audit is claimed.
