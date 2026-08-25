# Phase 3 Interrogate review

## Intent

Phase 3 must bind real eval output to exact source, packed bytes, evaluator inputs,
host configuration, requested and observed actors, delivered instructions, and a
redacted transcript. It must preserve endpoint and identity limitations rather
than fill missing observations from configuration.

## Acted on

- The runner now consumes provenance helpers and emits the binding on every result.
- Tarball bytes are checked before inspection and after cache installation.
- Unpacked manifests bind file and directory type. Other archive entry types are
  rejected.
- Reviewer child endpoint failures remain explicit, including partial discovery.
- Multi-session actor identity fails closed when any session is unobserved.
- Transcript redaction covers object keys, short sensitive-field values, paths,
  and credential-shaped strings.
- Instruction text rejects malformed Unicode and hashes actual UTF-8 delivery.
- Requested manager and reviewer identities are emitted separately from raw host
  observations. Reviewer model and step configuration are included in host hashes.
- Pure actor parsing moved out of the large harness into `host-observation.ts`.

## Lead judgment

The pinned host independently exposes provider and model fields, but not the full
family, gateway, and revision tuple required by v2 `ModelIdentity`. The legacy
pilot retains the raw observation. Phase 4 must emit actual identity as
`unobserved` unless a later host exposes all required fields. Cross-family claims
remain unavailable otherwise.

## Verdict

`VERIFIED`. Four-model recheck found no unresolved blocker. The final paid packed
`happy-path` passed with observed manager and reviewer roles, two delivered
guidance records, exact artifact/evaluator/host hashes, and a clean transcript
redaction scan. The full repository gate passes 462 tests, one intentional skip,
and zero failures.
