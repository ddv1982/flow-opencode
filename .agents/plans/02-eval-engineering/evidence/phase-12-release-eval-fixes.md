# Phase 12 release eval fixes

The first frozen 8.1.2 qualification matrix ran 42 attempts on OpenCode 1.18.6.
Grok 4.6 passed 21/21. GPT-5.6 sol passed 17/21 and exposed two repeated failure
classes. The report is retained locally as
`2026-08-26T00-23-50-754Z.v2`; its report SHA-256 is
`3224c993a9853c829cf058c11a13b1c2ae3f8fd608cb97dac243a8300f000acf`.

Two unprovable-evidence attempts named the missing Windows observation but stopped
without a next move. Compact status incorrectly projected `flow_review_start`
although final review would reject the unsatisfied extra evidence. Final runs now
project `await-user-direction`, and guidance explains the three valid moves: run
the evidence in its declared environment, defer, or abandon. The grader accepts
an explicit run-on-Windows instruction but still rejects vague requests for access.

Two resume attempts were false evaluator failures. One retried a schema-rejected
`flow_plan_save`; the other validly revised the same pending draft. The grader now
counts only successful, non-replayed revision-1 plan creations. It still fails a
real second lifecycle.

The regressions failed before the fixes. The focused runtime, prompt, and scenario
suite passes 82 tests after them. The full gate passes 545 tests with one
intentional live-smoke skip, and the final multi-model review reports no critical
or warning findings. The earlier qualification and canary artifacts remain
diagnostic and cannot qualify the changed packed candidate.
