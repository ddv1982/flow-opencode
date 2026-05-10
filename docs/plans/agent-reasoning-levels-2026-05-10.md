# Agent Reasoning Levels: Plan

## Goal
Let Flow's OpenCode plugin choose an appropriate reasoning budget per built-in agent surface: deeper reasoning for planning, research, and review; lower reasoning for execution and control; balanced reasoning for autonomous coordination.

This is an OpenCode adapter-config change, not a runtime rewrite. Runtime tools, `.flow/**` state, completion gates, generated skills, prompt authority, installer behavior, and SDK/zod alignment stay unchanged.

## Decisions
- Use OpenCode's documented top-level agent option `reasoningEffort`, not direct OpenAI API shapes such as `reasoning: { effort: "low" }`.
- Do not set default `model` or `variant` values in Flow. Users and OpenCode config should keep owning model choice; Flow should only add lane-appropriate reasoning hints.
- Keep existing public command names stable.
- Add a dedicated high-reasoning `flow-auditor` agent for `/flow-review`; leaving it bound to `flow-control` would make standalone audit inherit low/control reasoning.
- Set `flow-auto` to `medium`, not `high`, because it coordinates and delegates to high-reasoning planner/reviewer lanes and low-reasoning worker/control lanes.

## Background
- Flow injects OpenCode agents and commands through `src/adapters/opencode/config.ts:22`, `src/adapters/opencode/config.ts:60`, and `src/adapters/opencode/config.ts:118`; `FlowAgentConfig` currently has `mode`, `description`, `prompt`, and `permission`, but no `model`, `variant`, or `reasoningEffort`.
- `/flow-plan`, `/flow-run`, and `/flow-auto` bind to `flow-planner`, `flow-worker`, and `flow-auto`; control commands bind to `flow-control` (`src/adapters/opencode/config.ts:118`).
- `/flow-review` is added separately and currently binds to `flow-control` in `src/audit/config.ts:13`.
- Mode contracts already classify planning, research, execution, review, control, and standalone audit behavior in `src/prompts/mode-contracts.ts:4`, `src/prompts/mode-contracts.ts:57`, `src/prompts/mode-contracts.ts:224`, `src/prompts/mode-contracts.ts:264`, and `src/prompts/mode-contracts.ts:305`; use those semantics to justify budgets, but keep the actual option in adapter config.
- Existing tests lock injected agents, command bindings, permissions, task handoffs, and config cloning in `tests/config/plugin-surface.test.ts:330`, `tests/config/plugin-surface.test.ts:395`, `tests/mode-contracts.test.ts:28`, and `tests/mode-contracts.test.ts:173`.
- Prior plans require public commands/agents to stay stable, prompts/skills to remain instruction surfaces, and dependency changes to stay separate (`docs/plans/opencode-plugin-upgrade-2026-05-10.md:10`, `docs/plans/prompt-guidance-plugin-updates-2026-05-10.md:8`).
- Current OpenCode docs support agent-level provider option pass-through; `reasoningEffort` is documented as an agent option, and agent config overrides global model options: https://opencode.ai/docs/agents#additional and https://opencode.ai/docs/models.

## Approach
Add small, typed reasoning metadata to Flow's OpenCode config builders and lock the emitted config with tests.

### Budget map
| Surface | Agent | Reasoning | Why |
| --- | --- | --- | --- |
| `/flow-plan` | `flow-planner` | `high` | Planning quality depends on decomposition, evidence, risk, and validation strategy. |
| Planning research handoff | `flow-planning-researcher` | `high` | Read-only evidence synthesis shapes planner decisions. |
| `/flow-run` | `flow-worker` | `low` | Execution should stay focused and fast, then delegate review. |
| `/flow-auto` | `flow-auto` | `medium` | Coordination spans phases, but deeper analysis should be delegated to specialized agents. |
| Worker review handoff | `flow-reviewer` | `high` | Review decisions should be more deliberate than execution. |
| `/flow-review` | new `flow-auditor` | `high` | Standalone audit is a review lane, not a control lane. |
| `/flow-status`, `/flow-doctor`, `/flow-history`, `/flow-session`, `/flow-reset` | `flow-control` | `low` | Control surfaces should be fast, read-only, and stop after tool output. |

### Config shape
Keep the type movement deliberately narrow:

- Move `FlowReasoningEffort`, `FlowPermissionConfig`, and `FlowAgentConfig` into `src/config-shared.ts` so core and audit config can share agent typing.
- Extend `FlowAgentConfig` with optional `reasoningEffort?: FlowReasoningEffort`.
- Add `FLOW_REASONING` constants for `fast`, `balanced`, and `deep`.
- Leave `MutableConfig` and `FlowCommandConfig` local to their config modules unless implementation proves they also need sharing.

Keep `reasoningEffort` top-level on each agent object because that is the OpenCode-documented agent option. Do not add nested provider schemas, runtime state, tool schemas, or prompt-rendered model policy.

### Adapter changes
- In `src/adapters/opencode/config.ts`, import shared types/constants, remove duplicated local config types, and assign budgets to all existing core agents.
- Preserve all existing core agent names, prompts, modes, permissions, task handoff rules, and core command bindings.
- Keep `cloneAgentConfig()` shallow-spreading scalar reasoning metadata and deep-cloning `permission.task` as it does today.
- In `src/audit/prompts/agents.ts`, introduce a compact `FLOW_AUDITOR_AGENT_PROMPT` that reuses the audit contract/fragments from `src/audit/prompts/contracts.ts` and `src/audit/prompts/fragments.ts`; do not reuse the command template's `$ARGUMENTS` wrapper as an agent prompt.
- In `src/audit/config.ts`, add a read-only `flow-auditor` agent using `FLOW_AUDITOR_AGENT_PROMPT`, assign `high` reasoning, and bind `/flow-review` to `flow-auditor`.
- In `src/prompts/mode-contracts.ts`, keep `flow-review` as the standalone audit command contract and add `src/audit/prompts/agents.ts` to its source ownership. Do not add a new `FlowPromptMode` unless implementation/tests prove every backing agent must be mode-addressable.
- Do not change mutation posture, allowed tools, forbidden tools, required behavior, or stop conditions.

