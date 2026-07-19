# Flow prompt quality

Flow compiles public-command and hidden-worker prompts in
`src/prompt-surfaces.ts`; `src/config-shared.ts` consumes the
`surface-specific-bookended` variant. The compiler selects role- and
phase-specific material instead of concatenating whole skills.

Run the offline report and tests with:

```bash
bun run prompt:quality
bun run prompt:quality --json
bun test tests/prompt-quality.test.ts
```

Run the opt-in model comparison with:

```bash
bun run prompt:model-eval -- \
  --model openai/gpt-5.4 \
  --reasoning high \
  --timeout-ms 300000
```

`prompt:quality` is deterministic and offline. `prompt:model-eval` sends the
actual rendered prompt sets plus 19 scenarios to one requested model, requires
strict structured decisions, and grades those decisions deterministically. It
uses OpenCode `1.18.3`, `--pure`, an isolated temporary directory, and no
auto-approved tools. The default timeout is five minutes per variant and can be
changed with `--timeout-ms`. Standard output, standard error, and process exit
are drained concurrently so a large response cannot deadlock the runner.

Run model jobs sequentially: concurrent OpenCode processes can contend on the
local session database. The static token estimate is `ceil(characters / 4)`;
it is a comparative estimate, not a model tokenizer or quality score.

## Architecture and source ownership

Prompt fragments declare both their role and their origin:

- `skill-source` fragments are extracted directly from bundled skill files.
  Markdown sections are selected by heading; prompt-only blocks use unique
  `<!-- flow-prompt:...:start/end -->` markers.
- `compiler` fragments contain only host routing, purpose, and bookend text
  owned by `src/prompt-surfaces.ts`.
- Tests reject skill-looking source paths on compiler-owned fragments, duplicate
  fragment ids, role-inapplicable fragments, and missing or duplicate source
  markers.

`src/prompt-baseline-fixtures.ts` contains the only manual-text exception: a
frozen snapshot of pre-compiler assembly topology used for comparison. Default
production surfaces never select it. Its lifecycle and wire language stays
current, while current judgment remains sourced from skill Markdown.

The parallel routing index is
`skills/flow/references/parallel-orchestration.md`. The canonical manager
decision block lives in `parallel-decision.md`, and hidden-worker role contracts
live in `parallel-execution.md`. Worker integrity and each handoff schema live
in `skills/flow/references/handoff-format.md`. Hidden
reviewer depth, availability, output, cleanup, UI, audit, and completion rules
live in
`skills/flow-review/references/hidden-reviewer-contract.md`. This removes the
former hand-maintained prompt projections and keeps one source for each rule.

Manager prompts retain only minimal public-review routing. The reserved
`flow-reviewer` owns review judgment. Each other hidden worker receives one
role contract, one matching handoff schema, and the shared integrity rule.

Native skill loading follows the same progressive-disclosure boundary: read the
decision reference first, stop when work remains serial, load manifest and
execution guidance only after selecting fan-out, and load synthesis guidance
when handoffs return. The full advanced contract remains available without
charging ordinary serial work for every worker-stage instruction.

The former parallel playbook was 4,601 words. The routing index plus decision
branch is now 1,122 words (75.6% less) for work that remains serial. A selected
pass reaches 2,424 words through manifest and execution (47.3% less before
handoffs), while the complete staged contract is 3,177 words (30.9% less).
The optional worked example is excluded from these path totals.

## Closure and continuation policy

Flow has no token, compaction, phase-boundary, or resume-packet protocol. A
blocked feature resumes only through an explicit `flow_feature_reset`. A compact
projection with `workflowData.projection.closure.kind` is archive-only: the
manager retries guarded `flow_session_close` and does not run, reset, approve,
or replan it.

## Static evaluation

The 19 fixtures cover serial fixes, planning, an explicit plan-only request
through `/flow-auto`, review-first work, persistence,
UI validation, parallel discovery, partial and malformed handoffs, bounded
review repair, archive retry behavior, safe and unsafe candidate work, missing
planning/execution runtimes, detailed review, cleanup/UI evidence gaps, and
review-retry exhaustion.

