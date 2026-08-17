# Flow-Auto Feature

End-to-end happy path. The model plans, implements all features, validates each with focused checks, runs independent review per feature, validates the final feature at broad scope with the declared gate, and closes completed.

## Sub-features

- `/flow-auto` drives planning through completion
- All planned features are implemented in order
- Each feature gets focused validation
- Each completed run gets exactly one independent review
- Final feature gets broad validation with the plan's declared `gate`
- Session closes as `completed` with all outcomes verified
- No false completions (every completed run has passing validation + passing review)

## How to get to it

User perspective: "Do this entire thing end to end."

```
/flow-auto Add a slug utility that handles spaces and punctuation correctly
```

With implementation authority, the model should:
1. Create and approve a plan
2. Implement the first feature
3. Run focused validation
4. Dispatch independent review via `flow-reviewer`
5. If review passes, mark feature complete and continue
6. For the final feature, run the declared gate at `broad` scope
7. Close the session as `completed`

## Driving it with the Flow harness

The `happy-path` scenario verifies this behavior. From `evals/README.md`:

> `/flow-auto` with authority runs every feature and closes `completed`, with an exit-zero validation and exactly one passing review per completed run, and with the plan's declared gate itself observed passing at `broad` scope

The committed cassette is:
```
evals/cassettes/happy-path--opencode_claude-sonnet-5--2.json
```

To verify:
```bash
bun run replay
```

Look for:
```
- happy-path--opencode_claude-sonnet-5--2.json ... MATCH
```

A MATCH proves the runtime:
- Plans, approves, and executes multiple features
- Records focused validation per run
- Dispatches one independent `flow-reviewer` per completed run
- Records broad validation with the declared gate for the final feature
- Closes `completed` only when all features have passing reviews
- Preserves terminal outcome map across the lifecycle

## Gotchas

1. **One review per run, not per feature** - Each feature run gets one independent review. If a run is reset after failed review, the fresh retry gets its own review.

2. **Final feature is special** - It uses broad scope validation (the declared gate) instead of another focused check. This is not a "second review" - it's the canonical repository gate.

3. **Reviews are independent** - The `flow-reviewer` agent is read-only and submits its own verdict via `flow_feature_complete`. The manager never proxies or edits review results.

4. **Completed requires passing** - A `completed` closure with any non-passing run, missing validation, missing review, or failed gate is a false completion (test failure).

5. **Delivery map is durable** - The final `flow_session_close` includes `workflowData.delivery` with `outcomeSummary` and `terminalFindings`. This is the authoritative terminal state.

6. **Auto-continuation is optional** - Whether `/flow-auto` continues automatically depends on the host's capability signal. The scenario works either way; replay doesn't depend on continuation behavior.