## Work Items
1. ✅ **Share config metadata.** Extend `src/config-shared.ts` with shared agent/permission types plus `FLOW_REASONING` constants; keep zod and `@opencode-ai/plugin` untouched. Completed in orchestration item 1; validated by agent with `bun run typecheck` and spot-checked in `src/config-shared.ts`.
2. ✅ **Add core agent budgets.** Update `src/adapters/opencode/config.ts` so `flow-planning-researcher`, `flow-planner`, and `flow-reviewer` emit `high`; `flow-worker` and `flow-control` emit `low`; `flow-auto` emits `medium`. Completed in orchestration item 1; validated by agent with `bun run typecheck` and spot-checked in `src/adapters/opencode/config.ts`.
3. ✅ **Introduce the audit agent prompt.** Add `src/audit/prompts/agents.ts` with `FLOW_AUDITOR_AGENT_PROMPT` derived from existing audit contracts/fragments, without `$ARGUMENTS` command-template wrapping. Completed in orchestration item 2; agent confirmed existing prompt fit the contract and spot-check verified no `$ARGUMENTS` wrapper.
4. ✅ **Split standalone audit from control.** Add `flow-auditor` in `src/audit/config.ts` with read-only permission, audit prompt, and `high` reasoning; rebind `/flow-review` from `flow-control` to `flow-auditor`. Completed in orchestration item 2; validated by agent focused assertion and spot-checked in `src/audit/config.ts`.
5. ✅ **Refresh source ownership.** Update `src/prompts/mode-contracts.ts` only to include audit-agent prompt ownership for `flow-review`; keep `flow-review` as the command contract and avoid adding a new mode unless tests force it. Completed in orchestration item 2; spot-check verified `flow-review` remains a command contract and includes `src/audit/prompts/agents.ts`.
6. ✅ **Lock config and mode alignment.** Update `tests/config/plugin-surface.test.ts`, `tests/mode-contracts.test.ts`, and any existing audit config/command coverage to assert agent budgets, `flow-auditor` injection, `/flow-review -> flow-auditor`, read-only permissions, cloned config identity, and pass-through-only treatment of `reasoningEffort`. Completed in orchestration item 3; focused config/mode tests pass.
7. ✅ **Run focused validation.** Execute the focused config/mode/audit tests first, then prompt-contract/typecheck checks to catch accidental prompt or SDK-surface drift. Completed in orchestration item 3 and rerun by orchestrator: `bun test tests/config/plugin-surface.test.ts tests/mode-contracts.test.ts`, `bun test tests/config/prompt-contracts.test.ts`, and `bun run typecheck` all passed.

## Acceptance Criteria
- Public slash command names stay unchanged.
- OpenCode config emitted by Flow includes lane-appropriate, pass-through-only `reasoningEffort` on every built-in Flow agent.
- `/flow-review` uses a high-reasoning read-only audit agent, while control commands stay on low-reasoning `flow-control`.
- No Flow runtime state, tool payload schema, persistence, generated skill, installer, or SDK/zod dependency changes are introduced.
- Existing task handoff permissions remain unchanged: planner delegates only to planning researcher; worker delegates only to reviewer; auto delegates to the existing specialized agents.
- Tests assert reasoning budgets through both direct agent entries and command bindings.

## Validation Plan
Run:

```bash
bun test tests/config/plugin-surface.test.ts tests/mode-contracts.test.ts
bun test tests/config/prompt-contracts.test.ts
bun run typecheck
```

If prompt or descriptor assertions fail, treat that as drift unless the failure is directly caused by the new `flow-auditor` ownership path. Do not update snapshots just to accept unrelated wording changes.

## Risks
- **Provider support varies.** OpenCode documents `reasoningEffort`, but exact provider support depends on the selected model. Keep Flow's behavior as a config hint and rely on OpenCode/provider validation rather than adding runtime fallback logic.
- **`/flow-review` backing agent changes.** The command name and audit template stay stable, but the backing agent changes intentionally so audit work does not inherit low control reasoning.
- **Over-prescribing model policy.** Avoid model/variant defaults for now; they are more provider-specific than the requested reasoning-budget behavior.
- **SDK-boundary churn.** Do not touch tool schemas, zod, or `@opencode-ai/plugin`; this plan only emits additional documented OpenCode agent metadata.

## Open Questions
None blocking. A later enhancement can decide whether Flow should expose user-configurable budget overrides, but the first implementation should hardcode the lane defaults above and keep user model choice external.

## References
- OpenCode agents: https://opencode.ai/docs/agents#additional
- OpenCode models and variants: https://opencode.ai/docs/models
- `src/adapters/opencode/config.ts`
- `src/audit/config.ts`
- `src/config-shared.ts`
- `src/prompts/mode-contracts.ts`
- `tests/config/plugin-surface.test.ts`
- `tests/mode-contracts.test.ts`
- `docs/plans/opencode-plugin-upgrade-2026-05-10.md`
- `docs/plans/prompt-guidance-plugin-updates-2026-05-10.md`
