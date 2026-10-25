# Flow 10.0.0 release review, round 2

Verdict: PASS.

Reviewer model is grok-4.7. This is the cross-family audit of the Codex round 1 review, which reported gpt-6.1-sol. No second reviewer examined this round 2 trail. Critique mode's spawn-critics step was skipped because the parent forbade delegates. That limit fails closed.

Both round 1 P2 findings are closed on the current source. This round found no new causal defect in the scoped canary, release policy, restoration, workflows, package metadata, or maintained release docs. PASS covers that scoped code. It does not approve publication, paid qualification, or a frozen release.

HEAD is `8103f1cd42e1b4d111f25d2a311935d4e41fb997` on `feat/opencode-v2`. The checkout is dirty. The history check saw 154 porcelain entries. `CHANGELOG.md` is the only dirty path under `evals/canary`, `evals/qualification`, and `CHANGELOG.md`. Scoped file hashes did not change between `snapshot-start.json`, `snapshot-end.json`, and the final repro. `final-drift.json` records no drift.

## Closed findings

### Round 1 P2. Ambient host selectors before canary launch. Closed.

`scripts/canary-run.ts:62-79` `canaryLaunchEnvironment` copies the inherited environment, sets `PWD` to the fixture, deletes `FLOW_EVAL_AUTHORIZATION` and `TYPESAFE_API_KEY`, deletes every `OPENCODE_*` name except `OPENCODE_API_KEY`, and deletes `NODE_OPTIONS`, `NODE_PATH`, `BUN_OPTIONS`, and `BUN_PRELOAD`. Launch calls this function before `npm install`, the version check, and `opencode serve` (`scripts/canary-run.ts:126-190`). It then sets `OPENCODE_FLOW_REVIEWER_MODEL` from the approved model argument.

