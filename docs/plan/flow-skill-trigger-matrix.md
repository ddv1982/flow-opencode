# Flow skill trigger matrix

Status: implemented
Created: 2026-06-17

## Purpose

Record the prompt-trigger expectations used while implementing
`flow-skill-best-practices-review.md`.

Skill descriptions are the primary implicit trigger surface, so the intended
primary skill should be clear from common user phrasing before helper skills are
loaded through another Flow workflow.

## Matrix

| Prompt | Intended primary skill | Acceptable helpers or notes |
| --- | --- | --- |
| `run tests for this change` | `flow-test` | `flow-run` may load it inside an active feature. |
| `validate this feature` | `flow-test` | `flow-run` may own Flow state if a feature is active. |
| `make a test plan` | `flow-test` | `flow-plan` may use it when feature validation strategy is uncertain. |
| `triage this failing check` | `flow-test` | Failure classification should stay evidence-based. |
| `commit these changes` | `flow-commit` | `flow-contribution-check` can validate staged or outgoing work after boundaries are chosen. |
| `write a commit message` | `flow-commit` | Message text must reflect only the staged diff or proposed boundary. |
| `run preflight before commit` | `flow-contribution-check` | `flow-commit` can delegate to it after staging. |
| `prepare this branch for push` | `flow-contribution-check` | `flow-commit` is relevant only for commit readiness, not push validation. |
| `run Flow end to end` | `flow` | `flow` loads plan, run, review, and conditional helpers as needed. |
| `plan this Flow task` | `flow-plan` | `flow` is acceptable for a broader end-to-end request. |
| `run the next Flow feature` | `flow-run` | `flow` is acceptable when the user wants the broader loop. |
| `review this Flow feature` | `flow-review` | `flow-test` is only for validation-evidence review gaps. |
| `clean up this messy code` | `flow-deslop` | `flow-plan` or `flow-run` may load it for Flow-managed cleanup work. |
| `review this UI` | `flow-ui-quality` | `flow-review` may return the gated review payload. |
| `validate the browser flow` | `flow-test` | Ambiguous: use `flow-ui-quality` when the user asks for visual/design judgment. |

## Decisions

- `flow-test` targets validation and failure-triage prompts, including browser
  validation evidence.
- `flow-ui-quality` keeps visual judgment, design quality, screenshot assessment,
  and frontend UX standards.
- `flow-commit` owns commit preparation, staging boundaries, validation choices,
  and commit messages.
- `flow-contribution-check` owns repository-local contribution readiness
  preflight for staged or outgoing work.
- `flow` should win only broad end-to-end Flow loop prompts; narrow plan, run,
  review, validation, cleanup, UI, or commit prompts should resolve to the
  narrower skill first.
