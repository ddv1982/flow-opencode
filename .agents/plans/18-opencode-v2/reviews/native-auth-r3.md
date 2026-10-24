# Native auth round 3

Bounded PASS. Public host and broker disposal now reject with `NativeAuthError` and the message `Native account authentication failed.` The scratch path, the filesystem code, the release body, and the injected relay sentinel stay off that error. No actionable finding. This review gives no release approval.

throughput checkpoint: n/a, read-only investigation

This is a fresh review by Grok grok-4.7 with high reasoning. No delegates ran. Poteto sticky hooks were not verified, so this turn follows the skill directly.

## Overview

Round 2 left one P3. A failed `rm` during disposal replaced the generic authentication error and put the private directory in the message. An injected relay `stop` rejection did the same with its sentinel.

The frozen correction appends `.catch(refuse)` to the two memoized cleanup promises. `refuse` throws a new `NativeAuthError` and takes no cause. I diffed the current files against the pre-fix checkout. Those two lines are the entire production change. `protocol.ts`, `client-plugin.ts`, `source-plugin.ts`, and the smoke fixture are byte-identical to that checkout.

The caller who awaits disposal receives that new error. A removal that the filesystem refuses still leaves the directory in place. A later call returns the same rejection and does not try again.

## How the public error is built

`evals/native-auth/protocol.ts` lines 30 through 38 define `NativeAuthError` and `refuse`. The message is fixed. The constructor does not accept a cause.

`evals/native-auth/host.ts` line 217 applies `refuse` to the attachment cleanup promise stored in `done`. The public attachment method at lines 294 through 297 is a separate async wrapper. Each call to that wrapper returns a new promise. Both calls await the same inner promise. One release runs. The rejection object matches.

`evals/native-auth/broker.ts` line 174 applies `refuse` to the promise stored in `closing`. A second `dispose` returns that same promise. Relay stop, the pinned close, and `DELETE` still happen inside the `try`. Directory removal stays in the `finally`.

Those are the only two `rm` calls under `evals/native-auth`. The canary auth path, when cleanup fails, throws `NativeCanaryError` with the phase `cleanup` and drops the raw reason. I read that path. I did not launch a canary.

## Executed proof

Bun was `/tmp/flow-v2-toolchain/node_modules/.bin/bun`, version 1.4.0. The runner pid for the corrected probe was 14038. The fake CLI and loopback relay never called the native binary or pid 76572. Fetch was limited to `http://127.0.0.1`. Writes stayed under `/tmp/flow-v2-native-auth-review-r3`.

`boundary-probe.ts` calls the public `dispose` methods. It records message, name, stack, cause, own properties, Bun location fields, and `util.inspect` output. Needles were the owned path, its basename, `ELOOP`, `ENOTEMPTY`, `EACCES`, the release body `private-release-sentinel`, the relay sentinel, and the capability.

Results in `boundary-results.json`.

- Host ELOOP after a successful release. Disposal rejects. The owned directory remains under the renamed parent. One release. A second concurrent call returns the same error. After the probe restores the path, another dispose returns that same error and the directory is still there. The external staged client still verifies.
- Host ELOOP after a 503 release. Same public error. The release body is absent. The directory remains. One release.
- Host mode `000` child after a 503 release. This is the Round 2 chmod setup on this Mac. Removal still fails. The public error is generic. The directory remains. The release body is absent.
- Host release failure with a removable directory. The directory is gone. The public error is generic.
- Host clean disposal. The promise resolves. The directory is gone.
- Broker ELOOP after pinned close and `DELETE`. Both remote calls happen once. The directory remains. Repeated dispose is the same promise and the same error. Restoring the path does not remove it.
- Broker mode `000` child. Close and `DELETE` happen once. The directory remains. The public error is generic.
- Broker relay-stop injection. The real server stops, then the injected sentinel throws. Stop runs once. Close and `DELETE` do not run. The directory is removed. The sentinel is absent from the public error.
- Broker clean disposal. The promise resolves. The directory is gone.

Every rejected case has `cause` absent. The stack is `NativeAuthError` at `refuse` in `protocol.ts:37`. Bun also sets `line`, `column`, `sourceURL`, `originalLine`, and `originalColumn`. `sourceURL` is `evals/native-auth/protocol.ts`. Those fields do not contain the scratch path.

