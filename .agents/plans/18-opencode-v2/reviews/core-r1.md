# OpenCode v2 core review, round 1

Verdict: ISSUES.

This is a read-only verdict on the working tree at review time. It is not a pack, release, or full-green claim. HEAD is `8103f1cd42e1b4d111f25d2a311935d4e41fb997` on `feat/opencode-v2`. The migration is uncommitted. Hashes below are the snapshot at 2026-10-24T08:18:16Z.

Two current defects block a final pack. The native full-output suffix fix and the HTTP 400 release path are present in that snapshot. The initial Flow marker is not.

## Findings

### 1. High. A failed or cancelled primary stream wedges the next turn

`src/platform/opencode/execution-attribution.ts` keeps one frozen primary per session. The next context is legal only when that primary's phase is `ended`.

`src/platform/opencode/lifecycle.ts` lines 437-439 throw `Flow primary contexts or streams overlap` when the phase is anything else. The catch at lines 553-555 revokes the epoch and does not remove the primary. `ExecutionAttribution` has no per-session rollback. `clear()` closes the whole attribution map.

Paths that leave the phase short of `ended`:

- `execution-attribution.ts` lines 342-345. `cancel()` revokes through `failed()` and does not set `ended`. A real steer that cancels the in-flight body takes this path. The epoch changes. The old primary stays `streaming`. The steered context then hits the overlap throw, revokes again, and every later primary context for that session throws the same error until the plugin process restarts.
- Lines 337-339. A thrown `reader.read()` does the same. Phase stays `streaming`.
- Lines 321-324. An ok response with no body revokes and throws. Phase stays `request`.
- `lifecycle.ts` lines 532-534, then 553-555. `freeze()` stores the primary in phase `context`. `session.get` is the next await. If that call throws, or if `assertLive` fails after the freeze, the catch revokes and the primary stays `context`.

The HTTP 400 path is a different branch. Lines 315-318 set `ended`, call `failed()`, and return the original `Response`. `tests/execution-attribution.test.ts` asserts that the provider body, status, and `x-fixture-error` header stay intact, and that a later freeze is accepted. This review did not re-run that test. No test in `tests/lifecycle.test.ts` or `tests/execution-attribution.test.ts` cancels the wrapped body and then freezes the next input.

Minimal change: on cancel, pull failure, a missing body, and a context-hook failure after freeze, set that primary to `ended` or delete it before revoking. Add one test that cancels the wrapped stream and then admits the next real input.

### 2. High. The initial `/flow-auto` user message is persisted without its Flow token

`src/platform/opencode/lifecycle.ts` lines 334-355 build `promptPayload()` with text and attachments only, then call `ctx.session.prompt`. `command-hook.ts` lines 137-142 call `autoDrive.activate` and return the token only inside `attribution.accept`, after that receipt. `lifecycle.ts` lines 171-174 then pass the token to `autoDrive.observeMessage` as an in-memory part with `synthetic: true`. Nothing writes the token onto the native user message.

The lifecycle fixture stores that user message as text and id only (`tests/lifecycle.test.ts` lines 163-168). Synthetic dispatches do copy metadata onto the native record. The initial command does not.

`evals/reviewer-access.ts` lines 549-557 reject a v2 observed trace when the first root user message has `flowTokenSha256 === null`. That digest comes from native message metadata. The gate is strict, and this snapshot cannot satisfy it for an initial `/flow-auto` command. In-process continuation can still run, because the lease sees the memory-only part. A released native transcript of that command has no initial marker.

No preallocated admission marker is in the hashed `lifecycle.ts`. This review does not judge a patch that is not in the tree. Do not weaken `checkAutonomousLineage`.

Minimal change: put the private token in the admitted user payload before `session.prompt`, and activate only when the receipt matches that payload.

## Checked, and not findings

Request-scoped freeze, the admission registry, immutable assistant and tool bindings, and the live epoch are in `execution-attribution.ts` and `lifecycle.ts`. The prompt hook revokes and records a candidate. It does not grant an origin. Grant happens in the context hook after the native message matches the candidate or an accepted admission. Compaction continuity in `auto-compaction.ts` requires the same running, then completed, auto control id. Summary text is not the continuity key.

`tool-guard.ts` allows `flow_feature_complete` for a `flow-reviewer` child with a parent id and a matching workspace. It does not require a particular manager id. `tools.ts` sends every other agent to `featureCompleteReplay`. `flow-service.ts` lines 755-764 refuse a new completion when no exact accepted replay exists.

`config-shared.ts` denies `*` for the planner, reviewer, and worker, then allows read, glob, and grep. The reviewer also allows `flow_status` and `flow_feature_complete`. The worker also allows `edit`, with denials for `.flow` and `.git`. This pass did not execute the host rule matcher.

