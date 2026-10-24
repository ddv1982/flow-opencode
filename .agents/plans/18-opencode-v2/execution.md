# Implement the OpenCode 2 migration

The user authorized implementation on 2026-10-24.
The integration branch is `feat/opencode-v2`, based on
`8103f1cd42e1b4d111f25d2a311935d4e41fb997`.

## Completion gate

Flow 10.0.0 loads on the pinned OpenCode 2 host. Its commands, tools,
permissions, source-bound validation, automatic continuation, and model picker
pass their real-host checks. The packed package, evaluation tooling, README,
and maintained documentation agree on the v2 contract. Historical release
evidence remains verifiable. Qualification and publication follow the existing
release process after their concrete approval gates.

## Scope and rigor

The current host adapter has 17 TypeScript modules plus the terminal entrypoint.
The evaluation host and packed live smoke add two large integration paths.
This migration changes execution identity and permission enforcement, so the
runtime contract probes precede implementation. Domain and persistence behavior
remain fixed. Temporary breakage is confined to the integration branch.

## Throughput checkpoint

The first blocking path is runtime proof, followed by the server adapter and
continuation attribution. Two investigators own separate disposable directories.
One probes server behavior and identity. The other probes terminal loading and
dependencies. Both use Codex gpt-6.1-sol with high reasoning and priority service.
They cannot edit this checkout. The parent restores the pinned toolchain,
captures the baseline, integrates code, and runs authoritative checks.

Prefer a rerunnable probe over repeated manual inspection. Do not parallelize
product writes until the observed contracts establish independent ownership.
Paid model calls and release publication remain gated on concrete proposals.

## Execution sequence

1. Capture the baseline and prove phase 0 contracts in isolated host homes.
2. Compare attribution designs against those observations and select one.
3. Port the server adapter and prove its identity and validation boundaries.
4. Port the model picker and prove its terminal behavior.
5. Port evaluation and release tooling while preserving historical hashes.
6. Update maintained documentation and prepare the separate wiki diff.
7. Run complete deterministic and real-host verification before candidate freeze.
8. Prepare qualification, exact-artifact canary, and publication for their gates.

Each unit records its hypothesis, change, evidence, and verdict in
`decisions.tsv`. An inconclusive runtime observation does not pass a gate.

## Integration checkpoint

The first migrated whole-suite run had 133 failures. The second had 4,398
passes, 25 skips, and 13 failures. The remaining failures were native-event
fixtures, stale host pins, cancellation fixtures, and an exact grader-source
snapshot changing while the qualification test ran. The later complete check passed 4,461 tests with 25 skips and zero failures.
That check predates the combined compaction and retry fix and the evaluator
shutdown and isolation fixes. A final complete run remains required.

The native evidence port retains strict V1 serialized schemas and adds a V2
trace with endpoint-bound sessions and composite tool identities. It does not
invent assistant parents or independent part IDs. Its 314 focused tests passed.
The initial native command marker is persisted before admission. Exact packed
host probes prove runtime compaction continuity. The final export alone cannot
prove that continuity.

Independent release review found ambient configuration inherited by canary
launch and a missing identity join between native close evidence and the durable
Flow session. Both were fixed and passed independent release review R2. Evaluator review R2
found separate credential-drain and ambient reviewer-variant defects. Their
source fixes pass focused tests and typecheck. A fresh eval review remains due.

The draft qualification schedule has 180 primary manager dispatches, 46 reserve
dispatches, and two route probes. Its maximum is 228 top-level dispatches.
Internal generation is separate. This draft has no spending authorization and
is not a dollar cap. Canary authorization remains separate.

The user selected existing OpenCode 2 accounts as the authentication source.
A synthetic source-owned OAuth resolver passed its bounded mechanism tests.
Its production integration remains in progress. This selection does not
authorize paid model calls. No real credential values belong in evidence, logs,
arguments, or repository files.

## Final Typesafe configuration addition

The user requested an option to choose the environment variable containing the
Typesafe API key. Implement this after the core and authentication integration,
before final packing and qualification. Preserve `TYPESAFE_API_KEY` as the
default. An explicit name reads only that variable. Missing or blank values keep
advice unavailable, and errors must not include values. Update the README and
maintained configuration documentation. Verify custom-name activation, default
behavior, missing custom values, invalid names, and recovery-off isolation with
a fake transport. No live Typesafe request is authorized by this addition.


