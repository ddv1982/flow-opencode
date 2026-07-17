export class UnreadableFlowSessionError extends Error {
	readonly code = "UNREADABLE_FLOW_SESSION";
	readonly reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = "UnreadableFlowSessionError";
		this.reason = reason;
	}
}
