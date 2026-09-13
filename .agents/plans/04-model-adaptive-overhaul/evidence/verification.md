# Investigation verification

The inspected checkout is `52ddb8be284f07562ef0f64fe64664e8ae973a30`. Production source was unchanged during this investigation. Four untracked canary files were present before the work began. Research artifacts are new local files under `.agents/plans/04-model-adaptive-overhaul/`.

| Check run by the parent | Observed result | Limit |
| --- | --- | --- |
| `bun run check` | Typecheck, lint, release metadata, build, package checks, and tests passed. The test stage reported 828 passes, one skipped test, zero failures, and 4,376 assertions in 45.05 seconds. | The opt-in live test was skipped in this command. Full command output remains in this conversation rather than a saved log. |
| `bun run replay` | All 13 gated cassettes reproduced. | Decision replay does not run models. See `replay.log`. |
| `bun run smoke:live` | All 21 tests passed. The packed plugin loaded in OpenCode 1.18.6. Test process duration was 6.37 seconds. | This exercises host integration without a paid model task. See `live-smoke.log`. |
| `python3 .agents/plans/04-model-adaptive-overhaul/evidence/inventory.py` | Recomputes report counts and current retained campaign facts. | Local retained reports are not a global campaign history. See `inventory.json`. |
| `bun .agents/plans/04-model-adaptive-overhaul/evidence/prompt-inventory.ts` | Measures compiled prompts and loaded guidance. | Static bytes and whitespace words, not actual tokenizer usage. See `prompt-inventory.json`. |
| `bun .agents/plans/04-model-adaptive-overhaul/evidence/capacity-probe.ts` | Reproduces a schema-valid full operation ledger whose new close result fails the persistence schema. | Constructed boundary case, not a frequency estimate. See `capacity-probe.json`. |

No provider behavior improvement, cost reduction, reviewer accuracy, or product-value uplift was measured during this investigation. Future claims require the experiments in the plan.

Three generic how-explorer agents inspected runtime, prompts, and evals in the shared checkout with read-only assignments. All returned results. They used inherited model settings, so this was independent task coverage, not verified cross-family review. The parent read the cited implementations and ran the checks above. No agents created goals, recurring monitors, commits, or external writes.
