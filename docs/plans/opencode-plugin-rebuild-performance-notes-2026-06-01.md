# OpenCode Plugin Rebuild Item 9 Notes

Date: 2026-06-01

## Scope

Performance/usability gates for the lighter default workflow. This note records measurements and checks for Item 9 only; release notes and full final integration remain Item 10.

## Measured surfaces

- Continuity-stable surface counts: 9 commands, 7 agents, 18 OpenCode tools.
- Default coding surface counts, excluding standalone audit/review detail: 8 core commands and 6 core agents.
- Default coding prompt size sample:
  - `flow-plan` + `flow-run` + `flow-auto` command templates: 7,659 chars.
  - `flow-planner` + `flow-worker` + `flow-auto` agent prompts: 10,083 chars.
  - All core non-audit agent prompts: 17,595 chars.
  - All core non-audit command templates: 9,907 chars.
- Compact active-session system context sample: 6 lines, 497 chars.
- Tool/schema bloat gate remains bounded by `tests/config/tool-schemas.test.ts`; measured total raw OpenCode schema surface is 379,046 serialized chars under the 397,000-char ceiling.

## Cold start

`bun run build && bun run check:cold-start-budget` passed.

Latest measured result:

```json
{
  "iterations": 7,
  "thresholdMs": 150,
  "localRecordedPreRebuildMainMedianMs": 32.66,
  "medianMs": 37.11,
  "deltaFromLocalRecordedPreRebuildMainMs": 4.45,
  "improvedFromLocalRecordedPreRebuildMain": false
}
```

The rebuild remains well below the hard cold-start threshold. The median did not improve relative to the local recorded pre-rebuild artifact baseline, so this is recorded as continuity-stable rather than faster. The comparison is informational because absolute import timing varies by runner; the hard CI gate is the 150ms threshold.

## Workflow smoke coverage

- Ordinary non-final feature completion succeeds with passing validation and `featureReview` payload without a recorded reviewer decision.
- Ordinary final completion succeeds with broad validation and `finalReview` payload without a recorded final reviewer decision.
- Strict/review/review-and-fix completion paths still require reviewer decisions/accounting as applicable.

## Checks run

- `bun test tests/config/plugin-surface.test.ts tests/completion-gates.test.ts tests/runtime/final-completion-gates.test.ts tests/config/tool-schemas.test.ts`
- `bun run build && bun run check:cold-start-budget`
- `bun run eval:prompt-capture:check && bun run eval:review-capture:check && bun run typecheck`
- `bun run bench:smoke && bun run bench:gate`
- `bun test tests/prompt-mode-capture.test.ts tests/prompt-mode-behavior-eval.test.ts tests/config/skill-bundle.test.ts tests/install.test.ts tests/cross-area/install-lifecycle.test.ts`
- `bun run check:dependency-contract && bun run check:architecture-seams:enforce && node scripts/cross-area/bundle-sanity.mjs`

## Baselines

`bench/BASELINE.md` was not changed. `bench:gate` passed against the existing baseline after running the smoke benchmark.
