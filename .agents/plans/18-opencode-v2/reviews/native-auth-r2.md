# Native auth round 2

ISSUES. One P3 remains in the disposal error boundary. All three original R1 findings are closed on the reviewed source. No release approval.

This is a fresh independent source review by Codex gpt-6.1-sol with high reasoning effort. Priority was requested by the parent and was not independently reconfigured or measured here. No delegates ran.

throughput checkpoint: n/a, read-only investigation

## P3. Local disposal errors bypass the generic authentication error boundary

The affected statements are [host.ts:215](/Users/vriesd/projects/flow-opencode/evals/native-auth/host.ts:215) and [broker.ts:172](/Users/vriesd/projects/flow-opencode/evals/native-auth/broker.ts:172). Both finalizers await raw filesystem removal without an outer error normalization boundary. A removal failure replaces an earlier generic release or identity error. It exposes the private attachment or broker directory in the returned error.

The causal reproduction is [failure-probes.ts](failure-probes.ts). It calls the actual current helpers, uses its own loopback relay and fake CLI, and writes only this review directory. No native executable runs.

For the host case, the relay returns HTTP 503 during release. A synthetic child directory inside the owned attachment contains a file and has mode 000. Disposal rejects with this literal result on Bun 1.4.0:

```text
ENOTEMPTY: directory not empty, rm '/tmp/flow-v2-native-auth-review-r2/failure-probes/attachment'
```

The stable `Native account authentication failed.` release error is replaced. A second disposal returns the same error message. The attachment remains because removal failed. The external presealed client still verifies. The reviewer restores permissions and removes the fixture afterward.

The broker variant creates the same inaccessible child under its owned directory. Identity, close, and DELETE succeed through a fake CLI. Its final removal also returns raw `ENOTEMPTY` containing the broker path. This variant establishes the broker error leak independently of any injected server failure.

A separate fault injection makes the relay stop its real local server and then reject with `relay-stop-private-sentinel`. Broker disposal returns that exact text, removes its owned directory, and makes no subsequent close or DELETE call. Duplicate disposal returns the same promise. This proves the current propagation and sequencing if stop rejects. It does not establish that Bun naturally produces such an error. No separate native remote-unload defect is filed from that injection.

The observed leak is a private scratch path and arbitrary injected teardown text. No source OAuth refresh, access token, capability, metadata, or user account value leaked in this reproduction. The operator CLI and auth canary have additional generic top-level error handling. Public canary leakage from this path was not observed.

Minimal fix. Normalize failed completion at the public host and broker disposal boundaries with `refuse()`, without attaching the raw error as a public cause. Preserve independent local cleanup, pinned remote operations, and memoized completion. A filesystem that refuses removal can still require retained scratch and manual cleanup. That failure should remain generic. Add regressions for local removal failure as well as remote release failure.

Evidence is [failure-results.json](failure-results.json) and [failure-probes.log](failure-probes.log). This finding does not reopen the corrected R1 cleanup ordering.

## R1 findings and withdrawn objections

The full R1 report, decision trail, original repro and results were read. The fix handoff, freeze, complete change patch, adaptation patch, after results, and native receipt were read. Original evidence was left unchanged.

The original reproduction was copied into [repro.ts](repro.ts). It uses the owner's recorded adaptation to catch the earlier method-conflict refusal. Only its output destination changed from the owner's adapted version.

The independently executed [results](repro-results.json) show:

- A live pinned PID with failed CLI identity lookup returns the generic error, removes its owned broker directory, and sends no close or DELETE.
- A dead fixture PID with failed lookup removes the directory and resolves disposal without unpinned RPC.
- A matching identity with failed DELETE retains the generic error and removes its directory. Close and DELETE were attempted.
- Replacing the host configuration file with a directory no longer blocks attachment removal. Disposal succeeds.
- Conflicting integration and method ownership rejects during registration. There are zero method registrations and zero relay requests.

The dedicated broker regressions also pass for a reported replacement PID and replacement after close. DELETE is not sent after replacement. Repeated disposal shares completion. The host regressions pass with release failure, a configuration directory, and both together. They compare all external presealed bytes before and after cleanup.

The same-account alias regression passes. One OAuth registration handles two provider aliases for the same credential. A successful resolve retains the placeholder refresh. Different credentials on the same integration and method reject before any transform.

The source single-flight objection remains withdrawn. The original stress repro again reports `maxResolveDepth: 1`, across 26 resolve entries and 24 overlapping active lookups. Entry count is not concurrent refresh depth. The aborted-hook objection remains withdrawn on the retained native trigger and Effect evidence. No new causal evidence justifies reviving it.

## Source ownership, lease isolation, and execution path

