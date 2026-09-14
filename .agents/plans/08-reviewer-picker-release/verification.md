# 8.4.0 offline qualification verification

Baseline 8.3.0 was independently regraded without model calls into seal
qb1-af18b890822b62b28fed6d6228818df42125d0daa37a3d0c2e9de35539dc9e3b.
All 248 retained object filenames match their SHA-256 bytes. Original campaign,
canary and earlier seals remain unchanged. This does not create new measurements.

Candidate tarball SHA-256:
ccae62aa3a575a7f8d515a67b3b93d618e4d77d0958746ff3227ff6260830170.
Candidate unpacked manifest SHA-256:
785907843d1ea1e64d7f2a550baaf9c101ae4c3f22e7db0b61ac038c46c6e086.

The real release initializer accepted the feature record, exact candidate artifact,
frozen source comparison, full baseline regrade and existing freshness limits. It
created disclosure notes and a local durable record; initialization did not publish.

Focused feature, patch, release-record and documentation tests passed (27 tests).
All 13 gated replays reproduced. Provider-free OpenCode smoke passed 21 tests,
including real global preference save/reset and preserved configuration references.
Actionlint and typecheck passed. No model prompt or paid canary was run.

CI additionally rebuilds the declared candidate on Linux and verifies its exact
artifact and qualification through the same initializer used for publication.
Publication rechecks the frozen source and baseline freshness on resume.
