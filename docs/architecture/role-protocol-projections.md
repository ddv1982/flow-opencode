# Role protocol projections

Flow prompt surfaces are generated views, not semantic owners.

## Source-of-truth order

1. Runtime transitions and domain policy own workflow enforcement.
2. `src/core/registry/actions.ts` owns core workflow action metadata: action name, emitted events, invariant IDs, policy owners, and host-neutral descriptions.
3. OpenCode tool implementation modules own the actual read/workspace/mutation dispatch constants they invoke; descriptor parity tests compare those constants against descriptor metadata.
4. `src/adapters/opencode/tool-surface/descriptors.ts` owns the OpenCode-facing superset descriptor family for host tools, typed `runtimeActionBinding` facets, nullable `coreAction` facets, permission class, prompt guidance, docs metadata, and verification anchors.
5. `src/core/protocols/roles.ts` owns role protocol data: role objective, action ownership, boundaries, workflow outline, output protocol, and examples.
6. `src/prompts/mode-contracts.ts` owns mode contracts as data: allowed/forbidden Flow tools, mutation permissions, required behavior, and stop condition.
7. `src/prompts/generated/**` renders the OpenCode-facing prompt and command projections from those contracts.
8. `src/prompts/agents.ts` and `src/prompts/commands.ts` expose the generated prompt and command projections.

Prompt prose may explain how to route work, but runtime/core contracts decide whether an action is valid.
Live runtime persistence remains snapshot-primary; core event/replay infrastructure is a semantic oracle and regression gate, not live persistence authority.

## Projection rules

- Do not add new workflow policy by editing `src/prompts/agents.ts` or `src/prompts/commands.ts`; update core role/action data, mode contracts, or runtime policy instead.
- Do not collapse non-core/read/control/render tools into fake core actions. Typed `runtimeActionBinding` and nullable `coreAction` facets are part of the descriptor contract; only the OpenCode projection exposes an optional flat `runtimeAction` string.
- Keep adapter execution bindings and schema-owner metadata parity-tested against descriptors; descriptors should not silently claim a runtime action or payload owner that the tool boundary does not use.
- Generated prompt views must include the source-note, mode-contract summary, core action protocol, and semantic invariant references for mutating roles.
- Review-only and audit-only roles must remain explicit about read-only boundaries and must not receive hidden mutation authority through prompt wording.
- Docs and prompt evals should check generated contract expectations rather than long hand-maintained policy paragraphs.

## OpenCode core-action projection strictness

OpenCode projections have two intentional boundaries:

| Boundary | Helper / file | Behavior |
| --- | --- | --- |
| Strict descriptor metadata | `coreActionProjectionMetadata()` / `optionalCoreActionProjectionMetadata()` in `src/adapters/opencode/tool-surface/core-action-projection.ts` | A non-null stale core action is an error. Descriptor generation and parity checks should fail fast when projection metadata drifts. |
| Tolerant public host summary | `openCodeToolCoreSummary()` in `src/adapters/opencode/tool-projections.generated.ts` and `renderOpenCodeToolCoreSummary()` in `src/adapters/opencode/tool-surface/core-action-projection.ts` | Missing tool, absent core action, or stale projected core action returns `null`. |
| Guidance rendering | `applyFlowToolDefinitionGuidance()` in `src/adapters/opencode/tool-guidance.generated.ts` | Filters falsy summary text and continues rendering available guidance. |

Do not make public host guidance strict: stale generated projection data must not break tool definition rendering. Do not make descriptor metadata tolerant: descriptor drift should fail in parity/descriptor tests instead of being hidden. Read, control, workspace, and render-only tools may have no core action; that absence is a valid public projection, not an error.

## Completion gate projection table (descriptor-generated)

The table below is mechanically projected from `src/runtime/transitions/completion-gates.ts` via `src/runtime/transitions/completion-gate-projections.generated.ts`. Runtime transition enforcement remains authoritative.

<!-- completion-gate-doc-table:start -->
| Mode | Path | Step | Gate ID | Required Artifact | Recovery Kind | Predicate Owner | Invariant IDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| default | feature | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | feature | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | feature | 3 | reviewer_decision | feature_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| default | feature | 4 | validation_scope | targeted_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | feature | 5 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | feature | 6 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| default | final | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | final | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | final | 3 | validation_scope | broad_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | final | 4 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | final | 5 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| default | final | 6 | final_review_payload | final_review_payload | missing_final_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| default | final | 7 | reviewer_decision | final_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review | feature | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | feature | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | feature | 3 | review_scope_accounting | review_scope_ledger | missing_review_scope_accounting | reviewScopeLedgerFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review | feature | 4 | reviewer_decision | feature_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review | feature | 5 | validation_scope | targeted_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | feature | 6 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | feature | 7 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review | final | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | final | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | final | 3 | review_scope_accounting | review_scope_ledger | missing_review_scope_accounting | reviewScopeLedgerFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review | final | 4 | validation_scope | broad_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | final | 5 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | final | 6 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review | final | 7 | final_review_payload | final_review_payload | missing_final_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review | final | 8 | reviewer_decision | final_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review_and_fix | feature | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | feature | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | feature | 3 | review_finding_closure | review_finding_closure_ledger | missing_review_closure | reviewFindingClosureFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | feature | 4 | review_scope_accounting | review_scope_ledger | missing_review_scope_accounting | reviewScopeLedgerFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review_and_fix | feature | 5 | reviewer_decision | feature_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review_and_fix | feature | 6 | validation_scope | targeted_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | feature | 7 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | feature | 8 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 1 | validation_evidence | - | missing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 2 | validation_passed | - | failing_validation | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 3 | review_finding_closure | review_finding_closure_ledger | missing_review_closure | reviewFindingClosureFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 4 | review_scope_accounting | review_scope_ledger | missing_review_scope_accounting | reviewScopeLedgerFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
| review_and_fix | final | 5 | validation_scope | broad_validation_result | missing_validation_scope | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 6 | feature_review | - | failing_feature_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 7 | final_review_passed | - | failing_final_review | finalReviewFailureMessage | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 8 | final_review_payload | final_review_payload | missing_final_review | validateNormalizedSuccessfulCompletion | completion.gates.required_order, recovery.next_action.binding |
| review_and_fix | final | 9 | reviewer_decision | final_reviewer_decision | missing_reviewer_decision | finalReviewerDecisionFailureMessage | completion.gates.required_order, review.scope.payload_binding, recovery.next_action.binding |
<!-- completion-gate-doc-table:end -->

## Semantic parity anchors

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers
