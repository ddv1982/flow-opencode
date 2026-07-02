# Security

Flow's security boundary is local and host-facing: it writes workspace state, injects OpenCode commands and hidden workers, and copies managed skills into the user's OpenCode skills directory. The runtime avoids remote services and does not handle application user auth.

## Trust boundaries

| Boundary | Guard |
| --- | --- |
| Workspace path | `assertMutableWorkspaceRoot` in `src/runtime/workspace.ts` rejects filesystem root and `$HOME`. |
| Session file input | `parseStrictJsonObject` in `src/runtime/json/strict-object.ts` rejects malformed JSON and duplicate keys. |
| State writes | `withSessionLock` and atomic writes in `src/runtime/workspace.ts`. |
| Managed skills | Marker hashes and foreign-folder skips in `src/distribution/sync.ts`. |
| Hidden workers | Permission maps in `FLOW_CORE_AGENTS` in `src/config-shared.ts`. |
| Public commands | Command preflight in `src/adapters/opencode/plugin.ts` replaces stale command bodies. |

## Filesystem safety

`src/runtime/workspace.ts` keeps runtime state under `.flow/`, writes `.flow/.gitignore`, and archives sessions under `.flow/history/`. It quarantines unreadable sessions instead of deleting them silently. `isAbsoluteOrTraversal` rejects unsafe artifact-like paths where that helper is used.

## Prompt and worker safety

Hidden workers in `src/config-shared.ts` deny Flow state-changing tools. Most also deny edits, shell commands, native skill loading, and nested tasks. The manager remains the only actor that should call `flow_plan_approve`, `flow_feature_complete`, or `flow_session_close`.

## Dependency and release safety

`docs/maintainer-contract.md` documents why `zod` is exact-pinned and why `@opencode-ai/plugin` is a peer range with a pinned tested dev dependency. `.github/workflows/release.yml` uses npm trusted publishing through GitHub Actions OIDC and explicitly avoids normal `NPM_TOKEN` publishing.

## Key source files

| File | Purpose |
| --- | --- |
| `src/runtime/workspace.ts` | Filesystem root checks, lock, archive, quarantine, generated `.gitignore`. |
| `src/runtime/json/strict-object.ts` | Strict JSON parsing. |
| `src/config-shared.ts` | Hidden worker permission maps. |
| `src/distribution/sync.ts` | Managed skill marker and backup behavior. |
| `.github/workflows/release.yml` | Trusted publishing release path. |

Related pages: [Workspace persistence](systems/workspace-persistence.md), [Parallel orchestration](features/parallel-orchestration.md), and [Deployment](deployment.md).
