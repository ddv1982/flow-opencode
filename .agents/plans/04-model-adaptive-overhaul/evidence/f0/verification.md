# F0 verification

The original capacity probe accepts a 4,096-operation session and rejects its
4,097-operation close at the old schema. `capacity-base.json` records the failure.
`capacity-head.json` records the same probe succeeding after the change.

`focused.log` records 81 passing tests and 512 assertions across domain,
capacity, inspection, assurance, and filesystem persistence. Boundary cases
include an exactly 4 MiB active session, maximum escaped closing text, all
accepted operation IDs, archive reload and replay, oversized open files,
nonterminal admission, tampered terminal state, and validation replay.

`replay.log` records all 13 gated cassettes matching. `live-smoke.log` records
21 passing checks and 84 assertions against packed Flow in OpenCode 1.18.6.
The smoke verifies package and host integration without paid model requests.
It does not prove model-driven slash-command behavior.

`check.log` initially records 840 passing tests, one skipped live test, and one
documentation budget failure. `check-final.log` records the final complete check with 842 passes, one skipped
opt-in live test, zero failures, and 4,512 assertions. A later wording-only
clarification passed the focused documentation check in `docs-final.log`.
Commit `c4b1d9d` contains this F0 boundary. `commit-preflight.log` records staged
preflight. The optional gitleaks scanner was unavailable. The installed deslop
skill was absent, so cleanup used direct diff review, the independent comment
review, typecheck, lint, and the repository checks.

`close-perf.ts` performs five warmups and 30 measured filesystem close, archive,
and exact replay operations on each version. Median latency is 1.157146 ms at
base and 1.2433125 ms at head, a 7.45% increase within the 10% investigation rule.
These local filesystem timings do not estimate model latency or workload-wide
performance. Capacity behavior is checked separately by the boundary regressions.

## Remaining qualification evidence

The ten model-driven live lanes and terminal screenshots/video in overview.md
are not claimed complete. No paid model campaign has run. The local code checks
and packed host smoke establish narrower facts. No merge or release is claimed.
Legacy v5 revision values already at Number.MAX_SAFE_INTEGER remain readable but
cannot receive a safe successor. This exception is explicit in the contract.
