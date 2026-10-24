Bounded PASS. No causal bug found in the configurable Typesafe key source or the explicit internal-off correction. No release approval is given.

The review covers the frozen `plugin.ts`, `typesafe-key-env.ts`, and `typesafe-key-env.test.ts`, plus the current name-option documentation. I read the supplied handoff, hash inventory, and decisions. The three implementation and test hashes match the handoff. The three documentation hashes already differed when review began, consistent with the parent's stated shortening. No finding requires a source fix. There are no severity-ranked defects or failing product reproductions to report.

Overview.

The data shape is a setup-scoped `() => string | undefined` reader. `resolveTypesafeApiKeyReader` selects and validates one environment variable name. The wrapper closes over that reader for both bare `/flow-auto` defaults and the actual Jev provider. The key value remains a runtime lookup. Each setup creates its own closure and controller.

For an operator, a custom name selects only that variable. A populated default cannot substitute for a missing or blank custom value. The maintainer inherits a small configuration boundary without changing composition dependency signatures or adding a V1 adapter.

How it works and reviewed boundaries.

- [typesafe-key-env.ts:6](/Users/vriesd/projects/flow-opencode/src/platform/opencode/typesafe-key-env.ts:6) treats omission and explicit undefined as the default name. Null and other non-string values are invalid. The two character checks reject empty names, leading digits, punctuation, padded names, Unicode, CR, LF, and NUL. They avoid the trailing-newline exception of an anchored JavaScript `$` alone. Names are not trimmed.
- [typesafe-key-env.ts:13](/Users/vriesd/projects/flow-opencode/src/platform/opencode/typesafe-key-env.ts:13) emits a fixed warning and returns an unavailable reader for invalid configuration. A production probe verifies exactly one warning across repeated commands and provider assessments. Flow status remains operational. Neither the invalid value nor synthetic credentials appear in the observed logs or status.
- [typesafe-key-env.ts:18](/Users/vriesd/projects/flow-opencode/src/platform/opencode/typesafe-key-env.ts:18) captures the environment object, not the key value. Every invocation checks `Object.hasOwn`. Inherited getters are not touched. Own entries named `constructor`, `toString`, and `__proto__` work. Deleting an own value leaves it unavailable even when an inherited value exists. Nonblank values are trimmed. Blank values return undefined. Environment values in production are strings or undefined.
- [plugin.ts:8](/Users/vriesd/projects/flow-opencode/src/platform/opencode/plugin.ts:8) exports the existing `opencode-plugin-flow` ID. The installed SDK is `@opencode/plugin` 2.1.4. Its actual `dist/promise/plugin.js:1-3` implements `define` as an identity function. Its `Plugin.setup` contract permits a cleanup promise. Therefore the inner definition does not register a second native plugin, and returning `.setup(ctx)` preserves the cleanup result.
- [plugin.ts:23](/Users/vriesd/projects/flow-opencode/src/platform/opencode/plugin.ts:23) still passes this module's `import.meta.url` to composition. A production status probe compares `runtimeIdentity.pluginEntrySha256` with the independently computed SHA-256 of that entry file. It matches. This proves the source entry path, not a future packed bundle.
- [plugin-composition.ts:138](/Users/vriesd/projects/flow-opencode/src/platform/opencode/plugin-composition.ts:138) retains disposal ownership. The wrapper probe verifies that disposal removes tools, commands, event subscriptions, and hooks. Repeated disposal is harmless. A fresh setup in the same workspace remains operational. A rejected command registration also cleans its earlier registrations and leadership before a fresh setup succeeds.
- [plugin.ts:25](/Users/vriesd/projects/flow-opencode/src/platform/opencode/plugin.ts:25) uses the same reader as the provider. Two production contexts selecting different names remain isolated after both setups exist. Adding, rotating, and deleting synthetic environment values changes the next command default and assessment header. Mutating the original option after setup does not change the selected name. The wrong default remains unused.
- [jev-decision-provider.ts:82](/Users/vriesd/projects/flow-opencode/src/infrastructure/jev-decision-provider.ts:82) reads the key before transport. The unchanged transport uses `Authorization: Bearer <selected key>`, the existing Typesafe endpoint, and redirect mode `error`. Literal fake-fetch headers verify the selected trimmed value. The observed request bodies, status, and logs do not contain the synthetic credentials. No new persistence or telemetry path receives the key.

