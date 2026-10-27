# Maintainability after Flow 10

Preserve Session v5, host-observed validation, independent review, exact-artifact
qualification, and resumable publication. Reduce the places a maintainer must
change to preserve those guarantees.

## First change

- Share Node, package-pinned Bun, and frozen dependency installation through
  `.github/actions/setup-project`. Ordinary CI, scheduled evals, and weekly
  compatibility use the same setup. Jobs keep their names, runners, triggers,
  permissions, checks, and checkout policy.
- Keep conditional patch qualification, Bun-only auditing, and publication's
  registry/npm setup explicit. A shared action should not need a collection of
  switches for these different contracts.
- Build tool status metadata once on a fresh response object. Remove forwarding
  error and reviewer wrappers and the repeated validation coordinator argument.
  Keep schema parsing, mutation cancellation, reviewer-only writes, and exact
  completion replay at their existing boundaries.

## Next changes, in order

1. Move duplicated candidate preparation from the two release jobs into one
   tested command. Keep historical release rules and immutable artifact checks
   intact; compare every supported version's old and new commands before landing.
2. Give auto-drive presentation/timing a separate owner from execution authority.
   Then separate native hook registration from lifecycle decisions. Extract one
   cohesive responsibility at a time, without adding a second state ledger or
   passing the entire coordinator into each module.
3. Make qualification status a single read-only command derived from existing
   matrix, canary, archive, and publication records. Report the next unmet gate
   and whether it is offline or requires an approved model dispatch. Preserve
   failed attempts and original accounting; do not infer success from exit codes.
4. Consolidate maintainer instructions around those commands. Keep historical
   evidence immutable and link it rather than copying operating receipts into
   additional status files.

Each follow-up should remove duplicated policy or reduce independent mutable
state, retain the original behavioral controls, and pass normal CI. File moves
alone, larger line limits, broader test timeouts, and removed safety checks do
not count as simplification. Runtime changes still follow release qualification;
this maintenance PR neither publishes a version nor starts paid evaluations.
