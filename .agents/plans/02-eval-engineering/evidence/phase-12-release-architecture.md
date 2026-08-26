# Phase 12 release architecture

The strict release gate had a circular dependency. Canary and decision records
must be committed before tagging, but their full `ArtifactIdentity` contains the
pre-evidence Git commit and source-tree digest. The tagged checkout therefore
could not equal its own required evidence even when the packed npm artifact was
byte-identical.

## Architecture Arena

Three candidates independently converged on a separate packed-package identity.
An independent GPT-5.4 judge scored them on cycle removal, package guarantees,
source provenance, tamper detection, and reader load.

| Candidate | Score | Design |
| --- | ---: | --- |
| A | 24/25 | Compare packed identity at promotion boundaries and retain full artifact provenance everywhere else. |
| B | 20/25 | Use the packed projection across canary and release comparisons. |
| C | 15/25 | Add separate final-gate comparison helpers while keeping earlier comparisons strict. |

Candidate A won. The implementation adds `PackedArtifactIdentity` with exact
package version, tarball SHA-256, and unpacked-manifest SHA-256. Promotion checks
use those fields. Reports, canaries, decisions, and release analysis retain and
hash the full source commit and source-tree identity.

Candidate B contributed an explicit self-check that recomputes a decision's
`artifactSha256` from its stored full artifact. Candidate C's separate-boundary
naming reinforced that no eval-analysis comparison may be weakened.

The final qualification path keeps two checks separate. Required attempts are
full-compared with the report's measured `ArtifactIdentity`. The current promotion
candidate is then hard-failed unless its packed identity matches that measured
artifact. Canary evidence can therefore be committed without requiring a new paid
report, while any package-byte drift still returns `NOT VERIFIED`.

Rejected approaches included ignoring evidence paths in source hashing, removing
source fields from `ArtifactIdentity`, tagging before evidence is committed, and
rewriting evidence after tagging. Each either leaves the Git commit cycle intact
or weakens measured-source provenance.

The focused release suite passes 65 tests. The full gate passes 535 tests with one
intentional live-smoke skip. Existing full-provenance drift coverage remains green.
