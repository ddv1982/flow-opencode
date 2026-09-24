# Observed Echo recovery draft

An ordinary Echo recording-gate repair received two independent failed reviews. The second left its feature blocked at Session v5 revision 19. The manager proposed a retry conditional on attaching an authentic pre-edit reproduction receipt. Flow's live shadow call to `jev-1.13.0` abstained and made no mutation.

`checkpoint.json` is the retained durable state. `manager-proposal.json` and `decision-packet.json` preserve the exact candidate and policy packet. The packet's SHA-256 matches `runtime-shadow-outcome.json`. `review-findings.json` shows both review cohorts; `source-provenance.json` binds their private raw session hashes and the earlier Echo failure artifact. `snapshot.json` passes the dataset importer; `draft.json` is the import result.

`label-proposal-unreviewed.json` proposes abstention because the pre-edit receipt had not been supplied in the decision packet. A separate earlier Echo run did contain a failure artifact, but it was recovered only afterward. Reviewers should adjudicate this distinction and source authenticity before approving labels. This case is calibration-only, unreviewed, and contributes **zero** to qualification counts.