The off correction.

[plugin.ts:16-22](/Users/vriesd/projects/flow-opencode/src/platform/opencode/plugin.ts:16) disables this source when the recovery object has mode exactly `off`. It does not broadly interpret another recovery schema. Both ambient and custom keys then remain unavailable to the provider, and bare `/flow-auto` has no shadow defaults.

[command-hook.ts:119-126](/Users/vriesd/projects/flow-opencode/src/platform/opencode/command-hook.ts:119) still gives explicit command settings precedence. With internal plugin-off, an explicit shadow command can display its explicit limits while the provider remains unavailable. The probe observes two calls and $0.01 in that status, zero fetch calls, and a direct provider result of `missing-key`. This is consistent with the stated source-disable contract. It is not an authentication bypass.

With command `--recovery=off` alone, status is off and setup, command, and status issue zero fetch calls. A separate direct provider assessment can still use the configured reader. The next bare command can enable the normal shadow defaults again. That direct assessment is synthetic and bypasses the recovery controller deliberately. It is not evidence of a runtime recovery request while off.

The controller still establishes its existing invocation and retry fencing when advice is off. The wrapper neither supplies delegated settings nor changes authority policy. Shadow remains six attempts and $0.02 by default. Nine surrounding source files, including composition, controller, lifecycle, command handling, leadership, and Jev provider and transport, match the prior core R5 inventory exactly. See [core-comparison.json](/tmp/flow-v2-typesafe-env-review-r1/core-comparison.json). Native OAuth machinery was not reviewed here.

Verification.

The tests ran with the pinned `/tmp/flow-v2-toolchain/node_modules/.bin/bun`, version 1.4.0. The driver uses a synthetic environment allowlist, an isolated home and temporary directory, and macOS `sandbox-exec`. The [sandbox profile](/tmp/flow-v2-typesafe-env-review-r1/offline.sb) denies network operations and filesystem writes outside this review directory. Production fixture children also inherit that sandbox. Existing test fetch spies and the added fake fetch handle all assessments.

- [focused.log](/tmp/flow-v2-typesafe-env-review-r1/focused.log) records 92 passing tests, zero failures, and 331 assertions across the six requested focused files. I read all 37 new tests, including the fixture setup and subprocess isolation. The provider spy preserves the real implementation. Production tests assert native command status, literal auth headers, missing-key results, and zero pre-assessment requests.
- [challenges.log](/tmp/flow-v2-typesafe-env-review-r1/challenges.log) records eight additional passing probes and 576 assertions. They cover ASCII validation, omitted undefined, inherited environment getters, deletion, unusual invalid JavaScript values, per-context isolation, runtime rotation, option freezing, entry hashing, cleanup, setup failure, both off paths, and one generic production warning.
- [documentation.log](/tmp/flow-v2-typesafe-env-review-r1/documentation.log) records 15 passing tests and 126 assertions. Maintained prose is 106,656 bytes within 107,100. The older handoff's budget failure is superseded. I checked the current README, maintainer contract, and troubleshooting text for the name-only option and server environment. Native-account documentation remains surrounding work.

The first added cleanup probe guessed two subscriptions and observed three. Source inspection identified the existing composition, model-preference, and lifecycle subscriptions. I changed only the temporary probe to assert active subscriptions before cleanup and zero afterward. The original failed run remains in [challenges-first.log](/tmp/flow-v2-typesafe-env-review-r1/challenges-first.log). No product change was made to obtain passing tests.

Run the complete bounded verification again with:

```sh
python3 /tmp/flow-v2-typesafe-env-review-r1/run-checks.py
```

The driver exits nonzero if any selected check fails. To rerun only the added probes, append `challenges`.

Identity and drift.

