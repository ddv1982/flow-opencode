# Glossary

This page defines Flow terms as they are used in the code, skills, and docs.

| Term | Meaning | Source |
| --- | --- | --- |
| Flow session | The active workflow ledger stored at `.flow/session.json`. | `src/runtime/schema.ts`, `src/runtime/workspace.ts` |
| Plan | A structured description of requirements, decisions, final review policy, and features. | `src/runtime/schema.ts` |
| Feature | One executable unit inside a plan, with id, title, summary, targets, validation, dependencies, and status. | `src/runtime/schema.ts` |
| Approval | The plan lock state, either `pending` or `approved`. Approved plans cannot be changed. | `src/runtime/transitions.ts` |
| Active feature | The single feature currently in progress. Flow refuses to start a second one. | `src/runtime/transitions.ts` |
| Validation run | A command/status/summary record used as evidence before completion. | `src/runtime/schema.ts` |
| Validation scope | `targeted` for ordinary feature completion, `broad` for final feature completion. | `src/runtime/schema.ts`, `src/runtime/transitions.ts` |
| Feature review | Passing review payload required for every completed feature. | `src/runtime/schema.ts` |
| Final review | Passing review payload required for final completion, with `reviewDepth` matching the approved plan. | `src/runtime/schema.ts`, `src/runtime/transitions.ts` |
| Hidden worker | A Flow-managed OpenCode subagent injected by `src/config-shared.ts`. |
| Managed skill | One of the bundled skill folders copied from `skills/` to the OpenCode skills root. | `src/distribution/flow-skill-definitions.ts` |
| Skill sync | Startup and CLI process that installs, updates, or diagnoses managed skills. | `src/distribution/sync.ts` |
| Generated instructions | `.flow/opencode-instructions.md`, a rebuildable projection registered through OpenCode `config.instructions`. | `src/runtime/workspace.ts`, `src/adapters/opencode/config.ts` |
| Quarantine | Recovery path that moves unreadable active sessions into `.flow/history/`. | `src/runtime/api.ts`, `src/runtime/workspace.ts` |
| Command preflight | Adapter hook that replaces Flow slash command bodies with bundled current instructions. | `src/adapters/opencode/plugin.ts` |

Related pages: [Session, plan, and feature](../primitives/session-plan-feature.md), [Validation and review](../primitives/validation-and-review.md), and [Managed skills](../features/managed-skills.md).
