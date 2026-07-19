# Glossary

`CONTEXT.md` is the canonical terminology-only glossary. This page maps those
terms to their implementation sources.

| Term | Meaning | Source |
| --- | --- | --- |
| Flow v5 | Current product/runtime generation, distinct from the session schema version. | `package.json`, `CONTEXT.md` |
| Session v4 | Sole supported session-document contract for Flow v5. | `src/application/schema.ts`, `CONTEXT.md` |
| Flow session | The workflow ledger stored at `.flow/session.json` until archive publication converges. | `src/application/schema.ts`, `src/infrastructure/fs/workspace.ts` |
| Plan | A structured description of requirements, decisions, final review policy, and features. | `src/application/schema.ts` |
| Feature | One executable unit inside a plan, with id, title, summary, targets, validation, dependencies, and status. | `src/application/schema.ts` |
| Approval | The plan lock state, either `pending` or `approved`. Approved plans cannot be changed. | `src/domain/transitions.ts` |
| Active execution | The paired planned feature and execution epoch that is currently actionable. | `src/domain/session.ts`, `src/domain/transitions.ts` |
| Validation observation | A command/status/summary record offered as evidence before review assignment. | `src/application/schema.ts` |
| Validation scope | `targeted` for an ordinary feature outcome, `broad` for a final feature outcome. | `src/application/schema.ts`, `src/domain/transitions.ts` |
| Review assignment | Durable runtime-owned identity and bounded scope created before review. | `src/domain/session.ts` |
| Assignment result | Reviewer-reported verdict and findings for one assignment. | `src/domain/session.ts` |
| Bound prerequisite result | Passing feature-assignment result retained on a final assignment before recorded review history. | `src/domain/session.ts`, `src/domain/transitions.ts` |
| Recorded review execution | Assignment result accepted into durable history through an atomic feature outcome. | `src/domain/session.ts`, `src/domain/transitions.ts` |
| Reported time | Actor-supplied validation or review time bounded by lifecycle order. | `src/domain/transitions.ts` |
| Runtime acceptance time | Runtime-owned time at which a lifecycle operation is accepted. | `src/domain/transitions.ts` |
| Closure | Durable terminal disposition that leaves the session quiescent. | `src/domain/session.ts`, `src/domain/transitions.ts` |
| Archive publication | Publication of a closed session into history. | `src/infrastructure/fs/workspace.ts` |
| Archive-recovery session | Closed quiescent state whose archive publication has not converged. | `src/domain/transitions.ts`, `src/infrastructure/fs/workspace.ts` |
| Retry handle | Durable, workspace-history-unique accepted operation id used to resume interrupted archive publication. | `src/domain/session.ts`, `src/domain/transitions.ts` |
| Hidden worker | A Flow-managed OpenCode subagent injected by `src/config-shared.ts`. |
| Guidance id | Stable identifier for one embedded Markdown document returned by `flow_guidance`. | `src/guidance/ids.ts` |
| Legacy cleanup | Explicit CLI migration that archives pristine v4 global skill folders without deleting them. | `src/distribution/legacy-cleanup.ts` |
| Command preflight | Adapter hook that replaces manager command bodies and validates subtask command identity before rewriting its prompt. | `src/platform/opencode/plugin.ts` |

Related pages: [Session, plan, and feature](../primitives/session-plan-feature.md), [Validation and review](../primitives/validation-and-review.md), and [Embedded guidance](../features/embedded-guidance.md).
