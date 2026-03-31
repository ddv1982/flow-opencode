export const FLOW_PLAN_CONTRACT = `Return plan content that can be persisted by the runtime.

Plan shape:
- summary: string
- overview: string
- requirements: string[]
- architectureDecisions: string[]
- features: array of objects with:
  - id: string
  - title: string
  - summary: string
  - fileTargets: string[]
  - verification: string[]
  - optional dependsOn: string[]
  - optional blockedBy: string[]
- optional goalMode: implementation | review | review_and_fix
- optional decompositionPolicy: atomic_feature | iterative_refinement | open_ended
- optional completionPolicy: { minCompletedFeatures?: number, requireFinalReview?: boolean }
- optional notes: string[]

Optional planning context you may persist alongside the plan:
- repoProfile: string[]
- research: string[]
- implementationApproach: {
  chosenDirection: string,
  keyConstraints: string[],
  validationSignals: string[],
  sources: string[]
}`;

export const FLOW_WORKER_CONTRACT = `Return exactly one worker result payload with:

- contractVersion: "1"
- status: ok | needs_input
- summary: string
- artifactsChanged: array of { path: string, kind?: string }
- validationRun: array of { command: string, status: passed | failed | failed_existing | partial, summary: string }
- decisions: array of { summary: string }
- nextStep: string
- optional reviewIterations: number
- optional validationScope: targeted | broad
- featureResult: {
  featureId: string,
  verificationStatus?: passed | partial | failed | not_recorded,
  notes?: array of { note: string },
  followUps?: array of { summary: string, severity?: string }
}
- featureReview: {
  status: passed | failed | needs_followup,
  summary: string,
  blockingFindings: array of { summary: string }
}
- optional finalReview: {
  status: passed | failed | needs_followup,
  summary: string,
  blockingFindings: array of { summary: string }
}

Status-specific rules:
- if status is ok, outcome must be omitted or use kind: completed
- if status is needs_input, outcome is required and kind must be one of: replan_required | blocked_external | needs_operator_input | contract_error
- never return status: ok with a non-completion outcome
- never return status: ok until targeted validation is complete and featureReview has no blocking findings
- when the active feature is the final completion path for the session, run broad validation, include finalReview, and use validationScope: broad for the clean completion result`;

export const FLOW_REVIEWER_CONTRACT = `Return exactly one reviewer result payload with:

- scope: feature | final
- optional featureId: string
- status: approved | needs_fix | blocked
- summary: string
- blockingFindings: array of { summary: string }
- optional followUps: array of { summary: string, severity?: string }
- optional suggestedValidation: string[]

Reviewer rules:
- return approved only when the current feature is clean enough to advance
- return needs_fix when implementation should continue on the same feature
- return blocked only for real external blockers or required human decisions
- for scope: feature, include the active featureId
- do not implement fixes yourself; only review and report findings`;
