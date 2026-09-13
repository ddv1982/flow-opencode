# Sol and Grok live smoke, 2026-09-13

## Scope

The user authorized running the prepared OpenCode evals with OpenAI Sol and xAI
Grok. The native OpenCode 1.18.6 catalog exposed `openai/gpt-5.6-sol` and
`xai/grok-4.6`, both with `high`. Each model serves as manager and reviewer in a
separate artifact comparison: frozen f10 production guides versus the compact
candidate, with the same runtime and kernel. Two development tasks, one pair per
task, four attempts per model, no reserves. Holdouts remain sealed.

Model IDs and supported high effort were checked against the
[Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and
[Grok 4.6 documentation](https://docs.x.ai/developers/models/grok-4.6).
Requested/native-observed effort does not establish effective provider effort.

Both routes use existing OpenCode subscription logins. Sol advertises zero host
rates, so its manifest explicitly uses unknown dollar cost with token/time bounds:
80,000 generated tokens and 40 minutes for four attempts, plus at most one access
probe bounded at 1,000 generated tokens and two minutes. Grok retains the proposed
$25 study and $1 probe observed stop allowances with unknown-cost stop, alongside
the same token/time bounds. These are observation-based stop thresholds, not
invoice caps. No larger campaign is authorized by this smoke.

## Runner cleanup correction

Sol's access probe succeeded in `study-2026-09-13T13-02-56-221Z.v2`, then macOS
returned EPERM while the runner checked the exiting process group. No task
attempt was dispatched. A later OS probe confirmed the group was absent, and
retained credentials matched the original store. The runner now retries only
EPERM, at 50 ms intervals up to five times. Only ESRCH confirms absence; persistent
EPERM still fails closed. No process-enumeration fallback weakens confirmation.

The task-only Sol manifest reuses the successful separate access receipt without
issuing a second probe. Consequently its standalone decision reports
`variant-availability-unverified`; the separate probe records the requested high
variant as listed. Neither report was modified to conceal this separation.

Validation: 105 eval-reporting tests passed, including transient EPERM recovery,
persistent EPERM rejection, and process-group termination checks. Another 20
study-runner/host-isolation tests passed. Typecheck and focused Biome checks passed.
The first study-regression command used nonexistent test filenames; the corrected
command and successful output are retained separately.

## Sol results

`study-2026-09-13T13-04-46-899Z.v2`: four attempted, three product passes, one host
`command-aborted` failure (unscored), no product failures. Both farewell-export
attempts passed; the baseline markdown-link-report attempt was interrupted after
297.7 seconds, and the candidate attempt passed. Independent retained-evidence
regrading reproduced all three product passes. The three scorable outputs made
explicit completion claims with no assessed false completion.

Task accounting: 227,896 input, 15,053 output, 6,089 reasoning, 1,233,920 cache-read,
and zero reported cache-write tokens; 21,142 generated tokens. Cost is unknown.
The separate access probe adds 6,236 input and five output tokens. Token accounting
completeness and effective service tier remain unverified/unobserved.

The study is stopped/inconclusive with one tied complete pair and one unresolved
pair. This does not establish prompt superiority or regression. The host failure
record does not establish its underlying provider cause.

## Grok results

`study-2026-09-13T13-23-14-044Z.v2`: all four product attempts passed, including
both versions of both tasks. Independent retained-evidence regrading reproduced
all four passes. Both complete pairs tied. The final baseline Markdown workflow
included a superseded implementation run followed by a completed revised run;
internal workflow retries remain included in the attempt totals.

Task accounting: 788,399 input, 29,302 output, 62,958 reasoning, 2,900,352 cache-read,
and zero reported cache-write tokens; 92,260 generated tokens. The final attempt
crossed the 80,000 generated-token observed stop threshold by 12,260. The runner
therefore records `stopped`, cause `budget`, even though all four scheduled
attempts produced passing grades. No replacement or additional task was launched.
This demonstrates that between-attempt thresholds can overshoot during an active
attempt; it is not a hard streaming token cap.

Host-estimated task cost is $3.580534; the access probe adds $0.013864, for
$3.594398 total. The probe adds 5,945 input, one output, 136 reasoning, and 2,304
cache-read tokens. Study wall time was 1,843,904 ms (30.7 minutes). Host rate
estimates are not subscription invoices, and effective service tier and upstream
accounting completeness remain unverified.

## Interpretation

Across both models: eight task attempts, seven independently reproduced product
passes, one unscored host interruption. No product failures were observed. The
compact candidate passed both development tasks on both models; this is smoke
coverage only. Both study decisions remain inconclusive. Sol has an unresolved
pair; Grok crossed the generated-token threshold. Neither result establishes
noninferiority, efficiency, model superiority, or reviewer calibration. F4 is not
qualified, and production guidance is not promoted. Further campaigns need a
new frozen design and explicit bounded scope.

## Local evidence

Manifests, authorization/scope record, dry-run receipts, logs, and regrade outputs
are under `evals/results/sol-grok-smoke-2026-09-13-inputs/`. The original failed Sol
preflight, subsequent Sol study, and Grok study remain separate immutable study
directories. Raw evidence is ignored locally; it is not included in Git. No
production prompt promotion, push, release, or holdout run is implied.
