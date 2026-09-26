# Runtime review record

Reviewers used generic agents with inherited, unverified model identities. They operated read-only. No review used a live provider.

## Correctness findings

The first independent review found three reproducible defects through real in-memory service calls.

- A source-stale review reset could select another feature without its recovery grant. The exemption now permits reset-only or the same feature.
- Replaying an old reset-only operation could create a new automatic-start permission at a later revision. Replay state now reaches reconciliation, and old legacy replays cannot mint permission.
- A pending grant remained selected after source drift and prevented a changed proposal from obtaining usable advice. Stale pending grants now clear before bounded reassessment.

The reviewer inspected the fixes and reran 25 recovery policy, host, and adapter tests with Bun 1.4.0. All passed with 286 assertions. Its focused recheck returned PASS.

## Coverage and maintainability

The first coverage review found that the filesystem test stopped before fresh validation and independent review. The test now drives registered tools through the actual guard, persists controlled validation evidence, submits reviewer-owned completion, and derives the next coordinator prompt from persisted state.

The reviewer also required hook-driven shadow activation, stripped goal options, stop revocation, and production delegated refusal. Those tests now exist. It confirmed the full chain and returned PASS.

An unread grant-reservation field and its two assignments were removed. No comment or suppression violations remained.

These tests use controlled provider and validation inputs. They establish integration mechanics, not live model quality or real execution of every validation command.

## Parent checks

The first full check exposed a qualification-bundle scanner false positive. Newly packed source contained a JavaScript variable reference that matched its secret-assignment pattern. The adapter uses a scoped local key variable now. The scanner is unchanged. The sealing test and subsequent full repository check pass.

After those fixes, the pinned full check passed 1,329 tests with one opt-in live smoke skipped. All 13 gated cassette replays matched. A final cross-host replacement audit is recorded separately before final handoff.

## Cross-host replacement

The final lifecycle audit reproduced an old-host grant surviving a new plain auto command from another host. Command setup now replaces ownership synchronously and checks its generation across asynchronous status, request-anchor, and activation work. Tests cover sequential replacement, overlapping setup, and stop during setup.

The reviewer confirmed the fix and ran six host tests with Bun 1.4.0. All passed with 23 assertions. No provider calls ran.

Final parent verification passed 1,333 tests, all 13 gated replay cases, and all 22 checks in the packed OpenCode 1.18.6 smoke. The smoke contacts the local host but never asks an AI provider to perform work.
