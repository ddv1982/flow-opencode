# Flow invariant matrix

This matrix records the runtime-owned guarantees that must stay green while Flow is simplified.

| Invariant ID | Invariant | Primary owner | Supporting evidence | Primary verification |
| --- | --- | --- | --- | --- |
| `completion.gates.required_order` | Final-path completion requires the correct validation/review gates in runtime-defined order | `src/runtime/transitions/execution-completion.ts` | `validateSuccessfulCompletion()` and completion recovery ordering | `tests/runtime/semantic-invariants.test.ts`, `tests/completion-gates.test.ts`, `tests/runtime-completion-contracts.test.ts` |
| `completion.policy.min_completed_features` | Delivery/completion thresholds stay runtime-owned and allow threshold-based completion with pending work when configured | `src/runtime/domain/workflow-policy.ts`, `src/runtime/domain/completion.ts` | target-completion and decision-gate logic | `tests/runtime/semantic-invariants.test.ts`, `tests/runtime-summary.test.ts`, `tests/completion-gates.test.ts` |
| `decision_gate.planning_surface.binding` | Planning decision logs surface into runtime summaries/guidance as `decisionGate` payloads | `src/runtime/domain/workflow-policy.ts`, `src/runtime/summary.ts` | `activeDecisionGate()` and `explainSessionState()` | `tests/runtime/semantic-invariants.test.ts`, `tests/runtime-summary.test.ts` |
| `review.scope.payload_binding` | Feature/final review payload scopes remain distinct and invalid cross-scope payloads are rejected | `src/runtime/schema.ts`, review transitions | feature/final review arg schemas | `tests/runtime/semantic-invariants.test.ts`, `tests/reviewer-decision-scope.test.ts`, `tests/runtime-completion-contracts.test.ts` |
| `recovery.next_action.binding` | Recovery hints stay aligned with runtime recovery policy and canonical next actions | `src/runtime/transitions/recovery.ts` | canonical recovery metadata and resolution hints | `tests/runtime/semantic-invariants.test.ts`, `tests/recovery-hint-parity.test.ts`, `tests/runtime-recovery.test.ts` |
| `tools.canonical_surface.no_raw_wrappers` | Public tool / command / agent surfaces stay coherent and canonical-only | `src/tools.ts`, `src/tools/session-tools.ts`, `src/tools/runtime-tools.ts`, `src/config.ts` | registered tools plus injected commands/agents | `tests/runtime/semantic-invariants.test.ts`, `tests/config.test.ts`, `tests/smoke/dist-load.test.ts`, `tests/docs-tool-parity.test.ts` |

## Semantic parity gate

Use runtime-emitted semantic invariant IDs as the blocking merge gate for semantic drift. Prompt/docs layers may mirror or reference these IDs, but they do not own the policy behind them.

## Declared semantic invariant IDs

- [semantic-invariant] completion.gates.required_order
- [semantic-invariant] completion.policy.min_completed_features
- [semantic-invariant] decision_gate.planning_surface.binding
- [semantic-invariant] review.scope.payload_binding
- [semantic-invariant] recovery.next_action.binding
- [semantic-invariant] tools.canonical_surface.no_raw_wrappers
