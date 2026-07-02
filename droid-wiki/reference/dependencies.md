# Dependencies

Flow has one runtime dependency, one peer dependency, and a small TypeScript/Bun development toolchain. Dependency policy is documented in `docs/maintainer-contract.md`.

## Runtime and peer dependencies

| Dependency | Version | Why it exists |
| --- | --- | --- |
| `zod` | `4.1.8` | Runtime schemas in `src/runtime/schema.ts` and tool input schemas in `src/runtime/api.ts`. |
| `@opencode-ai/plugin` | peer `>=1.17.3 <2` | Host plugin API used by `src/adapters/opencode/sdk.ts`. |

`zod` is exact-pinned because schema objects cross the plugin/host boundary. `@opencode-ai/plugin` is a peer range for user install flexibility, while the dev dependency stays pinned for CI.

## Development dependencies

| Dependency | Version | Used by |
| --- | --- | --- |
| `@biomejs/biome` | `^2.2.6` | `bun run lint`. |
| `@opencode-ai/plugin` | `1.17.3` | Adapter tests and local build. |
| `bun-types` | `latest` | Bun TypeScript types. |
| `typescript` | `^6.0.2` | `bun run typecheck` and declaration output. |

## Automated updates

`.github/dependabot.yml` checks GitHub Actions and npm weekly. It intentionally ignores `zod` and `@opencode-ai/plugin` so those bumps are tested and reviewed manually.

## Key source files

| File | Purpose |
| --- | --- |
| `package.json` | Dependency declarations. |
| `.github/dependabot.yml` | Update policy. |
| `docs/maintainer-contract.md` | Dependency rationale. |
| `src/adapters/opencode/sdk.ts` | Re-exported OpenCode plugin SDK types and helpers. |

Related pages: [Security](../security.md), [Deployment](../deployment.md), and [Schema and JSON](../systems/schema-and-json.md).
