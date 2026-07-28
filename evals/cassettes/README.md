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
