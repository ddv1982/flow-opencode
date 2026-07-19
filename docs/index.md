# Flow documentation

This directory is the maintained documentation source for Flow. The README is
the public quick start; the documents below define the current implementation
and maintainer contracts.

- [Development](development.md) — build, architecture, guidance, testing, and
  release workflow.
- [Maintainer contract](maintainer-contract.md) — durable lifecycle, host,
  package, and quality invariants.
- [Causal state](causal-state.md) — revisions, snapshots, receipts, source
  identity, persistence, and evidence artifacts.
- [Review lifecycle](review-lifecycle.md) — validation, reviewer assignments,
  findings, and completion.
- [Replay](replay.md) — offline scenario and causality oracle.
- [Prompt quality](prompt-quality.md) — deterministic prompt compilation and
  evaluation.
- [Troubleshooting](troubleshooting.md) — installation and recovery guidance.
- [Architecture decisions](adr/) and [dependency boundaries](architecture/) —
  accepted design constraints.

Files under `docs/plan/` are implementation records. Their leading status is
authoritative for whether work is active, complete, superseded, or deferred;
paths, dependency versions, counts, and findings inside completed plans remain
historical evidence rather than current documentation.

The tracked `droid-wiki/` directory and its media are an archived generated
snapshot. They are retained for provenance only, are not a publishing source,
and must not be used to infer current commands, tools, versions, architecture,
or contributor instructions.
