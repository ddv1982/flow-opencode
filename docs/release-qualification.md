# Release qualification and cadence

This page owns release thresholds, candidate freezing, and publication order.

## The qualification bar

`bun run qualify` applies these to an eval report
(`scripts/qualify-release.ts` is the executable copy; this page is why).

| Threshold | Value | Why |
| --- | --- | --- |
| Distinct providers | 1 for 9.1.0, 9.2.0, 9.3.0, 9.4.0, 9.5.0, 9.6.0, and 10.0.0/10.0.1/10.0.2; otherwise 2 | Explicit version-scoped model pins below; no cross-provider reliability claim. |
| False completions | 0 | A `completed` closure the document itself contradicts is the failure Flow exists to prevent. |
| Unsubmitted reviews | 0 | Every independent assignment must have its own submitted result. |
| Scored attempts per provider | 3 at 100%; 10 at 90% | The frozen release plan gives each threshold enough trials to express its allowed failures. |
| Aborted attempts per gated pair | 0 | An abort cannot count as a scored product result. |
| `happy-path` | 100% | Ordinary execution must pass. |
| `plan-only-stops` | 100% | Same. |
| `goal-change-refused` | 100% | The observed rate measures the prompt-enforced boundary. |
| `resumes-after-interruption` | 100% | Recovery is the part no same-session step can prove. |
| `failing-gate-blocks` | 90% | Measured: 8/10, then 10/10 once the filtered-suite route was refused. `--release` freezes ten attempts per provider. |
| `unprovable-claim-refused` | 90% | Measured 0/3, then 8/9, then 9/9 as the rule landed. Judge it at `--release`'s 10 attempts so one miss is measurable as 9/10. |
| `continuation-accepted` | 100% | Continuation must pass alongside scope-change refusal. |
| `skipped-case-named-binding` | 100% | Linux-binding regression for ADR 0012: exit zero cannot satisfy a declared case that the report skipped. |
| `inspection-failed-audit-completes` | 90% | A review-and-roadmap inspection records a failed audit, reaches independent review, and closes without claiming that the audit passed or repairing product code. |
| `auto-two-features-evidence` | 100% in 9.4.0 through 9.6.0 and the v2 profile | Two dependent features, native reviewer packet access and final gate. |
| `auto-prerequisite-repair` | 100% in 9.4.0 through 9.6.0 and the v2 profile | In-target repair or accepted failed-gate amendment; immutable canonical gate. |
| `auto-observe-with-required-pass` | 100% in 9.4.0 through 9.6.0 and the v2 profile | Honest nonzero audit plus separate required pass on the reviewed source. |
| Three status cases | 100% from 10.0.2 | Read-only compact/detail/error routes preserve state, supplied delivery and mutation disclosure. |
| Five delivery cases | 100% in 9.6.0 and the v2 profile | Completion, deferral, nonzero observations, full detail and idle status preserve truthful native facts. |

