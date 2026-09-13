# F0 contract matrix

| Contract | Existing evidence and implementation check | Limit |
| --- | --- | --- |
| Plan approval preserves plan-only authority | tests/auto-drive.test.ts, tests/request-evidence.test.ts, prompt conformance scenarios | User intent remains a model judgment. Approval is not a new permission grant. |
| Named evidence must record each required assertion | tests/request-evidence.test.ts, tests/test-results.test.ts | A named assertion's relevance to the request remains a judgment. |
| Source drift invalidates old validation | tests/runtime-gates.test.ts | Source snapshots do not serialize external worktree edits. |
| Exact retries do not duplicate accepted mutations | tests/domain-transitions.test.ts, tests/runtime-close.test.ts | Operation IDs identify exact payloads, not semantically equivalent requests. |
| Reviewer submission belongs to the reserved reviewer | tests/flow-leadership.test.ts, tests/live-opencode-smoke.test.ts | Independence is host-attested. Review quality needs separate outcome evals. |
| Inspection completes with findings | tests/runtime-close.test.ts, tests/assurance-projection.test.ts | Negative findings do not establish accepted implementation. |
| Archive publication and retry preserve accepted records | tests/workspace-persistence.test.ts, tests/runtime-close.test.ts | Conflicting archives require explicit recovery. |
| Request anchoring preserves originating-host authority | tests/request-evidence.test.ts | Process-local continuation authority is not reconstructed from persisted state. |
| Concurrent lifecycle mutations serialize | tests/workspace-persistence.test.ts, tests/runtime-gates.test.ts | Filesystem locks protect state transactions, not whole command executions or worktree edits. |
| Terminal capacity survives admission limits | F0 capacity regressions and persisted close probe | Existing revision values at Number.MAX_SAFE_INTEGER have no representable successor in Session v5. No revision reset is introduced. |

Paths name intended verification targets, not a new passing-test claim. Phase verification records the commands and outcomes.
