# Review the migration plan corrections

The independent reviewer was `grok-4.7` with high reasoning effort.
Its first-round verdict was ISSUES. The parent checked the cited source and
corrected the plan. No second independent verdict is claimed.

## Resolve the five required corrections

1. The install range overstated tested compatibility. The support wording now
   names 2.1.4 and later 2.x releases only after a passing compatibility check.
   The peer range remains install eligibility.
2. A global host-policy edit would invalidate historical policy hashes and
   canary checks. Phase 3 now selects prospective policies by Flow version and
   preserves historical hash inputs. It also explicitly carries reviewer-model,
   permission, and recovery-key checks into the new profile.
   The parent verified `releasePolicySha256` in `evals/release-policy.ts`,
   policy validation in `scripts/release-metadata.ts`, and host comparison in
   `scripts/eval-canary.ts`.
3. The shared configuration path was ambiguous. Phase 1 now names
   `src/config-shared.ts` and permits its host-facing edits outside the adapter
   directory. Domain and persistence remain independent of the host.
4. CLI executable selection needed evidence. `registry.json` now includes bin,
   platform-package, file-count, and unpacked-size metadata. The parent launched
   the exact npm package in isolated directories and observed version 2.1.4.
   Phase 0 still requires exact server argv, health, and Linux launcher proof.
5. TUI dependencies cannot be chosen from dialog signatures. Phase 0 now
   requires a real runtime import check in the packed installation.
   Phase 2 selects any Solid and OpenTUI peers from that proof.

## Resolve the additional findings

The registry receipt now retains `@opencode/sdk@2.1.4` and
`opencode-ai@1.19.4` identities too. The normal installed executable was checked
again after the isolated launch and still reported 1.18.30.
Disposable probes stay outside the published tarball.
The scheduled compatibility check remains a non-blocking drift signal.
The reviewer keeps `flow_status` access as well as completion authority.
Catalog cell counts remain separate from paid dispatch authorization.

The prompt-admission and synthetic-message statements come from the official
plugin guide cited in `research.md`, rather than from declaration files.
Their execution semantics remain phase 0 proof obligations.

## Inspect the remaining release risks

Continuation attribution, trustworthy full command output, actual permission
enforcement, TUI imports, and terminal interaction remain unverified.
Paid qualification needs a concrete approved dispatch proposal.
Ref MCP was unavailable. The plan records that capability gap.

The review was read-only in the shared checkout. It produced no code changes.
Its direct comment scan found no authored code comments or suppressions.
