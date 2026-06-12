---
name: flow-run
description: Execute one approved Flow feature - scoped implementation, real validation evidence, then completion. Load before calling flow_run_start.
---

# Flow execution

## One feature at a time

- `flow_run_start` activates exactly one approved feature. It stays the sole target until it is cleanly complete, genuinely blocked, or reset — never drift into a second feature "while you're there".
- Keep edits scoped to the feature plus strictly necessary support changes. Out-of-scope problems you discover get noted for the user or a plan change, not fixed inline.
- Apply the stack profile recorded in the plan (commands, conventions, house rules). Do not re-derive or contradict it silently.
- Leave the codebase shippable: no debug prints, commented-out blocks, or temporary flags. Preserve intentional logging and observability — removing it is a regression, not a cleanup.

## Validate before claiming success

- Run targeted checks for what you changed (the relevant tests, typecheck, lint) before completing. When completing the session's last feature, also run the broad suite.
- Evidence means commands actually run and their observed results — never "should work" or test code that was written but not executed.
- If a check cannot run (missing tool, no network, broken baseline), record that as an explicit gap plus the next-best check you did run. An honest gap is acceptable; a fabricated pass is not.
- Read `references/validation-rubric.md` before recording evidence — it defines what counts and what does not.

## Complete, or report honestly

- Clean: `flow_feature_complete` with the validation evidence. The runtime rejects evidence-free completion: every recorded check must have passed, and `validationScope` must be `targeted` (or `broad` on the session's last feature). Gather evidence first; payload shape and worked examples are in `references/validation-rubric.md`.
- If the session's review policy requires a per-feature review, load the `flow-review` skill and record it via `flow_review_record` (`scope: feature`) before moving on.
- Blocked: stop and report a structured blocker — what failed, why, what you tried. Never report partial success as success.
- A feature built on a wrong assumption is reset (the reset parameter on `flow_feature_complete`), not patched into shape. Two failed attempts on the same feature for the same reason means stop and ask the user.

Never: fabricate or embellish evidence; mark the self-review passed without re-reading your own diff; quietly absorb scope changes that belong in a plan revision.
