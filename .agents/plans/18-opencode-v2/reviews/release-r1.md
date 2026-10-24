ISSUES. Two P2 defects remain open at the reviewed snapshot. The parent has read both reproduction artifacts and assigned fixes to the canary owner. Concurrent fixes do not change this round's verdict. They require a fresh review round.

Reviewer model is gpt-6.1-sol with high reasoning effort, as reported by this runtime. This is one independent read-only review. No siblings or delegates were spawned.

1. P2. Remove ambient host configuration before canary launch.

`scripts/canary-run.ts:66` retains OPENCODE_CONFIG, OPENCODE_CONFIG_CONTENT, and OPENCODE_CONFIG_DIR. The later launch cleanup at lines 77 through 93 strips Flow overrides and assigns temporary HOME/XDG paths, but leaves these host selectors intact. The cached pinned 2.1.4 binary reads all three. OPENCODE_CONFIG_DIR selects a configuration root independently of XDG_CONFIG_HOME.

This lets ambient config and plugins enter a canary whose measured config digest covers only fixture/opencode.json. The run therefore does not prove isolation to the approved fixture. Remove these ambient selectors before dependency setup, version checking, and server launch, or set explicit fixture-owned replacements. Keep required provider access deliberate. Add sentinel tests for the selectors.

`environment-repro.json` shows the current function preserving all three synthetic values. `vendor-environment-evidence.json` records the pinned binary's code excerpts and SHA-256. The exact function was transpiled without its imports after an unrelated evaluator import temporarily failed. No host was executed. Live contamination is not claimed as observed.

2. P2. Bind native close evidence to the supplied durable Flow session.

`scripts/eval-canary.ts:889` accepts a supported assurance projection plus a matching assurance summary from any completed manager flow_session_close. `completionSupportedFromDelivery` at line 296 compares check IDs/statuses and conclusion. It does not link the close request's sessionId or operation to the supplied Session v5 document parsed at line 799. Native calls retain their input at line 720, but this check ignores it.

A transcript and a different closed Session document can pass when their assurance statuses agree. `recordCanary` and qualification bundle regrading reuse this derivation. Digest checks preserve the selected bytes without proving that they belong together.

`evidence-splice-repro.ts` uses the current positive native fixture and the actual deriveCanaryResult. It gives the close call a correctly nested request naming session:unrelated while preserving the supplied document's closure fields. `evidence-splice-repro.json` reports passed and all six checks true. The supplied durable session ID is <redacted-id>.

For the v2 path, require the close request and returned operation/closure to match the Session ID, closure operation, and revision. Bind reviewer completion to the durable assignment/run in the same chain. Reject missing/conflicting identities. Add a swapped-session regression. Keep the historical derivation unchanged. A similar weakness exists in the historical verifier; this finding concerns the newly added native path, not historical byte drift.

The release flow inspected in this round selects a versioned profile, freezes the campaign plan, derives canary checks from retained evidence, seals/regrades the qualification bundle, compares rebuilt unpacked contents, and restores the sealed raw archive before publication. The following checks passed within this review's authority.

- 76 offline tests passed with zero failures. This comprises 27 release/native-canary/restoration tests, 25 historical canary tests, 9 charging/preparation tests, and 15 documentation contract tests. One Git-creating preparation test and three default-launch tests were filtered out. Logs are focused-tests.txt, historical-canary-tests.txt, charging-tests.txt, and documentation-tests.txt.
- The 10.0.0 profile contains 17 required cases on two distinct route providers, 144 primary cells, and 34 environment reserves. Each cell uses its manager model for review. Recovery is off, and canonical release evaluation requires Linux and host 2.1.4 without host/reviewer overrides. These are scheduling cells, not paid dispatch limits.
- Base-code comparison independently reproduces the original 9.1.0 through 9.6.0 policy and host hashes. All six match the current code and historical-policy-baseline.json. Old host policy remains 1.18.31. See historical-policy-comparison.json.
- All 1,562 tracked retained canary/qualification files match base commit 8103f1cd42e1b4d111f25d2a311935d4e41fb997 byte for byte. The CHANGELOG tail beginning with 9.6.0 is unchanged. See history-check.json.
- All six 9.x canary records verify offline in retained mode at a 2030 clock, without rewriting evidence. See historical-canary-verification.json. This is historical verification, not a current freshness claim.
- The artifact-restoration test proves that an equal unpacked manifest permits sealed raw-byte restoration. Wrong version and changed contents are rejected. The v2 release workflow invokes bundle restoration before strict publication evidence verification. The normal tag/ref, durable-record, trusted-publishing, and reconciliation paths remain in place. No publication was attempted.
- actionlint passed for both changed workflows. The latest-2.x compatibility resolver rejects non-2 stable versions. Pinned Linux live smoke remains a separate CI job. See actionlint.txt.
- Package/lock metadata agrees on Flow 10.0.0, exact 2.1.4 development plugin/client/schema dependencies, plugin/schema peer eligibility >=2.1.4 <3, and exact Zod 4.6.7. The current built TUI imports the plugin's leaf API. A final packed installation was not built or launched in this round.
- README and maintained docs state the tested 2.1.4 minimum, later-tested-2.x support, V1 removal, single native package installation, object options, and active-session closure before upgrading. The release cadence exception is explicit. No active V1 launch path was added in the reviewed canary code; historical preparation is readable but refused for active launch.
- The existing local wiki verifier was copied with only its output path redirected into this review directory. It passed all 293 checks across 45 pages. All inventory hashes match the local wiki. See verify-wiki.py and wiki-linkverification.json. Public pages were not read and publication remains held.

