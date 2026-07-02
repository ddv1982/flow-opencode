# Debugging

Debugging Flow usually starts with `flow_status`, then moves to `.flow/session.json`, skill setup health, or OpenCode adapter output depending on the symptom. `docs/troubleshooting.md` covers the user-facing install and recovery cases.

## Session problems

| Symptom | Where to inspect |
| --- | --- |
| No active Flow state | `flow_status` output from `src/runtime/api.ts`. |
| Lock timeout | `.flow/session.lock/owner.json`, created by `src/runtime/workspace.ts`. |
| Malformed session file | Quarantine behavior in `src/runtime/api.ts` and `src/runtime/workspace.ts`. |
| Generated instructions stale | `.flow/opencode-instructions.md`, refreshed by `refreshFlowInstructionFile` in `src/runtime/workspace.ts`. |

`src/runtime/workspace.ts` refuses filesystem root and `$HOME` as mutable workspace roots. It writes sessions atomically, uses a directory lock, and treats unreadable sessions as recoverable errors rather than silently deleting them.

## Skill setup problems

Run:

```bash
npx -y opencode-plugin-flow@4.2.0 doctor
```

The doctor logic in `src/distribution/sync.ts` reports missing, foreign, incomplete, edited, and outdated managed skill folders. Foreign or edited folders need a user decision, while missing or outdated Flow-owned folders can be repaired by sync and restart.

## Command preflight problems

Flow commands are not only static skill files. `src/adapters/opencode/plugin.ts` replaces Flow command parts during `command.execute.before` so `/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` can continue with bundled current instructions even when native skill discovery is stale.

## Live smoke debugging

`tests/live-opencode-smoke.test.ts` packs the plugin, installs it into a temporary OpenCode project, starts `opencode serve`, and checks command and agent registration over HTTP. Use it when a mocked test passes but real OpenCode startup or registration is suspect.

Related pages: [Workspace persistence](../systems/workspace-persistence.md), [Managed skills](../features/managed-skills.md), and [CLI and package](../systems/cli-and-package.md).
