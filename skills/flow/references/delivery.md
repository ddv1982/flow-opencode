## Delivery handoff

Copy `workflowData.delivery.summary.lines` unchanged as one block.
Implementation details may precede the block. Do not rewrite or restate its facts elsewhere.
Keep the supplied Goal line unchanged.
Copy each supplied `workflowData.delivery.assurance.limitations` statement unchanged, including its full topic list.
Before it, give task-required details absent from the summary using captured
evidence or retained delivery. Do not infer details from exit codes, read history
solely for closure. For requested full
detail or a missing summary, use the retained close response's `report`.

Map IDs only from `outcomeSummary`/`terminalFindings`: requirements are `verified`,
`incomplete`, or explicit `deferred`; `abandoned` stays the kind. A finding is
`fixed` only after passing review with current evidence; a failed verdict leaves
proven repairs pending pass and unproven repairs unverified. `recurring` needs
current confirmation, `residual` a confirmed nonblocker. Missing IDs and external
prerequisites are unavailable. Without delivery, report exact recovery and no map.
At a checkpoint or lease stop, print compact `findingsDigest` before the map.
