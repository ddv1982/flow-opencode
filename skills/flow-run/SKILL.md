---
name: flow-run
description: Execute one approved Flow feature - scoped implementation, real validation evidence, then completion. Load before calling flow_run_start.
---

# Flow execution

If `flow_run_start` is unavailable, the Flow plugin is not loaded: stop and tell the user to check `opencode-plugin-flow` in the `plugin` array of `opencode.json` and restart OpenCode. Do not implement without recorded Flow state.

## One feature at a time

- `flow_run_start` activates exactly one approved feature. It stays the sole target until it is cleanly complete, genuinely blocked, or reset — never drift into a second feature "while you're there".
- Parallel discovery may have informed the plan, but execution stays serial. Do not ask parallel workers to mutate the active Flow session, complete sibling features, or record Flow tool results. If parallel implementation experiments are useful, keep them in isolated worktrees and route the chosen result back through this one active feature.
- Keep edits scoped to the feature plus strictly necessary support changes. Out-of-scope problems you discover get noted for the user or a plan change, not fixed inline.
- Apply the workflow profile, stack profile, and context pack recorded in the plan (commands, conventions, house rules, file targets, review scope). `flow_status` may surface `workflowReadiness`, `contextQuality`, `contextTraceability`, and `contextDiagnostics`; call `flow_context` when you need the full context pack or project map. Resolve `workflowReadiness.state` values starting with `blocked_by_` or explicitly justify why they are false positives before claiming the feature is ready; use `contextQuality` as advisory planning/review pressure, not as a runtime gate.
- Leave the codebase shippable: no debug prints, commented-out blocks, or temporary flags. Preserve intentional logging and observability — removing it is a regression, not a cleanup.

## Validate before claiming success

- Run targeted checks for what you changed (the relevant tests, typecheck, lint) before completing. When completing the session's last feature, also run the broad suite.
- Evidence means commands actually run and their observed results — never "should work" or test code that was written but not executed.
- If a check cannot run (missing tool, no network, broken baseline), record that as an explicit gap plus the next-best check you did run. An honest gap is acceptable; a fabricated pass is not.
- Read `references/validation-rubric.md` before recording evidence — it defines what counts and what does not.
- When the feature's deliverable is a findings report (an audit, or the review-first feature of a `goalMode: review` plan), also read `references/audit-rubric.md` before writing any finding: every blocking-severity finding must survive your own refutation attempt and record the mitigating paths you checked.

## Complete, or report honestly

- Clean: `flow_feature_complete` with the validation evidence. The runtime rejects evidence-free completion: every recorded check must have passed, and `validationScope` must be `targeted` (or `broad` on the session's last feature). Gather evidence first; payload shape and worked examples are in `references/validation-rubric.md`.
- If `contextTraceability` shows changed artifacts outside feature targets/review scope, stop and recheck scope before completing; reset/replan when the change is legitimate but unplanned.
- If the session's review policy requires a per-feature review, load the `flow-review` skill and record it via `flow_review_record` (`scope: feature`) before moving on.
- Blocked: stop and report a structured blocker — what failed, why, what you tried. Never report partial success as success.
- A feature built on a wrong assumption is reset (the reset parameter on `flow_feature_complete`), not patched into shape. Two failed attempts on the same feature for the same reason means stop and ask the user.

Never: fabricate or embellish evidence; mark the self-review passed without re-reading your own diff; quietly absorb scope changes that belong in a plan revision.
