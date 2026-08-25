# Phase 9 Interrogate review and canary handoff

Phase 9 replaces the temporary unconditional release stop with an exact manual
canary protocol. Preparation validates and copies the tarball, extracts its bundled
entry into a project-local OpenCode plugin fixture, pins dependencies, and writes a
versioned checklist manifest outside Git. Direct OpenCode 1.18.6 inspection proved
that the fixture auto-loads the exact local plugin and exposes Flow's reviewer and
commands.

Recording accepts passed, failed, or incomplete outcomes. It requires the exact
check set, explicit operator, host digest, ActorIdentity-shaped manager/reviewer
evidence, and checklist-derived 72-hour expiry. Session and transcript JSON are
scrubbed for credentials, workspace paths, and runtime IDs before immutable
artifact and record publication. Byte-identical replay succeeds and changed bytes
conflict.

Release decisions now carry `canarySha256`, and `decisionInputSha256` includes it.
The scheduled canary-null decision remains separate; after the manual run the
maintainer reruns qualification to create a hash-suffixed canary-bound decision.
Strict tag verification recomputes that input hash, checks the full rebuilt
ArtifactIdentity, reads the fresh passed canary and sanitized artifacts from the
tagged checkout, and stops before any publish step on mismatch.

The release workflow now verifies on main and tags. Main has read-only contents
permission, reports missing release evidence as `INCONCLUSIVE`, and has no publish
job path. The tag-only release job has scoped write/id-token permissions and depends
on deterministic verification before npm or GitHub publication. The temporary
`canary-not-enabled` step is removed.

The non-model runtime proof packed the current bytes, generated the fixture,
observed Flow surfaces on the pinned host, returned `INCONCLUSIVE` in dry-run, and
failed strict verification as required. No canary record, canary-bound decision,
tag, or release was fabricated. The final phase remains `INCONCLUSIVE` until the
maintainer completes the prepared OpenCode checklist.

The full repository gate passes 520 tests with one intentional live-smoke skip.
The final four-model review found no unresolved blocker in the implemented
infrastructure; the human canary stop remains open by design.
