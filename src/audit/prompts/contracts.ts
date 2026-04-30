export const FLOW_AUDIT_CONTRACT = `When constructing the review/audit report payload, return exactly one JSON object that matches the audit report payload below, with no markdown fences, commentary, or trailing text:

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

Audit rules:
- treat requestedDepth as the user's requested review strength, but set achievedDepth from actual evidence gathered
- discoveredSurfaces is the canonical coverage ledger; reviewedSurfaces, unreviewedSurfaces, coverageSummary, and coverageRubric must be derivable from it without contradiction
- achievedDepth can be full_audit only when every major surface discovered during repo mapping is directly reviewed, every discovered surface is represented in discoveredSurfaces, and coverageRubric.fullAuditEligible is true
- if any major surface remains unreviewed, spot-checked only, or intentionally skipped, do not use achievedDepth: full_audit
- use category confirmed_defect only for directly supported defects; use likely_risk or hardening_opportunity when the finding is partially inferred or advisory
- Use confidence confirmed only when the cited evidence directly supports the conclusion.
- keep process/reporting issues in process_gap instead of mixing them into product defects
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why`;
