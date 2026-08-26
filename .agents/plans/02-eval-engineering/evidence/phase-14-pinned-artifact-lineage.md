# Phase 14 pinned artifact lineage

The first `v8.1.2` tag workflow stopped before publication because the committed
canary measured a tarball from local Bun 1.3.5 while CI rebuilt with the pinned
Bun 1.3.14. The same nine files produced different tar bytes. Local Bun 1.3.14
reproduced CI's SHA-1 `9ac02283e0115a673820bec254ba134b3b7f7aa0`.

Two Architect Arena candidates agreed that the exact-artifact contract was
correct. The independent judge chose an explicit `BunToolchain` capability. It
also required the verified executable directory to lead `PATH`, because nested
package scripts invoke `bun` again.

Every model-capable packaging caller now acquires the pinned toolchain before
packing or host startup. `packPlugin` and `preparePackageCache` require that
capability and cannot resolve an unrelated Bun from `PATH`. Release canary
preparation accepts a V2 report, parses its sibling catalog, checks every attempt
against the sibling `artifact.tgz`, and copies those bytes. The release CLI no
longer accepts a free artifact path.

Focused tests reproduced the wrong-version exit, the free-artifact canary path,
and equals-form release overrides before the fixes. The final local gate passes
560 tests with one intentional live-smoke skip. The earlier canary, decision, and
70-cell report remain unchanged diagnostic evidence; none qualifies a new
artifact.