`validation-capture.ts` lines 290-292 accept a spilled file that ends in the display tail or that tail plus one LF. Extra LF, changed whitespace, and a changed suffix stay incomplete in `tests/validation-capture.test.ts` lines 604-644. Unknown exit or unknown truncation stays ineligible. The local receipts at `/tmp/flow-v2-core-shell-proof/baseline-run/verification.json` and `fixed-run/verification.json` both describe a 400000-byte native file with digest `sha256:90bf37cbb6f8580766aceb9b7973ffd59e1441599574ec68d4983ba9314f7112`. The baseline observation has `outputComplete: false`. The fixed observation has `outputComplete: true` and the same digest. This pass did not recompute that digest from the output file and did not call the host.

`package.json` externalizes `@opencode/plugin`, `@opencode/schema`, `@opencode/client`, `zod`, and `effect` for the plugin and TUI builds. `tests/architecture-boundaries.test.ts` rejects `@opencode-ai` imports and confines `@opencode/` imports to `src/platform/opencode/`, `src/tui.ts`, and `src/flow-rpc.ts`. `schema-adapter.ts` is deleted. Model preference writes refuse a stale revision, a stale project, a busy session, and an unavailable model before commit (`model-preferences.ts` lines 199-244).

## Limitations

Parent-reported suite figures were not run here. They are not evidence in this verdict. That includes 4398 passed, 25 skipped, 13 failed, 7 distribution fixes, 43 native event reads, 5 remaining fixture updates, and 1 repro drift. This pass does not classify those failures.

No host, model, or paid call. No Linux CI, packed install, or TUI visual proof. CUA Terminal was already unavailable. The debug tarball was not reviewed as a release artifact.

Eval tooling tests were not reviewed as completed work. `evals/reviewer-access.ts` was read only for the lineage predicate.

Agents were forbidden, so there is no second critic lane and no cross-model review of this trail. Comment style was out of scope. Permission match order inside the host was not executed. The core owner can still edit these files. Re-hash before pack.

## Reviewed file hashes

SHA-256 at 2026-10-24T08:18:16Z.

