---
name: flow-run
description: Implement, validate, independently review, and record one approved Flow feature. Use only after a Flow plan is approved.
---

# Flow Run

Work on exactly one approved feature. The root manager owns edits and every
state-changing `flow_*` call; the reserved `flow-reviewer` owns the independent
review.

## Start and scope

1. Call `flow_status { request: { view: "compact" } }` first.
2. Call `flow_run_start` when a ready feature is not already running.
3. Read `flow_status { request: { view: "execution" } }` and use that
   projection as the active scope and source of revision guards.
4. Read the feature summary, targets, validation, dependencies, requirements,
   and decisions before editing.

Preserve unrelated worktree changes. Stop and replan when implementation needs
material scope outside the active feature. Use `flow_feature_reset` when a
wrong design or invalid assumption requires a fresh run; do not layer a retry
onto a bad execution.

## Implement

Prefer the smallest change that satisfies the approved outcome. Follow the
repository's existing boundaries and conventions. Do not create lifecycle,
validation, audit, or handoff sidecars. Durable user-requested reports should
normally be one stable Markdown artifact; JSON requires an explicit request.

Do not stage, commit, push, publish, or mutate releases unless the user asks for
that separate action.

## Validate

Choose checks from the changed behavior and risk:

- Prefer focused behavioral tests that would fail without the change.
- Cover persistence, integration, API, browser, accessibility, package, or
  build paths when the feature touches them.
- Typecheck, lint, build, and static inspection are indirect evidence; they are
  sufficient alone only for genuinely mechanical or documentation-only work.
- UI claims need visual inspection when a runnable target is available.
- Cleanup claims need behavior-preservation evidence, not formatting alone.

Immediately before each Bash command used as evidence, call
`flow_validation_start` with the current revision, feature id, the exact
command, and `scope` (`focused` or `broad`). Run that byte-for-byte command next
and inspect its complete outcome. Flow records the host-observed result directly
in the session; do not copy host-observed fields into a later request.

Use focused validation for ordinary features. For the final feature, run the
repository's broad applicable gate after the last relevant edit. A source edit
invalidates earlier applicability. Failed or unavailable checks are blockers,
not passing evidence.

## Review and record

After successful applicable validation, call `flow_review_start` with a fresh
operation id, current revision, feature id, every changed workspace-relative
artifact path, and a
bounded packet summary plus risk lenses. Pass `artifactsChanged` as a top-level
request field, not inside the packet; use an empty array only when the feature
changed no repository artifact. Flow selects current applicable validation
automatically and derives `feature` versus `final` review from plan progress;
callers do not supply the review kind.

Dispatch the returned assignment only to the reserved `flow-reviewer`. Do not
perform the independent review in manager context. Submit its exact assignment
result through `flow_feature_complete` with fresh guards. A pass completes the
feature; a blocking finding records a blocked outcome.

If repair is authorized after a failed review, reset the feature, fix it, and
repeat full validation and full review in a fresh run.

Read compact status after every recorded outcome. Follow runtime state to start
the next feature, report a blocker, or close the completed session.
