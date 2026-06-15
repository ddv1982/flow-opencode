# Parallel orchestration

Use fan-out when Flow work is broad enough that independent workers can gather
evidence faster than one linear pass. The manager still owns the Flow session:
only the manager calls state-changing Flow tools, approves plans, completes
features, records reviews, or closes sessions.

Read these companion references before a broad wave:

- `handoff-format.md` for the exact worker response shapes.
- `verification-gates.md` for coverage checks, handoff acceptance, verifier
  triggers, and synthesis rules.

## Manager sequence

1. Call `flow_status` if a Flow session may already exist.
2. Do a serial orientation pass. Read enough files, schemas, docs, tests,
   commands, or artifacts to identify real slices.
3. Define the local manager task. Do not delegate the immediate blocker that
   determines whether fan-out is even valid.
4. Build a pre-fan-out coverage gate:
   - total files, modules, routes, commands, findings, rows, or claims in scope.
   - one line per slice with path/range/lens and expected count.
   - partition check showing slices add back to the total when the work is
     countable.
   - overlap/gap check showing no duplicate ownership, empty slices, or missing
     target areas.
5. Spawn only named Flow workers. Use exact slices and the required handoff
   shape. Keep each prompt self-contained.
6. Continue non-overlapping manager work while workers run.
7. Read every handoff. Keep only claims that have evidence, match the assigned
   scope, and carry confidence labels.
8. Send important low-confidence, single-source, contested, or citation-heavy
   claims to `flow-verifier-worker`.
9. Run second waves only for material gaps, conflicts, narrowed scope, or
   verification needs.
10. Synthesize one Flow artifact: plan fields, completion evidence, review
    payload, audit report, or candidate patch decision. Do not paste worker
    handoffs as the user-facing result.

## Modes

When fanning out Flow work, select the matching hidden Flow agent by name. Do
not use generic subagents for Flow slices because Flow workers carry the
permission boundaries for each mode.

| Mode | Use agent | Worker output | Write access | Flow tools |
| --- | --- | --- | --- | --- |
| `evidence` | `flow-evidence-worker` | Coverage, facts, files inspected, confidence, gaps, suggested plan targets | No | `flow_status` only if needed |
| `review` | `flow-reviewer` | Coverage, candidate findings or review slice summary, confidence, gaps | No | `flow_status` only if needed |
| `validation` | `flow-validation-worker` | Command options or manager-authorized raw output, coverage, confidence, gaps | No code edits; commands only when explicitly allowed | `flow_status` only if needed |
| `audit` | `flow-audit-worker` | Refuted or surviving finding candidates, guards checked, confidence, gaps | No | `flow_status` only if needed |
| `verifier` | `flow-verifier-worker` | Per-claim verdicts against cited evidence or commands | No | `flow_status` only if needed |
| `candidate-implementation` | `flow-candidate-worker` | Candidate patch summary from an isolated worktree or exact path-owned slice | Only with explicit user authorization plus isolation or exact non-overlapping path ownership | No state-changing Flow tools |

Do not fan out parallel `flow_plan_save`, `flow_plan_approve`,
`flow_run_start`, `flow_feature_complete`, `flow_feature_reset`, or
`flow_session_close` calls. Runtime locking protects files, but Flow accepts only
one active feature result at a time.

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

Workers also must not approve work, close sessions, record Flow validation, or
claim validation they did not run. A worker may report raw validation output it
actually ran; the manager decides whether it is strong enough to record.

## Prompt contract

Every worker prompt includes:

```text
Overall goal, context only: <goal>
Mode: evidence | review | validation | audit | verifier | candidate-implementation
Your exact slice: <paths, modules, command, claim ids, risk lens, or worktree>
Expected coverage: <count, paths, range, or complete question set>
Do: <bounded actions>
Do not: call Flow state tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return exactly the matching handoff shape from handoff-format.md.
```

For research or current-doc slices, require source checks for versioned or
time-sensitive facts. For implementation candidates, remind workers that other
work may be active and that they must not revert unrelated changes.

## Where handoffs go

- Planning evidence becomes `requirements`, `decisions`, feature `targets`,
  feature `validation`, or plan notes in prose fields.
- Execution evidence informs the active feature, but `flow_feature_complete` is
  manager-owned.
- Validation evidence may become `validationRun` only when the command, status,
  and raw outcome are concrete enough to trust.
- Review evidence informs `featureReview` or `finalReview`, but the manager owns
  the pass/fail verdict.
- Audit evidence becomes findings only after refutation and verification rules
  in `verification-gates.md`.
- Candidate patches are inspected, merged, and validated by the manager before
  any Flow completion call.

When worker results conflict, inspect the underlying artifact directly and rerun
the smallest check that can settle the disagreement.

## Second waves

Start a follow-up wave when first-wave handoffs reveal:

- missing coverage in the original slice map.
- conflicting findings that matter to the Flow decision.
- a specialized follow-up that was intentionally out of scope.
- high-stakes, low-confidence, or single-source claims needing verification.
- bounded implementation candidates after research converges.

Do not recurse by default. If a worker says it needs another worker, the manager
decides whether that is a second wave and writes the next bounded prompt.