- `974cddff8a802d5a27ec64f0fb2f8bc342dfeb778a0aa63b82d71aaeb447fc4d` `src/platform/opencode/execution-attribution.ts`
- `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772` `src/platform/opencode/lifecycle.ts`
- `a78dbdda8e3e802550149ab6d2bcced886db35fe92e1779d5d20da25d99aef1c` `src/platform/opencode/auto-compaction.ts`
- `9781d3db22d7e8f7451253a19e7d23647db8cadbefbe4818beb1e264c6b7532d` `src/platform/opencode/auto-drive.ts`
- `262002ccf54a74d2a1b2106bde420d96ba279fb7b00d449d95350acca5fc29c3` `src/platform/opencode/auto-drive-messages.ts`
- `de2b4943fb3dd5d9381a3ee621a231f5f0883005c0fffff33e10ef04d69f54d7` `src/platform/opencode/auto-drive-decision.ts`
- `c3bc9296d2adfd5d77f87f9f882eb0f6a423e184fb8c9cc6976a2868586d76ca` `src/platform/opencode/auto-drive-validation.ts`
- `3b05232a9aa772017d845d499b0196b75d02bce35dc344931f4d431c2d7f1e6c` `src/platform/opencode/command-hook.ts`
- `28fcb3d89334e2e7701717e4cff16d888bff5646c7ea53dd19b1bde0564dde53` `src/platform/opencode/plugin-composition.ts`
- `061b163fe0b5ae036643133736fa985e9aac092d86059dbaf12d81c728d23cb2` `src/platform/opencode/plugin.ts`
- `f341b0bed05839cc802d88ee6204f37dadb69bb86d8d4e95c616cf3970ef1b8c` `src/platform/opencode/tool-guard.ts`
- `dd131d591208253296c4bda2bb243175d3470816f8096c4dde80c79328ecb10c` `src/platform/opencode/tools.ts`
- `314b357ee8a70e7c2c0c5dfb291f5a9e5aeb68c290f13e00ea2e058d6d835216` `src/platform/opencode/flow-tool.ts`
- `b0a48f9cdadb95c681a2161a62ec2b4b79b3f932aef1e73b7c394147f97d94aa` `src/platform/opencode/validation-capture.ts`
- `e9f45a4875e8ca936eb21f56cdd6764b7605503d9ecaa367ba13f0cf649b1183` `src/platform/opencode/config.ts`
- `e2496fd5be9db88f71e7c98fca441389665f6f986ba25b9b60d6c02c51db0179` `src/platform/opencode/sdk.ts`
- `461df3b882ca52fa53321e09629d37483f21ede7cd36d3915da6022bd76aae41` `src/platform/opencode/logging.ts`
- `522c5e89a7eb5e0cd20cc19022013f78515939795caffd9fbf871954a005e349` `src/platform/opencode/model-picker.ts`
- `99ecac2cda70f4c26735c7d878d2ad87da7063300ebc67b68e32ea24e38d392e` `src/platform/opencode/model-picker-ui.ts`
- `da47b4eada8f1765024c6956c1a7dd75e7ec0c7423ee1854260c3def4bd2d9d3` `src/platform/opencode/model-preferences.ts`
- `8fa8c7afd7db329f8de34c79889b95e8e600c67d48f849b16eea4f3106c14127` `src/config-shared.ts`
- `c8e9ba09c18220ccdc88288eb2c667caee1580980d695be45af436f95dd944e8` `src/tui.ts`
- `d2e04b71f1244ef9d1ef2859275051596ad79d309de5c4dab9e93e311952c577` `src/flow-rpc.ts`
- `efe1145e953fed122f0811a417bb9b5ed9dfc144b262dd28f750a883981da048` `src/application/model-preferences.ts`
- `3c68f1b8f340e0070e46033ccd7ef8a5610cef6ad1e4f23cd4c4572c365a83b8` `src/application/model-preferences-schema.ts`
- `f616bd10908d49c55e44c3bcfc3315d675cdac8164c65b775f7869e138541b75` `src/application/recovery-policy.ts`
- `ef044a759189b1ab96684b4aed17a3b556480cc5a96bb7dfa38a27efb0d28873` `src/infrastructure/fs/model-preference-store.ts`
- `4277203d63e1bc47a22d93765a9b82c87f4eaa42bb307c89c60fee46e64e6034` `src/prompt-surfaces.ts`
- `09f86fd952364b8d056913bb49775c11901faef0371c42a18b88be660cf3a182` `evals/reviewer-access.ts`
- `b314caed263dda5a8f96817eae8bfa005a89cd313e08248e68bc061a6cfda809` `tests/execution-attribution.test.ts`
- `f08cf080ea35d6a1698dd60f106d8780f90c56639c7b3ec180675ae6dd893b98` `tests/lifecycle.test.ts`
- `d333ee81e19df1c14e0a5cee2bb469c227470ef31a6ea395513be2b7188f2ce5` `tests/validation-capture.test.ts`
- `3412d7b7c9317c7cb0c454cf2d7d1060847683a2a8ed74c01452cf42893e9de0` `tests/architecture-boundaries.test.ts`
- `21435fe77bc56a1dbb005c500009cf8f96a7311e043d37d8c616d3c91bf07cab` `tests/opencode-native-core.test.ts`
- `ed69c3a6e20ff9e14f29b3553698c7aefa9dca6682b12237f1cfe891418a282d` `tests/model-preferences.test.ts`
- `3434cd5c091dc07eafb93671e41d61ad7c34cfa45f601c771a8eab44166d2d8c` `tests/model-preferences-store.test.ts`
- `c9ef62217a90bb1acac70304c9df24fc8be9d7840ad758f04f71bb457eaa5e3d` `tests/model-picker.test.ts`
- `164aba56578d43c740f4ca92d89dc0cfbd2d9cd18cb324a7f96f9cccb3815f39` `tests/auto-drive.test.ts`
- `288d4e0b49698ce5ff0ea9ddf1e7e9894a1ab99bf60ee5d5bbc53f9fd0df59b6` `tests/tool-parentage.test.ts`
- `72b1afd511af1708a764ed3dcb7284a70ee7bc5bda8d5bc56cce02aa17d61cb1` `tests/config-shared.test.ts`
- `57d2b03629a188d2f9f8eabc4c0493ba173bbbd550fbb97acaa4bc7ad5540b81` `/tmp/flow-v2-core-shell-proof/baseline-run/verification.json`
- `c7bfef94b0552d35a68345d3628a36ba6bb0f3ea18417be790c3b9ed7d51b994` `/tmp/flow-v2-core-shell-proof/fixed-run/verification.json`

## Decision trail

The log is `/tmp/flow-v2-core-review-r1/decisions.tsv`. This run wrote every row. Each evidence path was read or hashed in this session. No row claims a suite run. Cross-model review of the trail was not available.

Principles that changed a choice. Prove it works kept the verdict on the hashed source and the two shell JSON files. Explain the number kept the parent suite counts out of the verdict. Model the domain made the wedge recommendation a terminal phase, not another revoke. Boundary discipline made the marker recommendation part of the admitted payload. Test behavior separated the HTTP 400 unit test, which states its observable response, from the missing cancel-then-next-context test. Outcome-oriented execution left the unlanded marker patch unreviewed.
