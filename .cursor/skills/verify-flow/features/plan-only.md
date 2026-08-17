# Plan-Only Feature

Planning without implementation authority. The model saves a plan and stops without starting a run.

## Sub-features

- `/flow-plan` command accepts a goal
- Plan is saved with immutable fields (summary, overview, requirements, decisions, gate, features)
- No run is started
- No implementation occurs
- Session remains in `planning` status
- User is offered approval as the next step

## How to get to it

User perspective: "Plan this for me but don't implement it yet."

```
/flow-plan Add dark mode toggle to settings
```

The model should:
1. Inspect the codebase
2. Create a bounded plan with features and validation
3. Save the plan via `flow_plan_save`
4. Stop and wait for approval
5. Not call `flow_plan_approve` or `flow_run_start`

## Driving it with the Flow harness

The `plan-only-stops` scenario verifies this behavior. From `evals/README.md`:

> `/flow-plan` saves a plan and starts no run

The committed cassette is:
```
evals/cassettes/plan-only-stops--openai_gpt-5.6-sol--1.json
```

To verify:
```bash
bun run replay
```

Look for:
```
- plan-only-stops--openai_gpt-5.6-sol--1.json ... MATCH
```

A MATCH proves the runtime:
- Accepts `flow_plan_save` with valid plan structure
- Leaves session in planning status
- Makes no lifecycle mutations beyond the save
- Records no runs, validations, or reviews

## Gotchas

1. **Autonomous approval is different** - If the user says "plan and implement", the model can call `flow_plan_approve` in the same turn. That's `happy-path`, not `plan-only-stops`.

2. **Plan structure matters** - The plan must include `gate`, `features`, and `decisions`. Missing required fields fail the save.

3. **No implicit runs** - Saving a plan never implicitly starts a run. Runs require explicit `flow_run_start` or `flow_plan_approve` followed by routing.

4. **Immutability** - Once approved, the plan is immutable. Plan-only work can revise drafts but not approved plans.
