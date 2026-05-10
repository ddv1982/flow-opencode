# Prompt Guidance Plugin Updates: Plan

## Goal
Update the Flow OpenCode plugin prompt surfaces to follow OpenAI's current GPT-5.5 prompt guidance: outcome-first goals, concise collaboration style, explicit evidence/retrieval budgets, validation loops, and phase-aware tool-heavy workflows.

This is a prompt-surface plan, not a runtime rewrite. Preserve current OpenCode commands, agents, tools, generated skills, state semantics, installer behavior, and SDK/zod alignment.

## Decisions
- Keep existing public OpenCode surfaces stable: agents and slash commands continue to be injected through `src/adapters/opencode/config.ts:60` and `src/adapters/opencode/config.ts:118`.
- Keep runtime tools and mode contracts authoritative. Prompt and skill text may guide behavior, but must not define new tools, state transitions, completion gates, review semantics, or `.flow/**` ownership.
- Treat `src/prompts/mode-contracts.ts` as the source for tool boundaries and stop conditions. First use existing `requiredBehavior` / `stopCondition` data (`src/prompts/mode-contracts.ts:27`); add new mode-contract fields only if multiple generated surfaces would otherwise duplicate the same evidence, validation, or progress rules.
- Reframe prompts around outcome, success criteria, constraints, available context, evidence budget, validation expectation, final answer shape, and stop condition.
- Keep personality/collaboration wording short and subordinate to goals, tool rules, mode contracts, and stop conditions.
- Keep tool-definition guidance narrow: use/avoid/returns/call constraints only, not full workflow prose (`src/adapters/opencode/tool-surface/descriptor-guidance.ts:9`).
- Do not implement structured assistant-item `phase` preservation unless OpenCode plugin API support is verified later. Flow's textual session phase in compaction is useful context, but it is not evidence that assistant-item replay phases are available (`src/adapters/opencode/plugin.ts:152`).

## Background
- OpenAI's GPT-5.5 prompt guidance recommends shorter, outcome-first prompts; concise personality/collaboration style; preambles for multi-step/tool-heavy work; explicit retrieval budgets; validation rules; and preserving assistant-item `phase` values when manually replaying assistant output: https://developers.openai.com/api/docs/guides/prompt-guidance.md.
- The OpenCode plugin already has the right seams: `tool.definition`, `chat.message`, `command.execute.before`, `experimental.chat.system.transform`, and `experimental.session.compacting` are registered in `src/adapters/opencode/plugin.ts:32` and `src/adapters/opencode/plugin.ts:124`.
- Generated role prompts already compose mode contracts, core-action protocol, invariant protocol, role boundaries, skill fallback guidance, and fallback contracts from `src/prompts/generated/protocol-render.ts:30`.
- Fallback contracts already expose runtime mutation boundaries, allowed/forbidden tools, `.flow/**` safety, tool ordering, stop conditions, and skill-unavailable behavior in `src/prompts/generated/protocol-render.ts:83`.
- Prompt/context injection already treats persisted session text as untrusted and orders local guidance before official/external guidance in `src/prompt-system-context.ts:83` and `src/prompt-system-context.ts:167`.
- Tool descriptions and descriptor guidance are registry-centered, with selected `flow_*` tool guidance injected by `tool.definition` from `src/adapters/opencode/tool-surface/descriptor-guidance.ts:9` and `src/adapters/opencode/plugin.ts:32`.
- The prior plugin upgrade plan already set the guardrails: keep commands/agents stable, use skills as on-demand guidance, make prompts fallback surfaces, do not add tools/modes/state semantics, and keep the SDK boundary separate (`docs/plans/opencode-plugin-upgrade-2026-05-10.md:10`).
- Generated skill tests already lock the minimal `flow-plan`, `flow-run`, and `flow-review` bundle plus runtime-authority and no-direct-`.flow/**` constraints in `tests/config/skill-bundle.test.ts:91`.
- Prompt behavior evals already score required tool sequence, forbidden tools, required behavior, forbidden behavior, and next-step calibration in `tests/prompt-mode-behavior-eval-helpers.ts:13`.

