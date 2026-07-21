# Flow documentation

This directory is the maintained documentation source for Flow v6 and Session
v5. The public overview and installation instructions live in the
[README](../README.md).

- [Development](development.md) — repository structure and verification.
- [Maintainer contract](maintainer-contract.md) — runtime and release
  invariants.
- [Troubleshooting](troubleshooting.md) — configuration and session recovery.
- [ADR 0001](adr/0001-skills-first-flow-architecture.md) — the minimal-runtime
  direction.
- [ADR 0002](adr/0002-typescript-7-v5-hard-cutover.md) — current toolchain and
  layer boundaries; its older lifecycle decision is superseded.
- [ADR 0005](adr/0005-flow-v6-session-v5-simplicity-first.md) — the current
  simplicity-first lifecycle and its intentional tradeoffs.
- [ADR 0006](adr/0006-bounded-intra-feature-waves.md) — bounded host-native
  worker waves inside one serial durable feature lifecycle.
- [ADR 0007](adr/0007-reviewer-owned-submission.md) — reviewer-owned result
  submission with host-checked reviewer identity and no additional protocol.
- [Allowed cross-layer dependencies](architecture/allowed-cross-layer-dependencies.md)
  — source ownership.

Completed implementation plans, QA-scribe case-study material, prompt labs,
replay reports, causal-transport reports, and the Session v4 review/harness ADRs
were removed in v6. They are repository history, not current product contracts.
The bounded wave contract does not restore those systems.
