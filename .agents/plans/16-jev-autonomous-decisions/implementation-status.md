# JEV-1 implementation status

The user authorized implementation of this plan. JEV-1 evaluation tooling is implemented on `feat/jev-blocker-evaluation` in `/Users/vriesd/projects/flow-jev-evaluation`.

The full plan is not complete. JEV-2 through JEV-4 remain unstarted because the live promotion gate is unmeasured. Flow runtime behavior has not changed.

## Implemented

- Strict immutable campaigns and evidence with hidden labels and packet identity checks.
- Deterministic eligibility and separate manager-only and Jev-assisted comparisons.
- Per-action independent sample counts, complete pairs, and a conservative uncertainty bound.
- Explicit live-import attestations and simulation provenance.
- Bounded official-provider transport with deadlines, cancellation, retries, byte limits, and spending reservations.
- A CLI for checking inputs, collecting advice, and regrading reports. Output reservation occurs before paid requests.
- Versioned alignment metadata with the existing scoring and advisory-veto semantics preserved.
- Eight synthetic development cases, including multiple remedies and an all-bad choice set.

## Verified

The parent used Bun 1.4.0 and the frozen lockfile. `bun run check` passed with 1,304 tests, one skipped opt-in live OpenCode smoke, and zero failures. The four focused suites passed all 35 tests.

The actual offline CLI reports inconclusive with no qualifying live samples. The missing-key CLI exits 2 with eight unavailable observations and no provider calls.

Independent correctness and no-comments reviews passed. The reviewers used inherited, unverified model identities. One reviewer reran focused tests with Bun 1.3.14. The parent receipts on Bun 1.4.0 are authoritative.

The initial full check found the new ADR exceeded the dedicated record budget. The ADR was shortened to 1,980 bytes and received a named 2,000-byte allocation. The final full check passed without changing other ceilings or assertions.

See [verification provenance](evidence/implementation-verification.json), [focused tests](evidence/implementation-focused-tests.txt), [CLI smoke](evidence/cli-smoke.json), [offline report](evidence/offline-report.json), and [independent reviews](evidence/implementation-reviews.md). Full repository-check logs remain local and are identified by digest in the provenance receipt.

## Remaining gates

The user identified `~/.config/secrets/env` as the credential location. The directory and file are absent from this session's filesystem. See [credential discovery](evidence/credential-lookup.md). The key must become available to this process, and the live spending cap remains unspecified.

No TypeSafe model call, availability probe, real holdout campaign, manager comparison, or live latency measurement has run. The documented model pin is not a live availability claim. The synthetic starter data cannot qualify promotion.

The plan requires at least 300 independent accepted holdout cases per action class and a complete manager comparison. These observations must be collected and reviewed before advancing. The subsequent runtime and unattended-run gates also remain open.

The accepted plan says "Advance beyond JEV-1 only after its pre-registered Jev promotion gate passes." The implementation preserves that gate. No PR is represented as merge-ready, and no package or release was published.

## Design decisions

Model the Domain separated facts, authority, advice, and evidence. Boundary Discipline put parsing and HTTP handling at explicit interfaces. Sequence Work into Verifiable Units kept live authority out of the first phase. Prove It Works required real CLI runs and prevented unavailable evidence from becoming a passing result.