The five auth modules were read in full. The auth config reader, operator command, relevant harness startup and stop paths, campaign wiring, canary preparation, launcher, recording, offline derivation, and qualification join were traced.

The original refresh stays inside native connection resolution in the source service. The source plugin pins the provider, integration, active credential, method, label, and metadata, serializes resolver calls by credential ID, checks active identity after resolution, substitutes the placeholder before returning, and refuses original refresh duplicated in access or metadata. It has no native credential-store CRUD, model generation, or user-global-config write call. Child credential creation occurs only in the isolated eval or canary host.

The child overrides only selected OAuth method registrations. Its refresh callback calls the private relay and preserves the placeholder. HTTP and WebSocket guards check the active child credential and source selection before allowing the existing native request to continue. The exercised request-identity test retains the same input and `Request`, including its header. These helpers do not create a replacement model request, transport, prompt, assistant result, usage count, or success status. Unsupported account layouts may still reject honestly.

[lease-proof.ts](lease-proof.ts) independently exercises the actual broker through a synthetic CLI. Wrong capability returns 401. Overlapping acquisition returns 409. A resolution begun under an old lease returns generic 503 after release and replacement. A stale release returns 503, and the new lease still passes `check` with 200. [lease-results.json](lease-results.json) records those literal outcomes. This is one broker's cross-invocation lease isolation. No global exclusion across separately started brokers or real built-in OAuth refresh implementations is claimed.

Native identity pinning remains a before-and-after check over default CLI discovery, URL, PID, and version 2.1.4. It is not an atomic service handle. Replacement between checks can receive an attempted command before a later mismatch rejects its result. Native CLI recovery and replacement after the last check remain bounds. The regression demonstrates refusal of a detected replacement, not elimination of every process race.

Harness auth mode stages beneath private scratch, rejects disabled credentials, manual handoff, and simulation conflicts, and strips inherited `OPENCODE_*` selectors. Its private HOME global config contains the auth plugin with warming off, update disabled, and sharing disabled. The project config remains the ordinary Flow config. Readiness session creation and removal, config readback, and expected local plugin checks precede placeholder seeding. The native SDK's plugin status union is active or failed, so accepting a non-failed listed plugin does not admit a third loading state under that API.

`run.ts` enables the path only through explicit `FLOW_EVAL_NATIVE_AUTH` and requires concurrency one. Preflight and scenario hosts receive the same selection. Shutdown attempts auth disposal independently of credential-list and callback failure. Failed termination also attempts auth disposal and does not invoke project retention on an unquiescent host. These are source observations and the six executed shutdown tests, not a new actual EvalHost boot proof.

The operator command requires existing paid authorization and approved models before broker startup. It exclusively opens the output with no-follow and private modes. The executed tests preserve an existing file and a replacement inode, clean new owned output after startup or disposal failure, and avoid source startup on missing authorization or a rejected model. Its lstat-to-removal window against a same-user writer remains a bound. No new proof of atomic conditional unlink is claimed.

## Exact client and canary bindings

[artifact-proof.ts](artifact-proof.ts) reads only public static client files from the retained owner artifact. It stages the current client in this review directory and verifies both artifacts against current production source. Their four file hashes match exactly.

The current aggregate is:

```text
sha256:e8e4bed74dd1266ac3e1c4cd149918b8ffa35391afac0b098f95eb2930333c1b
```

The prior aggregate was `sha256:8e3c149d61b2f4998787e4729ea5207504d566684aea6b0fb0f7f4595ec31e4c`. Active verification refuses that older add-on. This requires auth add-on resealing. It does not require rebuilding or altering the separate product archive. [artifact-results.json](artifact-results.json) retains the exact per-file hashes.

The aggregate uses the shared `nativeAuthSourceSha256` canonical domain hash. Reversed keys and canonical installation round-trip retain the same hash. Exact four-file verification rejects extra paths, mutated bytes, symlinks, and hardlinks. The source plugin uses a separate hash domain. No executable extras enter the client seal.

Canary attachment mode and the private source-file argument must agree. Static descriptor, file, and preparation checks happen before the single dispatch charge. Live source attachment happens afterward. Failed acquisition or setup remains charged once. Native collection precedes termination. Cleanup finalizers are independent. Tests cover generic errors and removal of private data after source, dependency, version, startup, and release failure.

The public auth receipt binds the prepared digest, exact static client descriptor, selected model, host PID and version, public HTTP provider-policy digest, root native session, outcome, and native transcript digest. Strict parsing rejects unknown private fields. The executed tamper tests reject changed host, model, policy, native digest, and source descriptor. Recording requires a matching receipt. The private runtime config, its hash, capabilities, source URL, metadata, and credentials are not added to this public descriptor.