The first probe attempt exited 1. `commands.json` still says that. The fixture refresh was not `flow-native-auth-source-owned`, so broker startup correctly refused before disposal. The probe also treated Bun's source-location fields as a leak. I corrected the fixture and the allowlist, reran, and exited 0. `boundary-rerun.json` records that. The first log was overwritten by the rerun.

The focused offline command was one run of six files. It passed 63 tests, skipped 1, and failed 0, with 306 `expect` calls, in 2.96 seconds. The skip is `native canary loads sealed auth before seeding, exports before cleanup, and uses only the source bearer`. That test is the opt-in live canary. The 63 passes are this file list, on this machine, once. They include the four new disposal regressions, the same-account alias registration, the dead-pid cleanup with no close or `DELETE`, and the presealed-byte checks. They are not an OpenAI or xAI qualification.

Scoped `tsc` for the two auth modules and the two focused tests produced an empty log and exit 0. Biome checked 20 scoped files and applied no fixes. Root `tsc`, the root suite, build, pack, and Git did not run.

## Retained corrections

`repro-results.json` reruns the Round 1 cases against the current source.

- A live pinned pid with a failed identity lookup removes the directory, returns the generic error, and sends no close or `DELETE`.
- A dead fixture pid removes the directory and resolves, with no close or `DELETE`.
- A matching identity with a failed `DELETE` removes the directory, returns the generic error, and attempts close and `DELETE` once.
- Replacing the host configuration file with a directory no longer blocks attachment removal. Disposal succeeds.
- Conflicting method ownership rejects with an empty registration list and an empty relay log.
- Overlapping source resolves stay at `maxResolveDepth` 1, across 26 resolves and 24 overlapping entries. The single-flight and aborted-hook hypotheses stay withdrawn.

`lease-results.json` records wrong capability 401, overlap 409, a late old resolve 503, a stale release 503, and the replacement lease check 200.

`artifact-results.json` stages the current client and matches the retained owner bytes. The aggregate is `sha256:e8e4bed74dd1266ac3e1c4cd149918b8ffa35391afac0b098f95eb2930333c1b`. Reversed canonical keys keep that hash. Active verification refuses the prior aggregate `sha256:8e3c149d61b2f4998787e4729ea5207504d566684aea6b0fb0f7f4595ec31e4c`. Six retained 9.x canaries regrade at a 2030 clock with no `nativeAuth` field.

The native receipt under `review-r1-fixes` remains owner-executed. I did not rerun `tests/native-auth-native.test.ts`.

## Hashes

Start and end scoped hashes match. `closeout-hashes.json` shows no scoped drift after the corrected probe. Freeze mismatch is empty. The only differences from the Round 2 hash map are the four files named in `review-r2-fixes/freeze.json`.

`src/platform/opencode` was hashed only to keep it out of the auth comparison. 23 files, aggregate `710bb0f711f879e8f9a109acec068ea5652f589cd6cfa4a02b3208c3d6b59a5a`, unchanged from the start of this review to closeout. That is a window observation. It is not a core review. Product `d3d46d92` stays blocked by the separate compaction defect.

The full scoped map is `initial-hashes.json`. It matches `final-hashes.json`.

## Bounds

A failed memoized disposal does not retry removal after the directory becomes removable again. The directory stays until something else removes it.

The host attachment method returns a new promise on every call. The inner cleanup promise is the memoized one. Concurrent public calls in this probe shared one release and one rejection object.

Bun's extra error fields name the `refuse` throw site. They are part of the public error object. They do not carry the scratch path in this run.

No built-in OpenAI or xAI paid qualification ran. A real account route can still reject an unsupported layout. The sealed client hash does not prove a provider accepted the request.

The supplied comment inventory was read. Comment Sicko did not run. The two added production lines contain no comments. No new comment verdict is claimed.

## Rerun

`python3 /tmp/flow-v2-native-auth-review-r3/run-checks.py` repeats the hash gate, the six-file tests, both probes, the lease proof, the Round 1 repro, scoped types, and lint. The boundary probe in that script is the corrected one. It should exit 0. The copy of `commands.json` from this session still shows the first boundary exit of 1.
