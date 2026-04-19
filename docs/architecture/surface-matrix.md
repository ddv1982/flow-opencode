# Flow surface matrix

## Current baseline

| Surface | Source of truth | Current shape | Verification |
| --- | --- | --- | --- |
| Agents | `src/config.ts` | 5 (`flow-planner`, `flow-worker`, `flow-auto`, `flow-reviewer`, `flow-control`) | `tests/config.test.ts` |
| Commands | `src/config.ts` | 8 (`flow-plan`, `flow-run`, `flow-auto`, `flow-status`, `flow-doctor`, `flow-history`, `flow-session`, `flow-reset`) | `tests/config.test.ts` |
| Tools | `src/tools.ts`, `src/tools/session-tools.ts`, `src/tools/runtime-tools.ts` | 17 registered tools | `tests/config.test.ts`, `tests/smoke/dist-load.test.ts`, `tests/docs-tool-parity.test.ts` |
| Runtime policy | `src/runtime/domain/*`, `src/runtime/transitions/*`, `src/runtime/schema.ts` | normative workflow semantics | invariant gate matrix |
| Prompt expression | `src/prompts/contracts.ts`, `src/prompts/fragments.ts`, derived prompts/commands | role-specific wording only | `tests/protocol-parity.test.ts` |

## Simplification target

Keep the runtime/tool/command surface behaviorally stable while reducing duplicated policy wording and docs drift. Simplification is successful when:
- runtime remains the normative owner of workflow semantics
- prompt/doc surfaces become thinner expression layers
- docs stay mechanically aligned with the registered tool surface
- no user-visible command or tool change ships without an explicit migration note
