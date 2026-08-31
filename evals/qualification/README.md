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
