# Parallel orchestration

Use parallel workers only for read-only discovery, audit, validation research, or review coverage. Flow execution remains one active feature at a time, and the manager owns all state-changing tool calls.

## Manager sequence

1. Call `flow_status` if a session may exist.
2. Define slices by module, risk, route, command, or artifact type.
3. Send workers narrow prompts with exact files, commands to inspect, and expected output shape.
4. Keep workers read-only unless the user explicitly asked for independent implementation outside Flow.
5. Reconcile evidence yourself; dedupe, refute, and decide what belongs in the plan, completion payload, or review payload.
6. Run second waves only for material gaps.

## Worker rules

Workers may read files, inspect docs, run read-only commands, and summarize evidence. Workers must not edit `.flow/**` and must not call:

- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Workers also must not approve work, close sessions, or claim validation they did not run.

## Output shape

Ask workers for:

```text
Scope
Evidence inspected
Findings or facts
Open questions / gaps
Suggested Flow follow-ups
```

## Where evidence goes

- Planning evidence becomes `requirements`, `decisions`, feature `targets`, feature `validation`, or plan notes in prose fields.
- Execution evidence informs the active feature, but `flow_feature_complete` is manager-owned.
- Review evidence informs `featureReview` or `finalReview`, but the manager decides whether it is strong enough to record.

If worker results conflict, prefer the directly inspected source artifact over summaries and rerun the narrowest missing check.