The independent repro injected `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CLI_CONFIG_CONTENT`, `OPENCODE_MODELS_URL`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_SERVER_PASSWORD`, an unapproved reviewer model, the experimental websocket and native-LLM names, Node and Bun preload hooks, `FLOW_EVAL_AUTHORIZATION`, and `TYPESAFE_API_KEY`. The returned environment kept `OPENCODE_API_KEY` and the four provider keys. The ambient selectors were absent. `repro-final.json` matches the first repro.

The pinned local binary at the plan-host cache, SHA-256 `d8a65dd253dbea759ae0dd829792ff219b40178c7decffea822430a4d1ccadb3`, contains `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CLI_CONFIG_CONTENT`, `OPENCODE_MODELS_URL`, `OPENCODE_MODELS_PATH`, `OPENCODE_SERVER_PASSWORD`, and `OPENCODE_DISABLE_PROJECT_CONFIG`. It does not contain `OPENCODE_EXPERIMENTAL_WEBSOCKETS`, `OPENCODE_EXPERIMENTAL_NATIVE_LLM`, or `XDG_CONFIG_DIRS`. The binary was not executed. `vendor-env-names.json` records the scan.

`tests/canary-run.test.ts:304` asserts the same removal. That test passed in this round.

### Round 1 P2. Native close evidence bound to another session. Closed.

For package versions at or above 10, `deriveCanaryResult` (`scripts/eval-canary.ts:891`) parses the supplied document with `SessionSchema` and applies `nativeClosedSessionMatches` (`scripts/eval-canary.ts:336-373`) and `nativeCompletedRunsMatch` (`scripts/eval-canary.ts:376-426`). Historical versions skip both binds because `boundClose` and `boundRuns` are forced true when `native` is null (`scripts/eval-canary.ts:939-955`).

The close request must parse and canonical-equal `closureRetryRequest(session)`. That request carries the supplied session id, closure operation id, kind, and expected revision. The response operation id and revision, closure entity, archived projection, and delivery projection must match that same session. Reviewer completion must match the durable feature run's feature id, assignment, summary, expected revision, result, committed operation, and entity, including source and validation digests on the run. `closes-with-delivery` requires both binds and the existing assurance-status check (`scripts/eval-canary.ts:1012-1017`).

The repro used the current native fixture. The positive control passed all six checks. Putting `session:unrelated` on the close request failed `closes-with-delivery`. A different valid durable session with equal assurance failed. Swapping validation and review source digests failed `captures-validation` and `closes-with-delivery` while the assurance JSON stayed equal. The focused suite also passed the native splice and reviewer-binding tests named in `focused-tests.txt`.

## Checks run in this round

Bun was `/tmp/flow-v2-toolchain/node_modules/.bin/bun` 1.4.0. The focused command was `bun test` on these seven files: `tests/release-1000.test.ts`, `tests/canary-v2-native.test.ts`, `tests/canary-run.test.ts`, `tests/restore-qualified-artifact.test.ts`, `tests/documentation-contract.test.ts`, `tests/eval-canary.test.ts`, and `tests/paid-budget.test.ts`. Result: 114 pass, 0 fail, 600 `expect()` calls, 2.17s. Log: `focused-tests.txt`.

`releaseCatalog("10.0.0")` has 17 cases. Two models on distinct route providers produce 144 primary cells and 34 environment reserves. Every cell's reviewer model is its manager model. `releaseReviewerModel("10.0.0", alternate)` returns that alternate manager. `releaseHostPolicy("10.0.0")` is OpenCode 2.1.4, Linux, `reviewerSteps` null, `ambientConfig` `"disabled"`, `transport` `"http"`. `assertReleaseModels` (`evals/release-policy.ts:330-347`) requires exactly two models on distinct route providers. `assertReleaseHost` (`evals/release-policy.ts:447-472`) rejects a recovery API key, a non-Linux platform, and host or reviewer overrides. The measured v2 policy digest is `sha256:86953cd5da1a0af6a541243abd1d8b92ec5d4c2e0aff26334a5be1d21187c3f6`. The 144 and 34 figures are scheduling cells. `docs/release-qualification.md:132-136` keeps the historical 9.6.0 dispatch example separate and tells the operator to derive the v2 dispatch limit from frozen scenario steps, followups, and route probes. `runPaidCanary` consumes one canary dispatch at `scripts/canary-run.ts:59` before launch, and it refuses a preparation whose `schemaVersion` is not 2 (`scripts/canary-run.ts:47-50`).

Current `evals/release-policy.ts` reproduces the baseline policy and host digests for 9.1.0 through 9.6.0. All six match `.agents/plans/18-opencode-v2/historical-policy-baseline.json`, and each host pin is 1.18.31. Digests are in `repro-final.json`. This comparison imports the current module. It does not execute the base commit's file as a separate program. The retained evidence bytes are a separate check below.

`git diff --name-only 8103f1cd42e1b4d111f25d2a311935d4e41fb997 -- evals/canary evals/qualification` is empty. Those directories contain 1,562 tracked files. The `CHANGELOG.md` bytes from `## [9.6.0]` through the end match the base commit. Tail SHA-256 `a57ea2d173e2ba978d06341442c08067ebaf6cc0a719aad902558e8df3ab39be`. The base file begins with the changelog title and then 9.6.0. The working tree inserts the 10.0.0 notes before that heading.

All six retained 9.x canary records regrade through `canaryRecordIssue` with freshness `retained` at `2030-01-01T00:00:00.000Z`. Each returns no issue, status `passed`, and derivation `canary-evidence-v1`. The same records under freshness `required` return `Canary is expired.` This is offline historical verification. It is not a freshness claim for a 10.0.0 canary. Evidence: `historical-canary-verification.json`.

`scripts/restore-exact-release-artifact.ts:46-60` checks the sealed digest, compares `unpackedManifestSha256` of the rebuilt tarball and the sealed bytes, and only then overwrites the rebuilt path with the sealed raw bytes. A digest or content mismatch throws before the write. The focused restoration test passed. `.github/workflows/release.yml:132-136` restores a major version of at least 10 on the verify job when `evals/qualification/archives/${version}.json` exists. The publish job at `.github/workflows/release.yml:246-249` always materializes that archive for a major version of at least 10, so a missing archive fails the publish job. `scripts/release.ts:248` sends ordinary publication through `assertStrictReleaseEvidence`, which checks the canary record and rederives it from retained bytes before the bundle regrade (`scripts/release-metadata.ts:490-532`). The verify job's pre-publication command uses `--mode dry-run`. Dry-run prints the verdict and does not set exit code 1 (`scripts/eval-canary.ts:1922-1936`). Strict mode does. No publication was attempted.

