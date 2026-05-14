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

## Release-candidate smoke evidence

For release candidates, run the standard release-candidate smoke path:

```bash
bun run smoke:release
```

This prepares uploadable candidate assets, runs automated OpenCode-oriented smoke against those exact assets, and writes the evidence bundle under `prompt-exports/release-smoke/` by default. The default output directory is reusable: each run regenerates the fixed asset and evidence filenames there. Use `--no-keep-assets` only for disposable runs that must refuse pre-existing release-smoke outputs; that mode removes disposable assets but retains diagnostic evidence/checklist files. The lower-level runner remains available for focused diagnosis:

```bash
bun run smoke:opencode -- --json prompt-exports/opencode-smoke-evidence.json --summary prompt-exports/opencode-smoke-evidence.md
```

The release workflow runs equivalent artifact smoke after `bun run check` with prepared assets and uploads the JSON and Markdown evidence. This automated smoke validates the release shell install/uninstall flow against a temporary `HOME`, imports the installed plugin, checks command/agent/tool counts, checks generated skills, and exercises a minimal runtime tool session. It does not invoke a real OpenCode UI/CLI host.

Generated smoke artifacts and the manual-live checklist are evidence scaffolding for release/PR notes; do not commit them unless a maintainer intentionally archives a specific evidence record.

## Manual live OpenCode validation

Automated smoke evidence, including the `bun run smoke:release` manual-live checklist, does not replace live OpenCode UI validation. The generated checklist is a template for collecting evidence, not proof that live validation happened. Before claiming a release was live-tested:

1. Install the candidate with `bun run install:opencode` before tag, or the release install script after tag.
2. Open real OpenCode in a disposable project.
3. Run `/flow-doctor detail`.
4. Run `/flow-plan Live smoke: verify Flow can create a plan in OpenCode`.
5. Run `/flow-status detail`.
6. Run `/flow-session close abandoned`.
7. Uninstall with `bun run uninstall:opencode` or the release uninstall script.

Expected result: Flow commands are available, generated skills do not break fallback commands, `.flow/**` appears only in the disposable project, and OpenCode reports no UI/plugin errors.

## Release note expectations

Each release note should make the intent clear:

- What contract or risk changed?
- What was deliberately not expanded?
- Which targeted checks proved the change?
- Any known `Not-tested:` gaps that should constrain follow-up work? Do not close `Not-tested: Live OpenCode UI runtime interaction` unless the manual live OpenCode checklist was actually completed.
