# OpenCode v2 core review, round 2

Verdict: ISSUES.

One current P2 defect remains. A primary request that fails before the response hook causes the next valid turn to fail. The specific response-stream and context-setup failures named in R1 are fixed. The initial native marker is present. The R1 marker verdict also contradicts its own recorded source identity, as detailed below.

This is an independent review of the working tree on `feat/opencode-v2`, with HEAD and base both `8103f1cd42e1b4d111f25d2a311935d4e41fb997`. The migration remains uncommitted. No production files, Git state, or other owners' artifacts were changed. All review writes are under `/tmp/flow-v2-core-review-r2`.

## Finding

### P2. A request failure before any response rejects the next valid turn

Primary location: `src/platform/opencode/lifecycle.ts:659-661`.
Related locations: `src/platform/opencode/execution-attribution.ts:294-297`, `src/platform/opencode/lifecycle.ts:441-442`, and `src/platform/opencode/lifecycle.ts:556-560`.

After the HTTP request hook succeeds, the frozen primary has phase `request`. If the provider connection fails before a Response exists, `ExecutionAttribution.response()` never runs. The lifecycle's `session.execution.failed` handler calls `revoke()` but never ends that primary. The same omission applies to an interruption before a Response exists.

The next real input or `/flow-auto` command can be accepted and activate its new lease. Its context hook then encounters the old primary in phase `request` and throws `Flow primary contexts or streams overlap`. The catch ends the old primary and revokes the newly activated lease. The user must submit another fresh input to recover. This affects ordinary primary turns as well because the context and HTTP hooks are registered for all sessions.

The offline reproduction uses the existing in-memory lifecycle fixture and unchanged production `registerFlowLifecycle`. It emits context, then HTTP request, then a native-shaped execution-failed event without a response. It accepts a fresh command and invokes context. The first fresh context throws the overlap error and its authority is null. A second fresh command's context succeeds. The script makes zero network requests.

Reproduction command:

```sh
/tmp/flow-v2-toolchain/node_modules/.bin/bun /tmp/flow-v2-core-review-r2/pre-response-failure.ts
```

Evidence is [pre-response-failure.ts](pre-response-failure.ts) and [pre-response-failure.json](pre-response-failure.json). This proves the production lifecycle state transition offline. It is not a newly executed native-host connection-failure proof.

Minimal recommendation: cover request failures and aborts that never produce a response. Terminalize the affected primary before a fresh context is admitted, while preserving exact-primary and epoch protection against a delayed old failure ending a replacement primary. Add regressions for a rejected connection and an interruption before response arrival, each followed by one successful fresh input. Do not rely on the next context's overlap catch to perform cleanup.

## R1 disposition

1. The listed cancel, read-error, missing-body, locked-body, stale-response, and context-setup paths are closed. `ExecutionAttribution.end()` marks the exact primary terminal. The failure callback revokes only when that primary is still current. Context failure cleanup ends its owned primary. The focused regressions include late cancellation rejection and a duplicate old response after a replacement exists. The pre-response hole above is a remaining terminal path, not the original permanent wedge.
2. The initial marker issue is closed for the current source. `lifecycle.ts:334-345` allocates the token and includes it in the native user payload before `session.prompt`. Receipt ID, type, and payload are checked before activation. `command-hook.ts:138-142` activates with that same token. Pending or mismatched receipts do not grant execution authority.

R1 provenance needs a correction. Its `decisions.tsv` scope row at line 3 says the marker patch was unlanded, and its verdict row at line 6 says the missing marker is in the hashed source. Both point to lifecycle hash `1e8d5991dcaa756ef19484a6219dcca980551f201d21676c63534019af463772`. The retained historical marker entry's sourcemap contains source bytes with exactly that hash and already contains token allocation and `metadata: { [FLOW_AUTO_METADATA_KEY]: invocationToken }` at lines 334-344. I recomputed the hash from `sourcesContent`. Therefore the recorded R1 identity does not support its missing-marker claim. I cannot reconstruct a different unhashed source state the R1 reviewer might have seen.

