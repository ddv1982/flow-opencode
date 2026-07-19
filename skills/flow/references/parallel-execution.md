# Parallel pass execution

Read this after a pass decision and complete manifest. It defines Flow-native
worker routing, permissions, and launch prompts. Do not use generic workers for
Flow slices when the named hidden Flow worker is available.

## Modes

| Mode | Use worker | Output | Write access |
| --- | --- | --- | --- |
| `evidence` | `flow-evidence-worker` | Facts, coverage, confidence, gaps | None |
| `review` | `flow-reviewer` | Review slice findings and coverage | None |
| `validation` | `flow-validation-worker` | Proposed checks or authorized raw command evidence | Commands only when explicitly allowed |
| `audit` | `flow-audit-worker` | Refuted or surviving findings and guards checked | None |
| `verifier` | `flow-verifier-worker` | Per-claim verdicts against cited evidence | None |
| `candidate-implementation` | `flow-candidate-worker` | Candidate patch from isolated or exact-path ownership | Explicitly authorized owned paths only |

## Worker role contracts

These marked blocks are the canonical role instructions compiled into hidden
worker prompts.

<!-- flow-prompt:worker-role-evidence:start -->
### Flow evidence worker

Inspect only the assigned read-only slice. Report observed facts and coverage;
do not edit files, expand scope, or synthesize the whole pass. Only the root
manager may mutate Flow state.
<!-- flow-prompt:worker-role-evidence:end -->

<!-- flow-prompt:worker-role-validation:start -->
### Flow validation worker

Run only manager-specified commands or propose focused checks. Do not edit
files, expand scope, or synthesize completion. Only the root manager may mutate
Flow state. Distinguish commands actually run from checks merely proposed.
<!-- flow-prompt:worker-role-validation:end -->

<!-- flow-prompt:worker-role-audit:start -->
### Flow audit worker

Inspect only the assigned read-only slice and actively try to refute candidate
findings. Do not edit files, expand scope, or synthesize the whole audit. Only
the root manager may mutate Flow state. A blocking candidate must name the
guards and mitigating paths checked.
<!-- flow-prompt:worker-role-audit:end -->

<!-- flow-prompt:worker-role-candidate:start -->
### Flow candidate implementation worker

Work only in the manager-assigned isolated worktree or exact non-overlapping
path set. Preserve unrelated user changes. Never edit `.flow/**`, expand
ownership, claim completion, integrate other slices, commit, push, or publish.
Only the root manager may mutate Flow state. Your patch is a candidate for
manager inspection.
<!-- flow-prompt:worker-role-candidate:end -->

<!-- flow-prompt:worker-role-verifier:start -->
### Flow verifier worker

Verify only the assigned atomic claims against provided sources, commands,
counts, or current documentation. Resolve each source independently. Do not
generate new scope, edit files, identify the originating worker, or synthesize
the whole pass. Only the root manager may mutate Flow state.
<!-- flow-prompt:worker-role-verifier:end -->

## Permission contract

The plugin injects these hidden workers. `Flow state tools` means every
state-changing `flow_*` call; `flow_status` is the explicit read-only exception.

| Worker | Edit | Bash | Task | Skill | Flow state tools | `flow_status` |
| --- | --- | --- | --- | --- | --- | --- |
| `flow-reviewer` | deny | deny | deny | deny | deny | allow |
| `flow-evidence-worker` | deny | deny | deny | deny | deny | allow |
| `flow-validation-worker` | deny | ask | deny | deny | deny | allow |
| `flow-audit-worker` | deny | ask | deny | deny | deny | allow |
| `flow-candidate-worker` | ask | ask | deny | deny | deny | allow |
| `flow-verifier-worker` | deny | ask | deny | deny | deny | allow |

Never fan out `flow_plan_save`, `flow_plan_approve`, `flow_run_start`,
`flow_feature_complete`, `flow_feature_reset`, or `flow_session_close`. Workers
must not edit `.flow/**`, approve work, record Flow evidence, or claim commands
they did not run. Candidate workers may edit only their authorized isolation or
exact path scope.

## Launch

Every worker prompt contains:

```text
Overall goal, context only: <goal>
Mode: evidence | review | validation | audit | verifier | candidate-implementation
Pass id and manifest row id: <stable ids>
Your exact slice: <paths, modules, commands, claims, risk lens, or worktree>
Expected coverage: <count, paths, range, or completeness rule>
Dependencies and write scope: <verified dependencies; approved write scope>
Do: <bounded actions>
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the Flow handoff in this exact shape:
<matching handoff template copied verbatim from flow/references/handoff-format.md>
```

Hidden workers cannot load skills, references, or conversation history. Copy the
matching block from `flow/references/handoff-format.md`; a filename alone is
insufficient. Cite paths to any prerequisite synthesis artifact instead of
restating accumulated chat. For current-doc research, require checks for
versioned or time-sensitive facts. Remind candidate workers not to revert
unrelated changes.

Continue only non-overlapping manager work while workers run.

## Model routing

When the installation supports worker-specific models, use
`OPENCODE_FLOW_READONLY_WORKER_MODEL` for evidence, validation, and audit;
`OPENCODE_FLOW_REVIEW_WORKER_MODEL` for review and verification;
`OPENCODE_FLOW_CANDIDATE_WORKER_MODEL` for candidate implementation; and
`OPENCODE_FLOW_WORKER_MODEL` as fallback. Model ids are installation-specific
`provider/model` values. Leave overrides unset when the provider is unknown and
prefer stronger models where incorrect findings or patches are expensive.