## R8 frozen candidate

Attack the Premise separated native summary permission from live execution
provenance after the R7 archive failed cancellation followed by manual compaction.
The selected input ledger owns admission, readiness, lifetime, frontier, and
historical lineage. Request attribution owns primary and tool identity. The
compaction boundary validates native control, reason, prefix, and delivery.
Interrupted ordinary history can summarize without an execution origin. Known
automatic tombstones cannot take that fallback. Unmatched callbacks cannot revoke
a different accepted source. Repeated checked continuations reuse their origin.

The source freeze is `/tmp/flow-v2-compaction-r8-bnmny7om/freeze-final.json`.
The parent verified its ten files and all 75 actual server map contents. A
separate parent supplement records one accepted test-comment deletion after
all runtime byte audits closed. Product source and archive bytes did not change.

The proof candidate is `/tmp/flow-v2-candidate-r8/opencode-plugin-flow-10.0.0.tgz`.
Its raw SHA-256 is `fc19ca4a55a8f1684fe9e1c988adce2536a667a339a3a0e622d0c2e39518195d`.
Its unpacked manifest SHA-256 is
`667d6029038248b4222e28c8e5f7656bf1534286441335925faa4c2d20f3c95a`.
Linux reproduced the exact raw archive. Both systems passed the unchanged native
smoke with 119 assertions. Both canonical checks passed 4,700 tests with 27 skips
and zero failures across 184 files. The macOS/Linux assertion counts are 98,734
and 98,731. These runs precede only the comment deletion, which changes no test
expression. Generated runtime receipts stay outside the commit.

The exact archive passed all 16 continuation profiles and the original
interrupted-ordinary/manual-summary sequence, then a separately accepted ordinary
input executed its protected tool. The normal recovery harness passed three tests
using four native hosts with zero claims and no overlay. Both picker routes passed
eight phases. Source maps have 75 server rows and five TUI rows across 77 unique
project paths. Recorded 120-by-36 terminal cells passed visual replay inspection;
this does not claim live native font or pixel verification.

Fresh independent core R8 review passed after packed smoke, with 496 offline
tests and no actionable source findings. The other review verdicts remain scoped. Same-model auxiliary retry, native overlapping context,
and unread original-control correlation remain unproved. The trailing-history
and pre-dispatch concurrency neighbors are component evidence. No real account,
paid provider call, Git publication, or release is covered by these results.


## Actual-account smoke and observation gap

The implementation was committed as
`d233a0cca136d35f84c57b77d0e22f1583e654e0`. Commit and push preflight passed.
The user approved two top-level dispatches on openai/gpt-6.1-sol, one route probe
and one plan-only-stops attempt, including normal native OAuth refresh. The
existing-account relay and route probe passed. The scenario failed after one
completed flow_status with no plan or session document. Both claims remain
consumed. The relay exited cleanly and removed its private connection file.
No new ledger, account use, or paid rerun is authorized by this result.

The private receipt is `/tmp/flow-v2-prepush-20261024/result.json`.
The retained case replays its failure without divergence. It does not reveal the
paid native idle outcome, assistant finish, or transport close/cancel sequence.
The report's quiet end is not proof of native success. Offline native fixtures
show the evaluator can return quiet for a failed idle without assistant error.

Two diagnostic designs and a fresh cross-judge selected the existing V2 trace
as the owner of optional terminal facts. The correction preserves V1 schemas and
historical records. It keeps provider errors separate from non-retryable native
host failure. It changes neither plugin cancellation nor product grading on
unobserved terminal evidence. See [terminal evidence](terminal-evidence.md).

A separate bounded Responses fixture reproduces the completed-tool stopping
shape when protocol completion arrives before physical EOF. The actual native
Responses parser uses Stream.takeUntil on response.completed and cancels the
remaining body. Flow currently treats that consumer cancellation as failure.
The source guard then blocks the automatic next request. The normal-close
control reaches a second request. This is a demonstrated compatibility mechanism,
not proof of the old paid cause. Its receipt is
`/tmp/flow-v2-paid-smoke-investigation/responses-addendum/report.md`.
The final control reproduced the failure without any observer HTTP/body hooks.
Exactly one host and two cases ran; all owned processes were stopped and awaited.
Client cancellation remains unobserved in that control. Its report is
`/tmp/flow-v2-paid-smoke-investigation/responses-addendum/unwrapped-confirmation/report.md`.
Core correction designs must preserve true interruption, error, stale
ownership, pending admission, and retry guards. No epoch may be resurrected.

