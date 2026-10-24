# Native auth round 1

Verdict: actionable cleanup defect. No release approval.

The source-owned OAuth boundary holds in the executed offline checks. A broker dispose failure can leave the temp project and skip the location unload while the recorded service pid is still alive. That is P2. Two smaller fail-closed gaps are P3. The aborted-primary hook hypothesis was not reproduced.

throughput checkpoint: n/a, read-only investigation

## Overview

This review covered the five `evals/native-auth` modules, the eval harness wiring, the operator command, and the canary binding. The main repo was read only. Writes stayed under `/tmp/flow-v2-native-auth-review-r1`. No real account, no user service, no paid call, and no connection to pid 76572.

Production hashes for the frozen auth sources match the review-start record. Two test files drifted for the Linux portability correction. That drift is recorded separately below.

## Key concepts

The original refresh stays in the existing native 2.1.4 service. The child stores the placeholder refresh `flow-native-auth-source-owned` and the unresolved access marker. The client replaces only the selected OAuth method. The broker is a loopback relay with one lease and a bearer capability. The canary seals four client files and publishes a public receipt.

`request()` in Flow records a primary `Request` only when the project `http.request` hook runs. Native `PluginHooks.trigger` awaits each registered callback in append order and then returns the same input object.

## How it works

The broker discovers `opencode service status`, pins URL, pid, and version `2.1.4`, and repeats that check around each RPC. Dispose stops the relay, then tries to close the RPC and delete the debug location, then removes the temp directory.

The client guard calls the relay `check` route before it returns. It does not rewrite the `Request`. The source plugin reads `connection.active` and `connection.resolve`, substitutes the placeholder, and refuses a refresh copied into access or metadata.

Canary preparation verifies the sealed client before a charge. A live attach happens after that charge. Auth receipts are schema 2 and hash the public provider policy. Historical schema 1 records gain no `nativeAuth` field.

## Where things live

- `evals/native-auth/broker.ts` dispose is lines 138-171.
- `evals/native-auth/host.ts` attachment dispose is lines 210-219.
- `evals/native-auth/client-plugin.ts` method map is lines 89-133.
- `evals/native-auth/source-plugin.ts` pending map is lines 59-108.
- `src/platform/opencode/lifecycle.ts` `http.request` hook is lines 693-709.
- `src/platform/opencode/execution-attribution.ts` `request()` is lines 331-347.
- Native trigger implementation is the `PluginHooks` service in the local 2.1.4 darwin-arm64 binary.
- Promise hooks are wrapped at `node_modules/@opencode/plugin/dist/promise/adapter.js` line 429 with `Effect.promise(() => Promise.resolve(callback(event)))`.

## Findings

### P2. Broker dispose skips removal when a later step throws

`evals/native-auth/broker.ts:138-171`

`rm(directory)` sits after the identity check, the close RPC, and `DELETE /api/debug/location`. There is no `finally`. A throw from `refuse()` or from `api()` skips the removal.

Executed with a fake CLI and Bun 1.4.0. The runner pid was 92003. Signal 0 only. The real `opencode` binary was not started.

Live pid, and every later CLI call exits 1:

- dispose throws `Native account authentication failed.`
- the fake CLI log has no `DELETE` and no `/close`
- temp directory `flow-native-account-*` still contains `plugin` and `project`

Identity still matches, and `DELETE` exits 1:

- close and `DELETE` are present in the log
- dispose throws the same generic error
- the temp directory still contains `plugin` and `project`

Dead pid, CLI exits 1:

- `process.kill(pid, 0)` gets `ESRCH`
- dispose resolves
- the temp directory is gone

This run did not attach to a real native service. The observed fact is the skipped RPC and the leftover directory. On a discovered service, the same path would also skip the location unload.

Minimal fix: unload only when the pinned URL and pid still match, and always `rm` the temp directory in a `finally`. Do not send the close or delete RPC to a replacement pid.

### P3. Host attachment dispose skips the directory when configuration removal throws

`evals/native-auth/host.ts:210-219`

`rm(configurationPath)` runs before `rm(directory)`. A throw from the first call skips the second.

Executed against a local relay. No native CLI. The configuration file was replaced with a directory so the non-recursive `rm` throws `EISDIR`. After `dispose()`, `attachment` still contains `plugin` and `configuration.json`.

In this repro the capability file had already been removed before the throw. A throw that leaves the file in place would also leave that file, because the directory removal never runs. That second case was not executed.

Minimal fix: remove the attachment directory once, recursively, from the `finally`. The configuration path is already required to be inside that directory.

### P3. Duplicate integration and method keeps the last account and fails closed

`evals/native-auth/client-plugin.ts:89-94`

The selected map key is `integrationID` plus `methodID`. Two accounts that share that pair collapse to the last one. Startup does not refuse.

Executed with alpha active and a beta closure on the same integration and method. One method was registered. Refresh threw `Native account authentication failed.` The relay received no request.

`ensureSelected` compares the active credential id with the closure account before `fetch`. This path does not return beta's access token for alpha. It drops alpha's registration and refuses.

Minimal fix: refuse at registration when that key already belongs to a different credential id.

## Hook hypothesis

Root asked whether a delayed global `http.request` guard can resume after an aborted primary and bind that old `Request` to a fresh `/flow-auto` context.

Native trigger, from the 2.1.4 binary:

```js
s=f(function*(l,a,p){
  for(let y of e.get(r(l,a))??[]){
    if(y.options?.providerID!==void 0&&y.options.providerID!==Fu(p))continue;
    yield*y.callback(p)
  }
  return p
})
```

The loop awaits each callback. It does not read `Request.signal`. The model fetch wrapper runs that chain inside an Effect that receives the fetch signal.