## Approach
Use three ordered slices. Each slice should shrink or clarify an existing prompt surface before adding wording.

### Slice 1 — Define the shared prompt-framing contract
Update the shared prompt rendering contract so fallback surfaces consistently answer:

- What outcome is this mode trying to produce?
- What must be true before stopping?
- Which constraints and tool boundaries are non-negotiable?
- What evidence is enough, and what should happen when evidence is missing?
- What validation is expected before completion?
- What final answer shape should the user see?

The likely shared implementation seam is `renderFallbackContract` / `renderProtocolHeader` in `src/prompts/generated/protocol-render.ts:30`, backed by existing mode-contract data. Role prompts and the three primary command templates already call those helpers (`src/prompts/generated/role-prompts.ts:10`, `src/prompts/generated/command-templates.ts:5`); simpler control commands are literal templates and may need only minimal local wording. Add mode-contract fields only if current `requiredBehavior` / `stopCondition` data cannot express shared evidence budgets, validation expectations, or phase-boundary progress rules without duplicating text.

### Slice 2 — Reframe generated commands, agents, and skills
Apply the shared contract to generated prompt surfaces without expanding them:

- `src/prompts/generated/command-templates.ts` — make slash commands start from user-visible outcome, required context, constraints, and stop condition.
- `src/prompts/generated/role-prompts.ts` — make agents state role outcome, allowed decisions, validation expectations, and when to stop or ask.
- `src/prompts/generated/skill-docs.ts` / `src/prompts/skills.ts` — keep skills more detailed than fallback prompts, but remove duplicated runtime law and add explicit evidence/retrieval budgets where planning or review can otherwise over-search.
- `src/prompt-system-context.ts` — refine wording only if needed to make evidence priority and missing-evidence behavior clearer; do not add new persistence or cache semantics.

Expected behavior after this slice: tool-heavy workflows start with concise progress/preamble guidance, planning/review have retrieval budgets, execution requires relevant validation or next-best checks, and skills remain instruction surfaces rather than behavior authorities.

### Slice 3 — Recalibrate tests and trim only duplicated descriptor prose
Treat descriptor trimming as cleanup, not a standalone redesign:

- Keep `src/adapters/opencode/tool-surface/descriptor-guidance.ts` focused on tool call constraints: when to use, when to avoid, required payload shape, and return meaning.
- Remove workflow-level prose only where Slice 1–2 make it duplicative; keep guidance that prevents concrete tool misuse.
- Update prompt tests and eval fixtures to assert semantic behavior instead of exact old prose: outcome/success/constraints, forbidden-tool absence, required tool sequence, validation expectation, evidence budget, and calibrated next step.

## Work Items
1. **Classify only text touched by this change.** For each edited sentence, identify whether it is runtime law, mode-contract boundary, skill guidance, fallback prompt guidance, tool-call constraint, or injected context. Avoid a repo-wide authority taxonomy.
2. **Add the shared outcome-first fallback frame.** Centralize the compact frame in `protocol-render.ts` so generated role prompts and command templates inherit the same outcome, success, constraints, validation, and stop-rule shape.
3. **Add retrieval/evidence budgets to planning and review guidance.** Planning/review prompts and skills should say what requires support, what counts as enough evidence, when to use external lookup if available/authorized, and when to stop searching. Keep `src/prompt-system-context.ts:187` and `src/prompt-system-context.ts:239` provider-aware without assuming Ref/Exa/web are always present in the target OpenCode runtime.
4. **Add validation-loop wording to execution guidance.** Worker/auto surfaces should require targeted validation, typecheck/lint/build/smoke checks when relevant, and a next-best check when validation cannot run. Keep runtime completion gates authoritative.
5. **Keep progress/preamble guidance concise and deletion-balanced.** Add one short rule for multi-step/tool-heavy work: send a brief visible update naming the target result and first step before tool-heavy work, then avoid process narration unless it changes the user's understanding. Every new prompt sentence should replace or remove an equal amount of duplicate workflow law where feasible.
6. **Gate phase guidance behind evidence.** Check whether OpenCode exposes assistant-item phase metadata before planning any structured `phase` handling. If unsupported, keep only textual phase-boundary guidance in prompts.
7. **Slim tool descriptor guidance only where duplicated.** Remove or avoid workflow-level prose in `descriptor-guidance.ts` after the shared prompt frame exists; keep constraints needed to call each `flow_*` tool correctly.
8. **Recalibrate tests and prompt captures.** Update `tests/config/prompt-contracts.test.ts`, `tests/protocol-parity.test.ts`, prompt capture checks, and prompt-mode behavior eval fixtures to check semantic requirements rather than older wording.
9. **Update maintainer docs only if behavior becomes supported contract.** If the implementation changes supported prompt/skill ownership rules, update `docs/development.md`, `docs/contributor-map.md`, or `docs/maintainer-contract.md`; otherwise leave docs unchanged.