The investigator accidentally imported a helper with an argv initialization
side effect. It rewrote initial-binding.json before host launch. The investigator
reconstructed the receipt from preserved ordered content, but no independent
preincident checksum exists. That receipt was not immutable throughout the turn.
The original report, paid inputs, archive, and mapped source hashes have separate
unchanged bindings. Preserve the incident disclosure; do not reconstruct again
or use the reconstructed receipt as independent before-image proof.

## Terminal evidence and stream contract checkpoint

The evaluator correction is frozen across 19 source and test files. Its owner
ran 293 focused tests, typecheck, and lint. The parent verified the freeze and
independently ran 74 focused tests with 467 assertions and no failures. Fresh
independent correctness and comment reviews are in progress. Historical paid
records, V1 evidence, product source, and the fc19 archive remain unchanged.

The core design must distinguish HTTP reader lifetime from input authority and
native tool settlement. Static source embedded in the pinned 2.1.4 executable
publishes assistant finish and completed time after waiting for tool fibers.
Requiring those fields before admitting the first tool would therefore create
a circular dependency. Streamed time alone is not clean-success evidence.
The offset-bound source receipts are in
`/tmp/flow-v2-stream-completion-design/native-source-contract/`.

The first bounded pre-tool prototype stopped before dispatch because its live
plugin list was empty. It measured no assistant fields and establishes no native
contract failure. One corrected attempt uses explicit location selection and
observed plugin readiness before its two loopback cases. No account or paid
provider calls are authorized. The core design cross-judge remains in progress;
no core implementation has been selected or changed at this checkpoint.

The stream-completion cross-judge rejected both proposed completion barriers.
They require assistant fields that native publishes after its tool-fiber join.
The request-lifetime alternative remains a question pending the native negative
cases. It retains the response proxy and immediate read/status failures while
separating consumer cancellation from input-epoch revocation. No implementation
authorization follows from that judgment.

The installed Promise plugin adapter passes the signal supplied by
Effect.tryPromise directly into ToolContext. Effect creates that signal's abort
controller and aborts it when the waiting effect is interrupted. These exact
package-source bindings are recorded in `native-source-contract/tool-signal-receipt.json`
under the disposable design directory. They establish the adapter mechanism;
they do not claim a live held-tool interruption measurement.

The corrected ordering prototype passed readiness and exact hook ordering on one
host and two cases. Both held native calls gained streamed time after the server
terminal. Finish, error, and completed time remained absent before release for
both completed and failed Responses markers. The unchanged archive refused both
calls after release. This confirms the completion barrier problem but does not
measure the actual Flow callback's signal. The report is
`/tmp/flow-v2-paid-smoke-investigation/responses-addendum/pre-tool-contract-corrected/report.md`.

One disposable request-lifetime prototype is now authorized locally. It copies
the archive entry and changes only its captured cancel callback plus a bounded
measurement barrier inside the actual tool callback. Repository product source
and archive bytes remain frozen. The prototype tests completed and failed
Responses markers, a public user interrupt before mutation, and a separately
accepted fresh input. Its modified entry is not an exact-package qualification.
No account, paid provider, or new spending ledger is involved.

Independent evaluator review R1 reproduced one precedence regression. A closing
failed idle replaced an otherwise deliberate unanswered-question escalation, and
outcome collection then retained it as the attempt failure. The parent reproduced
the same result with an output-only copy of the review fixture. The original
review receipts remain unchanged. A bounded fix must keep the native idle on the
trace while preserving the question stop for that invocation. It must reset at
the next command and leave native failure primary at ordinary stall, deadline,
child-read, and cancellation boundaries. The report is
`/tmp/flow-v2-terminal-evidence-review-r1/report.md`.

The existing evaluator owner is implementing that fix and the seven accepted
comment deletions in its two-file fence. The original 19-file freeze remains an
immutable record; the correction will have a separate freeze and a fresh R2
review. Product execution source remains untouched by this evaluator work.

