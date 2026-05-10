# Investigation: Newest OpenCode Plugin Regression

## Summary
The SDK-boundary slice is stabilized with executable checks. Current evidence does not justify changing `zod` or `@opencode-ai/plugin` for Flow: the latest published `@opencode-ai/plugin` remains zod-aligned with Flow (`zod@4.1.8`), still accepts raw `tool({ args: ZodRawShape })` schemas, and still accepts string tool results. The likely observed failure remains host/runtime lifecycle behavior around OpenCode session termination, not a proven Flow dependency mismatch.

## Symptoms
- User tried the newest version and the Flow/OpenCode plugin no longer works properly.
- In the screenshot, `flow_plan_start` is called after planning begins and then the session shows `terminated` instead of continuing.
- The failure appears during an exercise screen heading hierarchy change request, after Flow-Auto classification/planning starts.

## Background / Prior Research
- External latest-version check on 2026-05-08: `npm view @opencode-ai/plugin version time --json` reported latest `@opencode-ai/plugin` as `1.14.41`, with `1.14.41` published `2026-05-07T14:51:10.512Z` and package metadata modified `2026-05-08T21:46:26.577Z`.
- Slice 1 refresh on 2026-05-10: `npm view @opencode-ai/plugin version dependencies time --json` reports latest `@opencode-ai/plugin` as `1.14.46`, published `2026-05-10T02:33:49.021Z`, package metadata modified `2026-05-10T08:07:49.760Z`, and dependencies `{ "zod": "4.1.8", "effect": "4.0.0-beta.59", "@opencode-ai/sdk": "1.14.46" }`.
- Official OpenCode custom tool docs show tools are created with `tool()` from `@opencode-ai/plugin`, with `args` defined as raw object-shaped Zod schemas; the same docs say tools receive `context.directory` and `context.worktree` (`https://opencode.ai/docs/custom-tools/`).
- Official OpenCode plugin docs describe npm/local plugin loading and TypeScript plugin functions (`https://opencode.ai/docs/plugins/`).
- External OpenCode release search found v1.14.41 on/around `2026-05-07`; recent release notes around v1.14.34-v1.14.37 include session/tool/client lifecycle changes such as v2 session rendering, session warp, task/child-session cancellation, PTY tickets, v2 session failure events, and permission preservation in task child sessions (`https://github.com/anomalyco/opencode/releases`).
- Prior external probe found relevant upstream issues: custom tools can fail on first start with `Cannot find package 'zod'` from `@opencode-ai/plugin/dist/tool.js` (`https://github.com/anomalyco/opencode/issues/13887`); plugin config entries without explicit versions can fail semver parsing (`https://github.com/anomalyco/opencode/issues/12143`); and older `@opencode-ai/plugin@1.1.45` packaging had unresolved `workspace:*` / `catalog:` deps that broke plugin installs (`https://github.com/anomalyco/opencode/issues/11353`).
- Git archaeology probe found this repo repeatedly treats three surfaces as fragile contracts: `zod` / `@opencode-ai/plugin` alignment, parsed tool args and raw schema shape, and lifecycle/retry semantics for `flow_plan_start` / `flow_run_start` / session parking. Candidate local evidence: `package.json`, `scripts/cross-area/dependency-contract.mjs`, `tests/config/tool-schemas.test.ts`, `docs/architecture/strictness-contract.md`, `src/adapters/opencode/tool-surface/schemas.ts`, `src/adapters/opencode/tool-surface/parsed-tool.ts`, and `src/adapters/opencode/tool-surface/session-tools/planning-tools.ts`.
- Git archaeology also flagged `flow_plan_start` as a lifecycle transition tool, not a plain planner call. It is currently expected to persist planning state and return success rather than explicitly terminate the host session.

## Investigator Findings

### SDK and dependency boundary
**Finding:** Latest `@opencode-ai/plugin@1.14.46` still depends on `zod@4.1.8`, matching this repo's declared and installed `zod`.

**Evidence:**
- `npm view @opencode-ai/plugin version dependencies time --json` returned latest `1.14.46` with dependency `zod: 4.1.8`.
- `npm view @opencode-ai/plugin@1.3.10 version dependencies --json` returned installed baseline `1.3.10` with dependency `zod: 4.1.8`.
- `node -e "const p=require('./node_modules/@opencode-ai/plugin/package.json'); ..."` confirmed the local lock currently installs `@opencode-ai/plugin@1.3.10` with `zod: 4.1.8`.
- `bun run check:dependency-contract` passed and reported project dependency, plugin dependency, installed root zod, and plugin effective zod are all `4.1.8`.

**Conclusion:** Do not change `zod` independently, and do not bump `@opencode-ai/plugin` in Slice 1. A future SDK bump is allowed only as an intentional SDK-boundary change with this dependency contract passing against the new installed SDK.

### Raw tool schema boundary
**Finding:** Flow already exposes raw object-shaped Zod schemas to `tool(...)`, not nested top-level schemas or JSON-string transport wrappers.

