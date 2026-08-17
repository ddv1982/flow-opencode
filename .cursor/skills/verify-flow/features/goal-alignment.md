# Goal-Alignment Feature

Continuation acceptance vs drift refusal. The model distinguishes between follow-ups that continue the approved goal and requests that materially change it.

## Sub-features

- **Drift refusal**: A materially different request makes no mutation, doesn't replace the active session, and doesn't close it
- **Continuation acceptance**: A follow-up that narrows method/emphasis while preserving all outcomes continues the same session (no cassette for this; acceptance is the mirror case, not separately recorded)

The committed cassette proves **refusal only**. Acceptance is implied by its absence - continuation is the normal path and doesn't need its own scenario.

## How to get to it

User perspective: Start work on Goal A, then ask for Goal B before A is finished.

**Drift (should refuse):**
```
/flow-auto Add dark mode to settings
<model starts planning or implementing>

/flow-auto Actually, add a markdown export feature instead
```

The model should:
1. Read current session via `flow_status`
2. Detect the goal changed materially (different outcomes)
3. Make no lifecycle mutation
4. Conversationally offer: continue A, defer A, or abandon A
5. Not start a second session
6. Not close the first session

**Continuation (should accept - no cassette):**
```
/flow-auto Add dark mode toggle to settings
<model creates plan, user approves>

/flow-auto You have my approval, please continue
```

This is goal-preserving (approval was the only thing missing), so the model continues the same session. This is the normal path and has no dedicated cassette.

## Driving it with the Flow harness

The `goal-change-refused` scenario verifies **drift refusal only**. From `evals/README.md`:

> a materially different request does not mutate, replace, or close the active session

The committed cassette is:
```
evals/cassettes/goal-change-refused--openai_gpt-5.6-sol--3.json
```

To verify:
```bash
bun run replay
```

Look for:
```
- goal-change-refused--openai_gpt-5.6-sol--3.json ... MATCH
```

A MATCH proves the runtime:
- Recognizes materially different goals
- Makes no session mutation when drift is detected
- Preserves the first session intact
- Does not start a competing session
- Leaves the user with an explicit choice

**Important:** This cassette proves refusal. It does NOT prove continuation-accepted, which is a separate behavior verified by continuation actually working in `happy-path` and other multi-turn scenarios.

## Gotchas

1. **Don't conflate refuse and accept** - The cassette proves the model stopped. It doesn't prove the model would have continued in the acceptance case.

2. **Alignment is conversational** - The model should ask about drift, not silently refuse. "This looks like a different goal; would you like to defer the current work?" is the expected behavior.

3. **Narrowing is continuation** - Asking for more detail, switching emphasis, or adding constraints while preserving all outcomes is continuation, not drift.

4. **Asking is not always wrong** - At 6.9.0, one attempt offered abandoning the active session as the *recommended* option. The model asked rather than assumed, which satisfied the invariant (no mutation occurred).

5. **The mirror matters** - A model that treated every follow-up as drift would pass `goal-change-refused` and fail `continuation-accepted`. Both need to hold.

6. **No separate continuation cassette** - Continuation is proven by other multi-turn scenarios (happy-path, resume) where the model successfully continues approved work across turns. The refusal scenario isolates the discrimination behavior.
