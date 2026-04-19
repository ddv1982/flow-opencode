export const FLOW_PLAN_CONTRACT = `Persist a plan with:

- summary: string
- overview: string
- requirements: string[]
- architectureDecisions: string[]
- features: { id, title, summary, fileTargets: string[], verification: string[], dependsOn?: string[], blockedBy?: string[] }[]
- goalMode?: implementation | review | review_and_fix
- decompositionPolicy?: atomic_feature | iterative_refinement | open_ended
- completionPolicy?: { minCompletedFeatures?: number }
- notes?: string[]

Optional context:
- repoProfile?: string[]
- research?: string[]
- implementationApproach?: { chosenDirection: string, keyConstraints: string[], validationSignals: string[], sources: string[] }`;

export const FLOW_WORKER_CONTRACT = `Return exactly one JSON object that matches the worker result payload below, with no markdown fences, commentary, or trailing text:

- contractVersion: "1"
- status: ok | needs_input
- summary: string
- artifactsChanged: { path, kind? }[]
- validationRun: { command, status: passed | failed | failed_existing | partial, summary }[]
- decisions: { summary }[]
- nextStep: string
- reviewIterations?: number
- validationScope?: targeted | broad
- outcome?: { kind, category?, summary?, resolutionHint?, retryable?, autoResolvable?, needsHuman? }
- featureResult: { featureId, verificationStatus?: passed | partial | failed | not_recorded, notes?: { note }[], followUps?: { summary, severity? }[] }
- featureReview: { status: passed | failed | needs_followup, summary, blockingFindings: { summary }[] }
- finalReview?: same shape as featureReview

Status rules:
- if status is ok, outcome must be omitted or use kind: completed
- if status is needs_input, outcome.kind must be replan_required | blocked_external | needs_operator_input | contract_error
- never return status: ok with a non-completion outcome
- never return status: ok until targeted validation is complete and featureReview has no blocking findings
- when the active feature is the final completion path for the session, run broad validation, include finalReview, and use validationScope: broad
- treat the active feature as the final completion path whenever completing it would satisfy the session completion policy, including completionPolicy.minCompletedFeatures even if other plan features remain pending`;

export const FLOW_REVIEWER_CONTRACT = `Return exactly one JSON object that matches the reviewer result payload below, with no markdown fences, commentary, or trailing text:

- scope: feature | final
- featureId?: string
- status: approved | needs_fix | blocked
- summary: string
- blockingFindings: { summary }[]
- followUps?: { summary, severity? }[]
- suggestedValidation?: string[]

Reviewer rules:
- return approved only when the current feature is clean enough to advance
- return needs_fix when implementation should continue on the same feature
- return blocked only for real external blockers or required human decisions
- for scope: feature, include the active featureId
- do not implement fixes yourself; only review and report findings`;
