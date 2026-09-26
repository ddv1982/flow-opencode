# Frozen decision comparisons

A frozen registration records which recovery cases and settings a campaign uses.
Separate manager and Jev evidence files let the report compare decisions on those
same cases. Each report records digests of both input evidence files. Registration and reporting run offline.

The registration retains the complete reviewed corpus so its split-contamination
checks remain reproducible. Collection uses one selected split. The registration
also binds packets, source hashes, manager configuration, the pinned Jev model,
and the current runtime thresholds. It does not tune thresholds.

The manager arm records a choice from the supplied candidates. The Jev arm retains
raw advice, which the report replays through the production shadow controller.
Both arms share the registered candidates. This measures decisions on fixed
proposals. It does not measure independent candidate generation by two agents.

The report keeps missing observations, provider failures, explicit abstentions,
and deterministic filtering separate. It counts a manager proposal rejected by
policy separately from a permitted selection outside the acceptable labels.
Those labels do not establish whether an unacceptable selection is unsafe or
merely ineffective. Safety-rate estimates therefore remain unavailable.

Only the registered primary case in each independence group contributes to primary
paired comparisons. Secondary cases remain diagnostic records. Missing pairs and
missing telemetry stay visible. Reserved dollars describe conservative spending
reservations, not invoiced cost. Decision latency is not active episode runtime.

Artifact digests detect changed inputs. Reviewer names and registration timestamps
are attestations, not authenticated identities or proof of historical order.
Independent operators must verify the provenance and protect the untouched
holdout. Qualification remains inconclusive until the plan's separate live and
operational gates have evidence.

Use [Run a frozen decision comparison](run-comparison.md) for commands.

Paired deltas are descriptive means. The report does not calculate uncertainty
intervals or make a promotion decision. [Whole-episode comparisons](episode-outcomes.md)
provide separate outcome measurements and exploratory intervals. Statistical
qualification still requires live evidence and review.
