# Parallel pass example

Use this example after `parallel-orchestration.md` when a broad Flow task needs a
concrete pass shape.

Goal: review whether bundled Flow command guidance is self-contained and aligned
with hidden worker permissions.

Serial orientation: the manager reads `src/config-shared.ts` enough to identify
five public command templates and six hidden worker configs. The manager keeps
`flow-status` local because it is one line and does not need a worker.

Coverage gate: ten countable items remain after the local check.

- Slice A: `flow-auto`, `flow-plan`, and `flow-run` templates, expected 3/10.
- Slice B: `flow-review` template plus `flow-reviewer` config, expected 2/10.
- Slice C: remaining hidden worker permission blocks, expected 5/10 after
  excluding the reviewer already covered by Slice B.

Worker prompts:

```text
Overall goal, context only: confirm Flow public commands are self-contained.
Mode: evidence
Your exact slice: flow-auto, flow-plan, and flow-run templates in src/config-shared.ts.
Expected coverage: 3/3 templates.
Do: report bundled sections, setup preflight coverage, and any gaps with file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the matching Flow handoff from handoff-format.md.
```

```text
Overall goal, context only: confirm Flow review command and hidden reviewer behavior.
Mode: review
Your exact slice: flow-review command template and flow-reviewer config in src/config-shared.ts.
Expected coverage: 2/2 surfaces.
Do: separate blocking findings from advisory notes and cite file:line evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the matching Flow handoff from handoff-format.md.
```

```text
Overall goal, context only: confirm hidden worker permissions match the orchestration model.
Mode: audit
Your exact slice: flow-evidence-worker, flow-validation-worker, flow-audit-worker, flow-candidate-worker, and flow-verifier-worker permissions in src/config-shared.ts.
Expected coverage: 5/5 worker permission blocks.
Do: report edit, bash, task, skill, flow_*, and flow_status permissions with evidence.
Do not: call state-changing Flow tools, edit .flow/**, own sibling slices, or make the final Flow verdict.
Return only the matching Flow handoff from handoff-format.md.
```

Handoff checks: the manager accepts only reports with terminal status, matching
coverage counts, concrete file:line evidence, confidence tags, and claims inside
the assigned slice. A claim such as `[high] validation workers may run commands;
evidence: src/config-shared.ts:307-320; corroboration: single source` is usable.
A claim such as `[high] permissions look safe; evidence: config reviewed` is
dropped or retasked.

Verifier pass: the manager sends any single-source claim that will enter the
Flow payload to `flow-verifier-worker`, for example: `C1: validation, audit,
candidate, and verifier workers have bash ask while evidence and review workers
have bash deny; sources: src/config-shared.ts worker permission blocks`.

Final synthesis: the manager re-reads the relevant config lines, keeps only
verified or clearly labeled claims, and records one artifact such as a plan
decision, review payload, or docs patch. Raw handoffs and unverified suggestions
do not move into the next pass or user-facing answer.
