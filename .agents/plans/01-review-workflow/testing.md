# Testing

Back-link. [Overview](overview.md).

## Project

```bash
bun run check
bun run replay
.agents/skills/flow-contribution-check/scripts/preflight.sh commit
.agents/skills/flow-contribution-check/scripts/preflight.sh push
```

## Per phase

| Phase | Static | Runtime surface |
| --- | --- | --- |
| 1 | `bun test tests/findings-digest.test.ts` | unit fixtures |
| 2 | `bun test tests/runtime-gates.test.ts` | in-memory `flow_status` compact |
| 3 | `bun test tests/runtime-close.test.ts` | in-memory close `delivery.report` |
| 4 | `bun test tests/prompt-quality.test.ts` | compiled prompt surfaces |
| 5 | `bun test tests/auto-drive.test.ts` | auto-drive harness |
| 6 | prompt-quality plus adjacent-defect cassette replay | reviewer skill + replay |
| 7 | prompt-quality plus documentation-contract | compiled `flow-plan` |
| 8 | `bun test tests/eval-scenario-checks.test.ts` | scenario grader |
| 9 | `bun run check` | inspect scenario plus matrix |

There is no `control-cli` coverage of OpenCode chat in this repository.
Phases that change chat behavior prove it with compiled prompts, the
in-memory Flow harness, cassette replay, and the new scenario grader.

Flag. A live `/flow-auto` inspect run on a fixture repo is the missing
host-level check. Add it only when the eval harness already drives
OpenCode for that scenario.
