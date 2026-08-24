# Phase 1. Strict report and catalog boundary

[Back to overview](overview.md)

## Goal

Create the versioned attempt ledger, minimal case-policy catalog, campaign
finalization record, and strict structural and semantic validation boundary.

## Changes

- `evals/report.ts`. Add v2 report, campaign, cell, attempt, disposition,
  evidence-payload, completion, provenance, actor, and structured issue types plus
  strict structural parsing.
- `evals/canonical-json.ts`. Add the reusable RFC 8785-compatible canonical JSON
  and domain-separated digest primitive used by frozen plans.
- `evals/validated.ts`. Keep validated boundary values deeply readonly in types
  and recursively frozen at runtime.
- `evals/report-pairing.ts`. Isolate complete-pair shape, retry, activation, and
  scored-target invariants from the general report boundary.
- `evals/catalog.ts`. Add the minimal case identity, evidence class, oracle, sample
  floor, release disposition, and analysis policy needed for semantic validation.
- `tests/eval-report.test.ts`. Cover valid round trips, missing fields, duplicate
  ids, unknown cases against a supplied catalog, inconsistent pairs, numeric
  bounds, cell-to-case-version drift, finalization causes, non-finite counters,
  transcript availability by outcome, and the summary-only exploit.

## Data structures

`EvalReportV2 = CampaignPlan + AttemptRecordV2[] + CampaignCompletion` and
`ParsedReport = valid ValidatedReport | invalid ReportIssue[]`.

## Verification

Static. `bun run typecheck` and `bun test tests/eval-report.test.ts`.

Runtime. Parse legacy reports as unsupported and synthetic v2 reports as valid.
Removing any required row, policy, completion fact, or provenance field must not
yield a validated report. No legacy-to-v2 conversion is allowed.

Stop gate. No qualification or runner changes until this parser fails closed.
