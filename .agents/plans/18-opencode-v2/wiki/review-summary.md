# Local wiki review

PASS for the requested local draft. Publication remains held. Public readback is NOT VERIFIED.

The wiki base is `de4be508451c25564fc4bfb4911fa056d10ce3f3`. Its initial worktree was clean. All 45 Markdown files were read before editing. All original filenames remain, comprising 44 content pages and `_Sidebar.md`. All 45 revised files were then read back in full.

The final diff changes 45 files with 354 insertions and 1741 deletions. `wiki.patch` is the concrete review artifact. No changes were written to the main repository. No commits, pushes, network requests, external writes, credentials, delegates, or model calls were used.

The draft makes repository docs authoritative. Home and the sidebar lead to v2 setup and current contracts. Removed skill-copy installation, installer CLI instructions, old source paths, V1 configuration, old tool counts, manager-proxy review, two-pass final review, and age-based lock ownership are gone. Former installer page URLs now explain embedded guidance and native package loading. Security limits remain explicit. Selected origin commits and July metrics remain labeled history. The absent overview video and captions were removed.

Model precedence was traced through application preference types and schemas, native picker resolution, server preference updates, the store, and reviewer defaults. Project role preferences override global picker choices. An absent project role inherits. Default resets to base role behavior. A selected reviewer model clears its variant and retains configured steps. Base plugin options override environment defaults. The same server package loads the picker, and native `/models` owns coding selection.

`inventory.json` maps each old page to canonical targets and a distinct edit reason. It records old and new hashes, original headings, line counts, and additional source evidence. `baseline.json` records every original page and source reference. `source-census.json` hashes 118 current README, documentation, source, workflow, and guidance files. It is a census, not a claim that every TypeScript implementation was read in full. The requested canonical docs, all current ADRs through 0018, and relevant implementation paths were read.

The sealing check detected concurrent changes to execution attribution and lifecycle source. Their affected identity, epoch, context, compaction, and revocation paths were rechecked. The wiki summaries still match. `source-drift.json` records that review and `source-recheck.json` captures the later hashes. Other writers remain active, so these local hashes are not a frozen release identity.

## Verification

- `python3 /tmp/flow-v2-wiki-draft/verify.py` passes all 293 checks across all 45 files. These include 124 canonical link occurrences, 126 wiki links, 35 source references, and 8 historical commit links. Canonical files and heading anchors are checked locally. Commit links are checked against local Git objects.
- `git -C /tmp/flow-opencode-v2-plan-wiki diff --check` passes.
- The sidebar links all 44 content pages. No Markdown files were added or deleted.
- The single public configuration example parses as JSON and uses `plugins` with a package and object options. There is no duplicate terminal installation entry.
- No long dash, prose colon connector, retired source-tree reference, installer invocation, or obsolete active-schema field remains in the draft.
- Application tests and release gates were not run. This is a local documentation diff, and the main checkout is read-only for this task.

The smallest rerunnable proof is `verify.py`. It reads the actual wiki and local canonical targets. It also detects stale inventory hashes. There is no new sync system, framework, or page-generation template.

## Principle decisions

Build the Lever produced the standalone link checker. Sequence Work into Verifiable Units made each page group end with a link check before the next group. Prove It Works required actual changed-file readback and diff checks. Outcome-Oriented Execution removed retired operating instructions rather than preserving a compatibility manual. Model the Domain kept the audit as one record per page. Laziness Protocol kept the verification script local and small and the wiki shorter than the source manual.

Technical Writing kept each page in an overview or reference role and linked detailed procedures. Unslop removed generated filler, decorative headings, long dashes, and prose colon connectors.

## Remaining public readback gate

Only the parent publishes, after the verified Flow 10.0.0 release through the usual process. Before publication, the parent must confirm that the public README install pin and all 47 distinct canonical URLs and anchors in `public-readback-gate.json` resolve and match the final released source. Recheck any source or documentation changes made after this local census. This task supplies no release verdict.

After reviewing and publishing the actual wiki diff, the parent must read back all 44 public content pages listed in `inventory.json`, plus the rendered sidebar. Confirm the published content matches the reviewed draft and the page, navigation, and canonical links work. Public readback must confirm v2-only support, the tested minimum, install once, model precedence, close-before-upgrade guidance, security limits, and historical labels. Local target checks do not satisfy this gate.

## Attention

Independent reviewer and cross-model review were not run because the user prohibited delegates and models. No independent verdict is claimed. Parent review of `wiki.patch` and the public readback gate remain outstanding by design. The local decision trail is `decisions.tsv` and was checked against the active conversation and live files.
