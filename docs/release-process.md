# Release Process Notes

Flow had rapid stabilization churn across the `1.0.46` through `1.0.50` release notes. Treat that period as evidence that the project benefits from fewer surface changes and stronger pre-release consolidation.

## Current release posture

- Default to a surface freeze: no new commands, tools, prompt contracts, state paths, or runtime modes unless a release note records the replacement/retirement tradeoff.
- Prefer contract consolidation, docs parity, test readability, and release hygiene over feature expansion.
- Use `docs/maintainer-contract.md` as the current contract map before deciding whether a release changes public behavior.

## Before release

Run the full gate:

```bash
bun run check
```

For high-risk areas, run the targeted checks from [`docs/maintainer-contract.md`](maintainer-contract.md#if-you-touch-x-run-y) before the full gate so failures are easier to localize.

## Release note expectations

Each release note should make the intent clear:

- What contract or risk changed?
- What was deliberately not expanded?
- Which targeted checks proved the change?
- Any known `Not-tested:` gaps that should constrain follow-up work?
