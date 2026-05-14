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

## Automated OpenCode smoke evidence

For release candidates, run the OpenCode-oriented smoke evidence command:

```bash
bun run smoke:opencode -- --json prompt-exports/opencode-smoke-evidence.json --summary prompt-exports/opencode-smoke-evidence.md
```

The release workflow runs the same smoke after `bun run check` with `--skip-build` and uploads the JSON and Markdown evidence. This automated smoke validates the release shell install/uninstall flow against a temporary `HOME`, imports the installed plugin, checks command/agent/tool counts, checks generated skills, and exercises a minimal runtime tool session. It does not invoke a real OpenCode UI/CLI host.

## Manual live OpenCode validation

Automated smoke evidence does not replace live OpenCode UI validation. Before claiming a release was live-tested:

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
- Any known `Not-tested:` gaps that should constrain follow-up work?
