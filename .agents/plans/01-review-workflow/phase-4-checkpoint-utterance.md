# Phase 4. Checkpoint paste

Back-link. [Overview](overview.md).

## Goal

When Flow hands control back, the manager pastes the compact digest. This
is a typed field, not a marker in prose.

## Changes

- `skills/flow-run/SKILL.md` **Blocked review**. After the one detail read
  for routing, print compact `findingsDigest` as the user-facing list, then
  checkpoint or reset as today.
- `src/guidance/catalog.ts` `FLOW_MANAGER_KERNEL`. One short line. On
  `await-user-direction` or when the lease will stop, report
  `findingsDigest` from compact status. Do not invent ids.
- `skills/flow/SKILL.md` Recovery. Same paste rule for checkpoints, not
  only for `delivery.report`.
- `tests/prompt-quality.test.ts`. Lock that `/flow-auto` and `/flow-run`
  name `findingsDigest`. Do not reintroduce bracket markers.

Stay inside the prompt byte ceiling. Pay for the kernel line by cutting a
sentence that restates retry policy already on `nextAction`.

Use Cursor `create-skill` for the SKILL.md edits.

## Data structures

None. The compact field from phase 2 is the payload.

## Verification

**Static.** `bun test tests/prompt-quality.test.ts`. Prompt byte ceiling.
`bun run check` if skills changed.

**Runtime.** No control-cli for OpenCode chat in this repo. Replay
`adjacent-defect-refused` still fails a silent pass. Read the compiled
`flow-run` and `flow-auto` surfaces and confirm they name `findingsDigest`
and still omit routing markers.
