# Resume Feature

Cross-session recovery from durable state. The model resumes a planned goal from `.flow/session.json` when no transcript exists, instead of starting a second lifecycle.

## Sub-features

- Fresh host session reads `.flow/` to discover active work
- Model derives status and next action from durable documents only
- No transcript is available (cross-session boundary)
- Model continues the planned goal instead of replanning
- No duplicate lifecycle is started
- Proper routing based on `nextAction` from status

## How to get to it

User perspective: The session ended (crash, timeout, user stopped it) mid-work. The user returns in a fresh conversation.

**Scenario:**
1. Model starts work with `/flow-auto Add feature X`
2. Session ends (simulated interruption)
3. New session starts with no prior transcript
4. User says: `/flow-auto Continue where we left off`

The model should:
1. Call `flow_status` first
2. Read that an active session exists with work in progress
3. Inspect the plan and current feature state
4. Resume execution from the current feature
5. Not create a second plan or session
6. Not restart completed work

## Driving it with the Flow harness

The `resumes-after-interruption` scenario verifies this behavior. From `evals/README.md`:

> a fresh session with no transcript resumes the planned goal from `.flow` instead of starting a second lifecycle

The committed cassette is:
```
evals/cassettes/resumes-after-interruption--opencode_claude-sonnet-5--3.json
```

To verify:
```bash
bun run replay
```

Look for:
```
- resumes-after-interruption--opencode_claude-sonnet-5--3.json ... MATCH
```

A MATCH proves the runtime:
- Reads durable state across session boundaries
- Resumes planned work instead of starting over
- Routes correctly based on recovered status
- Preserves feature order and dependencies
- Carries forward completed work and validations

From `evals/README.md`:
> Recovery is the largest body of contract in the repository that a same-session step cannot exercise at all, because a model that simply remembers what it just did looks indistinguishable from one that re-derived it.

## Gotchas

1. **No memory, only documents** - The model has no conversational transcript. Everything must be re-derived from `flow_status` output and the status's embedded plan/run/review data.

2. **Session boundary is intentional** - The harness marks a step `freshSession` to simulate this. The transcript from before the boundary is appended to the new session's transcript for assertion purposes, but the model never sees it.

3. **Status is the recovery mechanism** - `flow_status` returns `workflowData` with the plan, all runs, all validations, all review assignments. This is the contract for resuming.

4. **Alignment still applies** - A resumed request that changes the goal should still refuse. Resume doesn't bypass goal alignment.

5. **Not just "continue"** - The model must handle any status: blocked, awaiting approval, mid-validation, pending review dispatch, etc. The scenario tests recovery from a specific point; real usage must handle all states.

6. **Session boundaries in report** - The report's `sessionBoundaries` field marks where in `flowCalls` the resumed session picked up. Use this to distinguish resumption behavior from same-session continuation.
