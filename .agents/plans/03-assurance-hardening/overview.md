# Assurance hardening

Flow 8.1.2 has a confirmed evidence-admission defect and two release-proof gaps.
The committed canary closed `completed` even though its gate assertion was
recorded `absent`. Release qualification also trusts a caller-provided catalog,
and publication cannot rederive a committed decision from retained inputs.

## Definition of done

- Every plan evidence entry must be satisfied before final review or completed
  closure.
- Test-report evidence must come from one stable, bounded workspace file.
- Evaluator failures must never be classified as provider or host failures.
- Repository code must own release policy.
- Release CI must regrade retained evidence and rederive the decision.
- Canary checks must be derived from exact-artifact evidence.
- Only the current `main` commit may publish, under bounded network operations.
- A fresh release campaign and canary must verify the exact published package.

## Delivery order

1. Enforce gate assertions across admission, projection, and closure.
2. Consolidate request contracts and recover source headroom.
3. Harden validation-report ingestion.
4. Separate evaluator failure origins.
5. Make release policy repository-owned.
6. Derive canary results from executable evidence.
7. Create immutable regradable qualification bundles.
8. Rederive qualification during release.
9. Enforce main-tag provenance and publication deadlines.
10. Run full qualification and publish the corrective release.

Each numbered unit lands independently. A failed or inconclusive unit blocks the
next. No release is allowed before units one through nine are green.

## Verification

Every unit runs focused tests, `bun run check`, `bun run replay`, and the Flow
contribution preflight. Release-sensitive units also run package smoke, the live
OpenCode smoke, workflow lint, and strict metadata verification. The last unit
runs the paid multi-provider matrix and exact-artifact canary.

## Implementation workflow

Use `pstack:how` before changing an unfamiliar subsystem, TDD for each confirmed
defect, `pstack:deslop` before commits, `pstack:interrogate` before each PR,
`pstack:show-me-your-work` throughout, and the Babysit playbook after opening each
PR. Preserve failed and inconclusive evidence.
