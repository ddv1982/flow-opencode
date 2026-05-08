# Investigation: Newest OpenCode Plugin Regression

## Summary
Pending investigation.

## Symptoms
- User tried the newest version and the Flow/OpenCode plugin no longer works properly.
- In the screenshot, `flow_plan_start` is called after planning begins and then the session shows `terminated` instead of continuing.
- The failure appears during an exercise screen heading hierarchy change request, after Flow-Auto classification/planning starts.

## Background / Prior Research
- External latest-version check: `npm view @opencode-ai/plugin version time --json` reports latest `@opencode-ai/plugin` as `1.14.41`, with `1.14.41` published `2026-05-07T14:51:10.512Z` and package metadata modified `2026-05-08T21:46:26.577Z`.
- Official OpenCode custom tool docs show tools are created with `tool()` from `@opencode-ai/plugin`, with `args` defined as raw object-shaped Zod schemas; the same docs say tools receive `context.directory` and `context.worktree` (`https://opencode.ai/docs/custom-tools/`).
- External OpenCode release search found v1.14.41 on/around `2026-05-07`; recent release notes around v1.14.34-v1.14.37 include session/tool/client lifecycle changes such as v2 session rendering, session warp, task/child-session cancellation, PTY tickets, v2 session failure events, and permission preservation in task child sessions (`https://github.com/anomalyco/opencode/releases`).
- Prior external probe found relevant upstream issues: custom tools can fail on first start with `Cannot find package 'zod'` from `@opencode-ai/plugin/dist/tool.js` (`https://github.com/anomalyco/opencode/issues/13887`); plugin config entries without explicit versions can fail semver parsing (`https://github.com/anomalyco/opencode/issues/12143`); and older `@opencode-ai/plugin@1.1.45` packaging had unresolved `workspace:*` / `catalog:` deps that broke plugin installs (`https://github.com/anomalyco/opencode/issues/11353`).
- Git archaeology probe found this repo repeatedly treats three surfaces as fragile contracts: `zod` / `@opencode-ai/plugin` alignment, parsed tool args and raw schema shape, and lifecycle/retry semantics for `flow_plan_start` / `flow_run_start` / session parking. Candidate local evidence: `package.json`, `scripts/cross-area/dependency-contract.mjs`, `tests/config/tool-schemas.test.ts`, `docs/architecture/strictness-contract.md`, `src/adapters/opencode/tool-surface/schemas.ts`, `src/adapters/opencode/tool-surface/parsed-tool.ts`, and `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts`.
- Git archaeology also flagged `flow_plan_start` as a lifecycle transition tool, not a plain planner call. It is currently expected to persist planning state and return success rather than explicitly terminate the host session.

## Investigator Findings
<!-- Pair investigator appends structured analysis here. -->

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The newest OpenCode/plugin SDK version changed tool invocation, schema parsing, lifecycle behavior, or termination handling in a way this plugin no longer satisfies.
**Findings:** Initial evidence is screenshot-only: tool call `flow_plan_start` begins, then the run terminates.
**Evidence:** User-provided screenshot in current conversation.
**Conclusion:** Needs repo-backed and external-version investigation.

## Root Cause
Pending investigation.

## Recommendations
Pending investigation.

## Preventive Measures
Pending investigation.
