# Committed cassettes

Recordings of model decisions that CI replays on every change (`bun run replay`).

A cassette lands here only after someone has read the run it came from and decided
the sequence is worth pinning. `bun run eval` writes candidates into
`evals/results/<stamp>.cassettes/`; copy the ones worth keeping.

`flowVersion` in a cassette is the build that recorded it, kept as provenance.
Replay never reads it.

Prefer a small set that covers distinct decisions over one per attempt. Six
cassettes that each reach a different refusal are worth more than sixty that all
walk the happy path, and the set is read by hand — keep it readable.

See [../README.md](../README.md#replaying-recorded-decisions) for what a cassette
can and cannot reproduce.

## What is pinned, and why these

One per scenario from the Flow 7.0.2 matrix of 2026-07-28, plus one constructed
reviewer-catch sequence. The 7.0.2 set is spread across three providers on purpose
— a set drawn from one model records that model's habits rather than the runtime's
rules. Every paid recording was gated in that report (empty `fidelity`), and all 63
candidates replayed with the only divergence being the attempt that wedged
mid-flight, which is advisory by construction.

Picked by decision reached, not by provider or size: the ordinary path, the
plan-only stop, the refused goal change, the blocking gate, the unprovable claim,
the skipped acceptance case, and the resume across a fresh session with no
transcript.

The eighth cassette is `adjacent-defect-refused`. None of the seven pin a
`flow_feature_complete` that rejects a planted defect — they never reach that
decision — so replacing one would drop a distinct refusal. It is a hand-written
decision-layer sequence (`fixture/hand-written`), not a paid-model score: the
reviewer submits a failed verdict with a blocking finding, and a silent pass now
fails the scenario check. Replay still executes the real handlers.

`plan-only-stops` cassettes pin thin-router planning: `flow_guidance` before
`flow_plan_save`, and no `flow-worker` dispatch before a feature run starts. The
negative `plan-only-stops--fixture_hand-written--worker.json` cassette fails
replay when that worker dispatch regresses.
