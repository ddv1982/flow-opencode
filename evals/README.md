# Flow evals

`tests/` proves the runtime deterministically. These evals prove the thing tests
cannot: that a **real model, driven by the real prompts, reaches the intended
workflow outcome**.

They exist because prompt changes were previously unmeasured. Every scenario
asserts durable Session v5 state and the observed tool-call sequence — never
prompt wording — so a prompt can be rewritten freely as long as the outcomes
hold.

## Running

Needs provider credentials, so this is never part of `bun run check`.

```bash
bun run eval -- --model openai/gpt-5.6-sol
bun run eval -- --model openai/gpt-5.6-sol --model opencode/claude-opus-5
bun run eval -- --scenario happy-path --repeat 3
```

Ids are `providerID/modelID` as the host resolves them, which depends on which
providers you have authenticated — Opus 5 may be `opencode/claude-opus-5` rather
than `anthropic/claude-opus-5`. Only the first slash separates the two halves, so
a gateway model id keeps its own (`openrouter/openai/gpt-5.6-sol`).

A preflight boots one throwaway host and checks two separate things before the
run spends anything:

1. **The id resolves.** OpenCode builds its catalog from Models.dev overlaid with
   your configured providers. A miss here is a spelling or configuration problem.
2. **The model answers.** One near-free completion per model. A model can resolve
   and still refuse, because the catalog says nothing about whether your account
   is *entitled* to call it — the normal state for a newly released or
   preview-gated model. Without this stage that failure surfaces partway into a
   paid pass.

Either failure exits 2 before any scenario runs. Losing the probe host itself
reports `SKIPPED` and continues, since that is no evidence about the models.

The child host gets its own XDG directories so it never touches your session
database, but credentials live in that same data directory, so `auth.json` is
copied into the throwaway home and removed with it. Set `FLOW_EVAL_NO_AUTH_COPY=1`
to skip the copy and rely on environment credentials only.

`FLOW_EVAL_MODEL` accepts a comma-separated list as an alternative to `--model`.
`FLOW_OPENCODE_SMOKE_VERSION` overrides the pinned host.

Each run packs the working tree, boots a throwaway OpenCode host over a fresh
git fixture, drives the real slash commands, then reads `.flow/session.json` and
`.flow/history/`. Reports land in `evals/results/` (git-ignored).

## Scenarios

| id | invariant under test |
| --- | --- |
| `happy-path` | `/flow-auto` with authority runs every feature and closes `completed`, with an exit-zero validation and exactly one passing review per completed run |
| `plan-only-stops` | `/flow-plan` saves a plan and starts no run |
| `goal-change-refused` | a materially different request does not mutate, replace, or close the active session |
| `failing-gate-blocks` | a gate that cannot pass never yields `completed` closure, the red test is reported rather than deleted, and no review submission is rejected for dropping a live prior finding id (asking the user how to close is an accepted end) |
| `resumes-after-interruption` | a fresh session with no transcript resumes the planned goal from `.flow` instead of starting a second lifecycle |

These cover the invariants most of Flow's prompt text exists to protect.
`goal-change-refused` is the important one: goal alignment is the single
most-repeated rule in the repository and has almost no runtime enforcement, so
it is the rule most in need of evidence before its restatements are trimmed.

`resumes-after-interruption` is the only scenario that crosses a session
boundary. A step marked `freshSession` gets a new host session over the same
project, so no transcript survives into it and the model has nothing but `.flow`
to work from. Its transcript is appended to the earlier one, so assertions still
read a single continuous tool-call spine. Recovery is the largest body of
contract in the repository that a same-session step cannot exercise at all,
because a model that simply remembers what it just did looks indistinguishable
from one that re-derived it.

## Using evals to change prompts

The reason this harness exists is that adding prompt text used to be free while
deleting it broke phrase-pinned tests. The intended loop, which matches both
vendors' published migration guidance, is:

1. Record a baseline: `bun run eval -- --model <m> --repeat 3`. Note the pass
   rate, `promptFootprint.total`, and input tokens from the report.
