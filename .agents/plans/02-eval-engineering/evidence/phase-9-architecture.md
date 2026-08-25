# Phase 9 architecture synthesis

## Arena decision

Three candidates converged on a separate manual canary gate. The independent judge
selected the exact-artifact, write-once record base and grafted tag-only publication,
ActorIdentity-shaped evidence, checklist expiry, redacted artifact hashes, and an
exact canary digest inside the final release decision input.

## Operator flow

```bash
bun run build
bun pm pack --destination .release-artifacts
bun run eval:canary -- prepare \
  --artifact .release-artifacts/opencode-plugin-flow-<version>.tgz \
  --out .release-artifacts/canary-<version>

# Run the prepared local-plugin fixture in OpenCode and save its session evidence.
bun run eval:canary -- record \
  --prepared .release-artifacts/canary-<version>/prepared.json \
  --status passed --operator <maintainer> \
  --host-config <json> --actors <json> --checks <json> \
  --project-path <fixture> --session <json> --transcript <json>

# Reissue the decision with the reviewed canary in its input hash.
bun run qualify -- --report <report> --catalog <catalog> --artifact <tgz> \
  --canary evals/canary/<version>.json
```

`prepare` is non-claiming. It copies the exact tarball, extracts its validated
`dist/index.js` into a project-local `.opencode/plugins/flow.js`, pins the local
plugin dependencies, creates a small canary workspace, and writes the immutable
checklist/artifact preparation manifest outside Git under `.release-artifacts`.

`record` redacts JSON-shaped session and transcript evidence, removes workspace and
session identifiers, writes sanitized artifacts, and then publishes exactly one
canonical `evals/canary/<version>.json`. Byte-identical replay succeeds; a changed
record conflicts. Passed, failed, and incomplete attempts are all durable evidence.

## Record and gate

The strict canary record binds:

- full `ArtifactIdentity` and `v<packageVersion>` tag;
- exact checklist version, hash, and required check set;
- passed, failed, or incomplete status;
- explicit operator, recorded time, and checklist-derived 72-hour expiry;
- host configuration digest and manager/reviewer `ActorIdentity` observations;
- relative sanitized session/transcript paths, byte counts, and SHA-256 digests;
- its own canonical record hash.

Passed requires every check true, both sanitized artifacts, at least one actor, and
fresh internally consistent timestamps. Failed requires at least one false check.
Incomplete can preserve partial evidence but never qualifies publication.

The scheduled evaluation decision remains `canarySha256: null`. After manual canary
recording, qualification validates the exact artifact/tag/fresh passed canary and
writes a distinct canary-bound decision record. `decisionInputSha256` includes
`canarySha256`, so a canary cannot be attached to an older decision after the fact.

## Workflow

`release.yml` runs on main and `v*` tags. Main rebuilds and checks the package,
reports missing release decision/canary as `INCONCLUSIVE`, and has no publish job.
Tags rebuild the tarball from the tagged checkout and require an exact VERIFIED
canary-bound decision plus the fresh passed `evals/canary/<version>.json` from that
same checkout before npm or GitHub publication. The temporary Phase 5 stop is
deleted; publication remains tag-only.

No release is requested in this phase. The manual canary and canary-bound decision
remain pending for the maintainer-run OpenCode session.
