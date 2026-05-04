import type { PlanningContext } from "../schema";

export function mergePlanningContext(
	current: PlanningContext,
	next: Partial<PlanningContext>,
): PlanningContext {
	return {
		repoProfile: next.repoProfile ?? current.repoProfile,
		packageManager: next.packageManager ?? current.packageManager,
		packageManagerAmbiguous:
			next.packageManagerAmbiguous ?? current.packageManagerAmbiguous,
		stackProfile: next.stackProfile ?? current.stackProfile,
		standardsProfile: next.standardsProfile ?? current.standardsProfile,
		research: next.research ?? current.research,
		implementationApproach:
			next.implementationApproach ?? current.implementationApproach,
		decisionLog: next.decisionLog ?? current.decisionLog,
		replanLog: next.replanLog ?? current.replanLog,
		evidencePackets: next.evidencePackets ?? current.evidencePackets,
	};
}
