# Runtime construction decision

The user asked to continue implementation after the live gate was explained.
Build the remaining code with recovery off by default. Keep production delegated
activation unavailable until a reviewed release-owned qualification exists.
This changes construction order. It does not waive live qualification or claim
that simulated provider results prove model quality.

## Resume point

JEV-1 is committed at `5db4e98`. Its pinned full check passed 1,304 tests with one
opt-in live smoke skipped. Continue on `feat/jev-recovery-runtime` in the same
isolated worktree. Do not rerun the unchanged baseline.

## Candidate A

Own recovery in a shared application controller passed to every service factory.
Accept up to three manager proposals through an optional status envelope.
Status analysis may call the provider but cannot mutate Session state. Return a
selected action and enforce it within the existing reset or start transaction.
The host captures grants and supplies current lineage. A service-internal recover
method commits the selected action after fresh source and revision checks.

## Candidate B

Own recovery beside the auto-drive lease in a host coordinator. Add proposal
fields to reset and run-start tools. The coordinator obtains advice outside the
lock and calls the normal application mutation through a synchronous permission
hook. A proposal-bearing mutation becomes advice-only in shadow mode.

## Comparison

Both designs bind session, revision, source, approved plan, host, and live lease.
Both require default-off behavior, cancellation, one extra retry per feature,
bounded calls and spending, unchanged evidence gates, and exact read-only replay.
Both identify the separate workspace service constructed for every tool call as
an enforcement path that must share the policy controller.

A status proposal keeps analysis separate from mutation and preserves existing
mutation operation identity. B keeps policy lifecycle close to the existing lease
but makes mutation tools behave differently based on optional proposals.

## Proposed synthesis

Use status proposal intake from A with a single process-local controller and a
narrow transaction guard. Return an exact recommended mutation with a stable
operation ID. That ID is not permission. Only the host's matching pending grant
can authorize its first application. The manager calls the existing reset or
start tool, so accepted mutation provenance and replay remain ordinary Flow work.

Let the host request proposals at a checkpoint under the captured recovery lease.
Never synthesize a human reply. Recheck source and revision under the transaction.
Preserve legacy off-mode behavior and first automatic retries. New recovery
permissions apply only to the opt-in context and exact host-issued action.

Production qualification is a release-owned registry with no entries today.
Neither plugin JSON, a provider answer, nor a tool argument can qualify a model.
Tests may construct the internal controller with an explicit test profile.

## Throughput checkpoint

- Blocking first steps. Inspect inherited state, compare designs, and select the
  user-facing proposal path before changing schemas.
- Independent workstreams. One code owner implements coupled runtime, adapter,
  and host wiring. Parent owns this plan and review evidence.
- Shared mutable state. One process-local controller is intentional. Every
  plugin-created service receives its guard. No global mutable registry.
- Smallest safe decomposition. Keep domain transitions intact. Reuse atomic reset,
  exact start, source fingerprints, and operation replay. Separate network I/O
  from the transaction rather than adding a second workflow engine.

## Independent judgment

The independent judge approved the synthesis. It required shared factory wiring,
a second revocation check after source hashing, exact replay before fresh grants,
and a distinct delegated continuation path rather than an artificial user reply.
Pending reservations must survive ambiguous persistence failures until the exact
operation is reconciled. Production qualification remains outside caller control.

The implementation also must reject stale recovery-turn mutations after cancellation,
even when a caller changes the operation ID. Turning recovery off must not make a
previously queued recovery request eligible for the legacy path.
