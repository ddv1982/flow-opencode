# .factory Taxonomy

`.factory/` is process and evidence material, not Flow runtime source and not a packaged release surface.

## Active support material

- `library/` — project background notes used for maintainer orientation.
- `research/` — external research snapshots that can inform decisions but are not current source of truth.
- `skills/` — local process helpers outside the shipped plugin runtime.
- `services.yaml` and `init.sh` — factory/process bootstrap material.

## Historical validation evidence

- `validation/**/scrutiny/` — historical review artifacts.
- `validation/**/user-testing/` — historical user-test flow evidence.

These files may explain why a decision was made, but they should not be cited as current behavior without re-checking runtime code and `docs/maintainer-contract.md`.

## Guardrails

- Do not add `.factory/**` to the package release surface.
- Do not make runtime behavior depend on `.factory/**`.
- Do not classify `.factory/**` as wholesale dead code; tests use hidden `.factory` directories as workspace-root sentinels.
- Prefer moving new durable project truth into `docs/` instead of expanding `.factory/`.
