---
name: flow-run
description: Execute one approved Flow feature in the v4 runtime: start a feature with flow_run_start, make scoped changes, gather real validation evidence, obtain review payloads, and complete with flow_feature_complete.
---

# Flow Run

Use this skill for implementation after a Flow plan is approved. Work one feature at a time.

If `flow_run_start` is unavailable, stop and tell the user to check that `opencode-plugin-flow` is loaded in OpenCode.

## Start

- Call `flow_status`.
- Call `flow_run_start` with no `featureId` unless the user or plan requires a specific runnable feature.
- Treat the returned feature as the sole scope until it is completed, blocked, or reset.
- Load `flow-deslop` for cleanup/refactor features.
- Load `flow-ui-quality` for frontend, UX, responsive, accessibility, or visual work.

## Implement

- Read the feature `targets`, `summary`, `validation`, dependencies, and plan `requirements`/`decisions`.
- Keep edits scoped to the active feature. If new scope appears, stop and replan or defer it to another feature.
- Preserve unrelated user changes in the worktree.
- When a wrong assumption invalidates the feature, use `flow_feature_reset`; do not pile patches onto a bad path.

## Validate

- Read `references/validation-rubric.md` before completing.
- Run the strongest practical checks for the changed behavior.
- Record concrete command names, status, and observed results. "Tests pass" is not evidence.
- Non-final features complete with `validationScope: "targeted"`.
- The final feature must run a broad project-level gate and use `validationScope: "broad"`.

## Review and complete

Before `flow_feature_complete`, obtain a `featureReview` payload. Load `flow-review`; for read-only subagent reviews, the manager receives the payload and records it.

For the final feature, also obtain a `finalReview` payload whose `reviewDepth` equals the approved plan's `finalReviewPolicy`.

Complete with:

```json
{
  "status": "ok",
  "featureId": "active-feature-id",
  "summary": "what changed",
  "artifactsChanged": [{ "path": "src/file.ts" }],
  "validationRun": [
    { "command": "bun test tests/foo.test.ts", "status": "passed", "summary": "3 pass, exercised foo behavior" }
  ],
  "validationScope": "targeted",
  "featureReview": { "status": "passed", "summary": "review summary", "blockingFindings": [] }
}
```

If genuinely blocked, call `flow_feature_complete` with `status: "needs_input"` and an `outcome` that explains the blocker and next step. Never fabricate validation or review evidence to force progress.
