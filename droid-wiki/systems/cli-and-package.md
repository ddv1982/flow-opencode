# CLI and package

Active contributors: ddv1982

## Purpose

The npm package exposes the OpenCode plugin as the default export and ships a small CLI only for explicit v4 cleanup. The package surface is defined in `package.json`, implemented in `src/index.ts` and `src/cli.ts`, and checked by `tests/package-smoke.test.ts`.

## Directory layout

```text
src/
├── index.ts
├── cli.ts
└── config.ts
package.json
tests/package-smoke.test.ts
```

## Key abstractions

| Abstraction | File | Description |
| --- | --- | --- |
| Default export | `src/index.ts` | Re-exports `src/platform/opencode/plugin.ts`. |
| CLI `main` | `src/cli.ts` | Dispatches `legacy-cleanup --dry-run|--apply`. |
| `exports` | `package.json` | Maps package import to `dist/index.js` and `dist/index.d.ts`. |
| `bin` | `package.json` | Maps `opencode-plugin-flow` to `dist/cli.js`. |
| `files` | `package.json` | Publishes `dist`, `LICENSE`, `README.md`, and `CHANGELOG.md`. |

## How it works

`bun run build` first removes the generated `dist/` tree so deleted declaration
paths cannot leak into a tarball. It then bundles `src/index.ts` to
`dist/index.js`, bundles the CLI with a shebang, and emits declarations from
`tsconfig.types.json`.

## Integration points

`tests/package-smoke.test.ts` builds, packs, extracts, proves guidance text is embedded, runs the packed cleanup dry-run without filesystem writes, and checks consumer TypeScript import behavior. `.github/workflows/release.yml` repeats package smoke before publishing to npm.

## Key source files

| File | Purpose |
| --- | --- |
| `package.json` | Scripts, exports, bin, files, dependencies, and package metadata. |
| `src/index.ts` | Plugin export. |
| `src/cli.ts` | CLI implementation. |
| `tests/package-smoke.test.ts` | Packed package smoke test. |
| `.github/workflows/release.yml` | Release validation and publishing. |

## Entry points for modification

Change `package.json` for public package shape. Change `src/cli.ts` for CLI behavior, and run `bun run package:smoke` for package surface changes.

Related pages: [Deployment](../deployment.md), [Dependencies](../reference/dependencies.md), and [Getting started](../overview/getting-started.md).
