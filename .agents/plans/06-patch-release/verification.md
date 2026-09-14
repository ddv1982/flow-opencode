# 8.3.1 patch verification

The original 8.3.0 campaign was independently regraded offline into the new seal
qb1-c61abd32788d84b1950e7908cf3b96bc57e4dad1a6af26c950a6d3124bd2e6a4.
Original reports, model transcripts, canary, and seals are unchanged. The copied
content-addressed baseline bundle retains its own verifier source evidence.

Candidate tarball SHA-256:
29c7a3c1a4a652b5e3b95f9966d502556d944317bc73b820e2e048067e3df14c.
Candidate unpacked manifest SHA-256:
53f731df696d1a20c5ed181580ef841d73eecffab32820725291242a95e200d2.

The real release initializer verified eligibility, package identity, guidance
content, and full baseline evidence, then generated the durable local release
record and notes. This was initialization only; no publication resume was run.
The draft output lives under ignored .release-artifacts/8.3.1-readiness/.

Focused release tests passed (10), existing metadata/documentation tests passed,
all 13 gated cassettes reproduced, package smoke passed, actionlint passed, and
pinned OpenCode 1.18.6 provider-free smoke passed (21 tests). These do not run
models. The canary readiness dry-run correctly says the candidate has no canary;
the explicit patch policy accounts for that absence.

An initial initializer invocation used an abbreviated commit and was rejected by
the release-record schema. Repeating it with the full commit passed. No evidence
was weakened or replaced to resolve this input error.

The patch baseline retains the existing 72-hour canary and seven-day campaign
freshness limits. Before a later publication attempt, verify it has not expired.
CI and PR review remain required before merging/releasing the new policy.
