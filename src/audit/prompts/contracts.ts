export const FLOW_AUDIT_CONTRACT = `Build an internal review/audit ledger using these fields so coverage stays explicit and internally consistent:

- requestedDepth: broad_audit | deep_audit | full_audit
- achievedDepth: broad_audit | deep_audit | full_audit
- repoSummary: string
- overallVerdict: string
- discoveredSurfaces: { name: string, category: source_runtime | tests | ci_release | docs_config | tooling | other, reviewStatus: directly_reviewed | spot_checked | unreviewed, evidence?: string[], reason?: string }[]
- coverageNotes?: string[]
- validationRun: { command: string, status: passed | failed | partial | not_run, summary: string }[]
- findings: { title: string, category: confirmed_defect | risk | process_gap, confidence: confirmed | likely | speculative, severity?: high | medium | low, evidence: string[], impact: string, remediation?: string }[]
- nextSteps?: string[]

Final response rules:
- Default to a human-readable markdown review, not raw JSON.
- Begin with these sections in order: Conclusion, Top findings, Recommended next actions, Coverage notes.
- In Conclusion, state achieved depth, overall verdict, the main confirmed issue or highest risk, and a clear readiness recommendation when relevant.
- In Top findings, sort findings by actionability: confirmed_defect first, then risk, then process_gap; within each category, show higher severity first.
- Keep evidence concise in the main view: summarize each finding with short bullets and compact file/line references rather than dumping the full ledger.
- Only include the full structured ledger as JSON when the user explicitly asks for raw/json/structured details.
- For raw/json/structured-only requests, returning structured output without the human-readable review is allowed.
- When the user asks for both readable and structured details, place the structured JSON after the human-readable review under a \`Structured review data\` heading.

Audit rules:
- treat requestedDepth as the user's requested review strength, but set achievedDepth from actual evidence gathered
- discoveredSurfaces is the canonical coverage ledger for standalone review coverage; derive human-readable coverage summaries from it instead of duplicating the same truth in extra structures
- achievedDepth can be full_audit only when every major surface discovered during repo mapping is directly reviewed and every discovered surface is represented in discoveredSurfaces
- if any major surface remains unreviewed, spot-checked only, or intentionally skipped, do not use achievedDepth: full_audit
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why`;
