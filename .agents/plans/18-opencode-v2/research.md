# OpenCode v2 migration findings

Research date is 2026-10-24. Flow HEAD is
`8103f1cd42e1b4d111f25d2a311935d4e41fb997`. The package is 9.6.0.
The checkout was clean before the plan was written.

## The new host requires a plugin port

The [official plugin migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1)
replaces the function-and-hooks API with an ID and `setup(ctx)`.
Domain transforms replace global config mutation. Tools use new schemas and
structured results. Events and cleanup need explicit lifecycle handling.
The guide's optional dual-version export conflicts with the requested scope.
The plan excludes that export.

The [general migration guide](https://opencode.ai/v2/docs/migrate-v1/)
also identifies changed server clients and terminal configuration.
Native configuration uses `plugins` and object-form package options.
The new terminal configuration is global `cli.json`.

The [changelog](https://opencode.ai/changelog) lists 2.1.4 on October 23, 2026.
It records further public contract changes in 2.1.0, including compaction and
provider replay data. A claim covering every 2.0 release is therefore broader
than the proposed tested baseline.

## Registry packages are separate from the legacy CLI

Registry responses confirmed these current `latest` values.
The selected exact-version metadata and integrity values are retained in
[registry.json](registry.json).

- [`@opencode/cli`](https://registry.npmjs.org/@opencode%2fcli/latest) is 2.1.4.
- [`@opencode/plugin`](https://registry.npmjs.org/@opencode%2fplugin/latest) is 2.1.4.
- [`@opencode/client`](https://registry.npmjs.org/@opencode%2fclient/latest) is 2.1.4.
- [`@opencode/sdk`](https://registry.npmjs.org/@opencode%2fsdk/latest) is 2.1.4.
- [`opencode-ai`](https://registry.npmjs.org/opencode-ai/latest) remains 1.19.4.

The [official download page](https://opencode.ai/download) uses `@opencode/cli`
for the new npm installation. `@opencode/sdk` embeds a host. It is not the
replacement for an external network client in eval tooling.

The existing development plugin pin is `@opencode-ai/plugin@1.18.31`.
Its peer range is `>=1.18.3 <2`. The local `opencode --version` reports 1.18.30.
Neither the installed binary nor package configuration was changed.

An isolated `npm exec --package=@opencode/cli@2.1.4 -- opencode --version`
then exited zero and reported `opencode v2.1.4` on macOS arm64.
The full command and isolated directory settings are retained in
[host-version.json](host-version.json). The package's `.exe` bin name does not
prevent this launch. Linux startup and plugin behavior still need phase 0 proof.

Released 2.1.4 plugin, client, and schema declarations were downloaded into
`/tmp/flow-opencode-v2-plan-research` for inspection. They confirm
`Plugin.Context`, domain hooks, structured tool results, session parentage,
and nested session location. These declarations do not prove runtime behavior.

## Continuation is the highest-risk contract

The [plugin reference](https://opencode.ai/v2/docs/build/plugins/)
places prompt hooks before durable admission. Concurrent admission can run hooks
more than once. Synthetic messages bypass prompt hooks. Those semantics make a
mechanical replacement of Flow's `chat.message` handling unsafe.

Flow's current implementation uses assistant parentage and V1 compaction markers
to attribute automatic work. See `src/platform/opencode/auto-drive.ts`,
`auto-compaction.ts`, and `plugin-composition.ts`.
The plan requires a verified v2 attribution design instead of assuming equivalent
message fields or weakening the continuation authority checks.

## The terminal plugin can remain in the same package

The [CLI plugin reference](https://opencode.ai/v2/docs/build/plugins/cli/)
provides `Plugin.define`, reactive keymaps, promise-based dialogs, and toasts.
Its released declarations include dialog selection and confirmation.
The existing picker can therefore target public APIs without a custom renderer.
That is a design inference pending interaction proof.
The TUI barrel also re-exports Solid helpers. Its runtime import graph and peer
resolution must be exercised before choosing dependency declarations.

The [CLI loading guide](https://opencode.ai/v2/docs/cli/plugins/)
loads a server-configured package's TUI component automatically.
It reserves `cli.json` for client-only plugins.
The README's instruction to configure Flow twice must change.

## The release policy needs an explicit prospective profile

`evals/release-policy.ts` pins the qualification host independently to 1.18.31.
That shared constant also contributes to historical policy hashes and strict
canary checks. A global edit would invalidate retained records.
The prospective host policy must select by Flow version while preserving
historical hash inputs and historical canary verification.
Its 9.6.0 profile requires 17 cases. The generic profile has nine.
A plain version bump to 10.0.0 loses three autonomous and five delivery cases.
The one-provider exception is also limited to named 9.x versions.

Keeping the 17 cases on two providers gives 144 primary cells and 34 reserve
cells at unchanged thresholds. This is policy arithmetic, not a measured result
or an approved dispatch budget. The existing 9.6.0 profile has 72 primary and
17 reserve cells on one provider.

The authoritative process is in `docs/development.md`,
`docs/release-qualification.md`, and
`.agents/plans/05-release-simplification/README.md`.
Paid authorization names purpose, models, dispatch count, and expiry.
Canary authorization is separate. The campaign must retain complete attempts.
Freshness limits are seven days for campaigns and 72 hours for canaries.

`evals/provenance.ts` compares raw tarball and unpacked-manifest digests.
`.github/workflows/release.yml` already restores sealed tarballs for named
historical releases. A new candidate must preserve exact raw bytes through
publication rather than relying only on equal unpacked files.

The active eval host, canary fixture, smoke test, metadata probe, and recovery
plugins also use V1 contracts. Their port belongs in the release-critical work.
The phrase "V2 bundle" in qualification docs names an evidence format.
It does not mean the plugin supports OpenCode 2.

## The wiki has no current synchronization workflow

`docs/index.md` names `docs/` as the maintained source.
No active wiki synchronization script or workflow was found.
The wiki is a separate Git repository with HEAD
`de4be508451c25564fc4bfb4911fa056d10ce3f3`.
Read-only cloning and repository metadata confirmed that it exists.

The public [Home](https://github.com/ddv1982/flow-opencode/wiki),
[configuration](https://github.com/ddv1982/flow-opencode/wiki/reference--configuration),
and [deployment](https://github.com/ddv1982/flow-opencode/wiki/deployment)
pages describe older code paths and product behavior.
Home still links deleted `droid-wiki` video artifacts.
The proposed wiki pass preserves page URLs and replaces stale instructions
with current summaries and links to maintained docs.

## Evidence and capability limits

Exa search and fetch were used for official documentation.
Ref MCP was not exposed in the live tool catalog.
No Ref result, v2 plugin runtime test, paid evaluation, implementation verification,
release, or wiki publication is claimed.

Two read-only Codex explorers inspected host integration and release/wiki
contracts at the recorded Flow SHA. Both reported integration issues.
They used `gpt-6.1-sol` with high reasoning effort and priority service.
They shared the checkout without write authority. The parent inspected the
relevant source and upstream declarations before incorporating their findings.

An independent `grok-4.7` reviewer checked the plan and trail with high reasoning
effort. Its findings and the parent's corrections are recorded in
[review.md](review.md). The review did not certify plugin compatibility.

## Transport correction during implementation

The V1 experimental transport flags do not control the pinned v2 host.
The current [provider reference](https://opencode.ai/v2/docs/providers/#websockets)
documents `settings.transport`. Its statement about provider HTTP hooks does not
establish the behavior of global session hooks. A local native Responses probe
showed WebSocket traffic both without a hook and with a global session HTTP hook.

The selected adapter sets provider, model, and variant transport to `http`.
The exact production helper sent one HTTP request and opened zero WebSockets,
even with a WebSocket variant selected. Both control cases opened a WebSocket.
This proof used native 2.1.4 and a loopback provider, without paid inference.
The retained runtime receipt and source seal are recorded in `decisions.tsv`.
