# Agent Reasoning Levels Plan Critique

## Context / Scope
Review of `docs/plans/agent-reasoning-levels-2026-05-10.md` only, with narrow spot-checks of the named config seams.

## 1. Top 3 under-specified seams
1. **Shared config type ownership is broader than stated.** The plan says to move `FlowPermissionConfig` / `FlowAgentConfig` into `src/config-shared.ts` (`docs/plans/agent-reasoning-levels-2026-05-10.md:39-45`), but that file currently only exports `FLOW_READ_ONLY_PERMISSION` (`src/config-shared.ts:1`). Clarify whether `MutableConfig` and `FlowCommandConfig` remain duplicated in adapter/audit config or also move; otherwise the first work item invites incidental reshaping.
2. **`flow-auditor` prompt source is not explicitly named.** The plan says to use the “existing audit prompt surface” (`docs/plans/agent-reasoning-levels-2026-05-10.md:53,59`), while `src/audit/config.ts` currently imports only the command template and emits no audit agent (`src/audit/config.ts:1,15-18`). Specify the exact prompt constant/module to use, or state that it must be introduced separately.
3. **Mode contract naming seam is unclear.** `flow-review` is currently a command mode, excluded from capture modes (`src/prompts/mode-contracts.ts:14,47-55`), while `flow-reviewer` is the execution review agent (`src/prompts/mode-contracts.ts:259`). Adding a `flow-auditor` agent needs an explicit decision: add a new `FlowPromptMode` agent entry, or keep only the existing `flow-review` command contract and add source ownership there.

## 2. Contradictions / missing dependencies
- The plan says public command names stay stable, but also changes the backing `/flow-review` agent from `flow-control` to `flow-auditor` (`docs/plans/agent-reasoning-levels-2026-05-10.md:12,36,59`). That is acceptable, but tests and docs must treat agent identity as an internal contract change, not a public command change.
- Validation omits the direct audit/config tests likely to fail from rebinding `/flow-review`; it names config/mode tests (`docs/plans/agent-reasoning-levels-2026-05-10.md:76-80`) but should explicitly include any existing audit command/config coverage if present.
- External dependency on OpenCode accepting `reasoningEffort` is cited, but no local provider-support guard is planned beyond emitted config assertions (`docs/plans/agent-reasoning-levels-2026-05-10.md:22,85`). That is fine if the field is treated as pass-through only; say so in acceptance criteria.

## 3. Risk of over-planning — cut or simplify
- Cut the OpenAI Responses API comparison (`docs/plans/agent-reasoning-levels-2026-05-10.md:23`). This boundary is OpenCode config, and the comparison increases temptation to add provider-schema logic the plan rejects.
- Simplify the budget rationale table to agent → effort only (`docs/plans/agent-reasoning-levels-2026-05-10.md:28-37`). The “why” column repeats Decisions and risks bikeshedding.
- Merge Work Items 5 and 6 (`docs/plans/agent-reasoning-levels-2026-05-10.md:61-62`) into one “lock config and mode alignment” item unless separate owners are required.

## 4. Questions that would change implementation order
1. Should `flow-auditor` be modeled as a first-class agent mode in `mode-contracts.ts`, or only as config backing for the existing `flow-review` command?
2. What exact prompt constant should `flow-auditor.prompt` use?
3. Are shared config types intended to become the single source for adapter and audit config, or should the change only add `reasoningEffort` with minimal type movement?
