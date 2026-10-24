# Final configuration update

The parent added `options.typesafeApiKeyEnv` to the existing configuration page after the original local wiki audit. The example contains only the variable name. The text requires the key in the OpenCode server environment and explains that custom names never fall back.

The original audit remains in `/tmp/flow-v2-wiki-draft`. The final local inventory and patch were regenerated in `/tmp/flow-v2-wiki-final-draft`. All 293 checks across 45 pages passed again. The configuration source references now include `src/platform/opencode/typesafe-key-env.ts`.

The four refreshed artifacts in this directory supersede their earlier local draft versions. The original review summary describes the earlier audit. No wiki commit or publication occurred. The public readback gate remains open and runs only after the verified release.


## Patch storage

Commit preflight rejects blank context lines in a new patch file as trailing
whitespace. The parent moved the patch unchanged to `/tmp/flow-v2-wiki-reviewed-patch/wiki.patch`. Its SHA-256 is
`25016b5d92944d703e45380a27ea184548cd7a7c776c07f4b4424cb0923d12ce`. It matches the final local wiki draft. The separate wiki
checkout remains the publication candidate. The main repository retains review
and link-verification records, with no duplicate wiki content patch. Earlier
references to the plan-local `wiki.patch` are superseded by this location.


## Parent local readback

The parent read all 45 revised pages and compared their v2 support, tool/command,
permission, configuration, evidence, and release claims with maintained source
and documentation. The current local checker passes all 293 checks in
`/tmp/flow-v2-wiki-r8-local/linkverification.json`. No new wiki change was needed.
Public checks remain gated on the verified release and later wiki publication.
