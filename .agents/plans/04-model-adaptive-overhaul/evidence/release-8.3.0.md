# 8.3.0 release evidence

The authorized Linux matrix completed all 76 primary attempts: 38/38 on
openai/gpt-5.6-sol and 38/38 on xai/grok-4.6. No environment reserves were used.
All 76 retained replay cassettes reproduced. The measured commit is
ac4fdb8ca6d9f4315c11c3d1fb142a6b15c9067f, using OpenCode 1.18.6 and Bun 1.3.14.

The original fresh canary completed after a failed review requested more Git
baseline evidence and a follow-up review passed. Its two reviewer sessions share
one observed manager. The old recorder incorrectly required exactly one pair.
A second paid canary was started, then cancelled at the user's request. It is not
used as release evidence. No further paid runs are authorized or required here.

The recorder correction accepts verified reviewer retries under one manager and
still rejects unrelated reviewers, wrong parents, mixed models, and spliced
manager lifecycles. The complete original canary transcript retains both reviews;
no failure or reviewer session is filtered out to obtain a pass.

The original report, attempt records, and execution evaluator identity are
unchanged. The sealed bundle separately retains original execution authority and
current offline verification authority. Original authority hashes are checked
against the exact Git commit without executing historical code. Current code
independently regrades every retained outcome. Negative tests reject removed or
rewritten execution sources even after recomputing the bundle seal.

Publication readiness was independently VERIFIED for bundle
sha256:98dda2041423a7c3b68dbf17142d3498928c93659c38daffc538d09f8c60cbbe
and canary sha256:8de004b8718714f73b361695d0cc54c423c711064ee79decf5d4d233e5950bd6.
The measured tarball remains
sha256:f2cad40877d616a25df9f675ddbd4aeb0e0a6a342ef246e5d109a3978c891563.

Tracked release inputs live under evals/qualification/bundles/ and
evals/canary/. Local raw observations, failed preview, cancelled canary, and
verification logs remain under ignored .release-artifacts/8.3.0-linux/.
This conformance qualification does not promote the experimental compact guides
or establish reviewer calibration or model superiority.
