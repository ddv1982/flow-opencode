# Release Process Notes

Flow had rapid stabilization churn across the `1.0.46` through `1.0.50` release notes. Treat that period as evidence that the project benefits from fewer surface changes and stronger pre-release consolidation.

## Current release posture

- Default to a surface freeze: no new commands, tools, prompt contracts, state paths, or runtime modes unless a release note records the replacement/retirement tradeoff.
- Prefer contract consolidation, docs parity, test readability, and release hygiene over feature expansion.
- Use `docs/maintainer-contract.md` as the current contract map before deciding whether a release changes public behavior.

## Before release

Bump the version in `package.json` **and** the exact-version pin in the README install snippet (`"opencode-plugin-flow@X.Y.Z"`) together — OpenCode caches plugin installs per spec string and never re-resolves, so the README must always recommend the release being cut. The install smoke inside `bun run check` fails if the two drift.

Run the full gate:

```bash
bun run check
```

For high-risk areas, run the targeted checks from [`docs/maintainer-contract.md`](maintainer-contract.md#if-you-touch-x-run-y) before the full gate so failures are easier to localize.

## Release-candidate smoke evidence

For release candidates, run the standard release-candidate smoke path:

```bash
bun run smoke:release
```

This builds the distributable artifacts, packs the npm tarball with `bun pm pack`, runs the install smoke against that exact tarball, and writes the evidence bundle under `.release-artifacts/release-smoke/` by default. The lower-level runner remains available for focused diagnosis:

```bash
bun run smoke:opencode -- --evidence-dir .release-artifacts/release-smoke
```

The release workflow runs the same tarball smoke after `bun run check` and uploads the JSON and Markdown evidence, then publishes the tarball to npm (requires the `NPM_TOKEN` repository secret) and attaches it to the GitHub release. The automated smoke extracts the packed tarball into a temporary install, starts the plugin against a temporary `HOME` (verifying skill sync markers and the pre-npm double-load warning), checks command/agent/tool counts, exercises a minimal runtime tool session, and runs the uninstall CLI. It does not invoke a real OpenCode UI/CLI host.

Generated smoke artifacts and the manual-live checklist are evidence scaffolding for release/PR notes; do not commit them unless a maintainer intentionally archives a specific evidence record.

## Manual live OpenCode validation

Automated smoke evidence, including the `bun run smoke:release` manual-live checklist, does not replace live OpenCode UI validation. The generated checklist is a template for collecting evidence, not proof that live validation happened. Before claiming a release was live-tested:

1. Install the candidate by pointing `opencode.json`'s `plugin` array at the packed tarball (pre-tag) or at `opencode-plugin-flow@<version>` (post-publish), then restart OpenCode once.
2. Open real OpenCode in a disposable project.
3. Run `/flow-doctor`.
4. Run `/flow-plan Live smoke: verify Flow can create a plan in OpenCode`.
5. Run `/flow-status`.
6. Run `/flow-session close abandoned`.
7. Uninstall with `bunx opencode-plugin-flow uninstall` and remove the `opencode.json` plugin entry.

Expected result: Flow commands are available, the synced skills are discovered, `.flow/**` appears only in the disposable project, and OpenCode reports no UI/plugin errors.

## Release note expectations

Each release note should make the intent clear:

- What contract or risk changed?
- What was deliberately not expanded?
- Which targeted checks proved the change?
- Any known `Not-tested:` gaps that should constrain follow-up work? Do not close `Not-tested: Live OpenCode UI runtime interaction` unless the manual live OpenCode checklist was actually completed.
