# Development

Flow v6 is an ESM TypeScript package built and tested with Git and the versions
pinned in `package.json`.

## Local setup

```bash
bun install --frozen-lockfile
bun run check
```

`bun run check` is the canonical deterministic gate. Use focused commands while
iterating:

```bash
bun run typecheck
bun run lint
bun test tests/domain-transitions.test.ts
bun test tests/runtime-gates.test.ts tests/validation-capture.test.ts
bun test tests/workspace-persistence.test.ts
bun run build
bun run package:smoke
```

The opt-in real-host check launches the pinned `opencode-ai` package through
`bunx`. It therefore requires registry access or an already populated Bun
cache; it does not use a separately installed OpenCode binary:

```bash
bun run smoke:live
```

## Source layout

- `src/domain/` owns Session v5 values, invariants, and transitions that use
  only JavaScript/Node standard-library primitives.
- `src/application/` owns use cases and repository ports.
- `src/infrastructure/` owns filesystem persistence and source fingerprinting.
- `src/platform/opencode/` owns OpenCode hooks, host schemas, commands, tools,
  validation capture, and the duplicate-runtime guard.
- `src/guidance/`, `skills/`, and prompt surfaces own concise workflow judgment.
- `tests/` prove state-machine, persistence, platform, package, and host
  contracts.

Dependencies point inward. Domain code does not import filesystem or host APIs;
application code depends on domain; infrastructure implements application
ports; the OpenCode platform composes the outer layers.

There is no distribution/activation subsystem, cache inventory, repair journal,
or Flow-owned installer. OpenCode installs and loads the npm package from its
native plugin command and normal plugin configuration.

## Change discipline

- Keep Session v5 as one canonical run aggregate. Derive status and progress
  instead of adding parallel ledgers or cached counters.
- Every mutation needs a revision guard and stable operation ID. Exact replay is
  safe; conflicting reuse fails.
- Keep validation host-observed and session-native. Do not add caller-authored
  success, detached receipt stores, or clock requirements.
- Keep one review per run. A final review requires broad validation and is not a
  second pass.
- Prefer deletion when a test or document exists only for a removed concept.
  Do not preserve a dual stack for pre-v6 active state.
- Use table-driven lifecycle and persistence tests. Avoid registries that test
  the presence of other tests.

## Documentation

Update the README, maintainer contract, ADR, and changelog when a public
lifecycle or installation contract changes. Documentation must describe only
the current product; Git history owns superseded plans and experiments.

## Release

Release tags use `v<package-version>`. Blocking release checks include the
normal repository gate, package smoke, packed live OpenCode smoke, package
integrity generation, npm publication, and GitHub release assets. There is no
cross-version active-session gate because v6 is an explicit hard cutover.