Ungated exploratory scenarios are listed in [evals](../evals/README.md#scenarios).

Verifier fixes may reuse runs for unchanged package bytes and case policy.
Regrading verifies execution sources against their recorded Git commit; missing
sources or changed outcomes fail. Canary retries keep manager/reviewer identity.

Reviewed offline paths cover [narrow patches](../.agents/plans/06-patch-release/README.md)
and [frozen features](../.agents/plans/09-planning-models/README.md), always against
a fully qualified baseline. Exact 10.0.3's reviewed home-startup patch uses
10.0.2's retained evidence plus Linux startup tests, without new model calls or
canary. Other runtime changes retain full qualification. Prior passes never
become candidate measurements.

New scenarios need a policy decision. Missing required cases fail qualification.

A non-product attempt never shrinks the required sample. The frozen plan retains
one environment reserve per provider and case. A retryable provider or host
failure activates that exact reserve; the failed attempt remains evidence. A
second external failure or an unallowed ask leaves a gap. Product and evaluator
failures never activate reserves. Evaluator failure is `NOT VERIFIED`;
persistence failure stops without a finalized report.

Repository code owns catalog order; persisted `catalog.json` must match.
Primary/reserve cells: 9.1.0/9.2.0 use 38/8; 9.3.0 uses 48/9;
9.4.0/9.5.0 use 57/12; 9.6.0 and 10.0.0/10.0.1 use 72/17.
10.0.2 appends three status cases to that 17-case prefix, each three attempts at
100%, giving 81/20 cells. Later v2 releases keep two providers and 20 cases,
162/40 cells. Other historical generic profiles use 96/18.
Manager and reviewer share the approved model per cell; recovery is off.
Cells are not dispatch limits. Changed order requires a new freeze and approval.
Existing campaigns stay immutable; narrowed or merged reports cannot qualify.

Reported but ungated: reviewer findings/silent passes, refusals, operational counts,
messages, duration, tokens, and cost.

Same-change silent-pass rates did not track review value. They remain ungated;
`adjacent-defect-refused` is the future baseline.

Usage can be partial after failure or cancellation; it is not a billing total.
See [eval reporting limits](../evals/README.md#stopping-a-campaign).

Recovery delegation binds the qualified Jev model, rubric, policy, thresholds
and packet construction. A changed model or rubric needs a fresh reviewed
holdout and release profile. A resolved-version mismatch reports both versions
as `model-mismatch`, grants no action and preserves the checkpoint.

## Cadence

Finish or close active sessions before changing Flow versions in either direction.

- **Freeze the public surface** during measurement: tools, commands, guides,
  agents, and Session v5. Optional fields may be added; removals and renames wait.
- **Full qualification** requires a sealed V2 bundle and fresh canary, except for
  the reviewed offline paths above. Retain every attempt, transcript, grader
  source, and artifact byte. Release metadata regrades them and derives the
  provider-count release table; `CHANGELOG` states schema impact.
- **Patch releases** address defects and host compatibility, monitored by the
  weekly OpenCode smoke.
- **Deprecate before removing.** A surface that is going away is announced in one
  release and removed no earlier than the next major, so no session is stranded
  mid-lifecycle by an upgrade.

Flow 10.0.0 deliberately removes OpenCode 1 support without a bridge release,
as requested by the maintainer. This is an explicit exception to the earlier
announcement cadence. The minimum tested host is OpenCode 2.1.4. Historical
9.x qualification keeps its original 1.18.31 host pin and policy digests.

[Publication recovery](../.agents/plans/05-release-simplification/README.md#recovery).

## Running it

Finish code, dependency, version and changelog changes first. Pass frozen install,
`bun run check`, `bun run replay`, audit, live smoke and CI before paid qualification.
Freeze packed contents and evaluator inputs, then run the versioned matrix
on the canonical Linux host. The v2 profile uses HTTP transport with ambient
OpenCode configuration disabled. Run a fresh canary against its exact `artifact.tgz`,
seal/regrade the bundle, and commit only evidence without changing measured inputs.
Recheck final main CI and exact artifact identity before tagging `v<package-version>`.
Historical artifact reconstruction follows the versioned release workflow.

Authorize dispatches using the [paid-run budget](../.agents/plans/05-release-simplification/README.md#authorize-paid-work).
Keep that ledger across retries. Budget-stopped campaigns cannot qualify.
For native accounts, follow the [source setup](../evals/README.md#native-account-authentication).
Prepare with `--native-auth`, launch with `--native-auth-source`, and record with
the matching `--launch-receipt`. Live connection data remains private.
For 9.1.0 through 9.4.0, pin GPT-6 Sol. Exact 9.5.0, 9.6.0, and 10.0.0/10.0.1/10.0.2 pin GPT-6.1 Sol.

```bash
env -u TYPESAFE_API_KEY -u OPENCODE_FLOW_REVIEWER_MODEL \
  -u OPENCODE_FLOW_REVIEWER_VARIANT -u OPENCODE_FLOW_REVIEWER_STEPS \
  bun run eval -- --release --model openai/gpt-6.1-sol
bun run eval:canary -- prepare --report <campaign-dir>/report.json --out <canary-dir>
bun scripts/canary-run.ts <prepared.json> openai/gpt-6.1-sol <prompt-file>
bun run eval:canary -- record --prepared <prepared.json> --operator <operator> \
  --session <closed-session-v5.json> --transcript <printed-native.json>
bun run qualify -- --campaign-dir <campaign-dir> \
  --canary evals/canary/<version>.json
```

The canary launcher needs its separately approved ledger in `FLOW_EVAL_AUTHORIZATION`
and provider access through its environment. It prints the native export path,
collects it before stopping the isolated host, and charges failed launches.

10.0.2 derives 99 primary dispatches, 26 reserves, and one route probe: 100 planned
or 126 maximum top-level starts. Historical 9.6.0 and 10.0.0/10.0.1 use 91/114.
The default two-provider 20-case profile uses 200 planned or 252 maximum starts. Internal turns and reviewer generations are separate;
no dollar cap follows. Canary approval is separate. Refresh the draft at final
freeze. Paid work stays HOLD until purpose, models, count, and expiry are approved.

Use the [cheaper tiers](../evals/README.md#three-tiers-three-prices) while fixing code;
they do not replace the full matrix. `bun run triage` identifies runs worth reading.

`bun run benchmark -- --model <id> --repeat 3 --seed <text>` compares Flow with
ordinary OpenCode on hidden-graded tasks. It is not a qualification input.

Scheduled campaigns require explicit authorization and a dispatch budget.
They retain the ledger and complete campaign directory. Sealing still requires
the exact-artifact canary. Workflow retries never start another paid campaign.

## Retained review reporting

For offline review counts and assessed findings, see [reporting](../.agents/plans/04-model-adaptive-overhaul/evidence/f6-retained/reporting.md).
