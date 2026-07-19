# Security

Flow's security boundary is local and host-facing: it writes workspace state and injects OpenCode commands, tools, and hidden workers. Guidance is embedded in the package; plugin startup never touches the user's OpenCode skills directory. The runtime avoids remote services and does not handle application user auth.

## Trust boundaries

| Boundary | Guard |
| --- | --- |
| Workspace path | `assertMutableWorkspaceRoot` canonicalizes aliases and rejects filesystem root and `$HOME`, including aliases to them. |
| Managed `.flow` paths | Directory/file guards reject symbolic links before reads, locks, archives, or ignore-file writes. |
| Session file input | `parseStrictJsonObject` in `src/infrastructure/fs/strict-json-object.ts` rejects malformed JSON and duplicate keys. |
| State writes | `withSessionLock` and atomic writes in `src/infrastructure/fs/workspace.ts`. |
| Tool response prose | Plugin-authored metadata stays top-level; repository and caller prose stays under `workflowData`. |
| Session archives | Exact ids map to lowercase SHA-256 filenames; pinned-cwd helpers publish through relative temp+hard-link operations and delete active state only after inode, topology, spelling, and content revalidation. |
| Embedded guidance | Stable enum ids and package smoke prove the loaded text matches the installed plugin. |
| Legacy cleanup | Nofollow reads, exact marker hashes, extra-entry refusal, and recoverable moves in `src/distribution/legacy-cleanup.ts`. |
| Hidden workers | Permission maps in `FLOW_CORE_AGENTS` in `src/config-shared.ts`. |
| Public commands | Command preflight in `src/platform/opencode/plugin.ts` replaces stale command bodies. |

## Filesystem safety

`src/infrastructure/fs/workspace.ts` keeps runtime state under `.flow/`, writes
`.flow/.gitignore`, and archives sessions under `.flow/history/`. Workspace
roots use their canonical real path, managed directories and files refuse
symbolic links, and POSIX reads add `O_NOFOLLOW`. The config hook does not read
workspace state or register a Flow instruction path. Flow rejects unreadable or
incoherent session input rather than guessing repairs. Only a valid Session v4
document can become active state, and only an explicitly closed valid Session
v4 document can become canonical history. Archive and quarantine publication
use helpers pinned to validated directory identities so a swapped intermediate
symlink is not used as the destination; active deletion uses a separately pinned
`.flow` helper. Artifact paths are informational data and are not consumed as
filesystem targets.

## Prompt and worker safety

Hidden workers in `src/config-shared.ts` deny Flow state-changing tools. Most also deny edits, shell commands, native skill loading, and nested tasks. The manager remains the only actor that should call `flow_plan_approve`, `flow_feature_complete`, or `flow_session_close`.

## Dependency and release safety

`docs/maintainer-contract.md` documents why `zod` is exact-pinned and why `@opencode-ai/plugin` is a peer range with a pinned tested dev dependency. `.github/workflows/release.yml` uses npm trusted publishing through GitHub Actions OIDC and explicitly avoids normal `NPM_TOKEN` publishing.

## Key source files

| File | Purpose |
| --- | --- |
| `src/infrastructure/fs/workspace.ts` | Filesystem root checks, lock, archive publication, strict input, generated `.gitignore`. |
| `src/infrastructure/fs/strict-json-object.ts` | Strict JSON parsing. |
| `src/config-shared.ts` | Hidden worker permission maps. |
| `src/guidance/catalog.ts` | Stable embedded guidance ids. |
| `src/distribution/legacy-cleanup.ts` | Explicit conservative migration of old global folders. |
| `.github/workflows/release.yml` | Trusted publishing release path. |

Related pages: [Workspace persistence](systems/workspace-persistence.md), [Parallel orchestration](features/parallel-orchestration.md), and [Deployment](deployment.md).
