---
name: flow-plan
description: Create, revise, or approve a concise Flow plan before implementation. Use for new goals, draft-plan changes, and plan-only requests.
---

# Flow Plan

Inspect determining repository facts. Keep the plan scannable and executable
without rediscovering the goal.

## Start

- Call `flow_status { request: { view: "compact" } }` first.
- On top-level error, report exact summary/recovery and, if
  `workflowData.delivery` exists, the handoff below. State this initial read
  made no lifecycle, Git, or release mutation; stop.
- For `archiveRetry`, replay the projected `flow_session_close` request
  byte-for-byte. Report delivery; if absent, report exact recovery and no map.
  Refresh only if publication is unconfirmed; continue from the confirmed
  projection or stop without saving. This precedes alignment and grants no work.
- On close conflict, refresh compact and retry only for the same session/goal
  while status permits that kind; never close a replacement.
- Before mutation, align the projected goal with `/flow-plan`; continue only for
  the same goal or a method/emphasis narrowing that preserves every requested
  outcome, and close completed work. For a non-completed session, an
  explicit deferred/abandoned choice calls
  `flow_session_close` with compact id/revision, fresh operation id, that kind,
  and optional summary; report delivery, follow exact `archiveRetry`, and stop.
  Other new scope makes no mutation; conversationally offer continue, defer, or
  abandon.
- Delivery handoff: report `workflowData.delivery.report` verbatim and map IDs
  only from `outcomeSummary`/`terminalFindings`. Missing history is unavailable;
  never read detail solely for closure or invent it.
- If the user asked only for a plan and an approved same-goal session already
  exists, read detail once, report its immutable plan/progress, and stop without
  saving, approving, or running.
- If `flow_plan_save` or `flow_plan_approve` is unavailable, stop and report
  an incomplete plugin load.
- Inspect relevant code, tests, docs, scripts, and conventions in this manager
  context. Do not dispatch `flow-worker` while planning; that role is only for
  authorized implementation slices after approval. Ask only for a missing
  product choice that materially changes the outcome.

## Plan contract

Save one plan with:

- `summary`: the promised result in one sentence.
- `overview`: the implementation approach and important boundaries.
- `requirements`: acceptance criteria, constraints, and non-goals.
- `decisions`: assumptions and architecture or scope choices already made.
- `evidence`: one `scope: "gate"` entry for the canonical whole-repository
  command, plus `scope: "extra"` entries for observations this host may lack.
  Each entry names `requirement`, `environment`, `command`, `platform`
  (`win32`, `darwin`, `linux`, or `other`), and `assertions` (empty when the
  evidence is not a test result). Broad observations run the gate command
  byte-for-byte. Extra entries may be omitted when the goal is fully observable
  here. Final review and completed closure stay refused until every extra
  entry is satisfied on its declared platform with named cases passing. The
  gate is the command every broad observation must run; a failed or
  claimed-broad gate still vetoes review.
- `features`: ordered outcome slices, each with a stable `id`, `title`,
  `summary`, bounded `targets`, concrete `validation`, and `dependsOn` ids.

Each feature needs one observable outcome judgeable from bounded evidence and
focused validation. Split only independent failures or true dependencies; file
overlap decides neither. Separate a race or state-machine invariant from
independently acceptable UI, persistence, or accessibility outcomes; merge only
under one indivisible invariant. Avoid step-shaped features and vague checks.

Preserve stable finding, issue, or requirement IDs exactly in the saved feature
`summary` or `validation`; each stays traceable from the immutable plan to one
outcome and its evidence.

A `validation` entry naming a command is recorded byte-for-byte; prose there stays
reviewer judgment, never a fabricated result.

Before saving, confirm:

- every requirement maps to a feature or an explicit non-goal;
- targets name real files, modules, routes, commands, or artifacts;
- validation names the behavior or contract the check will prove;
- dependencies capture true ordering without circular or hidden work;
- assumptions and intentional gaps are visible in `decisions`.

## Save and approve

Call `flow_plan_save` with one nested request: stable operation id, current
revision (`0` for new), goal, and complete draft. Summarize outcome, feature
order, validation, and material decisions. Call `flow_plan_approve` with a fresh
operation id/current revision only after explicit approval or prior autonomous
implementation authority. Approval locks the plan. Ask conversational
`/flow-auto` approval without requiring a second command; a reply may resume its
same process-local interaction only after approval advances the same Flow
session.

Do not begin implementation during a plan-only request. Do not create a plan
document in the repository unless the user explicitly requests one.