2. Remove **one group** of instructions — a restated rule, a self-evident
   caveat, an edge case now enforced in the runtime.
3. Re-run the same scenarios and models. Keep the cut if the pass rate holds.
4. When a cut regresses a scenario, prefer moving that rule into the runtime
   (a typed field, a schema constraint, a transition guard) over restoring the
   prose.

Add a scenario whenever a real failure is found in the field. A scenario is the
durable way to encode a lesson; another paragraph of prompt text is not.

## Reading a failed run

Four outcomes short of a pass are reported differently, because they mean
different things:

- `FAIL` — the model ran and the durable outcome was wrong. This is the only
  class that is evidence about the prompts.
- `ENV` — the run never reached a model: the host would not boot, the dependency
  install failed, the network dropped. Excluded from the pass rate and flagged
  separately, so a lost network cannot look like a prompt regression.
- `ASKED` — the model asked the user and stopped, so the step ended there.
  Excluded from the pass rate and flagged separately, because the workflow is
  mid-flight: its durable state is neither the intended outcome nor evidence
  against the prompts. A scenario that sets `mayEscalate` is the exception: there
  the ask is the end the contract leaves, so the run is checked like any other and
  reads `PASS+ASK` or `FAIL+ASK`.
- `ABORT` — a step blew the timeout. The message says whether the session was
  `wedged` (no new message or part, with the incomplete tool calls named) or
  `still working` (producing output up to the deadline, so looping rather than
  stuck). Tokens and tool calls collected before the abort are kept.

Suspending the machine mid-run is credited back rather than charged to the
model: an iteration that takes far longer than its own poll interval is time the
process did not observe, so it extends the deadline and is named in any abort
message.

Nothing answers the harness's questions, so a pending question can never resolve
and the step ends as soon as the session goes quiet holding one. Four recorded
attempts each burned their full twenty minutes in that state before it was
reported apart.

Whether asking was right is the whole question, and it is scenario-specific. Two
scenarios set `mayEscalate` because the contract leaves the model no move of its
own: a gate that cannot pass makes `completed` closure unavailable, and every other
closure needs authority only the user can grant (`skills/flow-run/SKILL.md`). There
asking is the intended end, and their checks hold on it — the blocker may be named
in the question instead of a closing summary, and the invariant is what the model
did *not* do. It counts only when the last step asked; a question during an earlier
step ends the run before the step that probes the invariant ever runs.

Everywhere else an ask is excluded and left to you. Where the prompt already
granted authority to proceed, stopping to ask is closer to a defect than to
caution. The report records every question, so read those and the run's
`finalText` before concluding anything about the prompts.

`failing-gate-blocks` is the scenario to be most careful with: it passes at
roughly even odds, and was measured equally unreliable at 6.8.0, so a single
attempt of it neither condemns nor vindicates a prompt change. Every failure of
it recorded so far is the same one — closed as `completed` over a gate that
cannot pass. Whether that is a dishonest report or a real observation is worth
checking per failure: an exit code a model merely claims is unverifiable, but
`src/platform/opencode/validation-capture.ts` reads one from the host's own bash
metadata whenever the validation was captured, so the durable document in the
report distinguishes the two. Judge prompt changes on the other scenarios and run
this one at higher `--repeat` if you need a real rate from it.

Because a rate is the only useful reading of a stochastic scenario, every run
prints passes per attempt for each scenario and model pair under the aggregate,
marks any split result `FLAKY`, and records the same breakdown as
`summary.passRates` in the report. The aggregate alone hides exactly the
distinction that matters: one pass in six and six in six are different findings.

## Cost

A full pass is five scenarios of real agentic work, one of them two commands
long. Expect a handful of dollars
per model on a flagship model, and use `--scenario` while iterating.

Cost is whatever the provider reports, and a provider that prices nothing reports
zero rather than omitting the field: every OpenAI run measured here reported
`cost: 0` on real token use. A zero total against non-zero output tokens is
therefore read as unknown and printed as `cost not reported by provider` — an
unknown spend is not a free one. Token counts are always real.
