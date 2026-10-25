# Flow 10.0.0 V2 eval review, round 2

Verdict: ISSUES. Two P2 findings are on the bytes read at `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. This is not a freeze and not a release approval.

The round 1 caller omission is closed. `EpisodeHostOptions` now picks `credentialHandoff`. Inherit without a handoff is refused before `EvalHost.start`. A handoff with credentials disabled is refused. The harness returns `V2 credential inheritance requires an explicit native credentialHandoff; auth.json is unsupported.` No `auth.json` copy runs on that path.

## Overview

The review covered the eval host, native trace conversion, study protocol, release host policy, HTTP transport selection, and recovery startup. The working tree is dirty: 112 paths differ from the base commit. Hashes of the 28 scoped files are in `source-reviewed.json`. None of those hashes changed between the start of the repro and the check after the tests.

Pinned Bun was 1.4.0 from `/tmp/flow-v2-toolchain/node_modules/.bin/bun`. The shell Bun 1.3.14 was not used.

## Key concepts

Native credential inheritance is an explicit snapshot plus an `onStop` callback. The child home stays under the scratch directory. Rotation has to be copied out before that directory is removed.

Release isolation is two separate switches. `ambientConfig: "disabled"` deletes `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, and `OPENCODE_CONFIG_DIR`. `reviewerEnvironment: "disabled"` blanks `OPENCODE_FLOW_REVIEWER_MODEL`, `OPENCODE_FLOW_REVIEWER_VARIANT`, and `OPENCODE_FLOW_REVIEWER_STEPS`. The release campaign sets only the first switch.

HTTP selection is one provider transform. It writes `transport: "http"` onto each provider, model, and variant already in the editor. A provider added by a later transform is left alone.

## How the review ran

`/tmp/flow-v2-eval-review-r2/repro.ts` constructed `EvalHost`, drove `stop` with a fake client, called the real credential rejects, resolved reviewer configuration, walked the grader import graph, and built the live treatment plugin into this directory. It did not spawn OpenCode.

Focused tests, same Bun:

`bun test tests/recovery-episode-host.test.ts tests/config-shared.test.ts tests/eval-host-trace.test.ts tests/eval-v2-trace-contract.test.ts tests/study-manifest.test.ts tests/study-host-isolation.test.ts`

114 pass, 0 fail, 468 assertions, 6 files, 6.99 seconds. The isolation test used the in-repo loopback fake. It refused any origin other than its own server.

## Where the code lives

Credential shutdown is `evals/harness.ts` `stopOnce`, lines 3616 to 3677. The caller type is `evals/recovery-decisions/episode-host.ts` lines 112 to 122, with the early rejects at lines 180 to 189.

Release start is `evals/run.ts` lines 1109 to 1126. Preflight is lines 824 to 831. The override gate is `evals/release-policy.ts` lines 463 to 472. Reviewer precedence is `src/config-shared.ts` lines 200 to 259. The child environment copy is `evals/bun-toolchain.ts` lines 62 to 70 and `evals/harness.ts` lines 1980 to 1987 and 2259 to 2268.

HTTP registration is `src/platform/opencode/http-transport.ts`. Flow calls it first inside `createFlowPlugin`. The control arm imports `evals/http-transport-plugin.ts`. Plugin readiness is `evals/harness.ts` lines 2372 to 2412.

## Findings

### P2. Shutdown drops credential rotation when session drain fails

`stopOnce` puts `session.active`, every interrupt, every wait, and `credential.list` in one promise. A rejection from active or wait skips the list. The method then kills the server, rethrows, and skips `onStop`. `rm` of the scratch directory is after that throw, so the directory stays.

Repro, real `stop` method, fake client, no server process:

- `session.active` throws `active-stuck`. `credential.list` was not called. `onStop` was not called. Scratch remained.
- An active session whose `session.wait` throws `wait-timeout` did the same.
- An idle session listed the rotated credential, called `onStop` with that list, and removed scratch.

`tests/recovery-episode-host.test.ts` still passes. Its fake `stop` calls `onStop` itself, so it never runs this branch. Registered callers still default `providerCredentials` to disabled. Inherit is opt-in. The hole is on the handoff this round exposed.

Minimum fix: while the server is alive, list credentials even if interrupt or wait fails. Call `onStop` when the list succeeds. Remove scratch only after `onStop` succeeds.

### P2. Release scenario host applies an ambient reviewer variant

`runCampaign` rejects `OPENCODE_FLOW_REVIEWER_MODEL` and `OPENCODE_FLOW_REVIEWER_STEPS` through `assertReleaseHost`. That function has no variant argument. A Linux call for package 10.0.0 with neither override is accepted. The same call rejects a model override and a steps override.

