# Validation evidence rubric

Use this before recording `flow_feature_complete`.

## Evidence tiers

1. **Behavioral automated test**: a targeted unit/integration/e2e test exercises the changed behavior and fails without the change.
2. **Manual reproducible check**: you ran the app, CLI, endpoint, or workflow and recorded exact steps plus observed result.
3. **Indirect automated check**: typecheck, lint, build, or compile proves shape but not behavior. Acceptable alone only for docs, comments, renames fully covered by tooling, or purely mechanical changes.
4. **Static inspection**: reading code without running anything. This is a gap, not completion evidence for behavioral work.

Use the strongest practical tier. For risky work, combine tiers.

## Recording rules

- Each `validationRun` entry has `command`, `status`, and `summary`.
- Completion accepts only passing entries. Failed or skipped checks belong in the summary/notes and must be resolved or explained as blockers.
- Do not claim a command was run unless it was run in this session or directly reported by a trusted worker with raw output.
- Include scope in the summary: what behavior, files, routes, or states the check covered.
- UI work should include browser or screenshot evidence when the app can run locally.
- Cleanup/refactor work should show behavior preservation, not only formatting success.

## Scope

- Use `validationScope: "targeted"` for ordinary feature completion.
- Use `validationScope: "broad"` only when the session is on its final feature and the project-level gate was run.

Broad validation usually means the repo's full check command, full relevant test suite, build, or equivalent release gate. If the broad gate cannot run, do not mark the final feature complete; report `needs_input` or fix the blocker.

## Good payload fragment

```json
{
  "validationRun": [
    {
      "command": "bun test tests/runtime-gates.test.ts",
      "status": "passed",
      "summary": "12 pass; covered approval immutability, active feature, and completion gates"
    },
    {
      "command": "bun run typecheck",
      "status": "passed",
      "summary": "TypeScript accepted runtime and adapter changes"
    }
  ],
  "validationScope": "broad"
}
```

## Blockers and resets

- If validation fails due to a code bug, fix it and rerun.
- If validation reveals a wrong design or interface assumption, call `flow_feature_reset` and rerun from the corrected approach.
- If validation needs external access, missing credentials, or ambiguous user input, record `status: "needs_input"` with an honest `outcome`.

Never trim failing output, relabel a failed command as passed, or use "not run" as completion evidence.