The disposable lifetime prototype completed one host and four synthetic
dispatches. Completed/open allowed the actual tool and automatic next request.
Failed/open left the already-issued read-only tool signal un-aborted; that tool
completed and native idle then failed. Public interruption aborted the actual
plan-save callback signal and persisted no mutation. A fresh ordinary input in
the same session saved revision 1 with only its own operation. The parent checked
the exact two replacement spans and reversal and reread the persisted document.
The report is `/tmp/flow-v2-stream-lifetime-prototype/report.md`.

The selected synthesis is
`/tmp/flow-v2-stream-completion-design/synthesis/decision.md`. Consumer cancel
ends only the captured HTTP resource, as EOF already does. Exact admitted-input
and native tool proof stay required, and definite read/status failures retain
their owned revocation. Whole-assistant confirmation flights and new state are
rejected. The existing core owner may change attribution and its minimal tests;
lifecycle policy changes require a concrete missing-boundary reproduction first.
The provider-failure cell is a recorded native boundary limit, not rollback or
failed-provider mutation proof. No production package or paid-cause claim is
derived from this prototype.

The current writers have separate file fences. The evaluator owner changes its
wait and terminal tests. The core owner changes request attribution and its
focused tests. Prior artifacts stay immutable. The parent owns integration and
the next package. This keeps diagnostic precedence separate from execution policy.

## Combined candidate after the stream correction

Both implementations are frozen. The core production diff is one cancel callback
calling finish instead of fail. Lifecycle source is unchanged. The evaluator
retains native terminal facts and preserves a selected question escalation for
that invocation. A fresh command or prompt gets its own observation.

The new archive is `e8d85c5339d1aa058493088a61a6410b5785a6462f65aed09b73de01ef6dd7d9`.
Its unpacked manifest is
`ce2b3bf96a6cf3e57c987df65d8da3ae97abbcd4b20294266841b6c3d2088985`.
Candidate and map bindings are in `/tmp/flow-v2-candidate-stream-lifetime/`.
Linux reproduced the exact raw archive. All 12 installed files match.

The unchanged packed smoke passes all 119 assertions on macOS and Linux.
Normal recovery passes three tests on four native hosts with zero claims.
Both picker routes pass eight phases. The continuation lane passes 16 profiles
and the exact public-interrupt/manual-summary/fresh-input sequence. The unwrapped
Responses gate passes normal-close and completed/open cases, each with a real
tool result, automatic second request, and succeeded idle. These are synthetic
checks. They neither qualify a paid provider nor identify the original paid cause.

The first complete checks failed four fixture assumptions about the added
pre-dispatch metadata/transcript read. The parent prepared and verified four
test-only ports outside the repository, then applied them after every package
QA lane closed. The original failing logs and freezes remain. The ports preserve
the single actual progress-poll assertion and separately assert the command
boundary read. All 153 affected tests pass. Production and archive bytes did not
change. Final combined hashes are in `combined-freeze-final.json`.

Final canonical checks each pass 4,744 tests, with 27 skips and zero failures.
The macOS and Linux assertion counts are 99,135 and 99,132. The logs are
`/tmp/flow-v2-stream-lifetime-check-macos-final.log` and
`/tmp/flow-v2-linux/stream-lifetime/full-check-final.log`. Replay matches all
13 gated cassettes. Dependency audit and actionlint pass. Documentation remains
within both existing byte budgets. Two comment reviews have no open findings.

Independent evaluator R2 passed and closed F1 after checking the expected
fixture-only supplement. It ran 301 focused tests and independently checked the
27 final hashes. Its report is `/tmp/flow-v2-terminal-evidence-review-r2/report.md`.
Core R9 passed after inspecting the exact archive and running 525 focused tests
with 3,061 assertions and no failures. Its report is
`/tmp/flow-v2-core-review-r9/report.md`. The parent read both full reports and
verified the canonical results separately. Native overlap, auxiliary retry, and
unread-control correlation limits remain. Recorded terminal-cell replay passed
on the new capture; this does not claim live terminal font or pixel verification.

The pre-push smoke proposal is a draft only. No new authorization or ledger has
been created. The original two claims remain consumed and their failed report
stays unchanged. Commit and push preflight remain before a new paid proposal.
