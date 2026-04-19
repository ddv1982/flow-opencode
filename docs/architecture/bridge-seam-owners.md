# Bridge seam owners (Phase 1.5)

| Seam ID | Primary owner role | Backup owner | Blocking tests |
| --- | --- | --- | --- |
| BR-01 plan-apply-shape | `executor` | `test-engineer` | `tests/config.test.ts` (`non-worker tool schemas...`, `planning tool schema matches runtime feature id format constraints`); `tests/runtime-completion-contracts.test.ts` (`rejects unsafe feature ids during plan apply`); `tests/schema-equivalence.test-d.ts` (`_flowPlanApplyArgsMatchExpected`) |
| BR-02 plan-context-record-shape | `executor` | `test-engineer` | `tests/config.test.ts` (`non-worker tool schemas accept representative valid payloads and reject invalid ones`); `tests/runtime-tools.test.ts` (`every Flow tool emits non-empty metadata and still returns a string`) |
| BR-03 planning-context-normalization | `executor` | `architect` | `tests/runtime-completion-contracts.test.ts` (`rejects unsafe feature ids during plan apply`); `tests/runtime-tools.test.ts` (`tools return machine-readable missing-session responses for plan, review, and reset operations`) |
| BR-04 plan-feature-id-sanitization | `executor` | `test-engineer` | `tests/config.test.ts` (plan approve/select schema cases); `tests/runtime-completion-contracts.test.ts` (`rejects malformed dependency graphs during plan apply`) |
| BR-05 run-start-shape | `executor` | `verifier` | `tests/config.test.ts` (flow_run_start schema cases); `tests/runtime-tools.test.ts` (`tool rejects flow_run_start for completed sessions`) |
| BR-06 worker-result-raw-vs-runtime | `executor` | `test-engineer` | `tests/config.test.ts` (`worker tool raw args accept...`, `worker tool raw schema stays structurally aligned...`, `worker tool raw schema rejects invalid feature ids...`); `tests/runtime-tools.test.ts` (`tool rejects the old nested worker payload shape`, `tool rejects non-ok worker payloads missing outcome at parse time`); `tests/runtime-completion-contracts.test.ts` (`rejects replan_required outcomes without structured replan fields`) |
| BR-07 worker-to-transition-cast | `executor` | `verifier` | `tests/runtime-completion-contracts.test.ts` (`tool accepts the documented top-level worker payload`, `completeRun accepts the documented top-level worker payload directly`, `completeRun preserves optional worker-result fields without adapters`); `tests/schema-equivalence.test-d.ts` (`_workerResultArgsIncludesReplanWithoutRequiredOutcomeOmission`) |
| BR-08 reset-feature-shape | `executor` | `test-engineer` | `tests/config.test.ts` (flow_reset_feature schema cases); `tests/runtime-tools.test.ts` (`tools return machine-readable missing-session responses for plan, review, and reset operations`) |
| BR-09 review-args-shapes-exported-via-shared | `executor` | `test-engineer` | `tests/config.test.ts` (feature/final review schema cases); `tests/runtime-completion-contracts.test.ts` (`reviewer decision tool rejects featureId on final review at parse time`) |

## Ownership rule

Bridge seam changes are not merge-ready unless the listed blocking tests are green and no new boundary cast points are added in scoped bridge files without corresponding seam tests.
