# Guidance distribution

Active contributors: ddv1982

## Purpose

Guidance distribution is a build-time concern. `src/guidance/ids.ts` declares
stable ids, and `src/guidance/catalog.ts` imports Flow Markdown as text,
validates the set, and supplies both
compiled commands and the `flow_guidance` tool. Runtime startup does not copy or
discover guidance files.

## Data flow

```text
skills/**/*.md
  -> src/guidance/catalog.ts
  -> Bun bundle in dist/index.js
  -> compiled public command OR flow_guidance(id)
```

## Legacy cleanup

`src/distribution/legacy-cleanup.ts` is intentionally outside the plugin import
graph. The package CLI invokes it only for
`legacy-cleanup --dry-run|--apply`. Apply moves marker-proven, pristine v4
folders to a recoverable archive outside OpenCode's skill root; it refuses
foreign, edited, extra, malformed, non-directory, and symlinked content.

## Key source files

| File | Purpose |
| --- | --- |
| `src/guidance/ids.ts` | Stable topics and document ids. |
| `src/guidance/catalog.ts` | Embedded text and exact lookup. |
| `src/platform/opencode/tools.ts` | `flow_guidance` registration. |
| `src/prompt-surfaces.ts` | Selected core command compilation. |
| `src/distribution/legacy-cleanup.ts` | Explicit old-folder migration only. |
| `tests/package-smoke.test.ts` | Packed-content proof. |
| `tests/distribution-and-surface.test.ts` | Startup, tool, and link-safety proof. |

Related pages: [Embedded guidance](../features/embedded-guidance.md), [CLI and package](cli-and-package.md), and [Debugging](../how-to-contribute/debugging.md).