## Acceptance Criteria
- Public OpenCode command and agent names remain unchanged.
- Generated skills remain exactly instruction surfaces for `flow-plan`, `flow-run`, and `flow-review`; they do not define tools, state transitions, review gates, or persistence behavior.
- Fallback prompts include outcome, success criteria, constraints/tool boundaries, validation expectation where applicable, and stop condition.
- Planning/review surfaces include explicit evidence and retrieval budgets phrased for whatever external lookup tools are available/authorized; absence of evidence is not treated as proof of absence.
- Execution surfaces require relevant validation or a clear next-best check when validation cannot run.
- Tool-definition guidance remains call-specific and does not duplicate full workflow prose.
- No dependency, SDK, zod, installer, runtime schema, `.flow/**`, or OpenCode plugin API changes are made unless separately justified by implementation evidence.

## Validation Plan
Run focused checks after the implementation pass, then the broader prompt/eval gate:

```bash
bun test tests/config/prompt-contracts.test.ts tests/protocol-parity.test.ts
bun test tests/config/skill-bundle.test.ts
bun test tests/prompt-mode-behavior-eval.test.ts
bun run eval:prompt-capture:check
bun run eval:review-capture:check
bun test tests/descriptor-family-parity.test.ts tests/docs-tool-parity.test.ts
bun run typecheck
```

If prompt wording changes invalidate existing captures, update fixtures only after confirming the new outputs preserve allowed/forbidden tools, required behavior, stop conditions, and next-step calibration.

## Risks
- **Over-slimming loses safety gates.** Mitigate by keeping allowed/forbidden tools, `.flow/**` safety, validation expectations, and stop conditions in mode/fallback contracts.
- **Skills become a second source of truth.** Mitigate by preserving the existing runtime-authority language tested in `tests/config/skill-bundle.test.ts:120`.
- **Phase guidance over-assumes host support.** Mitigate by treating structured phase preservation as a later API-evidence check, not part of this prompt update.
- **Eval churn rewards old prose.** Mitigate by recalibrating prompt tests toward semantic snippets and tool-boundary behavior instead of exact older wording.

## Open Questions
- Does the current OpenCode plugin API expose assistant-item `phase` metadata in a way Flow can preserve, distinct from Flow's own textual session phase? If not, keep assistant-item phase behavior as prompt wording only.
- Are new `FlowModeContract` fields worth the churn, or can this pass express evidence, validation, and progress rules through existing `requiredBehavior` / `stopCondition` plus renderer text?

## References
- OpenAI GPT-5.5 prompt guidance: https://developers.openai.com/api/docs/guides/prompt-guidance.md
- Existing plugin upgrade plan: `docs/plans/opencode-plugin-upgrade-2026-05-10.md`
- Plugin prompt/context hooks: `src/adapters/opencode/plugin.ts`
- Generated prompt protocol renderer: `src/prompts/generated/protocol-render.ts`
- Generated commands/roles/skills: `src/prompts/generated/command-templates.ts`, `src/prompts/generated/role-prompts.ts`, `src/prompts/generated/skill-docs.ts`
- Tool descriptor guidance: `src/adapters/opencode/tool-surface/descriptor-guidance.ts`
- Adaptive system context: `src/prompt-system-context.ts`
- Skill bundle tests: `tests/config/skill-bundle.test.ts`
- Prompt behavior eval helpers: `tests/prompt-mode-behavior-eval-helpers.ts`
