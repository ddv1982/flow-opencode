# Parallel orchestration

Use fan-out when Flow work is broad enough that independent workers can gather
evidence faster than one linear pass. The manager still owns the Flow session:
only the manager calls state-changing Flow tools, approves plans, completes
features, records reviews, or closes sessions.

Sections: quick path, operational defaults, manager sequence, modes, permission
contract, worker rules, prompt contract, handoff location, and follow-up passes.

Read these companion references before a broad parallel pass:

- `parallel-pass-patterns.md` for pass selection, effort defaults, and stop or
  follow-up rules.
- `handoff-format.md` for the exact worker response shapes.
- `verification-gates.md` for the pre-fan-out coverage gate, handoff
  acceptance, verifier triggers, and the manager synthesis barrier. Those
  definitions are canonical; this file only points at them.
- `parallel-pass-example.md` for a concrete end-to-end pass after the rules
  below are clear (synced with the `flow` skill; not bundled into commands).

## Quick path

1. Orient serially and keep the immediate blocker local.
2. Fan out only when two to five non-overlapping slices reduce known
   uncertainty.
3. Write a coverage gate before spawning workers: total scope, exact slices,
   expected counts, and overlap/gap check.
4. Give each worker a named mode, exact slice, expected coverage, and the
   required handoff shape.
5. Accept only scoped, evidenced, confidence-labeled claims; verify important
   weak, contested, or single-source claims.
6. Synthesize one manager-owned artifact. Raw handoffs do not become the answer,
   Flow payload, or patch decision.

## Operational defaults

- Prefer serial work when the scope is small, tightly coupled, or blocked by one
  decision that must be made before slices are meaningful.
- A normal first pass is two to five workers with independent slices. Use more
  only when the coverage gate is countable and the slices remain non-overlapping.
- Run at most one routine follow-up pass. Extra passes need an explicit manager
  reason, such as a high-stakes verifier check or a newly discovered bounded
  slice.
- Do not fan out just to keep agents busy. Every worker should reduce a known
  planning, validation, review, audit, or implementation uncertainty.

Skip fan-out when:

- one file, command, or design question determines the next step.
- slices would share the same contracts, fixtures, or edit targets.
- the manager can inspect the full scope faster than writing and checking
  worker prompts.
- the result would still need the same manual synthesis with no time saved.

## Manager sequence

1. Call `flow_status` if a Flow session may already exist.
2. Do a serial orientation pass. Read enough files, schemas, docs, tests,
   commands, or artifacts to identify real slices.
3. Define the local manager task. Do not delegate the immediate blocker that
   determines whether fan-out is even valid.
4. Build the pre-fan-out coverage gate defined in `verification-gates.md`
   ("Before fan-out"): total scope, one line per slice with expected count,
   partition check, and overlap/gap check.
5. Spawn only named Flow workers. Use exact slices and the required handoff
   shape. Keep each prompt self-contained.
6. Continue non-overlapping manager work while workers run.
7. Read every handoff. Keep only claims that have evidence, match the assigned
   scope, and carry confidence labels.
8. Send important low-confidence, single-source, contested, or citation-heavy
   claims to `flow-verifier-worker`.
9. Run follow-up passes only for material gaps, conflicts, narrowed scope, or
   verification needs.
10. Apply the manager synthesis barrier from `verification-gates.md`: keep
    only distilled, evidence-backed claims and synthesize one Flow artifact.
    Do not paste worker handoffs as the user-facing result.

## Modes

When fanning out Flow work, select the matching hidden Flow agent by name. These
workers are injected by the plugin config; invoke the named worker when it is
available. Do not use generic subagents for Flow slices because Flow workers
carry the permission boundaries for each mode.

| Mode | Use agent | Worker output | Write access | Flow tools |
| --- | --- | --- | --- | --- |
| `evidence` | `flow-evidence-worker` | Coverage, facts, files inspected, confidence, gaps, suggested plan targets | No | `flow_status` only if needed |
| `review` | `flow-reviewer` | Coverage, candidate findings or review slice summary, confidence, gaps | No | `flow_status` only if needed |
| `validation` | `flow-validation-worker` | Command options or manager-authorized raw output, coverage, confidence, gaps | No code edits; commands only when explicitly allowed | `flow_status` only if needed |
| `audit` | `flow-audit-worker` | Refuted or surviving finding candidates, guards checked, confidence, gaps | No | `flow_status` only if needed |
| `verifier` | `flow-verifier-worker` | Per-claim verdicts against cited evidence or commands | No | `flow_status` only if needed |
| `candidate-implementation` | `flow-candidate-worker` | Candidate patch summary from an isolated worktree or exact path-owned slice | Only with explicit user authorization plus isolation or exact non-overlapping path ownership | No state-changing Flow tools |

Mode examples:

- Use `flow-evidence-worker` when the repo shape is unclear and the output will
  become plan requirements, decisions, targets, or validation entries.
- Use `flow-reviewer` when changed files or risk lenses can be reviewed
  independently before the manager returns one review payload.
- Use `flow-validation-worker` when the manager needs command options or raw
  output from an explicitly authorized command.
- Use `flow-audit-worker` when candidate findings must be refuted before they
  can become a report or follow-up feature.
- Use `flow-verifier-worker` for atomic claims that are contested,
  single-sourced, high-stakes, or destined for a Flow payload.
- Use `flow-candidate-worker` only after explicit user authorization and only
  with an isolated worktree or exact non-overlapping path ownership.

## Permission contract

The plugin injects these hidden workers with the following permission values.
`Flow state tools` means the `flow_*` rule, while `Flow status` documents the
explicit `flow_status` exception.

| Worker | Edit | Bash | Task | Skill | Flow state tools | Flow status |
| --- | --- | --- | --- | --- | --- | --- |
| `flow-reviewer` | deny | deny | deny | deny | deny | allow |
| `flow-evidence-worker` | deny | deny | deny | deny | deny | allow |
| `flow-validation-worker` | deny | ask | deny | deny | deny | allow |
| `flow-audit-worker` | deny | ask | deny | deny | deny | allow |
| `flow-candidate-worker` | ask | ask | deny | deny | deny | allow |
| `flow-verifier-worker` | deny | ask | deny | deny | deny | allow |

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
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from handoff-format.md>
```

Hidden workers cannot load skills or read `handoff-format.md` themselves. The
manager copies the matching handoff template into every worker prompt; a bare
filename reference is not enough.

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
the smallest check that can settle the disagreement. The manager synthesis
barrier in `verification-gates.md` applies before anything moves forward.

## Follow-up passes

Start a follow-up pass when first-pass handoffs reveal:

- missing coverage in the original slice map.
- conflicting findings that matter to the Flow decision.
- a specialized follow-up that was intentionally out of scope.
- high-stakes, low-confidence, or single-source claims needing verification.
- bounded implementation candidates after research converges.

Do not recurse by default. If a worker says it needs another worker, the manager
decides whether that is a follow-up pass and writes the next bounded prompt.
