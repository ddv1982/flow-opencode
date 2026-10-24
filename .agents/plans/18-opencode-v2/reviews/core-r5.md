# OpenCode v2 core review, round 5

Verdict: **PASS**.

This is a bounded source review of the callback-ownership fix on `feat/opencode-v2`. HEAD and the review base are `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. The migration is still uncommitted. Release approval, a packed runtime, Linux CI, visual proof, and the future Typesafe API key env option are outside this verdict.

No concrete source defect remained in the attacked ownership paths. A delayed old context or compaction callback, resolving or rejecting, no longer revokes a newly accepted `/flow-auto` after admission or after the new context has frozen. The new protected tool runs. A stale automatic shell stays rejected. Strict retry object identity still holds.

## Ownership result

The rejected premise is that the current primary object still proves ownership of the host epoch after an await. A new command advances the epoch and can leave the ended primary object in the map. `end` marks that object ended and does not remove it (`execution-attribution.ts:390-393`).

`CallbackOwner` (`lifecycle.ts:75-80`) stores host, epoch, the primary snapshot, and kind `attempt` or `admission`. `owns` (`lifecycle.ts:151-155`) requires the host epoch to match. Attempt cleanup also requires `attribution.current(host)` to be the captured primary. Admission cleanup may cancel its captured logical epoch and does not consult primary identity. `failOwned` (`lifecycle.ts:161-164`) ends the captured primary only when that primary's origin epoch matches, then calls `revoke` only when `owns` is true.

The remaining direct host `revoke` calls are owned cleanup, the synchronous real-prompt hook (`lifecycle.ts:361`), the synchronous command start (`lifecycle.ts:383`), and confirmed session deletion (`lifecycle.ts:784`). Setup failure, event-stream loss, and dispose still invalidate the whole plugin (`lifecycle.ts:760-767`, `849-858`, `865-871`).

Checked actor paths:

- Context captures the owner before the native read (`lifecycle.ts:505-520`). The same-epoch overlap check revokes that epoch. A later epoch replaces the pending slot. The old `finally` deletes the slot only when it is still that owner object (`lifecycle.ts:637-639`).
- Compaction captures the existing automatic primary and its origin epoch (`lifecycle.ts:647-688`). The `WeakMap` from checked compaction to `InputOrigin` is unchanged (`lifecycle.ts:99`, `675-684`).
- Tool verification resolves the immutable assistant or call binding first (`execution-attribution.ts:257-268`). A known old binding cannot take the replacement primary. `verify` checks that owner before and after the native reads (`lifecycle.ts:217-262`). `execute.before` and public `beforeTool` share that function (`lifecycle.ts:743-758`, `863`).
- Registered HTTP requests use the `WeakMap` owner (`lifecycle.ts:692-722`, `execution-attribution.ts:254-255`). A late response for that old `Request` throws the identity error and leaves the new authority in place (`execution-attribution.ts:400-410`). Body cancel calls the failure hook only when `end` still sees that primary as current (`execution-attribution.ts:419-421`, `448-450`).
- Command and synthetic admission capture the logical epoch before the first native read (`lifecycle.ts:282-299`, `383-396`). A superseded admission does not cancel the replacement.
- Accepted-message observation rechecks ownership around `observeMessage` (`lifecycle.ts:193-216`).
- A failed per-host session or context read calls `failOwned` for that host and logs. It does not set `streamLost` (`lifecycle.ts:786-805`, `841-846`). Subscribe error and EOF still set `streamLost`, clear attribution, and call `recovery.revoke()` with no host (`lifecycle.ts:849-858`, `recovery-policy.ts:260-270`).

## Executed reproductions

`/tmp/flow-v2-core-review-r5/challenges.ts` imports production `registerFlowLifecycle`. The native context read snapshots the message array after the blocked read resumes, so the old callback observes the post-replacement transcript. Results are in `challenges.json`.

The matrix is context and compaction, each resolving and rejecting, each after fresh admission and after the new context and HTTP request exist. Every old callback throws. Authority before and after is the same object, epoch 5, token `local-token`. `beforeTool` on the new assistant then resolves.

Also executed in that file:

- Three response-less retries, then the same bound call twice. Both tool calls resolve and authority remains.
- An assistant removed before a later freeze and then restored cannot bind again.
- An already bound assistant cannot justify a response-less retry. The context hook rejects overlap. `freeze` still requires `prior.origin === origin` (`execution-attribution.ts:293-299`).
- Cancel of a registered old response body after the fresh tool has run leaves epoch 5 in place, and a second fresh tool call resolves.
- A late response for the old registered `Request` throws `Flow primary response did not match its Request identity.` The fresh tool still resolves.
- An unbound shell whose assistant id is already in the manual context's previous-assistant set is rejected with `Flow tool has no attributable primary request.` The later manual Flow tool resolves. Authority stays absent after the manual steer.

Pinned Bun 1.4.0 also ran 15 focused files. The command and the pass lines are in `focused-tests.log`. **408 passed, 0 failed**, one run, 939 ms, 2139 `expect()` calls. The files are lifecycle, execution attribution, auto-drive, auto-drive decision, auto-drive validation, recovery host, recovery policy, recovery authority, tool parentage, native core, validation capture, config, model preferences, preference store, and model picker. That count is only those files. It does not measure evals, native auth, a full check, or a packed host.

The lifecycle file includes the production copies of the ownership matrix, the stale-shell case, stream-loss fail-closed, and the response-less retry cases. Those passed inside the 408.

## Observation, not a finding

An unregistered primary `http.response` still ends the live primary and revokes that epoch. The hook falls back to the current primary when `requestOwner` misses (`lifecycle.ts:712-722`). `response` then ends that current primary and calls the failure hook (`execution-attribution.ts:407-414`). In the probe, authority became null and the already registered live request could not finish.

That path is the existing exact-`Request` failure. A response whose `Request` was registered to the old primary does not take this branch and did not revoke the replacement. I am not holding the source gate on a host that synthesizes a new `Request` object for a primary response. Inspect that branch if a real host can do so.

## Retained closures and boundaries

R1 stream, setup, cancel, read, and no-body failures, and the R2 response-less first-input failure, stay closed on the sequences those rounds recorded. This round did not rebuild those historical scripts. The current lifecycle tests that cover stream loss, exact request finalizers, and response-less retry passed.

The R1 missing-marker claim stays unsupported for lifecycle `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772`. `/tmp/flow-v2-core-review-r4/marker-provenance.json` still records that source as allocating and persisting the token, and archive `0e4` lifecycle `188ec48417cef20250e9208cf69e3eaa9225e15f2d6b1331f4b18a630164fd35` as lacking both. I read that receipt. I did not re-hash the tarballs in this round.

The R3 compaction retry defect stays closed. Repeated retries in the probe reuse the attempt, and a bound assistant still cannot mint a new origin. The R4 archive hash `ec8728416e4000657014acee3b3838e2d034189b4cdeda463cb3f4c6248265b7` was bound by R4 to lifecycle `bd5fb2eaabf6...`. Current lifecycle is `5ed5b01899572bdbfb8cadb4fdf6fd62ccc29a3067ec28da91c02e3bb11bc2bc`. That archive does not contain this fix. I did not open the tarball again.

Prompt hooks revoke and record candidates (`lifecycle.ts:342-366`). They do not grant an origin. Summary text is not an origin. The compaction memo is keyed by the checked control object.

`tool-guard.ts:124-133` permits `flow_feature_complete` for a `flow-reviewer` child that has a parent. It does not require an assignment-manager parent id. Other mutations still require a primary manager. `validation-capture.ts:450-514` still joins the armed shell command, session identity, workspace, and `sourceDigest`, and host gaps stay ineligible. `package.json` build scripts still externalize `@opencode/plugin`, `zod`, `@opencode/schema`, `@opencode/client`, and `effect`. Those files match the R4 reviewed hashes. `schema-adapter.ts` is absent. V1 remains deleted.

## Identity and drift

Owned hashes, unchanged from the start of this review through the test run:

- `src/platform/opencode/lifecycle.ts` `5ed5b01899572bdbfb8cadb4fdf6fd62ccc29a3067ec28da91c02e3bb11bc2bc`
- `src/platform/opencode/execution-attribution.ts` `69f5e7212d42e6919c9c495332587a34b10b83392799323cb778130547117294`
- `tests/lifecycle.test.ts` `d2dee273bb0e63b27bf0ada85d0a1822729ecfa861b2576fe2c505725b3c5a60`

`initial-hashes.json` and `final-hashes.json` cover 305 `src` and `tests` files at the start, and the same set at the end. No `src` file changed during the review. Compared with R4's final inventory, the only `src` changes are the two owned production files above. Concurrent edits outside the core fence changed `tests/canary-run.test.ts`, `tests/canary-v2-native-auth.test.ts`, and `tests/eval-canary.test.ts` while this review ran. `drift.json` has both hashes. Those files were not in the focused command. Native-auth tests and eval harness edits are not evidence for this source.

## Limitations

Actual auxiliary retry is still unproved. The suite shows a same-session auxiliary retry cannot retire a healthy primary. That is a negative component. No native auxiliary retry callback was executed here.

No packed profile, full check, Linux run, paid model, or official-provider qualification was run after this fix. The root Linux result of 4494 passes predates this source and the auth work. I do not apply it here.

No final archive contains lifecycle `5ed5b018...`. Root pack is still later.

The Typesafe API key env name is not in this source and does not affect this verdict.

Comment inventory is a separate review. Comment Sicko was not run. This round gives no comment verdict.

No host, network, Git write, root build, package, delegate, or second model was used.

## Decision trail audit

`decisions.tsv` is this run's log. Each row matches a command or a code read from this session. `initial-hashes.json`, `focused-tests.log`, `challenges.json`, and `drift.json` exist and say what the rows claim. I did not edit earlier rows.

Cross-model review of the trail did not run. The parent forbade delegates.

## Attention

reviewed by none

- The unregistered primary response still revokes the live epoch. I left it as exact-request fail-closed. Read `execution-attribution.ts:407-414` if a host can respond with a new `Request` object.
- This PASS is the source ownership gate only. Packed runtime, auxiliary retry, and the final archive are still open.
- Canary and native-auth tests moved during the review. They are outside the hashed core verdict.
