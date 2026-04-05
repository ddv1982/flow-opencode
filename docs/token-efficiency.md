# Token-Efficiency Notes

This section is mainly for maintainers.

It explains how Flow's token-efficiency measurement works and where the snapshot is stored.

## What It Does

The token-efficiency tooling:

- records a current measurement snapshot for the selected project/session
- reports prompt, command, and summary-size measurements
- compares current values against the plugin baseline
- helps decide whether further compaction work is justified

## What It Does Not Do

It does **not**:

- automatically reduce runtime token usage by itself
- change normal `/flow-status` behavior for end users
- enable compact mode by default

## Current Status

- Flow prompt + command surface was reduced from **18192 bytes** to **16297 bytes**
- default `flow_status` / `summarizeSession` behavior is preserved
- compact mode is **not enabled yet**

## Write a Measurement Snapshot

```bash
bun run measure:token-efficiency -- --worktree <your-project>
```

## Where the Snapshot Is Stored

With an active Flow session:

```text
<worktree>/.flow/sessions/<active-session-id>/token-efficiency-measurements.current.json
```

Without an active session:

```text
<worktree>/.flow/token-efficiency-measurements.current.json
```

The file is a **current snapshot**, so it is overwritten on the next run for that same scope.

## Supporting Files

- `analysis/token-efficiency-measurements.ts`
- `analysis/token-efficiency-measurements.baseline.json`
- `tests/token-efficiency-verification.test.ts`

## Guardrails

- the generator fails loudly if the baseline is missing or malformed
- the comparison baseline lives in `analysis/token-efficiency-measurements.baseline.json`
- compact-mode work remains gated until the required evidence exists