The installation embeds exact public source bytes. `deriveCanaryResult` includes the parsed installation in `flow-canary-host-config-v2`. Qualification sealing reads installation, session, and transcript by recorded byte lengths and digests. `qualification-regrade.ts` checks those same bundle roles, re-derives the canary, and compares status, checks, actors, and host-config digest. That qualification connection was source-reviewed. No new bundle was prepared or qualified, and no concurrent grader closure was hashed by this reviewer.

The receipt is a consistency binding over retained evidence, not a cryptographic attestation that defeats an operator fabricating all evidence and hashes together. It does not replace actual provider qualification.

Six retained 9.x canaries independently regrade at a 2030 clock with retained freshness. Their installation records have no `nativeAuth` field. The no-auth mode test also proves no default field is inserted. No historical evidence was rewritten.

## Executed checks and source identity

Bun was `/tmp/flow-v2-toolchain/node_modules/.bin/bun`, version 1.4.0. [commands.json](commands.json) records argv and outcomes. [run-checks.py](run-checks.py) reruns the bounded checks. It clears inherited Flow and OpenCode selectors, assigns a scratch HOME and TMPDIR, and preloads a fetch guard that permits only HTTP loopback. Native tests are not enabled.

The six-file offline suite passed 59 tests, skipped one opt-in native canary, and failed zero tests, with 252 expect calls. [offline-tests.log](offline-tests.log) names every executed case. This count excludes the separate repro, lease proof, artifact assertions, six retained regrades, and failure probes. It is not a provider qualification count.

Scoped TypeScript for the auth modules, config reader, and native-auth tests passed. Biome checked 20 scoped files without fixes. Logs are [types.log](types.log) and [lint.log](lint.log). Root tsc, the root suite, builds, pack, Git-backed qualification, and canary preparation did not run.

The first extra assertion added to the failure probe compared `/private/tmp` from the CLI cwd with `/tmp` from the filesystem error. That reviewer assertion failed. The corrected assertion checks the owned directory basename and passes. This was a macOS path-alias error in the reviewer script, not a product finding. Earlier observations remain supported by the rerun.

[initial-hashes.json](initial-hashes.json) matches every supplied R1-fix freeze entry. [late-start-hashes.json](late-start-hashes.json) separately identifies later-inventoried dependencies and two closeout-only qualification files. [final-hashes.json](final-hashes.json) reports zero drift across 25 compared files and zero freeze mismatches. [verify-hashes.py](verify-hashes.py) reruns the comparison. Concurrent core, Typesafe, and associated test changes are outside that claim. No whole-tree source hash or full-green claim is made.

## Limits and attention

The retained `/tmp/flow-v2-native-auth-probe/review-r1-fixes/native-receipt.json` is owner-executed evidence. The private fixture source was inspected. The receipt reports authenticated default CLI discovery, active plugins before import, source rotation and unrelated-account preservation, one local bearer-authenticated model request, fallback and cached-access source-loss refusal, source-location eviction, and both owned PIDs stopped. Its retained staged client bytes match this review. The native fixture and live canary were not rerun here.

No actual credentials were read. No user service or PID 76572 was contacted. No cloud OAuth, real provider, paid model, connector, delegate, Git operation, repository edit, root build, pack, goal, automation, or task creation occurred. All reviewer writes stayed under `/tmp/flow-v2-native-auth-review-r2`.

Built-in OpenAI and xAI routing, metadata, refresh behavior, environment-key precedence, Linux real-account forwarding, actual request budgets, and paid qualification remain unproved here. The auth modules themselves contain no model-dispatch bypass. That source observation does not certify an installed budget plugin. The parent's separate actual EvalHost boot work and concurrent core compaction fix are not certified by this report. The parent reports product `d3d46d92` blocked by that core edge case. This review grants no release approval regardless of earlier green counts or packed smoke receipts.

Prove It Works required the actual R1 reproduction and direct static artifact comparison. Boundary Discipline focused the new finding on public error completion. Make Operations Idempotent drove repeated-disposal and stale-lease checks. Build the Lever produced the rerunnable probes and hash checker. Test Behavior, Not Implementation required absent directories, preserved bytes, and literal HTTP outcomes. Minimize Reader Load kept the call graph tied to refresh ownership and cleanup ownership. Model the Domain used separate artifact descriptors, lease identities, and cleanup-result records. Unslop and technical-writing shaped the report and decision log.

The no-delegate instruction overrides optional how critics, Comment Sicko, and cross-model trail review. The supplied comment inventory is context only. No new independent comment verdict is claimed. Poteto sticky hooks were not verified.

Attention.

The decision trail was self-audited against this conversation and the retained artifacts. No independent trail reviewer ran because delegates were prohibited. Inspect the P3 reproduction and the distinction between real filesystem failure and injected relay-stop failure. Owner-executed native evidence and missing real-provider qualification remain explicit limits.
