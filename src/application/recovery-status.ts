export type RecoveryActivation = {
	host: string;
	source: "explicit" | "default" | "api";
	mode: "off" | "shadow" | "delegated";
	attempts: number;
	outcome: string;
	inactiveReason: string | null;
};

export function recoveryActivationView(
	activation: RecoveryActivation,
	active: boolean,
	bound: boolean,
	advice: {
		calls: number;
		last: Record<string, unknown> | null;
		inFlight: boolean;
	} | null,
) {
	const attempts = advice?.calls ?? activation.attempts;
	return {
		automation: { scope: "current-plugin-process", active, bound },
		advice: {
			configured: activation.mode !== "off",
			configuredMode: activation.mode,
			activationSource: activation.source,
			active: advice !== null,
			attempted: attempts > 0,
			attemptsReserved: attempts,
			outcome:
				typeof advice?.last?.kind === "string"
					? advice.last.kind
					: advice?.inFlight
						? "pending"
						: activation.outcome,
			inactiveReason: advice ? null : activation.inactiveReason,
		},
	};
}
