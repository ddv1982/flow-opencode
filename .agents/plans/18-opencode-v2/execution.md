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
