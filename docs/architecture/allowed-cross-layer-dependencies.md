# Source Ownership

Flow v4 keeps the dependency map simple:

- `src/runtime/**` is host-neutral and must not import adapters or distribution.
- `src/distribution/**` syncs bundled skills and must not import runtime behavior.
- `src/adapters/**` binds OpenCode to runtime and distribution.
- `src/config-shared.ts` contains host-neutral config constants.
- `src/index.ts`, `src/config.ts`, and `src/cli.ts` are entrypoints.

There is no seam checker in v4. Keep this map small enough that import review is obvious.
