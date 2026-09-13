# F1 owner checklist

- [x] Read the Poteto Principles index and applicable leaf skills.
- [x] `how` over the affected subsystem. Prior read-only grounding traced execution, grading, reporting, cleanup, and qualification.
- [x] `architect` for parallel design exploration. Snapshot and base-plus-patch alternatives were grounded before implementation; select bounded full snapshots.
- [x] Blocking first steps. Freeze shared evidence types and exclusive worker ownership before fan-out.
- [x] Independent workstreams. Reviewer controls and corpus creation use separate files; owner integrates retained grading, reports, and host cleanup.
- [x] Shared mutable state. F2 reserves provenance and host observation. Parent reserves source, docs, authoritative checks, and Git operations.
- [x] Smallest safe decomposition. Two bounded generic workers maximum; owner implements the coupled runner/store/schema path.
- [x] Delegate code-writing to bounded workers and inspect their changes. Generic inherited model pairs were unverified. Reviewer and corpus workers had exclusive files and no children or paid calls.
- [x] Verify deterministic graders, offline replay, declaration parsing, reviewer controls, and development/holdout separation.
- [x] Independent critic or parent review of meaningful changes. Parent, evidence-script reviewer, runtime reviewer, and corpus critic found concrete false-pass cases. Regression controls cover the accepted corrections. Parent owns final whole-phase sign-off.
- [x] Report exact files, focused checks, and remaining live gates.
- [ ] Rebase into small, ordered commits; stack follow-ups. Skipped here because parent owns Git operations.
- [ ] Run Opening a PR. Skipped because external writes are outside this task.

Throughput checkpoint: schema and ownership first; two disjoint worker lanes; no shared-file writes; parent integration and verification remain sequential. No paid model runs or holdout-content disclosure.

## Verification

- `bun run typecheck` passed after final code changes.
- Scoped `bunx biome check --write` passed for owner files. Child-owned reviewer and corpus files passed their scoped checks. Holdout objects were not formatted or opened by this owner.
- The 20-file focused/regression command passed 333 tests, zero failures, 1,340 assertions in 45.77 seconds. It included benchmark/reporting/pairing, report storage/rendering, snapshots, declaration parsing, retained grading/regrading, retention, reviewers, development cases, sealed-manifest checks, grader input, qualification bundles/CLI, release qualification and cancellation/reporting.
- After retaining decoded authenticated observations, the five-file receipt/snapshot/declaration/retention recheck passed 23 tests and 99 assertions in 2.66 seconds.
- After the final Unicode chunk-boundary correction and CLI identity inclusion, `bun test tests/retained-benchmark.test.ts tests/benchmark-regrade.test.ts` passed 15 tests and 43 assertions in 2.82 seconds.
- The final reviewer found that a detached descendant could keep output pipes open beyond the probe deadline. Timeout and output-limit paths now settle failure and close owned streams independently of a later process-close event. The regression settles in 5,066 ms and explicitly removes its descendant. This does not claim OS containment.
- Before commit, the new assessment field and helpers were renamed to `workflowCompleted` to reflect their existing completed-only semantics. Historical decoding is unchanged. The affected files were already included in the exact-grader source list. Typecheck, scoped Biome, and `bun test tests/eval-report.test.ts tests/benchmark-regrade.test.ts tests/completion-claim.test.ts tests/retained-benchmark.test.ts` passed. The focused run had 39 passes, zero failures, and 181 assertions in 8.09 seconds.
- Parent's whole-gate run exposed a 5,000 ms test timeout around the expanded mutation loop. Each of the 31 development mutations now has its own timed test. The final command `bun test tests/retained-benchmark.test.ts tests/benchmark-regrade.test.ts tests/benchmark-reporting.test.ts` passed 57 tests, zero failures, and 258 assertions in 14.58 seconds. Typecheck and scoped Biome also passed after these changes.
- Parent independently reproduced the old exit-zero false pass, then verified the new authenticated output controls. Exact parent performance and adversarial receipts live in the separately owned `evidence/f1-parent/` directory.

## Retention and interpretation

Snapshots preserve bounded source bytes and executable bits. A fixed per-probe runtime uses an explicit trusted Bun configuration, disabled dotenv loading, fresh reconstruction, cleared credentials, and authenticated post-call observations. The runtime has no OS sandbox. It does not claim containment of arbitrary malicious same-user code.

Offline regrading requires the matching recorded grader sources, Bun binary, installed Zod content and lockfile. It does not automatically execute historical source bundles. Expected probes and source/runtime identities bind the frozen campaign before provider work. The CLI checks transcript identity and rederives completion declarations as well as reproducing correctness receipts.

Explicit completion declarations use the same organic task instruction for both arms. Unassessed language remains unknown. The separate `workflowCompleted` field records only a durable `completed` closure. Deferred and abandoned closures remain false. Reviewer matching is a narrow synthetic control. Unmatched defective-case findings remain unassessed. Human case-label imports do not authorize reviewer promotion without per-attempt/per-finding adjudication; F1 promotion remains advisory.

## Corpus seal update

The initial formatted sealed manifest digest was `sha256:067263473809a4b006dcdb79b51babdef555efa42e098e830819c852864aa54e`. Its final digest is `sha256:dbb52b76d38a967329342deed33b7fe042c7836f9ca268a0115e0c3c519b1898`.

The corpus owner changed five opaque artifacts after review found that output-only probes did not verify promised argument preservation. The correction added 33 preservation checks and five controls that return correct outputs while mutating inputs. The manifest and integrity test were updated to the resulting bytes. The task count stayed 12 and `used` stayed false. Only reference implementations and mutation controls were checked locally. No candidate or model campaign consumed the confirmation set. No contents were disclosed to this owner or the parent.

## Remaining gates

Parent owns authoritative full check, exact packed-host verification, final independent verdict, docs, commits and phase acceptance. No provider campaign was authorized or run here. F1 establishes deterministic measurement controls and an initial synthetic development bank; it does not establish modern-model quality, reviewer calibration, or comparative value.
