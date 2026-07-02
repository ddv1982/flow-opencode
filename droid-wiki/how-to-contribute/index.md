# How to contribute

Contribution work starts with the runtime and skills split: `skills/**` owns workflow judgment, while `src/**` owns durable state, hard gates, skill sync, and OpenCode integration. `docs/maintainer-contract.md` is the main contract to read before changing behavior.

## Work pickup

1. Read the relevant source and the matching skill or test file.
2. Keep changes inside the existing ownership boundary from `docs/architecture/allowed-cross-layer-dependencies.md`.
3. Add or update tests in `tests/` for behavior changes.
4. Run the narrow check during iteration, then run `bun run check` before finishing.

## Definition of done

| Area | Expected evidence |
| --- | --- |
| Runtime behavior | Bun tests in `tests/runtime-gates.test.ts` or `tests/workspace-persistence.test.ts`. |
| Adapter or command surface | Tests in `tests/distribution-and-surface.test.ts`. |
| Package shape | `bun run package:smoke` when exports, CLI, package files, or build outputs change. |
| Host integration | `bun run smoke:live` when OpenCode behavior might drift. |
| Release | Version, changelog, README install pins, tag, and release workflow checks agree. |

## Review expectations

Review should check the changed source, tests, and validation output. If the change touches persistence, review `src/runtime/workspace.ts` and the tests that cover locks, archive, duplicate-key rejection, and quarantine. If the change touches public command behavior, review `src/config-shared.ts`, `src/adapters/opencode/plugin.ts`, and the bundled skill definitions in `src/distribution/flow-skill-definitions.ts`.

Related pages: [Development workflow](development-workflow.md), [Testing](testing.md), and [Patterns and conventions](patterns-and-conventions.md).
