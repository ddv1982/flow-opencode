# ADR 0002: TypeScript 7 and the Flow v5 Hard Cutover

Date: 2026-07-17

## Status

Accepted.

## Context

Flow v4 is host-neutral at runtime, but its state machine, persistence, tool
transport, and distribution concerns are still concentrated in a few large
modules. The package also relies on implicit compatibility between the Zod
version used by Flow and the Zod version embedded in the OpenCode plugin SDK.

TypeScript 7 is now stable and gives Flow a substantially faster native
compiler. OpenCode 1.18.3 remains the stable plugin API; its v2 plugin exports
are beta and do not yet expose every integration used by Flow.

## Decision

Flow v5 is an ESM-only, intentionally breaking rewrite with these minimum
platforms:

- TypeScript 7.0.2 for build and declaration emit.
- Bun 1.3.14 for development, tests, builds, and release packaging.
- Node.js 24 or newer for the published runtime and CLI.
- OpenCode plugin API 1.18.3 or newer within the 1.x stable line.
- Zod 4.4.3 for Flow's domain and persistence boundaries.

Dependencies and toolchain versions are pinned exactly. CI validates Node 24
and 26 and uses the pinned Bun version. A scheduled compatibility job may test
the latest OpenCode release, but release gates use the pinned version.

Source and declaration checking use `module: "NodeNext"` and explicit `.js`
relative specifiers. Bun still bundles the two runtime entrypoints, but its
resolver is not allowed to hide imports that would be invalid in a Node ESM
consumer. Package smoke compiles the packed declarations under strict NodeNext
resolution without `skipLibCheck` and imports the packed plugin with Node.

OpenCode transport schemas are owned by `src/platform/opencode`. They use the
schema implementation exported by `@opencode-ai/plugin`; domain and persisted
data use Flow's direct Zod dependency. The two schema graphs never cross the
platform boundary. Shared valid and invalid contract fixtures prove that both
boundaries accept and reject the same wire payloads.

The v5 source dependency direction is:

1. `domain` — values, invariants, and pure transitions; no host or filesystem.
2. `application` — use cases and ports; depends only on domain.
3. `infrastructure` — filesystem implementations of application ports.
4. `platform/opencode` — OpenCode hooks, transport schemas, and result rendering.
5. `guidance` and prompts — stable ids, embedded Markdown, and compiled command
   surfaces.
6. `distribution` and `cli` — explicit recoverable legacy cleanup, never plugin
   startup behavior.

Flow does not use OpenCode native skill registration or global skill files as a
plugin contribution mechanism. Core guidance is compiled from the package
catalog, and optional guidance is progressively disclosed through the stable
`flow_guidance` tool. Plugin initialization must not read or write the global
skills root. The CLI may only archive marker-proven pristine v4 folders when a
user explicitly invokes `legacy-cleanup --apply`; dry-run makes no writes and
the migration never deletes.

Flow also does not project active session state into `config.instructions`.
The config hook registers commands and agents without workspace filesystem I/O;
canonical commands load the sole active representation, `.flow/session.json`,
through `flow_status` at the point of action.

The v5 persisted session format is version 3. Flow will not read or migrate
older active sessions. If an older session is encountered it is preserved and
reported as unsupported; it is never silently overwritten or deleted.

Public use-case results are discriminated unions rather than open-ended
`Record<string, unknown>` values. IDs are branded at the domain boundary,
transitions are exhaustive and immutable, and time and ID creation are
injected rather than read by domain code. Every completion outcome has an
explicit `kind`; defaulted union discriminators are forbidden at transport
boundaries. Caller-owned collections are copied before they enter session
state.

## Non-goals

- Supporting Flow v4 source APIs or session files.
- Targeting OpenCode's beta v2 plugin API before its migration contract is
  complete.
- Reintroducing startup skill synchronization, setup-health state, or a second
  instruction or active-state source outside the installed package.
- Using TypeScript's unstable programmatic compiler API.
- Enabling `isolatedDeclarations`; Flow publishes a single plugin entrypoint and
  the annotation cost currently exceeds its value.
- Disabling `skipLibCheck` while Bun's ambient declarations conflict internally.

## Cutover gates

The v5 release requires:

- typecheck, lint, declaration emit, unit tests, package smoke, and live OpenCode
  smoke to pass on the pinned toolchain;
- contract tests across the OpenCode and core schema boundary;
- Node 24 and Node 26 package-consumer tests;
- no imports that violate the documented dependency direction;
- no compatibility readers, adapters, aliases, or deprecated v4 entrypoints.

## Consequences

- Existing `.flow/session.json` files must be closed with v4 or archived by the
  user before starting a v5 session.
- Consumers must upgrade their Node and OpenCode installations with Flow v5.
- The OpenCode adapter duplicates a deliberately small wire-schema description;
  contract fixtures prevent that description from drifting from core parsing.
- Flow can upgrade its core validation independently of the host SDK's internal
  validator version.
