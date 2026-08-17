---
name: verify-flow
description: Verify Flow workflow invariants through cassette replay and deterministic gates
---

# Verify Flow

Maintainer tooling for verifying Flow's durable session invariants without paid model access. Proves the runtime reaches correct outcomes on decisions models already made.

## Launch

Ready when dependencies install and typecheck passes:

```bash
bun install --frozen-lockfile
bun run typecheck
```

Exit 0 from typecheck means the environment is operational. No long-lived servers.

## Doctor

Before driving scenarios, confirm the environment is healthy:

```bash
bun run typecheck && bun run package:smoke && bun run replay
```

All three must pass. This verifies:
- TypeScript compilation
- Packed plugin loads with correct surface (10 tools, 5 commands, 4 guides)
- All committed cassettes replay to their recorded expectations

## Drive

**NEVER** drive against a real project's `.flow/session.json`. This harness creates isolated test workspaces.

Available verification commands:

```bash
# Replay all committed cassettes (no cost, no model, no network)
bun run replay

# Full deterministic gate (typecheck, lint, build, all tests, metadata)
bun run check

# Live smoke test (requires OpenCode host, no credentials needed)
bun run smoke:live

# Paid eval smoke (requires provider credentials, NOT part of check)
bun run eval:smoke -- --model openai/gpt-5.6-sol
```

**Replay is the primary verification tool.** It feeds recorded tool calls through real transition guards and validators with no model involvement. This proves runtime behavior without spending anything.

The five core workflow features are documented in `features/`:
- `plan-only.md` - planning without implementation
- `flow-auto.md` - end-to-end happy path
- `goal-alignment.md` - continuation vs drift detection
- `resume.md` - cross-session recovery
- `failing-gate.md` - blocker handling and honest stops

Each feature maps to one or more committed cassettes in `evals/cassettes/`.

## Evidence

When verifying a feature, capture evidence to `evidence/<feature-id>/run.txt`:

```bash
mkdir -p .cursor/skills/verify-flow/evidence/<feature-id>
bun run replay > .cursor/skills/verify-flow/evidence/<feature-id>/run.txt 2>&1
echo "Exit code: $?" >> .cursor/skills/verify-flow/evidence/<feature-id>/run.txt
```

Include:
- Exact command run
- Exit code
- Match status for relevant cassettes
- Any failure output

Evidence proves verification happened on this branch/VM.

## Cleanup

- Kill only PIDs this verification run started
- **NEVER** `pkill opencode` (may kill user's host)
- **NEVER** `bun run replay -- --accept` unless explicitly asked (rewrites expectations)
- Clean up only test workspaces in `/tmp/flow-*` if needed
- Leave `evals/cassettes/` and `evals/results/` untouched unless rewriting expectations

## Helpers

Use existing repository scripts only:
- `bun run typecheck` - TypeScript compilation
- `bun run lint` - Biome checks
- `bun run build` - Plugin build
- `bun test tests/<file>` - Focused test runs
- `bun run replay` - Cassette replay
- `bun run check` - Full gate

No additional helper scripts, wrappers, or custom harnesses.

## Isolation

Cassette replay runs in complete isolation:
- No model involvement (recorded decisions only)
- No network calls (offline execution)
- No host process (built-in test harness)
- Fresh temporary workspaces per replay
- No mutation of developer's `.flow/` state

Each replay boots an in-process test environment over temporary Git fixtures. The five committed cassettes prove these invariants:

1. **plan-only-stops** - planning saves a plan and starts no run
2. **happy-path** - `/flow-auto` runs all features, closes completed, exactly one review per run, declared gate passes at broad scope
3. **goal-change-refused** - materially different requests don't mutate/replace active sessions
4. **resumes-after-interruption** - fresh session with no transcript resumes from `.flow`
5. **failing-gate-blocks** - gates that can't pass never yield completed closure, blockers are reported

Additional cassettes exist for other scenarios (`skipped-case-refused`, `unprovable-claim-refused`) but the five above cover the core workflow contract.

Paid evaluation (`bun run eval`) is **not** part of verification. It requires provider credentials and costs money. Use it only when explicitly instructed and only for measuring prompt changes against live models.
