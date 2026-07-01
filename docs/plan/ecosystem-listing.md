# Ecosystem listing submissions

Status: drafted, not submitted (maintainer submits the PRs)

Flow is not listed on the OpenCode ecosystem page while direct alternatives
(micode, opencode-conductor, subtask2, opencode-tasks) are. Two submissions
close the discoverability gap.

## 1. opencode.ai ecosystem page

Repo: `anomalyco/opencode`, file
`packages/web/src/content/docs/ecosystem.mdx` (Plugins table; the docs page
says "Want to add your OpenCode related project to this list? Submit a PR").

Proposed row:

| Name | Description |
| --- | --- |
| opencode-plugin-flow | Durable one-feature-at-a-time planning/execution loop with enforced validation and review gates, resumable across restarts |

## 2. awesome-opencode

Proposed entry (Plugins section):

> [opencode-plugin-flow](https://github.com/ddv1982/flow-opencode) — Stateful
> planning and execution workflow: plan a goal as features, approve the plan,
> then implement one feature at a time with enforced validation and review
> evidence. Session state survives restarts and compaction.

## Notes

- Submit after the next release so the README quick start is live on npm.
- Both descriptions deliberately lead with the durable state machine and
  hard gates — that is the differentiator against prompt-only workflow
  plugins in the same table.
