import {
	type PreparedValidation,
	type PrepareValidationInput,
	prepareValidation,
} from "../../application/prepare-validation.js";
import { createFileSessionRepository } from "./session-repository.js";

export function prepareWorkspaceValidation(
	workspace: string,
	input: PrepareValidationInput,
): Promise<PreparedValidation> {
	return prepareValidation(createFileSessionRepository(workspace), input);
}
