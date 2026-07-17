# Dependencies

Flow has one runtime dependency, one peer dependency, and a small TypeScript/Bun development toolchain. Dependency policy is documented in `docs/maintainer-contract.md`.

## Runtime and peer dependencies

| Dependency | Version | Why it exists |
| --- | --- | --- |
| `zod` | `4.4.3` | Core domain, tool-use-case, and persistence validation. |
| `@opencode-ai/plugin` | peer `>=1.18.3 <2` | Stable host plugin API and host-owned tool schemas. |

Zod schema objects do not cross the plugin/host boundary. Host transport uses `tool.schema`; core validation uses Flow's exact-pinned Zod. Shared contract fixtures keep the two wire contracts aligned. `@opencode-ai/plugin` is a peer range for user install flexibility, while the dev dependency stays pinned for CI.

## Development dependencies

| Dependency | Version | Used by |
| --- | --- | --- |
| `@biomejs/biome` | `2.5.4` | `bun run lint`. |
| `@opencode-ai/plugin` | `1.18.3` | Adapter tests and the pinned live-host build. |
| `@types/bun` | `1.3.14` | Bun TypeScript globals. |
| `@types/node` | `24.13.3` | Node 24 runtime surface. |
| `typescript` | `7.0.2` | Native typecheck and declaration output. |

The registry's newest Node declarations are on the Node 26 line, but Flow pins
the latest Node 24 declarations deliberately: `engines.node` promises Node 24
support, and compiling against Node 26-only APIs would make that promise
unreliable. A matching package override prevents `bun-types` from resolving its
wildcard Node dependency to another major. CI executes the packed consumer on
Node 24 and 26.

## Automated updates

`.github/dependabot.yml` checks GitHub Actions and npm weekly. It intentionally ignores `zod` and `@opencode-ai/plugin` so those bumps are tested and reviewed manually.

## Key source files

| File | Purpose |
| --- | --- |
| `package.json` | Dependency declarations. |
| `.github/dependabot.yml` | Update policy. |
| `docs/maintainer-contract.md` | Dependency rationale. |
| `src/platform/opencode/tools.ts` | Private host-owned OpenCode transport schemas and tools. |
| `src/platform/opencode/sdk.ts` | Re-exported OpenCode plugin API types and helpers. |

Related pages: [Security](../security.md), [Deployment](../deployment.md), and [Schema and JSON](../systems/schema-and-json.md).
