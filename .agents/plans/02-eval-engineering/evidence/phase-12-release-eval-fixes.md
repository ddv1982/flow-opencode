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

The second frozen 42-attempt matrix, `2026-08-26T02-07-37-746Z.v2`, proved
resume at 3/3 on both providers but exposed that moving the evidence checkpoint
instruction had removed the separate red-gate handoff rule. All six red-gate cells
failed the same missing-choice check. Its report SHA-256 is
`c97eebb4e725f15620f9360b63936fc7f66605e30d88eed9ace2fff319f5f498`.
The final guide restores that rule and requires extra-evidence handoff to copy the
plan command byte-for-byte. This matrix and its canary are diagnostic only.

The final full candidate matrix, `2026-08-26T03-22-55-256Z.v2`, passed 41/42.
Its only miss durably saved a same-platform focused command as extra evidence,
then stopped at the resulting assertion checkpoint. The report SHA-256 is
`2a3f552de47c12bb18d6b16b1a75fd0b7bde69d15d8b60c5a8a638046f7a752e`.

Plan save now rejects OS extra evidence on the gate platform. Current-host focused
checks stay in feature validation; non-OS services, credentials, settings, and
devices use `other`. The exact failed OpenAI resume case then passed 3/3 in
`2026-08-26T09-48-15-333Z.v2`, report SHA-256
`7a384b1699d928b6b2c14e19fa7988e3fae59ce7872ab8797da7e7fbd95619a6`.
The full gate passes 546 tests with one intentional skip.

The full matrix on the plan-boundary candidate passed 41/42. The only miss
contained a structured Windows environment and exact `bun test` command handoff,
but the grader required imperative prose. Report
`2026-08-26T10-08-51-154Z.v2` has SHA-256
`01d8237db8e3de3a17f778298cd9b290b7ddd2dbae036d65c4cb478cf8e1005d`.
The grader now accepts either an affirmative exact-command instruction or a
structured environment-plus-command handoff. Immutable canary JSON is excluded
from Biome and remains protected by dedicated schema and digest verification.
