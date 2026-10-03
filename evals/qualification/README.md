# Qualification bundles

`bun run qualify -- --campaign-dir <dir> --canary <record>` writes a sealed,
content-addressed directory under `bundles/`.

The seal binds the canonical report, catalog, policy, plan, completion, every
attempt and redacted transcript, expected provenance, exact artifact, canary and
its evidence, derived decision, and the complete grader source closure. The seal is
written last. An interrupted directory is not qualification evidence; an identical
retry completes or replays it, while conflicting bytes are refused.

Bundle creation is not release authorization. Release verification reopens every
object, regrades each attempt, and rederives the canary, provenance, usage, and
decision before accepting the bundle.

Archived bundles use `archives/<version>.json` to pin a `.tar.gz` digest and seal.
The standalone materializer validates regular USTAR entries and restores exact
sealed bytes into a private directory outside the source workspace. Release
verification uses isolated temporary directories and cleans them after verification;
saved release records retain their
ordinary bundle location. Expanded historical bundles remain supported, and
multiple matching proofs are refused. CLI inspection:

```sh
bun scripts/materialize-qualification.ts --descriptor evals/qualification/archives/9.4.0.json --out /tmp/flow-qualification-archives
```

CI labels verification at the recorded canary time as RETAINED. Tag readiness,
release initialization and resume still enforce current-time freshness.
