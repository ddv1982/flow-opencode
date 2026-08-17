# Flow Verification Features

Five core workflow invariants proven through cassette replay.

## Feature Files

- **[plan-only.md](plan-only.md)** - Planning without implementation authority
- **[flow-auto.md](flow-auto.md)** - End-to-end happy path with completion
- **[goal-alignment.md](goal-alignment.md)** - Continuation acceptance vs drift refusal
- **[resume.md](resume.md)** - Cross-session recovery from durable state
- **[failing-gate.md](failing-gate.md)** - Honest blocker reporting without false completion

## Cassette Mapping

Each feature corresponds to committed cassettes in `evals/cassettes/`:

| Feature | Cassette(s) | Scenario ID |
|---------|-------------|-------------|
| plan-only | `plan-only-stops--openai_gpt-5.6-sol--1.json` | plan-only-stops |
| flow-auto | `happy-path--opencode_claude-sonnet-5--2.json` | happy-path |
| goal-alignment | `goal-change-refused--openai_gpt-5.6-sol--3.json` | goal-change-refused |
| resume | `resumes-after-interruption--opencode_claude-sonnet-5--3.json` | resumes-after-interruption |
| failing-gate | `failing-gate-blocks--opencode_claude-sonnet-5--1.json` | failing-gate-blocks |

## Verification Method

All five features are verified through `bun run replay`, which:
1. Loads the committed cassette (recorded tool calls)
2. Feeds those calls through the real runtime (no model)
3. Grades the result against recorded expectations
4. Reports MATCH or DIVERGENCE for each cassette

A clean replay proves the runtime still produces correct outcomes on decisions a model already made. This is **free**, deterministic, and fast.

## Beyond These Five

Additional cassettes exist for edge cases:
- `skipped-case-refused` - test case skipping without false verification
- `unprovable-claim-refused` - environmental gap handling

These are part of the full suite but represent specialized validation scenarios rather than core workflow paths.
