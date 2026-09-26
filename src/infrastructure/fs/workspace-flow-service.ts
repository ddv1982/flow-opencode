import { createFlowService } from "../../application/flow-service.js";
import type { RecoveryGuard } from "../../application/recovery-policy.js";
import { systemTransitionEnvironment } from "../system/transition-environment.js";
import { createFileSessionRepository } from "./session-repository.js";

export const createWorkspaceFlowService = (
	workspace: string,
	recovery?: RecoveryGuard,
) =>
	createFlowService(
		createFileSessionRepository(workspace),
		systemTransitionEnvironment,
		recovery,
	);
