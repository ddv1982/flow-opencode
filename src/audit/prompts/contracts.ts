import { renderExampleBlocks } from "../../prompts/format";

export const FLOW_AUDIT_CONTRACT = `Return exactly one JSON object that matches the audit report payload below, with no markdown fences, commentary, or trailing text:

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
- use confidence confirmed only when the cited evidence directly supports the conclusion
- keep process/reporting issues in process_gap instead of mixing them into product defects
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why
- when persisting an audit artifact through flow_audit_write_report, pass the completed audit report object; Flow recomputes the coverage sections from discoveredSurfaces and rejects unsupported full_audit claims
- if flow_audit_write_report succeeds, the final audit output should use the returned normalized report object
- artifact paths returned by flow_audit_write_report are persistence metadata, not fields in this audit report payload

Output examples:

${renderExampleBlocks([
	{
		name: "downgraded-full-audit",
		body: `{"requestedDepth":"full_audit","achievedDepth":"deep_audit","repoSummary":"Mapped prompt/config and prompt-eval surfaces directly, but did not finish all discovered repo surfaces.","overallVerdict":"Useful deep audit with one confirmed defect and a documented coverage downgrade.","discoveredSurfaces":[{"name":"prompt/config wiring","category":"source_runtime","reviewStatus":"directly_reviewed","evidence":["src/config.ts:1-126","src/prompts/commands.ts:1-215"]},{"name":"runtime smoke coverage","category":"tests","reviewStatus":"unreviewed","reason":"The audit stayed read-only and did not inspect every runtime-oriented test surface."}],"coverageSummary":{"discoveredSurfaceCount":2,"reviewedSurfaceCount":1,"unreviewedSurfaceCount":1,"notes":["Command/config surfaces were reviewed directly; runtime smoke paths were not fully inspected."]},"reviewedSurfaces":[{"name":"prompt/config wiring","evidence":["src/config.ts:1-126","src/prompts/commands.ts:1-215"]}],"unreviewedSurfaces":[{"name":"runtime smoke coverage","reason":"The audit stayed read-only and did not inspect every runtime-oriented test surface."}],"coverageRubric":{"fullAuditEligible":false,"directlyReviewedCategories":["source_runtime"],"spotCheckedCategories":[],"unreviewedCategories":["tests"],"blockingReasons":["Not every discovered surface was directly reviewed."]},"validationRun":[{"command":"bun run check","status":"not_run","summary":"The audit surface is read-only, so no shell validation was executed directly."}],"findings":[{"title":"Audit claims can overstate coverage when reviewed surfaces are not enumerated explicitly.","category":"confirmed_defect","confidence":"confirmed","severity":"high","evidence":["src/prompts/contracts.ts:59-90"],"impact":"A report can sound more exhaustive than the actual inspection that was performed.","remediation":"Keep coverage counts aligned with the listed reviewed and unreviewed surfaces."}],"nextSteps":["Fix confirmed defects first.","Run a follow-up full_audit only after every discovered major surface is directly reviewed."]}`,
	},
	{
		name: "broad-audit-hygiene",
		body: `{"requestedDepth":"broad_audit","achievedDepth":"broad_audit","repoSummary":"Quick audit sweep across the command and documentation surfaces.","overallVerdict":"No confirmed product defects, but there is a process gap worth fixing.","discoveredSurfaces":[{"name":"release-process documentation parity","category":"docs_config","reviewStatus":"directly_reviewed","evidence":["docs/development.md:47-61",".github/workflows/ci.yml:92-104"]}],"coverageSummary":{"discoveredSurfaceCount":1,"reviewedSurfaceCount":1,"unreviewedSurfaceCount":0},"reviewedSurfaces":[{"name":"release-process documentation parity","evidence":["docs/development.md:47-61",".github/workflows/ci.yml:92-104"]}],"unreviewedSurfaces":[],"coverageRubric":{"fullAuditEligible":true,"directlyReviewedCategories":["docs_config"],"spotCheckedCategories":[],"unreviewedCategories":[],"blockingReasons":[]},"validationRun":[{"command":"bun run check","status":"not_run","summary":"No shell validation was executed directly from this read-only audit surface."}],"findings":[{"title":"Documentation can drift from the actual CI validation path.","category":"process_gap","confidence":"confirmed","severity":"medium","evidence":["docs/development.md:47-61",".github/workflows/ci.yml:92-104"],"impact":"Operators can get the wrong impression about which checks currently gate CI.","remediation":"Keep maintainer docs aligned with the real workflow files."}]}`,
	},
])}`;
