# ADR 0002: TypeScript 7 Toolchain and Inward Layers

Date: 2026-07-17

## Status

Accepted for toolchain, platform, and source-layer decisions. Its earlier Flow
v5 lifecycle and distribution decisions are superseded by
[ADR 0005](0005-flow-v6-session-v5-simplicity-first.md).

## Decision

Flow is an ESM package with these minimums:

- TypeScript 7.0.2;
- Bun 1.3.14 for development, tests, builds, and packaging;
- Node.js 24 or newer;
- the stable OpenCode 1.x plugin API declared in `package.json`;
- Zod 4.4.3 for application and persistence boundaries.

Dependencies are pinned. Source and declaration checking use NodeNext semantics
and explicit `.js` relative imports. OpenCode transport schemas stay in the
platform layer; application persistence schemas use Flow's direct Zod
dependency.

Dependencies point inward: domain → standard library only, with no outer Flow
layers or host APIs; application → domain; infrastructure →
application/domain; platform → inward layers plus guidance and configuration.

## Consequences

- Package smoke verifies the packed ESM entrypoint and declarations.
- Host validator objects never enter public declarations or domain code.
- The OpenCode adapter may duplicate a small wire schema, backed by contract
  tests, so SDK validation internals do not leak inward.
- Flow v6 no longer has the CLI/distribution layer described by the original
  decision.
