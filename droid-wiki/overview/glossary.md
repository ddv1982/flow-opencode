# Glossary

This page defines Flow terms as they are used in the code, skills, and docs.

| Term | Meaning | Source |
| --- | --- | --- |
| Flow session | The active workflow ledger stored at `.flow/session.json`. | `src/application/schema.ts`, `src/infrastructure/fs/workspace.ts` |
| Plan | A structured description of requirements, decisions, final review policy, and features. | `src/application/schema.ts` |
| Feature | One executable unit inside a plan, with id, title, summary, targets, validation, dependencies, and status. | `src/application/schema.ts` |
| Approval | The plan lock state, either `pending` or `approved`. Approved plans cannot be changed. | `src/domain/transitions.ts` |
| Active feature | The single feature currently in progress. Flow refuses to start a second one. | `src/domain/transitions.ts` |
| Validation run | A command/status/summary record used as evidence before completion. | `src/application/schema.ts` |
| Validation scope | `targeted` for ordinary feature completion, `broad` for final feature completion. | `src/application/schema.ts`, `src/domain/transitions.ts` |
| Feature review | Passing review payload required for every completed feature. | `src/application/schema.ts` |
| Final review | Passing review payload required for final completion, with `reviewDepth` matching the approved plan. | `src/application/schema.ts`, `src/domain/transitions.ts` |
| Hidden worker | A Flow-managed OpenCode subagent injected by `src/config-shared.ts`. |
| Guidance id | Stable identifier for one embedded Markdown document returned by `flow_guidance`. | `src/guidance/ids.ts` |
| Legacy cleanup | Explicit CLI migration that archives pristine v4 global skill folders without deleting them. | `src/distribution/legacy-cleanup.ts` |
| Quarantine | Recovery path that moves unreadable active sessions into `.flow/history/`. | `src/application/flow-service.ts`, `src/infrastructure/fs/workspace.ts` |
| Command preflight | Adapter hook that replaces manager command bodies and validates subtask command identity before rewriting its prompt. | `src/platform/opencode/plugin.ts` |

Related pages: [Session, plan, and feature](../primitives/session-plan-feature.md), [Validation and review](../primitives/validation-and-review.md), and [Embedded guidance](../features/embedded-guidance.md).
