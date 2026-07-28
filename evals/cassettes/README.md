# Committed cassettes

Recordings of model decisions that CI replays on every change (`bun run replay`).

A cassette lands here only after someone has read the run it came from and decided
the sequence is worth pinning. `bun run eval` writes candidates into
`evals/results/<stamp>.cassettes/`; copy the ones worth keeping.

Prefer a small set that covers distinct decisions over one per attempt. Six
cassettes that each reach a different refusal are worth more than sixty that all
walk the happy path, and the set is read by hand — keep it readable.

See [../README.md](../README.md#replaying-recorded-decisions) for what a cassette
can and cannot reproduce.

## What is pinned, and why these

One per scenario, from the Flow 7.0.2 matrix of 2026-07-28, spread across three
providers on purpose — a set drawn from one model records that model's habits rather
than the runtime's rules. Every one was gated in that report (empty `fidelity`), and
all 63 candidates replayed with the only divergence being the attempt that wedged
mid-flight, which is advisory by construction.

Picked by decision reached, not by provider or size: the ordinary path, the
plan-only stop, the refused goal change, the blocking gate, the unprovable claim,
the skipped acceptance case, and the resume across a fresh session with no
transcript. Replacing one is cheaper than adding an eighth.
