# Flow v2 Boundaries

Flow v2 keeps the current runtime safety model while reducing long-term tool and prompt sprawl.

## Boundary model

### Runtime invariants

These rules are enforced in runtime/domain, runtime/transitions, and runtime/schema, not redefined elsewhere:

- final-path completion always requires final review
- emitted `recovery.nextRuntimeTool` values use canonical tool names only
- deprecated raw-tool aliases are removed from the active tool surface

### Orchestration guidance

Prompts and command templates may describe sequencing, but they should consume runtime-owned policy and canonical tool names. Prompt-expression sources (`src/prompts/contracts.ts` and `src/prompts/fragments.ts`) are derived wording layers, not normative workflow owners:

- canonical tools are the default path
- raw payload normalization is an internal compatibility concern, not part of the public tool surface
- reviewer and worker approvals should persist through canonical tools first

### UX phrasing

Human-facing prompt text may vary, but it must not introduce new workflow semantics.

## Tool contract direction

### Canonical tools

- `flow_review_record_feature`
- `flow_review_record_final`
- `flow_run_complete_feature`
- `flow_reset_feature`

Runtime recovery metadata must emit canonical tool names only. Raw-wrapper aliases are no longer part of the public tool surface.

## Semantic parity anchors

Runtime-owned semantic parity currently anchors on:

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers

Prompt-expression and docs surfaces may mirror these IDs, but they must not redefine the underlying policy.
