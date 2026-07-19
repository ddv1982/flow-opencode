# Source Ownership

Flow v5 uses inward-only dependencies:

```mermaid
flowchart LR
    Platform[platform/opencode] --> Infrastructure[infrastructure]
    Platform --> Application[application]
    Infrastructure --> Application[application]
    Infrastructure --> Domain[domain]
    Application --> Domain[domain]
    Platform --> Domain
    Platform --> Guidance[guidance]
    Platform --> Config[config-shared]
    Platform --> Harness[application/harness]
    Config --> Prompts[prompt modules]
    Prompts --> Guidance
    Distribution[distribution activation and legacy cleanup] --> Guidance
    CLI[cli] --> Distribution
```

- `src/domain/**` owns values, invariants, state, and pure transitions. It may
  not import application, infrastructure, platform, distribution, or host APIs.
- `src/application/**` owns use cases and ports. It may import domain only.
- `src/infrastructure/**` implements application ports for local filesystems and
  process services. It may import application and domain.
- `src/platform/opencode/**` is the outer composition and transport layer. It
  may import the inward layers, config, and embedded guidance. It owns
  process-global runtime leadership, bounded host observation, optional-worker
  admission coordination, Bash receipt capture, and private host schemas. Host
  schema objects stay private in this layer and never appear in emitted public
  types.
- `src/guidance/**` owns stable ids and Markdown embedded into the package.
- `src/application/harness/**` owns the provider-neutral sanitized resource and
  quality oracle. It consumes bounded projections rather than host SDK values.
- `src/distribution/**` owns explicit single-version activation inventory and
  convergence plus recoverable legacy cleanup. It is not imported by plugin
  startup and does not import workflow behavior.
- `src/prompt-*.ts` compiles host-neutral prompt fragments and evaluation
  contracts from bundled guidance definitions.
- `src/cli.ts` is a thin outer adapter over distribution APIs.
- `src/index.ts` is the ESM package entrypoint.

The removed `src/runtime/**` and `src/adapters/**` trees have no compatibility
entrypoints. `tests/architecture-boundaries.test.ts` enforces both their absence
and the inward dependency rules above.
