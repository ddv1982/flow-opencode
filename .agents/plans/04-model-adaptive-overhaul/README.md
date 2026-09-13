# Model-adaptive overhaul work record

Start with [implementation.md](implementation.md) for current status and local
commit boundaries. [overview.md](overview.md), [research.md](research.md),
[eval-design.md](eval-design.md), and [checklist.md](checklist.md) preserve the
original investigation and acceptance plan; their historical checkboxes do not
supersede the implementation record. [decisions.tsv](decisions.tsv) is append-only.

## Tracked material

The plan, research, decisions, design and verification summaries are retained in
Git. The two prompt candidates under `evidence/f4-candidates/` are experimental
sources, not installed Flow guidance. Their review and static metrics do not
establish model effectiveness. Production guides remain under the root `skills/`.

The three tracked campaign manifests use paths relative to their own directory
and retain exact artifact identities. The [first funded comparison proposal](evidence/f4-candidates/campaign-proposal/README.md)
remains unapproved. Housekeeping does not authorize paid execution.

## Local evidence

The scoped `.gitignore` retains raw logs, diagnostic scripts and JSON outputs on
this machine without adding them to Git. It explicitly keeps campaign inputs and
candidate metrics trackable. Packed tarballs are already ignored repository-wide.
The 2.2 MB `evidence/f3-parent/legacy-fixtures.json` is a frozen diagnostic fixture;
earlier failed-check logs explain the subsequent fixes and are preserved locally.
Verification summaries refer to these local files, which will be absent in a
fresh clone. Those references describe retained evidence, not checked-in evidence.

The baseline tarball belongs at
`evidence/f3-parent/artifacts/opencode-plugin-flow-8.2.1.tgz`; the compact candidate
belongs at `evidence/f4-candidates/compact/artifacts/opencode-plugin-flow-8.2.1.tgz`.
The historical artifact dry-run also needs the ignored tarball named by its
manifest under root `evals/results/`. Transfer these exact bytes from the local
evidence archive before running a manifest elsewhere. A fresh build is a new
artifact: record its new identity and freeze a new manifest instead of relabeling
it with the existing hashes. Dry-run verifies artifact identities without provider
requests. Raw evidence has not been uploaded or deleted by this cleanup.

The four pre-existing 8.2.1 canary files are outside this work record and remain
untouched for their separate release review.
