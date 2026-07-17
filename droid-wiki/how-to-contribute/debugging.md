# Debugging

Debugging Flow usually starts with `flow_status`, then moves to `.flow/session.json`, `flow_guidance`, or OpenCode adapter output depending on the symptom. `docs/troubleshooting.md` covers the user-facing install and recovery cases.

## Session problems

| Symptom | Where to inspect |
| --- | --- |
| No active Flow state | `flow_status` output from the filesystem composition and application service. |
| Lock timeout | `.flow/session.lock/owner.json`, created by `src/infrastructure/fs/workspace.ts`. |
| Malformed session file | Quarantine behavior in `src/application/flow-service.ts` and `src/infrastructure/fs/workspace.ts`. |

`src/infrastructure/fs/workspace.ts` refuses filesystem root and `$HOME` as mutable workspace roots. It writes sessions atomically, uses a directory lock, and treats unreadable sessions as recoverable errors rather than silently deleting them.

## Guidance problems

Confirm that the embedded tool is registered and request a known id:

```bash
flow_guidance { "id": "flow-test" }
```

If the tool is missing, check plugin loading. If one id is rejected, verify the installed package version and `src/guidance/catalog.ts`. Do not repair guidance by copying files into OpenCode's global skill root.

## Command preflight problems

`src/platform/opencode/plugin.ts` replaces Flow command parts during `command.execute.before` so `/flow-auto`, `/flow-plan`, `/flow-run`, and `/flow-review` always use the current package's compiled instructions.

## Live smoke debugging

`tests/live-opencode-smoke.test.ts` packs the plugin, installs it into a temporary OpenCode project, starts `opencode serve`, and checks command and agent registration over HTTP. Use it when a mocked test passes but real OpenCode startup or registration is suspect.

Related pages: [Workspace persistence](../systems/workspace-persistence.md), [Embedded guidance](../features/embedded-guidance.md), and [CLI and package](../systems/cli-and-package.md).
