export const FLOW_AUDIT_CONTRACT = `Build an internal review/audit ledger using these fields so coverage stays explicit and internally consistent:

- requestedDepth: broad_audit | deep_audit | full_audit
- achievedDepth: broad_audit | deep_audit | full_audit
- repoSummary: string
- overallVerdict: string
- discoveredSurfaces: { name: string, category: source_runtime | tests | ci_release | docs_config | tooling | other, reviewStatus: directly_reviewed | spot_checked | unreviewed, evidence?: string[], reason?: string }[]
- coverageSummary: { discoveredSurfaceCount: number, reviewedSurfaceCount: number, unreviewedSurfaceCount: number, notes?: string[] }
- reviewedSurfaces: { name: string, evidence: string[] }[]
- unreviewedSurfaces: { name: string, reason: string }[]
- coverageRubric: { fullAuditEligible: boolean, directlyReviewedCategories: string[], spotCheckedCategories: string[], unreviewedCategories: string[], blockingReasons: string[] }
- validationRun: { command: string, status: passed | failed | partial | not_run, summary: string }[]
- findings: { title: string, category: confirmed_defect | likely_risk | hardening_opportunity | process_gap, confidence: confirmed | likely | speculative, severity?: high | medium | low, evidence: string[], impact: string, remediation?: string }[]
- nextSteps?: string[]

Final response rules:
- Default to a human-readable markdown review, not raw JSON.
- Begin with these sections in order: Conclusion, Top findings, Recommended next actions, Coverage notes.
- In Conclusion, state achieved depth, overall verdict, the main confirmed issue or highest risk, and a clear readiness recommendation when relevant.
- In Top findings, sort findings by actionability: confirmed_defect first, then likely_risk, then hardening_opportunity, then process_gap; within each category, show higher severity first.
- Keep evidence concise in the main view: summarize each finding with short bullets and compact file/line references rather than dumping the full ledger.
- Only include the full structured ledger as JSON when the user explicitly asks for raw/json/structured details.
- When structured details are requested, place them after the human-readable review under a \`Structured review data\` heading.

Audit rules:
- treat requestedDepth as the user's requested review strength, but set achievedDepth from actual evidence gathered
- discoveredSurfaces is the canonical coverage ledger; reviewedSurfaces, unreviewedSurfaces, coverageSummary, and coverageRubric must be derivable from it without contradiction
- achievedDepth can be full_audit only when every major surface discovered during repo mapping is directly reviewed, every discovered surface is represented in discoveredSurfaces, and coverageRubric.fullAuditEligible is true
- if any major surface remains unreviewed, spot-checked only, or intentionally skipped, do not use achievedDepth: full_audit
- use category confirmed_defect only for directly supported defects; use likely_risk or hardening_opportunity when the finding is partially inferred or advisory
- Use confidence confirmed only when the cited evidence directly supports the conclusion.
- keep process/reporting issues in process_gap instead of mixing them into product defects
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why`;