Existing live receipts were read as evidence with limits. /tmp/flow-v2-canary-implementation/flow-canary-native-live-HYujPD/verification.json reports a real 2.1.4 host, loopback provider, three fake requests, one launch charge, native export before cleanup, and a stopped host. Its test source confirms a synthetic plugin and a fake npm shim/dependency symlink. It is useful launch/export/termination evidence. It does not qualify the actual Flow package, Linux, real provider behavior, or the two findings above. Its JSON is not a source-hash seal for this final working tree. I did not rerun it under the no-host/no-model fence.

The outstanding release gates are not additional code findings. Full deterministic checks on the final integrated tree, frozen installation, replay/audit, final packed smoke, canonical Linux CI, final TUI interaction proof, exact paid matrix and canary approvals, paid qualification, evidence sealing on the frozen candidate, final artifact identity, publication, clean released installation, and public wiki readback remain unverified by this reviewer. No full-green or ready-to-publish verdict is given.

The new study protocol port and actual-usage proof are outside this review. The native evidence regrader owner is still porting host traces and grader consumers. This report does not certify those active changes. I read qualification integration only far enough to trace the scoped canary and artifact gates. The supplied 61-canary-test and two-qualification-test owner reports were not substituted for this review's direct checks.

Snapshot evidence is in snapshot-start.json and snapshot-end.json. HEAD is 8103f1cd42e1b4d111f25d2a311935d4e41fb997 on feat/opencode-v2. This is a dirty integration checkout, not a committed or frozen candidate. The initial manifest hashes 121 scoped files. The final manifest includes six late-read dependency hashes. Review findings apply to these unchanged file hashes.

- scripts/canary-run.ts SHA-256 bb74105030924591606f66104a1ba469073fffc70462d4d2bcfd457541fea06c.
- scripts/eval-canary.ts SHA-256 a5e62d6e86ddd74404c68410cfdf92d4c40530041c88cbf7f6ce3d5cc29d79b6.
- evals/release-policy.ts SHA-256 3a1c9b15097501440a44762d45e0cff20ee725cd40408498c5cd0cbfdc339a28.
- scripts/release-metadata.ts SHA-256 544d8b4095562016e6e919a273bb097ec4c6856c6f330543a41dcb60cd89cd43.
- scripts/restore-exact-release-artifact.ts SHA-256 d596cd54f8c0faad9030d400960ed402aecc54f895c4079bc925ec5791c7d1c1.

During review, .agents/plans/18-opencode-v2/decisions.tsv and docs/release-qualification.md changed. I reread the new decision rows and the final canary command instructions. They do not resolve either finding. Exact before/after hashes are in snapshot-end.json. An import check also encountered HostTraceSchema missing from evals/host-trace.ts while another owner was working. This is transient integration evidence, outside the reviewed defects. The direct function reproduction avoided that import chain. Later edits have not been verified in this round.

The local review runtime was Bun 1.3.14 and Node 26.12.1, rather than the repository's Bun 1.4.0 and CI Node 24. This limits the test receipt. The parent owns authoritative pinned-toolchain reruns.

Poteto workflow receipt follows. The full poteto-mode SKILL.md and inline Principles index were read. No trusted sticky receipt was present, so cross-turn activation was not asserted. The how Investigation/Critique path ran sequentially because the parent prohibited delegates. The user-requested finding format replaces the general explanation format. The existing comment review was inspected; this round files no style or comment findings and does not self-certify a new independent comment pass. Throughput checkpoint is n/a for a read-only investigation.

Prove It Works changed the review from relying on owner summaries to executing offline regressions, comparing actual historical bytes/base hashes, and preserving reproductions. Boundary Discipline changed the checks toward the launch environment and cross-file evidence binding. No application data model was written or redesigned. No architecture implementation workflow was invoked. Unslop and technical-writing shaped this report's wording, not code findings.

All review writes are confined to /tmp/flow-v2-release-review-r1. No main-checkout edits, Git writes, delegates, network/connector calls, host launches, provider/model calls, paid calls, goals, automations, commits, pushes, PRs, or tags were made.

The handoff drift check is final-drift.json. It records later changes separately from the reviewed hashes. Concurrent fixes remain unverified until a fresh round.
