# Isolated recovery treatment

The evaluation needs to exercise delegated recovery before a release profile is
qualified. Production delegation remains disabled. The experiment must use the
same commands, message ancestry, tools, and recovery guards as the shipped plugin.

## Design decision

Use one internal plugin composition and a separate evaluation entrypoint. Each
plugin instance constructs its own recovery controller. The production entry uses
the empty release registry. The evaluation entry supplies a fixed experimental
profile and reports experimental provenance.

| Candidate | Decision | Reason |
| --- | --- | --- |
| Shared composition with an evaluation entrypoint | Selected | Reuses the actual host hooks and guarded mutations. |
| Parent-process recovery controller with remote tools | Rejected | Duplicates manager ancestry and auto-drive lifecycle. |
| Production configuration option for experimental profiles | Rejected | Adds an activation path to the production plugin. |
| Copied evaluation implementation of Flow hooks | Rejected | Allows the experiment to diverge from the released behavior. |

Two design delegates and an independent judge agreed on shared composition.
Their models were inherited. Model diversity was not verified. The synthesis adds
a simulation-only configuration, a controller factory per instance, and matching
composition and command dispatch for both evaluation arms.

The Model the Domain principle led to explicit arm and provenance types. Separate
Before Serializing Shared State led to separate design artifacts and one code
owner. Prove It Works requires a persisted guarded mutation in a real host.

## Verification boundary

The first full treatment check uses OpenCode 1.18.31 with scripted xAI responses.
The script follows the Responses route used by the pinned host. Its
[dependency manifest](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/package.json)
pins `@ai-sdk/xai` to `3.0.102`. The SDK package provides the stream event schema
used to check the fixture format.
The manager must obtain the actual Flow revision and random recovery grant from
tool results. The real Jev adapter must send its request through the shared budget
gate before a simulated response is returned.

The successful case must persist the exact authorized mutation. A matching control
must make zero Jev requests. A below-threshold response must consume its reservation
without permitting the mutation. The simulated transport must never forward an
inference request to a real provider.

After the xAI checks passed, the same simulation was extended to the selected
OpenAI manager. Each provider uses its actual OAuth Responses route. Each manager
requires its own accepted, control, and below-threshold check. Request-budget
checks alone do not establish recovery-treatment behavior.

Simulation does not establish model quality, pricing, or live qualification. The
episode runner retains its live refusal. Operator resume, reviewed cost bounds,
package-cache and executable identity, and funded qualification remain separate
work.
