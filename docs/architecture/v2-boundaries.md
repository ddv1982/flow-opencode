# Flow v2 Boundaries

Flow v2 keeps the current runtime safety model while reducing long-term tool and prompt sprawl.

## Boundary model

### Runtime invariants

These rules are enforced in runtime/domain and runtime/transitions, not redefined elsewhere:

- final-path completion always requires final review
- emitted `recovery.nextRuntimeTool` values use canonical tool names only
- deprecated raw-tool aliases are removed from the active tool surface

### Orchestration guidance

Prompts and command templates may describe sequencing, but they should consume runtime-owned policy and canonical tool names:

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
