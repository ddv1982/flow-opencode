# F1 parent verification

Commit f10c386 retains independently regradable outcomes and integrates F2 host
observations into reports. The full gate in check-accepted.log passes 988 tests
with 5,084 assertions and one opt-in live skip. Replay reproduces all 13 gated
cassettes. Independent review passes. No paid campaign was run.

The old grader falsely passed an exit-zero incorrect fixture. The final grader
rejects it. A parent probe additionally rejects forged stdout, a forged receipt,
argument-iterator pollution, NaN/null coercion, and a Map masquerading as plain
JSON. Correct ordinary execution and trusted startup still pass. See
adversarial-head.json and its rerunnable script.

Thirty local known-good farewell grades measured a median 8.054 ms
with the old grader and 93.402 ms after the retained-grader commit.
The raw committed sample is grader-committed.json; its generic helper label
still says working-F1. The graded source files were unchanged from f10c386. This exceeds
the 10% investigation threshold. The extra 85.348 ms buys
source/runtime integrity checks, durable evidence, and fresh authenticated probe
processes. These are evaluator costs, not measured plugin latency. Retain the
checks rather than reverting to exit-status trust. This small fixture is not a
campaign-wide performance estimate. Grader runtime objects deduplicate by digest
inside a campaign; very small standalone grades pay fixed evidence overhead.

The development bank has 12 contracts. The 12 confirmation contracts were
created and checked by an isolated corpus owner, then sealed. No model candidate
consumed them, and the parent never read their contents. The final manifest hash
is dbb52b76d38a967329342deed33b7fe042c7836f9ca268a0115e0c3c519b1898.
The owner checklist explains the draft seal change for argument-preservation
controls. No human calibration or comparative improvement is claimed.