The promise adapter wraps each hook in `Effect.promise` with a zero-argument function, so Effect 4.0.1 does not attach that promise to the abort signal. The promise body can finish after abort. The fiber does not continue to the next hook.

Executed with Effect 4.0.1 from this repo. Signal abort during the first hook:

- the first hook logged `auth-start` and `auth-end`
- the second hook did not log `flow`
- `runPromise` rejected with `All fibers interrupted without error`

A separate state-machine check called the real `ExecutionAttribution`. Ending the old primary, freezing a new one with the same agent and model, then calling `request()` with the old `Request` binds that `Request` to `new-primary`. `request()` will adopt an unseen primary `Request` onto the current context-phase primary.

That adoption did not happen on the abort path, because the later hook did not run. `session.execution.interrupted` is published from the generation effect's settled cause, and that effect contains the hook chain. This review did not find a scheduler window where a successful new context is frozen and the old hook still runs afterward.

This is not a finding.

## Checks that held

Source single-flight. Twenty-four overlapping `active()` calls, each waiting 15ms, produced `maxResolveDepth` 1. `connection.resolve` was entered 26 times because waiters re-enter after the in-flight operation finishes. Those entries did not overlap. The pending map is set in the same turn as the empty check. No concurrent refresh was observed.

Dead-pid dispose removes the temp directory.

Client refresh of a collapsed foreign account makes no relay call.

Scoped offline tests, Bun 1.4.0, 1.59s, env `FLOW_CANARY_NATIVE_AUTH_LIVE`, `FLOW_OPENCODE_NATIVE_EXECUTABLE`, and `FLOW_EVAL_NATIVE_AUTH` unset:

- 49 pass
- 1 skip
- 0 fail
- 205 `expect()` calls

The skip is `native canary loads sealed auth before seeding...` in `tests/canary-v2-native-auth.test.ts`. It runs only when `FLOW_CANARY_NATIVE_AUTH_LIVE` is `1`. It was not run.

`tests/native-auth-native.test.ts` was not run. The owner receipt at `/tmp/flow-v2-native-auth-probe/production-native-receipt.json` remains the owner-executed native proof. It uses the fixture provider `native-auth-fixture`. It is not a built-in OpenAI or xAI qualification.

`/tmp/flow-v2-eval-auth-integration/verification.json` is an owner-executed bootstrap proof. Status passed. `modelGenerationRequests` is 0. `actualModelBearerReproved` is false. `productionEdits` is false. `authOwnedFreezeMatches` is true. `sourceRefreshUnchanged: false` is the probe's expected synthetic rotation to `eval-auth-synthetic-rotated-refresh`, and `sourceRefreshIsPlaceholder` is false. That file does not show a placeholder written back over the source refresh.

Operator tests preserved a replaced output file. The remaining same-user `lstat`-then-`rm` window was not reproduced. It stays a bound.

Harness and canary still pass the process environment through with provider API keys retained by `canaryLaunchEnvironment`. The guard refuses an active `env` connection and a switched credential id. It does not inspect `Authorization`. Built-in OpenAI and xAI precedence was not re-proved. The local package has no JavaScript provider source. Missing paid qualification is a limit.

Flow's lifecycle `http.request` hook attributes the same `Request` and does not replace its URL. The recovery budget plugin can replace a URL on the recovery treatment path. That path is outside this auth seal.

## Hash drift

Review start and review end match for every frozen production file in `initial-hashes.json`, including `broker.ts`, `client-plugin.ts`, `host.ts`, `protocol.ts`, `source-plugin.ts`, and the fixture plugin.

Test-only drift, already present in this checkout:

| file | initial | final |
| --- | --- | --- |
| `tests/native-auth.test.ts` | `sha256:d59e83951783bc6f8aaf6ff46ff3c7c3936d9240aa28fc52fb09cf765682f6e8` | `sha256:67c9dffd8b533851d0cacad76c5742bcc698be328dd3e9565af8866ecca05cfc` |
| `tests/fixtures/native-auth-smoke.ts` | `sha256:7a8a4e1865311eda4fce7cee950a9afa06e9485cd44e7d6c69aa4ac3286e6f90` | `sha256:8ce07fde3cb2e1fead34cdfd0e3d57d82982006d814393b9cbd433a55c7f564b` |

`tests/native-auth.test.ts` `directory()` uses `mkdtemp(join(tmpdir(), "flow-native-auth-unit-"))` and imports `tmpdir` from `node:os`. `tests/fixtures/native-auth-smoke.ts` uses `mkdtemp(join(tmpdir(), "flow-native-auth-production-"))` and writes `receipt.json` only inside that temp root. Neither file still mentions `/tmp/flow-v2-native-auth-probe`.

Linux Git ownership from a tar that preserved a Mac uid is an environment fact about the disposable checkout. It is outside this review's product scope.

## Limits

No release approval. Prior release and eval verdicts do not certify this auth code. Root's Linux 4494-pass snapshot predates it.

Comment inventory at `/tmp/flow-v2-comment-review-auth-r1` was not given a comment verdict. The parent forbade delegates, so Comment Sicko was not run. Sticky poteto hooks were not verified. One reviewer. Critic coverage is partial.

`tests/native-auth-native.test.ts` and the live canary were not run here.

## Gotchas

A passing offline count is the number of executed assertions. It is not a cloud refresh proof.

`request()` trusts the current context-phase primary. Anything that ends that primary and freezes another one before the Flow hook runs can adopt an unseen `Request`. The abort path measured here does not do that, because the later hook is skipped.

Broker cleanup and host cleanup both depend on every preceding await succeeding. The executed failures leave directories behind.