The copied R1 log is [receipts/08-decisions.tsv](receipts/08-decisions.tsv). Historical receipt identity and current checks are in [evidence-checks.json](evidence-checks.json). Preserve the old trail and add a superseding correction in the parent's audit. I did not edit R1 artifacts.

## Checked without another finding

The production model is an admission registry, a frozen primary per native session, immutable assistant and call bindings, and a current epoch. Prompt attempts revoke. They do not grant an origin. Context establishes positive authority only from accepted local admission or a matching native real-input candidate. Stale origins are checked before HTTP and before native tools carrying automatic authority. Flow tools are checked again after permission and identity awaits. No event-prefix positive authority or summary-text authority was introduced.

Automatic compaction continuity uses the exact native running automatic control ID, then requires that same completed ID and live authority at resume. Manual and mismatched controls cannot retain the grant. Reviewer completion permits any verified `flow-reviewer` child in the matching workspace. It does not require a specific assignment-manager parent. Other permitted callers use exact accepted replay.

The HTTP helper at `http-transport.ts:6-16` updates every enumerated provider, model, and variant's settings. It preserves other settings. Composition registers it before agents, lifecycle hooks, and tools, and retains disposal in its cleanup list. The provider editor exposes inactive providers as well. A provider or transport override registered later is not silently attributed. The primary WebSocket handshake still throws and revokes. The local transport receipt shows bare and no-op-hook cases using WebSocket, and the forced case using HTTP even with the WebSocket variant selected. This is one local OpenAI Responses fixture, not official-provider qualification or a guarantee about every third-party transport.

Reserved roles use deny-all followed by explicit read permissions. The worker adds edit with `.flow` and `.git` denials, including absolute-path patterns. The reviewer adds only the two intended Flow actions. Native tools explicitly assert their permission action. I did not run the host permission matcher in this review.

Validation capture joins session, assistant, call, role, workspace, exact command, exit, and completeness. Unknown exit or completeness stays ineligible. Spilled output requires a native exited shell record and a matching output suffix, with at most one native trailing LF. The safe reader checks its host output directory and file shape. JUnit evidence must be fresh. Persistence recomputes source identity and marks source drift ineligible. I independently read and hashed the retained 400000-byte shell output. It matches the receipt's `sha256:90bf37cbb6f8580766aceb9b7973ffd59e1441599574ec68d4983ba9314f7112`.

Preference persistence uses a shared atomic store and stale-revision checks. Server writes recheck project options, model availability, activity, abort, and unload before commit. The picker preserves independent roles, project precedence, reset behavior, and configured variant restoration. Picker choices clear the base variant. The independent-server receipt explicitly limits shared activity detection to the shared native store. It does not establish an atomic barrier against a prompt beginning in another process after the scan.

The server and TUI builds externalize the native packages and Effect. Runtime native imports stay at host adapters, the TUI entry, and the RPC contract. The native plugin package supplies its client and Effect dependencies. V1 schema bridging is deleted. Final isolated install and platform qualification remain release gates.

## Verification and artifact identity

I ran the following with Bun 1.4.0 and an owned temporary directory:

```sh
PATH="/tmp/flow-v2-toolchain/node_modules/.bin:$PATH" TMPDIR=/tmp/flow-v2-core-review-r2/tmp bun test tests/execution-attribution.test.ts tests/lifecycle.test.ts tests/opencode-native-core.test.ts tests/auto-drive.test.ts tests/validation-capture.test.ts tests/tool-parentage.test.ts tests/config-shared.test.ts tests/model-preferences.test.ts tests/model-preferences-store.test.ts tests/model-picker.test.ts
```

Result: 233 passed, zero failed, across those ten files. [focused-tests.log](focused-tests.log) contains the output. This is focused unit and component evidence. The separate reproduction above covers the missing terminal case. No full-suite, typecheck, lint, Linux CI, or qualification result is claimed from this run.