| Variant | Complete scenarios | Criteria | Est. tokens | Exact duplicate lines | Role-inapplicable lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whole-skill baseline | 13/19 | 45/54 | 62,847 | 192 | 26 |
| Lexically deduplicated | 13/19 | 45/54 | 62,603 | 176 | 26 |
| Surface-specific | 19/19 | 54/54 | 18,352 | 7 | 0 |
| Surface-specific with bookends | 19/19 | 54/54 | 19,061 | 7 | 0 |

The implemented bookended set is 69.7% smaller than the whole-skill baseline by this
estimate. Lexical deduplication alone changes little; role/phase selection
accounts for nearly all of the reduction and eliminates role-inapplicable
lines.

### Implemented surface inventory

| Surface | Words | Est. tokens | Actions | Exact dupes | Sources |
| --- | ---: | ---: | ---: | ---: | ---: |
| `flow-auto` | 4,453 | 8,315 | 132 | 4 | 11 |
| `flow-plan` | 1,486 | 2,794 | 52 | 2 | 7 |
| `flow-run` | 2,115 | 3,983 | 51 | 0 | 8 |
| `flow-review` task | 76 | 140 | 0 | 0 | 1 |
| `flow-status` | 10 | 16 | 1 | 0 | 0 |
| `flow-reviewer` agent | 1,189 | 2,225 | 49 | 1 | 4 |
| `flow-evidence-worker` | 170 | 303 | 3 | 0 | 3 |
| `flow-validation-worker` | 170 | 305 | 3 | 0 | 3 |
| `flow-audit-worker` | 181 | 320 | 3 | 0 | 3 |
| `flow-verifier-worker` | 173 | 311 | 3 | 0 | 3 |
| `flow-candidate-worker` | 195 | 349 | 3 | 0 | 3 |

Worker prompts are larger than their old one-paragraph forms because the old
prompts referred to a handoff without supplying its required shape. The
exported `validateFlowWorkerHandoff` rejects missing headings, empty sections,
unresolved placeholders, duplicate headings, invalid status values, and free
form output in offline checks. OpenCode still returns worker output as plain
text, so this is not a runtime interception hook and does not establish that a
claim is true.

The hidden reviewer grew from the first surface-specific draft because that
draft had accidentally omitted detailed-review depth, runtime-unavailable
behavior, and cleanup/UI special-case evidence. Restoring that judgment is an
intentional quality correction, while the reviewer remains 49.6% smaller than
the 4,414-token whole-skill baseline.

## Live model comparison

On 2026-07-17, the runner compared the whole-skill baseline and implemented
prompt sets, then reran the GPT-5.6 Sol implemented set after the
progressive-disclosure split. Each model returned one decision per scenario,
graded across 96 routing, scope, validation, review, retry, ownership, handoff,
continuation, and false-completion criteria. These are single-sample decision
simulations, not end-to-end Flow executions.

These provider-backed rows predate the nineteenth deterministic plan-only
scenario and remain historical 18-scenario samples. No 19-scenario model score
is claimed until that optional evaluation is rerun.

| Model | Configuration | Variant | Scenarios | Criteria | Tool events | OpenCode-reported tokens |
| --- | --- | --- | ---: | ---: | ---: | --- |
| `openai/gpt-5.4` | high reasoning | Baseline | 15/18 | 92/96 | 0 | 62,055 input + 12,800 cache read; 87,310 total |
| `openai/gpt-5.4` | high reasoning | Implemented | 18/18 | 96/96 | 0 | 20,080 input + 12,800 cache read; 46,580 total |
| `openai/gpt-5.6-sol` | high reasoning | Baseline | 17/18 | 95/96 | 0 | 74,956 input; 82,430 total |
| `openai/gpt-5.6-sol` | high reasoning | Implemented after progressive-disclosure split | 18/18 | 96/96 | 0 | 33,052 input; 41,668 total |
| `opencode/deepseek-v4-flash-free` | provider default | Baseline | 10/18 | 86/96 | 0 | 83,619 input; 94,803 total |
| `opencode/deepseek-v4-flash-free` | provider default | Implemented | 11/18 | 89/96 | 1 | 4,170 input + 60,416 cache read; 68,694 total |

