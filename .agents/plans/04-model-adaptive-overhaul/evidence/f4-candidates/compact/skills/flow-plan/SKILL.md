---
name: flow-plan
description: Create, revise, or approve a concise Flow plan before implementation. Use for new goals, draft-plan changes, and plan-only requests.
---

# Flow Plan

Plan from repository facts. Keep the result concise and executable without rediscovering the goal.

## Start

1. Call `flow_status { request: { view: "compact" } }` first.
2. On top-level error, report exact summary, recovery, and the available delivery handoff below. State that this initial read made no lifecycle, Git, or release mutation, then stop.
3. Before alignment, replay a projected `archiveRetry` byte-for-byte through `flow_session_close`. Report the handoff below. Refresh only if publication is unconfirmed. Continue from the confirmed projection or stop without saving. Cleanup grants no work authority.
4. Before mutation, align the projected goal with `/flow-plan`. Continue only for the same goal or a method or emphasis narrowing preserving every requested outcome. Close completed work.
5. For a non-completed session, close deferred or abandoned only on an explicit choice. Follow the closure protocol below and stop. Other new scope makes no mutation. Conversationally offer continue, defer, or abandon.
6. For plan-only with an approved same-goal session, read detail once and report the immutable plan and progress. Stop without saving, approving, or running.
7. Missing `flow_plan_save` or `flow_plan_approve` means an incomplete plugin load. Report it and stop.

For fresh closure, call `flow_session_close` with compact id and revision, fresh operation id, chosen kind, and optional summary. Report the handoff and follow exact `archiveRetry`.

Handoff: report `workflowData.delivery.report` verbatim. Map IDs only from `outcomeSummary` and `terminalFindings`. Missing history is unavailable. Do not invent it or read detail solely for closure. Without delivery, report exact recovery and no map.

On close conflict, refresh compact. Retry only the same session and goal while status permits that kind. Never close a replacement.

Inspect relevant code, tests, docs, scripts, and conventions in manager context. Dispatch no `flow-worker` during planning. It handles authorized implementation slices after approval. Ask only for a missing product choice that materially changes the outcome.

## Choose evidence

Inspect repository instructions such as `AGENTS.md` and `CONTRIBUTING.md`, maintained development docs, CI workflows, then build and test manifests. Match commands to requested behavior and current platform. Prefer an explicit whole-repository command over a conveniently named narrow script. Probe fitness when observable without mutation. For unclear gates, record the chosen source and rationale in `decisions`. Only armed observations count as passing evidence.

## Define the plan

Save one plan with these fields:

- `summary`: the promised result in one sentence.
- `overview`: approach and important boundaries.
- `requirements`: acceptance criteria, constraints, and non-goals.
- `decisions`: assumptions, settled architecture or scope choices, and intentional gaps.
- `evidence`: exactly one `scope: "gate"` entry for the canonical whole-repository command, plus needed `scope: "extra"` entries for observations this host may lack.
- `features`: ordered outcome slices with stable `id`, `title`, `summary`, bounded `targets`, concrete `validation`, `dependsOn` ids, and optional `kind`.

Each evidence entry names `requirement`, `environment`, `command`, `platform` (`win32`, `darwin`, `linux`, or `other`), and `assertions`.

Case-specific acceptance needs the exact name and a command writing JUnit to `.flow/results.xml`. For Bun, use `bun test --reporter=junit --reporter-outfile=.flow/results.xml`. `--reporter-outfile` alone does not select JUnit. Use no other or absolute path or summary such as "all tests pass". `assertions` takes only the quoted name after `case named`, `test named`, or `assertion named`. Omit introducer words.

Use `assertions: []` for non-case evidence, including whole-suite exit success. For a named case skipped on the requested host, make that exact case honestly runnable within approved scope or preserve it as extra evidence on a host where it runs. Never use a local substitute. Separate current-host proof uses `assertions: []`.

Broad observations run the gate byte-for-byte. Omit extras only when the goal is fully observable here. Final review and completed closure require every extra entry to pass on its declared platform with named cases passing. A failed or claimed-broad gate vetoes review.

Give each feature one observable outcome. Split only independent failures or true dependencies, not file overlap. Keep indivisible invariants together. Avoid step-shaped features and vague checks.

Preserve finding, issue, and requirement IDs exactly in feature `summary` or `validation`, traceable from the immutable plan to one outcome and its evidence. Record validation commands byte-for-byte. Prose remains reviewer judgment, never a fabricated result.

For inspect-only review, audit, or survey without a promised edit, invent no repair features. Use a small set of `kind: "inspect"` features with existing paths as targets and reviewer-inspection validation. State in `decisions` that no source edit is authorized. The existing repo check may be the gate. Ask before repairs.

Before saving, map every requirement to a feature or explicit non-goal. Use real file, module, route, command, or artifact targets. Name the behavior or contract each validation proves. Dependencies must capture true ordering without cycles or hidden work.

## Save and approve

Call `flow_plan_save` with one nested request containing stable operation id, current revision (`0` for new), goal, and complete draft. Summarize outcome, feature order, validation, and material decisions.

Approve with `flow_plan_approve`, fresh operation id, and current revision only after explicit approval or prior autonomous implementation authority. Approval locks the plan. Ask conversationally for `/flow-auto` approval without another command. A reply may resume that process-local interaction only after approval advances the same Flow session.

`Plan only` and `do not implement yet` control timing, not scope. Never save them as a requirement, decision, or non-goal. Do not implement or create a plan document unless requested.
