---
name: flow
description: Drive a Flow session end to end - check status, plan, execute features one at a time, review, and close. Load when starting, resuming, or unblocking Flow work.
---

# Flow driving loop

Flow persists planning and execution state under `.flow/**` so work survives compaction and restarts. The plugin owns state and a few hard invariants; you own all judgment. Never edit `.flow/**` directly.

## The loop

1. `flow_status` first, always. It returns current state plus a suggested next step. Trust it over conversation memory, especially after compaction.
2. No active session: with a goal, load the `flow-plan` skill, then `flow_plan_save` and `flow_plan_approve`. Without a goal, stop and ask — never invent one.
3. Approved plan: load the `flow-run` skill, `flow_run_start` one feature, implement, then `flow_feature_complete` with validation evidence.
4. Review when the session policy requires it: load the `flow-review` skill, record decisions with `flow_review_record` (`scope: feature` per feature, `scope: final` before close).
5. All features complete and final review recorded: close via `flow_session` (`action: close`). Its `history`, `show`, and `activate` actions inspect or switch sessions.
6. Back to step 1, until the session is closed or a stop condition hits.

## Stop and ask the user

- No active session and no stated goal (a bare "resume" with nothing to resume).
- Plan approval, unless the auto-approve criteria in `flow-plan` are all met.
- Destructive or hard-to-reverse actions: deleting data, force-pushing, schema migrations, publishing, touching secrets or money.
- The same feature fails or blocks twice for the same reason — do not loop a third time.
- Real scope has grown beyond the approved plan. Do not quietly absorb it; propose a plan change.

## Hard invariants (runtime-enforced — work with them, not around them)

- A feature cannot complete without recorded validation evidence.
- A session cannot close as completed while features are unfinished.
- An approved plan cannot be mutated without an explicit reset.
- Under a strict review policy, completion requires a recorded reviewer decision.

## Recovery playbook

- Confused, or a tool result contradicts your memory: `flow_status` (detailed) and re-anchor on it.
- Feature stuck, half-done, or built on a wrong assumption: reset it via `flow_feature_complete`'s reset parameter, then re-run or replan. Resetting is cheap; piling fixes on a broken feature is not.
- Wrong or stale session active: `flow_session` `history`/`show` to find the right one, then `activate`.
- Approved plan turned out wrong: reset the affected features, `flow_plan_save` a revised plan, get it approved again, and tell the user why.
