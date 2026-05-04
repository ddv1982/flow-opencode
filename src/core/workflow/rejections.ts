import type { TransitionRecovery } from "../../workflow/recovery";

export type WorkflowRejectionCode =
	| "missing_session"
	| "session_already_exists"
	| "invalid_command"
	| "transition_rejected";

export type WorkflowRejection = {
	accepted: false;
	code: WorkflowRejectionCode;
	message: string;
	recovery?: TransitionRecovery;
};

export type WorkflowAcceptance<Event> = {
	accepted: true;
	events: readonly Event[];
};

export type WorkflowDecision<Event> =
	| WorkflowAcceptance<Event>
	| WorkflowRejection;

export function acceptWorkflowEvents<Event>(
	events: readonly Event[],
): WorkflowAcceptance<Event> {
	return { accepted: true, events };
}

export function rejectWorkflowCommand(
	code: WorkflowRejectionCode,
	message: string,
	recovery?: TransitionRecovery,
): WorkflowRejection {
	return {
		accepted: false,
		code,
		message,
		...(recovery ? { recovery } : {}),
	};
}