[scoped-before.sha256](/tmp/flow-v2-typesafe-env-review-r1/scoped-before.sha256) and [scoped-after.sha256](/tmp/flow-v2-typesafe-env-review-r1/scoped-after.sha256) record all six feature-owned files. The code hashes remain:

```text
9f4e1a64fc3106a98f7496b4f915e6f9c31eabac8c2cd21bc247beb7a517d688  src/platform/opencode/plugin.ts
7d935e078b49a82ec3e1ffab5526158375ee55194b6c6bcf38b4fadfa044132d  src/platform/opencode/typesafe-key-env.ts
91bf9142043a12664a8d7c2eaba5d9206f393a878b401df4b53e7b315fa897b0  tests/typesafe-key-env.test.ts
```

[before.json](/tmp/flow-v2-typesafe-env-review-r1/before.json) and [after.json](/tmp/flow-v2-typesafe-env-review-r1/after.json) cover 6,746 files under source, tests, scripts, docs, evals, and root-level files. This inventory excludes Git internals, node_modules, dist, and .agents. [drift.json](/tmp/flow-v2-typesafe-env-review-r1/drift.json) is empty. No captured file changed during the review. [handoff-comparison.json](/tmp/flow-v2-typesafe-env-review-r1/handoff-comparison.json) separates pre-existing documentation changes from review-time drift. SDK and supplied evidence hashes are in [evidence-sha256.json](/tmp/flow-v2-typesafe-env-review-r1/evidence-sha256.json).

Principles and workflow receipt.

Poteto Mode and its inline Principles index were read in full. How ran sequentially under the user's no-agents fence. The Investigation output is this cited explanation and judgment. Throughput checkpoint is n/a for a read-only investigation. No trusted sticky-hook receipt was present, so no cross-turn activation is claimed.

- Model the Domain named the setup-scoped reader before writing the probes. The context matrix checks one fixed name with changing values rather than treating options as stored credentials.
- Boundary Discipline focused validation attacks on configuration and environment lookup. It kept OAuth machinery and controller policy outside this option review.
- Test Behavior, Not Implementation chose production setup, observable status, literal headers, and empty registrations after cleanup. It also removed the unsupported exact subscription-count assumption from the temporary probe.
- Prove It Works required inspecting actual SDK semantics and source hashes, then limited proof to source plus the fake host and transport actually exercised.
- Build the Lever produced `run-checks.py`, `snapshot.py`, and the rerunnable `challenges.test.ts` inside the assigned directory.

The technical-writing and unslop skills shaped the report. The no-comments skill was read. Its independent reviewer could not run under the user's explicit no-agents instruction. The supplied inventory contains three public-contract comment keeps in `evals/harness.ts` and zero suppressions. I read that inventory and scanned the three feature TypeScript files for comment and suppression markers, finding none. This is not an independent comment review.

Trail audit and limitations.

[decisions.tsv](/tmp/flow-v2-typesafe-env-review-r1/decisions.tsv) records this run's choices and the probe correction. Rows were checked against this conversation's tool results and the files cited above. No supported task-history tool was used and no private history store was read. The rerunnable [audit.py](/tmp/flow-v2-typesafe-env-review-r1/audit.py) validates evidence pointers, final check results, report links, marker scans, and matching snapshots. Its output is [trail-audit.json](/tmp/flow-v2-typesafe-env-review-r1/trail-audit.json). Evidence files resolve. The first probe failure is preserved rather than hidden. Cross-model trail review did not run because agents were forbidden.

I made no repository edit, Git write, build, pack, network request, paid call, real-credential read, native user-service operation, connector call, or persistent task creation. Global typecheck and lint were owner-reported and were not independently rerun here. The fixture calls production setup against installed SDK interfaces, but it is not a running OpenCode server. Linux behavior, the final packed artifact and entry hash, native auxiliary runtime behavior, and native OAuth proof remain with their owners. No final archive was claimed to contain this source.

Attention.

reviewed by none for the cross-model trail audit.

The parent must still build once the source reviews close and run the final native packed gates. This PASS closes only the bounded configurable-key source review and the stated internal-off correction.