**Evidence:**
- Official OpenCode custom tool docs use `args: { field: tool.schema.string() }` and describe `tool.schema` as Zod.
- `src/adapters/opencode/tool-surface/schemas.ts` exports raw `*ArgsShape` objects and separate parse schemas.
- `tests/config/tool-schemas.test.ts` covers every public tool's raw `definition.args`, rejects string-transport alias tools, rejects nested worker result payloads, and checks representative valid/invalid payloads.
- `bun test tests/config/tool-schemas.test.ts tests/config/plugin-surface.test.ts` passed before Slice 1 edits.

**Conclusion:** Keep raw SDK-compatible `tool(...)` arg shapes. Do not reintroduce JSON-string wrapper tools or schema-cast bridges to work around host behavior.

### Tool result and lifecycle boundary
**Finding:** Latest SDK typings widen tool results from `Promise<string>` to `Promise<string | { output: string; metadata?: ... }>` and change `context.ask` from `Promise<void>` to `Effect.Effect<void>`, but Flow's current tools still return string JSON and do not rely on `context.ask`.

**Evidence:**
- `npm --cache /tmp/flow-opencode-npm-cache pack @opencode-ai/plugin@1.14.46 --pack-destination /tmp/flow-opencode-sdk-check` plus inspection of `dist/tool.d.ts` showed `ToolResult = string | { output: string; metadata?: ... }`, raw `Args extends z.ZodRawShape`, required context fields, and `ask(input): Effect.Effect<void>`.
- Local `node_modules/@opencode-ai/plugin/dist/tool.d.ts` for `1.3.10` returns `Promise<string>` and uses the same raw `Args extends z.ZodRawShape` shape.
- `tests/config/plugin-surface.test.ts` now asserts `flow_plan_start`, plan approval, `flow_run_start`, and a retry `flow_run_start` return parseable JSON strings with `status: "ok"`, persisted `planning` / `running` session state, no `terminated` / `terminate` / `stop` / `closed` host-control fields, and retry-safe already-running behavior.

**Conclusion:** Flow should keep returning stringified JSON for compatibility with both installed and latest SDK typings. If OpenCode host termination persists, collect host logs or a minimal OpenCode reproduction; do not infer a Flow SDK dependency mismatch from the screenshot alone.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The newest OpenCode/plugin SDK version changed tool invocation, schema parsing, lifecycle behavior, or termination handling in a way this plugin no longer satisfies.
**Findings:** Initial evidence is screenshot-only: tool call `flow_plan_start` begins, then the run terminates.
**Evidence:** User-provided screenshot in the originating conversation.
**Conclusion:** Needs repo-backed and external-version investigation.

### Phase 2 - Slice 1 stabilization
**Hypothesis:** The fragile boundary can be locked without prompt slimming or skill generation by checking dependency alignment, raw schemas, and lifecycle response envelopes.
**Findings:** Dependency alignment already passed; raw schema tests already passed; added a focused lifecycle continuation test for `flow_plan_start` / `flow_run_start` and retry semantics.
**Evidence:** `bun run check:dependency-contract`; `bun test tests/config/tool-schemas.test.ts tests/config/plugin-surface.test.ts`; latest SDK tarball type inspection.
**Conclusion:** Slice 1 can land without package dependency changes.

## Root Cause
No repo-local root cause is proven for the screenshot-only `terminated` symptom. Flow's tested SDK boundary returns successful JSON lifecycle envelopes and does not emit host termination signals from `flow_plan_start` or `flow_run_start`.

The strongest evidence-backed hypothesis is an OpenCode host lifecycle/session handling regression or changed host behavior around tool/task/session termination in newer OpenCode releases. That remains an external-host hypothesis until reproduced with live OpenCode logs or a minimal host reproduction.

## Recommendations
1. Keep `@opencode-ai/plugin` and `zod` unchanged for Slice 1.
2. Preserve `zod@4.1.8` alignment with the plugin SDK's effective zod version; never change zod independently of the SDK boundary.
3. Keep Flow tools returning stringified JSON for now; do not adopt `{ output, metadata }` until an intentional SDK-boundary change proves old and new hosts remain compatible.
4. Keep raw `tool(...)` arg shapes in `src/adapters/opencode/tool-surface/schemas.ts` and reject JSON-string alias tools.
5. If the live host still terminates after these checks, capture exact OpenCode version, plugin package resolution, host logs, and the raw `flow_plan_start` response before changing Flow code.

## Preventive Measures
- Keep `bun run check:dependency-contract` in Slice 1 and full release validation.
- Keep `tests/config/tool-schemas.test.ts` as the raw schema and zod/plugin alignment gate.
- Keep `tests/config/plugin-surface.test.ts` lifecycle coverage for plan/run continuation and retry-safe execution start.
- Treat future `@opencode-ai/plugin` upgrades as reviewed SDK-boundary changes: inspect latest package typings, run dependency contract, run config/tool schema tests, and run `bun run typecheck` before changing package policy.
- Do not remove or loosen boundary notes/code unless these tests prove compatibility.