`actionlint` exited 0 for `.github/workflows/release.yml` and `.github/workflows/opencode-compatibility.yml`. Output file `actionlint.txt` is empty. The compatibility job resolves `@opencode/cli@2` and keeps versions matching `/^2\.\d+\.\d+$/` (`.github/workflows/opencode-compatibility.yml:36-38`). Both reviewed workflows pin checkout, setup-node, and setup-bun, and they pin Bun 1.4.0 and Node 24. The live registry was not queried.

`package.json` is Flow `10.0.0`, `packageManager` `bun@1.4.0`, engines `node >=24`, peers `@opencode/plugin` and `@opencode/schema` `>=2.1.4 <3`, dependencies `zod` `4.6.7` and `saxes` `6.0.0`, and devDependencies `@opencode/plugin`, `@opencode/client`, and `@opencode/schema` at exact `2.1.4`. `bun.lock` records the same versions. Published `files` include `README.md` and `CHANGELOG.md`. They do not include `evals/`. `OPENCODE_HOST_VERSION` is `"2.1.4"` (`evals/opencode-host.ts:13`). `openCodeInvocation` rejects a version below 2.1.4 and any version outside stable 2.x (`evals/opencode-host.ts:15-44`). `prepareCanary` reads `package/package.json` from the packed artifact and refuses a package that does not target OpenCode v2 (`scripts/eval-canary.ts:1376-1386`).

`registerHttpTransport` sets provider, model, and variant `settings.transport` to `"http"` (`src/platform/opencode/http-transport.ts:3-18`). `src/platform/opencode/plugin-composition.ts:154` calls it. Release and preflight host starts pass `ambientConfig: "disabled"` (`evals/run.ts:828` and `evals/run.ts:1113-1116`). The canary writes the same HTTP setting on provider, model, and default variant (`scripts/canary-run.ts:101-118`) and reads it back before the prompt and again before export (`scripts/canary-run.ts:266-304`). Installed `@opencode/schema` 2.1.4 defines transport as optional `"http"` or `"websocket"`.

README, CHANGELOG, `docs/index.md`, `docs/quickstart.md`, and `docs/release-qualification.md` state the tested 2.1.4 minimum, later tested 2.x support, removal of OpenCode 1, object options, and active-session closure before an upgrade. The cadence exception for 10.0.0 is explicit in `docs/release-qualification.md:94-97` and `CHANGELOG.md:5-9`. README lines 50-51 disclose HTTP transport selection while Flow is loaded.

The local wiki verifier was copied from round 1 with its output path moved into this directory. It passed 293 checks across 45 pages. `wiki-summary.json` and `wiki-linkverification.json` record the result. Resolution was local files and anchors. Public pages were not read.

The parent-pointed tarball `/tmp/flow-v2-candidate-review/opencode-plugin-flow-10.0.0.tgz` hashes to `224f3c78b5376a6178356fd7e37fb31420b31c147f4b1db1617ab582e0dd843e` (366,774 bytes). This round hashed that file. It did not install it, launch it, or treat another owner's packed receipts as measurements.

## Limits of the PASS

These are limits of what the passing code proves. They are not additional filed defects.

Launch-time `assertProviderHTTP` accepts a selected model whose `settings.transport` is absent, and it rejects a present value other than `"http"` (`scripts/canary-run.ts:285-286`). Provider transport and the selected variant must be `"http"`. The fixture writes all three. `deriveCanaryResult` seals artifact, installation, actors, host, and platforms (`scripts/eval-canary.ts:1035-1049`). That digest does not include the provider readback or `run.json`. An offline regrade of a recorded canary does not re-prove HTTP transport.

`canaryLaunchEnvironment` keeps provider API keys. It also leaves proxy and certificate variables untouched. The repro preserved `HTTPS_PROXY`. Provider access is intentional. A proxy can still redirect that access. This round did not treat that as an ambient OpenCode config selector.