The OpenAI implemented result passed every criterion while reducing uncached
input by 67.6%. The DeepSeek implemented result improved scenario and criterion
scores but still missed browser evidence, parallel discovery, and root-manager
state ownership in several worker/reviewer scenarios; it also emitted one tool
event despite the tool-free instruction. Those misses remain explicit caveats
and illustrate the variability of a single provider sample.

The candidate scenario states that it begins at the root Flow manager, and
the canonical `flow-run` source explicitly identifies the hidden candidate as a
subordinate rather than an entry route. Refreshed GPT-5.6 Sol samples routed the
safe candidate case through `flow-run`, called status first, retained root
manager state ownership, required a complete manifest, and then selected the
candidate and reviewer workers. The post-split implemented sample passed 18/18
and 96/96 with no tool events. Because the baseline was not rerun after the
native-reference split, no new paired token-reduction percentage is claimed.
In the earlier paired run, the implemented prompt reduced uncached input by
73.1%. The refreshed baseline passed the candidate
case but varied on an unrelated detailed-review decision by selecting the
public `flow-review` route without listing the hidden reviewer, producing its
17/18 result. This movement from an earlier perfect baseline sample is kept as
evidence of single-sample model variability.

An initial DeepSeek response used `"not_applicable"` inside validation arrays.
The strict schema rejected the entire run. The packet now explicitly requires
`[]` for non-applicable arrays and reserves `"not_applicable"` for scalar enums;
the recorded comparison is the successful rerun. Model ids are provider
aliases, so this runner cannot identify the provider's exact underlying model
snapshot.

The packet contains all eleven surfaces so a model can choose routes. Actual
OpenCode delivery supplies one applicable role/phase surface. Aggregate packet
size and cross-role competition are therefore confounds, and the live results
support comparison rather than a universal quality claim.

## Repetition decisions

| Rule or material | Decision | Reason |
| --- | --- | --- |
| `flow_status` before action | Keep | Ambient and command occurrences cross different recovery boundaries. |
| Manager state ownership | Keep | Manager routing, worker prose, and permission maps protect different trust boundaries. |
| Full review bundle in task and reviewer | Consolidate | The reserved reviewer is canonical; the task retains routing only. |
| Per-tool worker mutation prohibitions | Enforce structurally | Permission maps are authoritative; prompts retain one ownership reminder. |
| Full parallel playbook | Load conditionally | Commands need the bounded decision/manifest contract; stages remain progressive-disclosure material. |
| Every handoff format in manager prompts | Load conditionally | Each worker gets one schema; managers retain acceptance and accounting rules. |
| Planning examples | Remove | The schema and checklist retain the distinct planning contract. |
| Completion checkpoint | Keep after evaluation | A short final bookend restores the pending-archive criterion without repeating the full prompt. |
| Manager and reviewer judgment | Keep separately | Routing and independent review cross different role boundaries and have different canonical sources. |

Safety text is not removed merely because it repeats. Runtime gates, manager
routing, and worker permissions remain separate enforcement layers.

## Regression policy

`tests/fixtures/prompt-quality-baseline.json` records accepted per-surface word
counts, exact-duplicate ceilings, and a justification. A prompt fails the size
guard only when it grows by more than the larger of eight words or 2%; tiny
formatting changes do not force a rebaseline. Material growth requires an
updated accepted baseline and specific justification.

Tests also reject missing static contracts, model-directed compaction language,
manager-only worker capabilities, missing or multiple schemas, terminology
drift, bundled example/handoff catalogs, and long references without
navigation. Model-response schemas reject missing or extra fields and missing,
duplicate, unknown, or malformed scenario decisions. Model evaluation remains
opt-in because it uses external providers, is slower, and is nondeterministic.

## Conductor decision

Defer a deterministic Flow Conductor. The evidence now covers rendered
contracts and two model families' next-step decisions, but the runner does not
launch real child sessions or observe concurrency supervision, handoff
collection, cancellation, retry accounting, recovery, result ordering, or
progress reporting. That is not enough evidence to justify new runtime
machinery.

The next evidence step is an instrumented live integration evaluation of those
mechanics with prompt quality held constant. If it exposes recurring mechanical
failures, the first conductor increment should remain read-only and bounded,
reuse existing hidden workers and handoff validation, preserve manager-only
state mutation, retry at most once, persist only bounded recovery data, and
retain the prompt-driven path as fallback.
