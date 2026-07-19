export class UnreadableFlowSessionError extends Error {
	readonly code = "UNREADABLE_FLOW_SESSION";
	readonly reason: string;

	constructor(message: string, reason: string) {
		super(message);
		this.name = "UnreadableFlowSessionError";
		this.reason = reason;
	}
}

export class UnsupportedFlowSessionVersionError extends Error {
	readonly code = "UNSUPPORTED_FLOW_SESSION_VERSION";
	readonly actualVersion: unknown;

	constructor(actualVersion: unknown) {
		super(
			"Flow supports only Session v4 state; the active session uses an unsupported version.",
		);
		this.name = "UnsupportedFlowSessionVersionError";
		this.actualVersion = actualVersion;
	}
}