`evals/harness.ts:1994-2000` deletes only `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, and `OPENCODE_CONFIG_DIR` when `ambientConfig` is `"disabled"`. Release and preflight pass that flag. The canary strip is wider. Harness, study protocol, and active fixture ports were not reviewed to completion. The difference is recorded so a later eval review can close it. It does not reopen the canary finding.

`evals/README.md:349` says historical 1.18.6 policies remain readable with their original hashes. Release policy, README, CHANGELOG, and `docs/release-qualification.md` state the 9.x release host as 1.18.31. `evals/` is outside the published package files. This sentence was not filed as a packed-doc defect. Study protocol remains outside the completed review.

The machine Node is v26.12.1. The focused tests and repros ran on Bun 1.4.0. CI pins Node 24. This round did not rerun the suite on Node 24.

`npm exec --yes` in `openCodeInvocation` can fetch a host package. This round did not launch a host, call a model, or make a network request.

## Unverified gates

These gates remain open. They are not code findings from this round.

Full deterministic `bun run check` on the final integrated tree, frozen installation, replay, and audit were not run here. Canonical Linux CI was not run. A final packed install and smoke were not run here. TUI interaction was not observed. Exact paid matrix approval, paid qualification, evidence sealing of a frozen 10.0.0 candidate, final artifact identity after that seal, publication, a clean released installation, and public wiki readback remain unverified. No 10.0.0 canary record was regraded because that live evidence is not in the retained 9.x set. Owner live and packed receipts were not executed again and are not this reviewer's measurements.

No commit, push, pull request, tag, or publish was made.

## Snapshot hashes

Round 1 hashes for the two files that changed:

- `scripts/canary-run.ts` was `bb74105030924591606f66104a1ba469073fffc70462d4d2bcfd457541fea06c`. It is now `39fff632e149c3a458c536be6062f7d63e47b7f2d05caf19d2eb1bfe4695fe45`.
- `scripts/eval-canary.ts` was `a5e62d6e86ddd74404c68410cfdf92d4c40530041c88cbf7f6ce3d5cc29d79b6`. It is now `e7f38a3c50b6ee7ffc7c2a19cfa383848206704753a3a27c2649a1b40ab11513`.
- `evals/release-policy.ts` was `3a1c9b15097501440a44762d45e0cff20ee725cd40408498c5cd0cbfdc339a28`. It is now `bd4405901cd5c7576c12f4a4284bc174fd316e805381f0cb572caab4986bf2e9`.

Unchanged from the round 1 snapshot:

- `scripts/release-metadata.ts` `544d8b4095562016e6e919a273bb097ec4c6856c6f330543a41dcb60cd89cd43`.
- `scripts/restore-exact-release-artifact.ts` `d596cd54f8c0faad9030d400960ed402aecc54f895c4079bc925ec5791c7d1c1`.

`scripts/export-canary-native.ts` is `963f2fcba75f7d23e9a0096b820c2cb6b7f876cb14ef7cb41f7dac8fc00b52f2`. The full 36-file manifest is `snapshot-end.json`.

## Poteto receipt

The poteto-mode skill and its inline Principles index were read before the reproductions. Leaf skills applied here were how (Critique), principle-prove-it-works, principle-boundary-discipline, principle-fix-root-causes, principle-build-the-lever, principle-test-behavior-not-implementation, principle-explain-the-number, principle-outcome-oriented-execution, unslop, technical-writing, and show-me-your-work. No trusted sticky receipt was present.

Prove It Works replaced owner summaries with the repro, the 114-test run, the retained-byte diff, and the six-record regrade. Boundary Discipline kept the review on the launch environment and the session identity chain. Fix Root Causes reran the splice and the ambient selectors against the current functions. Build the Lever kept those checks in `repro.ts` and `historical-verify.ts`. Test Behavior Not Implementation judged observable status and check booleans. Outcome-Oriented Execution confirmed schema 2 refusal and the 2.x host gate. Explain the Number ties 17, 144, 34, 114, 1,562, and 293 to the commands above. Unslop and technical-writing shaped this report's wording. Show-me-your-work wrote `decisions.tsv`. No application data model was written. No architecture implementation workflow was invoked.

throughput checkpoint: n/a, read-only investigation

All review writes are under `/tmp/flow-v2-release-review-r2`. No main-checkout edits, Git writes, delegates, network calls, host launches, provider calls, paid calls, commits, pushes, pull requests, or tags were made.