The release scenario start sets `ambientConfig: "disabled"` and leaves `reviewerEnvironment` unset. The ordinary host copies `process.env` through `currentBunToolchain`. Reviewer variables are blanked only when `reviewerEnvironment` is `"disabled"`. Release plugin options carry the pinned model and omit variant and steps. `resolveFlowReviewerConfiguration` then reads the environment. The variant applies because the model is explicit.

Repro: plugin model `openai/gpt-6.1-sol` plus `OPENCODE_FLOW_REVIEWER_VARIANT=max` and `OPENCODE_FLOW_REVIEWER_STEPS=3` returned variant source `environment` value `max`, and steps source `environment` value 3. Blank strings left the model pinned, omitted the variant, and left steps at `host-default`.

The campaign gate stops a steps override before launch. It does not stop a variant. The release host-config digest records `reviewerSteps: null` and does not record a variant. Preflight also omits `reviewerEnvironment`. A variant alone does not apply there, because preflight passes no reviewer model.

Minimum fix: pass `reviewerEnvironment: "disabled"` on the release preflight start and the release scenario start. Reject a set `OPENCODE_FLOW_REVIEWER_VARIANT` in `assertReleaseHost`, alongside model and steps.

### P3. Benchmark and reviewer campaign starts inherit the parent environment

`package.json` script `benchmark` runs `evals/benchmark-run.ts`. Its `EvalHost.start` calls at lines 451 and 520 pass neither `ambientConfig: "disabled"` nor `reviewerEnvironment: "disabled"`. `evals/reviewer-run.ts` line 294 passes a reviewer model and omits both flags. Study cells and episode hosts set both. The release scenario sets ambient config only.

Minimum fix: pass both flags at those three starts.

## What held

HTTP. A provider, model, and variant present before `registerHttpTransport` all became `transport: "http"`, including a variant that started as `force-ws`. A provider inserted after that callback stayed `websocket`. Undefined `variants` throws, so the transform fails closed. Flow registers this helper and no later `provider.transform`. The budget plugin hooks fetch and the websocket constructor. It does not transform providers. `withFlow: false` loads only the HTTP plugin.

The grader walker returned 108 files, including `evals/http-transport-plugin.ts` and `src/platform/opencode/http-transport.ts`. A Bun build of `evals/recovery-decisions/live-treatment-plugin.ts` succeeded as one 2,106,754 byte file. Live `effect/...` imports: 0. The `effect` strings in that file are schema `importDeclarations`. Executable imports are Bun builtins. Neither treatment `Bun.build` call contains an `external` array.

Plugin readiness accepts the realpath of the configured directory, or the directory name when the listed path ends in `index.ts` or `index.js`. Other paths are ignored. A failed expected plugin throws `An expected native evaluation plugin failed to load.` The isolation fake lists the package directory, so this run did not exercise the `index.ts` fallback. `realpath` is not caught. A listed path that cannot be resolved aborts the poll immediately.

V1 `HostTrace` schema text matches the base schema after the rename to `HostTraceV1Schema`. `evals/study-statistics.ts` has the same git object id as the base, `be5d51635327a750bac7556a7784ac2269c7a79c`. The legacy and previous study protocol payloads match the base. Active `prepareStudyManifest` refuses OpenCode 1.18.6. The 1.18.6 host record still sets `nativeLlm: false`. Newer records set `transport: "http"`.

Current protocol digests from this process:

- legacy `sha256:a0f3454c6370992dfb952160fbba577a856eb8f920a4a49460ac9f8f83927940`
- study `sha256:147c51db430de30bd88a94c5fb4a4ef9b1ff5fac7ae3c05aa2af6f60aafff6d9`
- opencode2 `sha256:31d303b0a7e0132d5fe9b164acdb813ef49bd6a8fe29035ccae600bbeeda36c8`
- statistics `sha256:50795aa7b68e61c86840c0ecd3c0ef52bc835506ed4c1f38f31000181e7dda44`

The saved packed proof at `/tmp/flow-v2-packed-eval-parent/validation.json` stores native input 10, output 5, reasoning 4, cache read 3, cache write 0, `costUsd` null, completeness `unverified`. The harness adds those five fields separately. That file was read. The host was not run again.

Trace tests passed, including endpoint-owned session binding, composite tool identity, missing initial marker, and compaction left unproved. Both harness provenance calls pass `entry.native`. No historical evidence directory is in the diff against the base.

## Limits

No OpenCode server, no network, no paid model, no full suite, no Linux run, no packed qualification, no release approval. The earlier socket probe under `/tmp/flow-v2-http-contract` was not repeated. Canary policy and the src stream work stayed with their owners. The missing initial flow-token gate was left as it is. Comment wording was out of scope.

`report.json` holds the raw repro objects. `commands.txt` holds the commands. `source-reviewed.json` holds the file hashes.
