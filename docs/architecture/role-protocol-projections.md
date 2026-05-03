# Role protocol projections

Flow prompt surfaces are generated views, not semantic owners.

## Source-of-truth order

1. `src/core/registry/actions.ts` owns workflow action metadata: action name, emitted events, invariant IDs, policy owners, and host-neutral descriptions.
2. `src/core/protocols/roles.ts` owns role protocol data: role objective, action ownership, boundaries, workflow outline, output protocol, and examples.
3. `src/prompts/mode-contracts.ts` owns mode contracts as data: allowed/forbidden Flow tools, mutation permissions, required behavior, and stop condition.
4. `src/prompts/generated/**` renders the OpenCode-facing prompt and command projections from those contracts.
5. `src/prompts/agents.ts` and `src/prompts/commands.ts` expose the generated prompt and command projections.

Prompt prose may explain how to route work, but runtime/core contracts decide whether an action is valid.

## Projection rules

- Do not add new workflow policy by editing `src/prompts/agents.ts` or `src/prompts/commands.ts`; update core role/action data, mode contracts, or runtime policy instead.
- Generated prompt views must include the source-note, mode-contract summary, core action protocol, and semantic invariant references for mutating roles.
- Review-only and audit-only roles must remain explicit about read-only boundaries and must not receive hidden mutation authority through prompt wording.
- Docs and prompt evals should check generated contract expectations rather than long hand-maintained policy paragraphs.

## Semantic parity anchors

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers
