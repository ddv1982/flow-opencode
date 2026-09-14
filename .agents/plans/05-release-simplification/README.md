# Release simplification

Reduce maintainer recovery work without weakening package qualification.
No paid evals or canaries are authorized for this work.

## Phase 1. Stop duplicate draft creation

Use the existing `Release` data shape and unique-tag observer. Send one creation
request, then retry observations. Preserve metadata, duplicate, and asset checks.
Stop when remote state cannot be established.

The offline reproduction simulates a stale release listing after a successful
or disconnected creation request. The old code sends another POST and sees
duplicate drafts. A rejected request also repeats three times. This proves a
code mechanism consistent with the 8.3.0 incident, not its historical network
timeline, which was not captured.

The alternative of adopting the POST response ID adds a second observation path
and still needs reconciliation for lost responses. A durable creation receipt
belongs in phase 3. The bounded fix preserves the existing API.

Verification uses `bun test tests/release-publish.test.ts`, followed by the
repository contribution checks. No live GitHub mutations are needed to exercise
the injected publication runtime. Tests cover later invocation reuse once the
draft becomes visible. Cross-process exactly-once creation is not claimed.

Throughput checkpoint. The existing injected runtime makes fault simulation
deterministic and free of provider calls. The parent owns regression tests,
documentation, integration, and commits. One generic inherited-model delegate
owns investigation and the publisher-only implementation. File ownership is
disjoint. No model diversity is claimed.

## Phase 2. Require explicit paid-run authorization

Inventory model-launch entry points, including the scheduled eval workflow,
manual campaigns, probes, and prepared canary fixtures. Reuse current attempt
accounting and frozen plans. Add a persisted authorization budget that is
consumed before provider work starts. A resumed command must retain consumption.
Keep recording, replay, grading, and publication independent of authorization
to spend. Document limits when a user launches OpenCode outside these entry
points. Prove denial, exhaustion, and restart behavior with fake providers.

## Phase 3. Consolidate release state

Use one release record to reference existing artifact hashes, evidence, and
publication IDs. Avoid copying transcripts or introducing another qualification
authority. Model unknown remote outcomes explicitly. Persist creation intent
before mutation so an interrupted invocation can reconcile before creating.
Derive a read-only status view and resume actions from that record.

Verify crash recovery using simulated responses and retained 8.3.0 evidence.
Preserve exact package identity and the original measured evaluator identity.
Migrate current callers together, then remove replaced path-coordination code.

## Deferred product changes

Task-proportional workflows and prompt reductions change agent behavior. Keep
them separate from release tooling. Existing conformance evidence does not prove
their efficiency or review quality.

## Recovery

The release workflow verifies retained qualification and canary evidence offline.
Its pinned OpenCode smoke does not call a model provider. Publication recovery
does not require another paid matrix or canary when the qualified inputs remain
unchanged and retained evidence still satisfies release policy. Expired evidence
stops publication for an explicit decision. It must not trigger an automatic
paid rerun.

Draft preparation sends at most one creation request per invocation. It then
retries release observations, including when the creation response is lost.
If the draft remains unobservable, preparation stops with an unknown outcome.
Before restarting, inspect GitHub for the existing draft and confirm its tag,
commit, notes, and assets. A fresh process cannot distinguish a stale empty
listing from absence. The workflow serializes publication jobs, but the command
does not provide a durable creation receipt across process restarts.

When the exact draft is visible, rerun the failed publication job to reuse it.
Conflicting metadata, duplicate drafts, and mismatched assets still fail.
Do not delete drafts automatically or regenerate passing provider evidence to
resolve a publication error.
