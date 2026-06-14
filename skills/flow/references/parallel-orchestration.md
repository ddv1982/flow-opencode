# Parallel orchestration

Use fan-out for every worker category whose output can be merged as evidence,
review, validation support, audit findings, or an isolated candidate patch. Flow
execution still has one active feature, and the manager owns every
state-changing Flow tool call.

## Manager sequence

1. Call `flow_status` if a session may exist.
2. Do a brief serial orientation pass so slices are real and non-overlapping.
3. Name the manager's immediate local task; do not delegate the next blocker.
4. Define slices by module, risk, route, command, artifact type, or worktree.
5. Send workers narrow prompts with exact ownership and expected output shape.
6. Continue non-overlapping manager work while workers run.
7. Reconcile handoffs yourself; dedupe, refute, and decide what belongs in the
   plan, completion payload, review payload, or follow-up feature.
8. Run second waves only for material gaps, conflicts, or missing coverage.

## Modes

When fanning out Flow work, select the matching hidden Flow agent by name. Do
not use generic subagents for Flow slices because the Flow workers carry the
permission boundaries for each mode.

| Mode | Use agent | Worker output | Write access | Flow tools |
| --- | --- | --- | --- | --- |
| `evidence` | `flow-evidence-worker` | Facts, files inspected, gaps, suggested plan targets | No | `flow_status` only if needed |
| `review` | `flow-reviewer` | Candidate findings or review slice summary | No | `flow_status` only if needed |
| `validation` | `flow-validation-worker` | Command options, raw output summaries, coverage gaps | No code edits; commands only when explicitly allowed | `flow_status` only if needed |
| `audit` | `flow-audit-worker` | Refuted or surviving finding candidates | No | `flow_status` only if needed |
| `candidate-implementation` | `flow-candidate-worker` | Candidate patch summary from an isolated worktree or exact path-owned slice | Only with explicit user authorization plus isolation or exact non-overlapping path ownership | No state-changing Flow tools |

Do not fan out parallel `flow_run_start`, `flow_feature_complete`,
`flow_feature_reset`, or `flow_session_close` calls. Runtime locking serializes
file writes, but the Flow model accepts only one active feature result at a time.

## Worker rules

Workers may read files, inspect docs, run authorized read-only commands, and
summarize evidence. Candidate implementation workers may edit only when the
manager assigned an isolated worktree or exact path ownership that does not
overlap sibling workers or manager edits.

Workers must not edit `.flow/**` and must not call:

- `flow_plan_save`
- `flow_plan_approve`
- `flow_run_start`
- `flow_feature_complete`
- `flow_feature_reset`
- `flow_session_close`

Workers also must not approve work, close sessions, or claim validation they did
not run. A worker may report raw validation output it actually ran; the manager
decides whether it is strong enough to record.

## Prompt contract

Every worker prompt includes:

```text
Overall goal, context only: <goal>
Mode: evidence | review | validation | audit | candidate-implementation
Your exact slice: <paths, modules, command, risk lens, or worktree>
Do: <bounded actions>
Do not: call Flow state tools, edit .flow/**, own sibling slices, or make the final verdict.
Return exactly the handoff shape below.
```

Ask workers for:

```text
Scope
Evidence inspected
Findings or facts
Open questions / gaps
Suggested Flow follow-ups
```

For candidate implementation workers, ask for:

```text
Changed or proposed patch
Verification run
Merge risks
Manager follow-ups
```

## Where handoffs go

- Planning evidence becomes `requirements`, `decisions`, feature `targets`,
  feature `validation`, or plan notes in prose fields.
- Execution evidence informs the active feature, but `flow_feature_complete` is
  manager-owned.
- Validation evidence may become `validationRun` only when the command, status,
  and raw outcome are concrete enough to trust.
- Review evidence informs `featureReview` or `finalReview`, but the manager owns
  the pass/fail verdict.
- Candidate patches are inspected, merged, and validated by the manager before
  any Flow completion call.

If worker results conflict, prefer the directly inspected source artifact over
summaries and rerun the narrowest missing check.
