import type {
	Feature,
	Plan,
	PlanningContext,
	Session,
} from "../../runtime/schema";
import { SessionSchema } from "../../runtime/schema";

export type WorkflowState = Session;
export type WorkflowFeature = Feature;
export type WorkflowPlan = Plan;
export type WorkflowPlanningContext = PlanningContext;

export type WorkflowInitialStateInput = {
	sessionId: string;
	goal: string;
	recordedAt: string;
	planning?: Partial<PlanningContext> | undefined;
};

export function createInitialWorkflowState(
	input: WorkflowInitialStateInput,
): WorkflowState {
	return SessionSchema.parse({
		version: 1,
		id: input.sessionId,
		goal: input.goal,
		status: "planning",
		approval: "pending",
		planning: {
			repoProfile: input.planning?.repoProfile ?? [],
			packageManager: input.planning?.packageManager,
			packageManagerAmbiguous: input.planning?.packageManagerAmbiguous ?? false,
			stackProfile: input.planning?.stackProfile,
			standardsProfile: input.planning?.standardsProfile,
			research: input.planning?.research ?? [],
			implementationApproach: input.planning?.implementationApproach,
			decisionLog: input.planning?.decisionLog ?? [],
			replanLog: input.planning?.replanLog ?? [],
			evidencePackets: input.planning?.evidencePackets,
		},
		plan: null,
		execution: {
			activeFeatureId: null,
			lastFeatureId: null,
			lastSummary: null,
			lastOutcomeKind: null,
			lastOutcome: null,
			lastNextStep: null,
			lastFeatureResult: null,
			lastReviewerDecision: null,
			lastValidationRun: [],
			history: [],
		},
		closure: null,
		notes: [],
		artifacts: [],
		timestamps: {
			createdAt: input.recordedAt,
			updatedAt: input.recordedAt,
			approvedAt: null,
			completedAt: null,
		},
	});
}