While I reviewed, the continuation owner replaced the top-level native marker and stream receipts with newer packed-candidate receipts. I saved the retained versions in [receipts](receipts) and recorded their SHA-256 values in [receipt-hashes.json](receipt-hashes.json). The retained stream receipt reports 22 named assertions. The marker receipt reports zero lineage issues for the original native user message and two synthetics. These are receipt results, not host runs performed by this reviewer.

For both updated receipts I independently verified the archive SHA-256, installed entry bytes, loaded entry hash, source map hash, archive entry and map bytes, and every mapped production source against the working tree. All comparisons passed. The candidate archive SHA-256 is `224f3c78b5376a6178356fd7e37fb31420b31c147f4b1db1617ab582e0dd843e`. Its loaded entry SHA-256 is `486ed90cabb81dcd2ff59c7dd5785b0f4226fe3d876edea59c124d78c9f01c63`. See [evidence-checks.json](evidence-checks.json). This binds those specific probes to the reviewed source. It does not make the archive a final release artifact, and it does not cover the finding above.

No source or initially inventoried test hash changed between the start and end of this review. [initial-hashes.json](initial-hashes.json) and [final-hashes.json](final-hashes.json) record the comparison. Any subsequent production fix requires a fresh independent round and artifact checks.

## Scope and limitations

The review inspected every changed or added production source under `src/`, the deleted adapter, package build boundaries, and relevant core and picker tests. Additional surrounding sources were read for completion replay, source binding, and recovery invalidation. [reviewed-files.sha256](reviewed-files.sha256) records 49 reviewed file identities, including a deletion marker for `schema-adapter.ts`.

Main eval tooling remains another owner's work. It was not reviewed as completed implementation. Its exported lineage predicate is supported here only by the retained marker receipt. Historical parent suite counts were not adopted as my measurements.

No native host, provider server, model, paid call, network call, browser, connector, delegate, goal, or automation was launched. Preference tests use ordinary local Bun subprocesses. No Git writes occurred. No new terminal visual proof was attempted. The reported Terminal denial, visual gate, official-provider proof, final packed gates, Linux CI, paid qualification, and release approval remain outside this source verdict. Comment style was excluded as instructed.

## Decision trail and principles

[decisions.tsv](decisions.tsv) is this run's canonical trail. I audited its rows against the current conversation, actual tool outputs, source, and retained files. The prior R1 trail was independently checked against its cited source identity. No supported history lookup was needed beyond the supplied task digest and live files. No claim of independent review of my own trail is made because this task forbids another agent.

Model the Domain changed the review from a list of error handlers to a check of terminal transitions for `context`, `request`, and `streaming`. That exposed the response-less request path.

Boundary Discipline kept the marker check on accepted native payloads and the transport review on provider settings and HTTP or WebSocket hooks.

Prove It Works changed the evidence check to actual archive, entry, map, compiled source, and shell bytes. It also required the offline reproduction before retaining the P2 finding.

Test Behavior, Not Implementation kept the reproduction on accepting fresh input and observing its failed context and lost lease. It did not assert private calls.

Explain the Number kept parent-reported suite totals out of this verdict. The 233 result names the exact focused files and saved output.

Outcome-Oriented Execution kept this review on the v2-only target. It did not ask for a temporary V1 path or treat intermediate progress as release completion.

## Attention

reviewed by gpt-6.1-sol

- Fix the pre-response terminal path before source freeze. The existing native stream assertions start with a Response and do not exercise that path.
- Supersede R1 decision rows 3 and 6 for the marker's recorded source identity. The retained historical source bytes contradict that part of the original verdict.
- R1's Grok 4.7 identity is parent-reported. This run independently audited its trail, but launched no additional critic and makes no new multi-model delegation claim.
- Retained runtime receipts prove their named local probes. Visual, official-provider, Linux, full-suite, and final release gates remain separate.
