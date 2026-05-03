import { COMPLETION_GATE_AUDIT_GUIDANCE } from "../../runtime/transitions/completion-gate-projections.generated";

export const FLOW_AUDIT_CONTRACT = `Build an internal review/audit ledger using these fields so coverage stays explicit and internally consistent:

- requestedDepth: broad_audit | deep_audit | full_audit
- achievedDepth: broad_audit | deep_audit | full_audit
- repoSummary: string
- overallVerdict: string
- discoveredSurfaces: { name: string, category: source_runtime | tests | ci_release | docs_config | tooling | other, reviewStatus: directly_reviewed | spot_checked | unreviewed, evidence?: string[], reason?: string }[]
- evidencePackets?: { id: string, purpose?: planning | review | audit | validation | general, summary: string, sourceRefs?: string[], highlights?: string[], selectedContext?: string[], excludedContext?: string[], codemapSummaries?: string[], sliceSummaries?: string[], relationshipHypotheses?: string[], ambiguities?: string[], knownExclusions?: string[], alreadyCoveredFindings?: string[], validationEvidence?: { command: string, status: passed | failed | failed_existing | partial | not_run, summary: string }[] }[]
- coverageNotes?: string[]
- validationRun: { command: string, status: passed | failed | partial | not_run, summary: string }[]
- findings: { title: string, category: confirmed_defect | risk | hardening_opportunity | process_gap, confidence: confirmed | likely | speculative, severity?: high | medium | low, evidence: string[], impact: string, remediation?: string }[]
- nextSteps?: string[]

Review method:
- First map the repository's architectural boundaries, runtime entrypoints, persistence/state surfaces, test oracles, CI/release gates, and docs/config/tooling surfaces.
- For each source/runtime surface you directly review, trace at least one concrete invariant or failure path from entrypoint to state/output, then look for contradictory evidence in tests or validation artifacts.
- Before approving a behavior surface as clean, choose the applicable adversarial failure-mode classes: lifecycle/reentrancy/idempotency, async races/event ordering, persistence failure and recovery, interaction geometry/hit-testing, accessibility semantics/live regions, and test-oracle authenticity. Record the checked classes or meaningful gaps in coverageNotes, findings, or nextSteps.
- For each test surface you directly review, identify what behavior it proves, whether it exercises a normal product path rather than a shortcut-only setup, and what important behavior remains unproved.
- Prefer findings that explain an observable failure mode, regression path, broken invariant, or missing oracle over generic maintainability advice.
- Treat a surface as directly_reviewed only when the evidence cites concrete files/lines or artifacts inspected for that surface; use spot_checked when only representative files were sampled.

Finding taxonomy and confidence rules:
- Use confirmed_defect only when cited evidence directly supports a current incorrect behavior, broken contract, or failing invariant.
- Use risk for likely product, runtime, architecture, or regression risk where the failure mode is plausible but not proven as currently broken.
- Use hardening_opportunity for useful architectural, test, or resilience improvements that are not likely defects and should not be presented as release blockers.
- Use process_gap for missing validation, missing release evidence, coverage/accounting limitations, or workflow/reporting issues.
- Use confidence: confirmed only when the cited evidence directly establishes the claim; use likely for strongly supported inference; use speculative for hypotheses that need validation.
- Do not upgrade a finding's severity to high unless the evidence shows a likely release blocker, data loss, security/privacy issue, or broad availability failure.

Final response rules:
- Default to a human-readable markdown review, not raw JSON.
- Begin with these sections in order: Conclusion, Top findings, Recommended next actions, Coverage notes.
- In Conclusion, state achieved depth, overall verdict, the main confirmed issue or highest risk, and a clear readiness recommendation when relevant.
- In Top findings, sort findings by actionability: confirmed_defect first, then risk, then hardening_opportunity, then process_gap; within each category, show higher severity first.
- Keep evidence concise in the main view: summarize each finding with short bullets and compact file/line references rather than dumping the full ledger.
- Only include the full structured ledger as JSON when the user explicitly asks for raw/json/structured details.
- For raw/json/structured-only requests, returning structured output without the human-readable review is allowed.
- When the user asks for both readable and structured details, place the structured JSON after the human-readable review under a \`Structured review data\` heading.

Audit rules:
- treat requestedDepth as the user's requested review strength, but set achievedDepth from actual evidence gathered
- discoveredSurfaces is the canonical coverage ledger for standalone review coverage; derive human-readable coverage summaries from it instead of duplicating the same truth in extra structures
- evidencePackets is optional read-only context/evidence metadata for packet boundaries, exact sources, exclusions, uncertainty, and validation evidence; it must support discoveredSurfaces/findings instead of replacing their concrete evidence references
- achievedDepth can be full_audit only when every major surface discovered during repo mapping is directly reviewed and every discovered surface is represented in discoveredSurfaces
- if any major surface remains unreviewed, spot-checked only, or intentionally skipped, downgrade achievedDepth below full_audit and explain the gap in coverageNotes
- when no validation was run, include an explicit validationRun entry with status: not_run and explain why

Completion gate parity guidance (descriptor-projected, runtime enforcement remains authoritative):
${COMPLETION_GATE_AUDIT_GUIDANCE}`;
