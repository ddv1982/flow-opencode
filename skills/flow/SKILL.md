---
name: flow
description: Drive a Flow goal from planning through implementation, validation, independent review, and explicit closure. Use flow-auto as the normal end-to-end interface; use flow-plan for plan-only work and flow-run or flow-status for advanced recovery.
---

# Flow

Flow's active goal is authoritative until completed, deferred, or abandoned;
never silently fall back.

## Route from status

1. Call `flow_status { request: { view: "compact" } }` first and apply
   **Manager entry checks** before mutation.
2. For a plan-only request with an approved same-goal session, read detail once,
   report the immutable plan and progress, and stop.
3. With no session or a draft, load `flow_guidance { id: "flow-plan" }`; stop
   after planning only when the request solely asks for a Flow plan. An
   inspection report or review-and-roadmap deliverable is work to execute
   within the original scope.
4. For an approved ready, running, or blocked feature, load
   `flow_guidance { id: "flow-run" }` and follow it for exactly that feature.
5. After `flow-run`, reload compact status. Route blocked outcomes through the
   loaded retry and checkpoint contract; otherwise continue **End-to-end loop**.

## End-to-end loop

The runtime decides when `/flow-auto` continues automatically; never assume a
further turn, and finish the authorized work in this one.

For `ready`, apply `flow-run`; after every recorded result reload compact. For `completed`,
close and handle **Delivery handoff** plus exact `archiveRetry`.
`flow_run_start` and intermediate progress are not terminal: never return “ready
for the next feature” or wait while an action is authorized. Return only after closure
or a checkpoint. Direct `/flow-run` stops after one feature.

For blocked work, follow `flow-run` routing. Never implicitly select a feature
whose latest relevant reviewed outcome remains failed.
Untouched independent features may continue; if only retries remain, wait at
`await-user-direction`. Otherwise pause only for a material
choice, missing Git/release authority, hard failure, or user-chosen closure.
If a Flow tool is absent, report an incomplete plugin load; never simulate state.

## Invariants

- Plans are immutable. Out-of-plan work stops; finish or explicitly close, never
  replan in place.
- One durable feature run exists at a time; worker waves add no Flow state.
- Preserve unrelated work and stay inside the active feature.
- Passing requires current-source validation and one independent review; the
  final feature uses broad validation, not another review.
- Record failures honestly; retries are fresh full runs.
- Use runtime revisions, fresh operation ids, and current-schema fields.
- Do not create reports/sidecars, Git changes, or release mutations unless
  requested; reports default to Markdown and JSON is opt-in.

Shared contracts: [Manager entry checks](../flow/references/manager-entry.md) and
[Delivery handoff](../flow/references/delivery.md), embedded below.
