import { createFlowService } from "../../application/flow-service.js";
import { systemTransitionEnvironment } from "../system/transition-environment.js";
import { createFileSessionRepository } from "./session-repository.js";

export const createWorkspaceFlowService = (workspace: string) =>
	createFlowService(
		createFileSessionRepository(workspace),
		systemTransitionEnvironment,
	);
