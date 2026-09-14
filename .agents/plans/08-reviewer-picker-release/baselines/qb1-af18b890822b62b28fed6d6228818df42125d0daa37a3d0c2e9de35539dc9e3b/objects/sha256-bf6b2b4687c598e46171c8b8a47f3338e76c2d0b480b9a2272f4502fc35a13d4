/** Operator cancellation is control flow, not a provider or product failure. */
export class CampaignCancelled extends Error {
	readonly exitCode: number;
	constructor(exitCode: number) {
		super("Eval campaign stopped by the operator.");
		this.exitCode = exitCode;
	}
}

export async function withCampaignSignals(
	run: (signal: AbortSignal, beginFinalization: () => void) => Promise<number>,
): Promise<number> {
	const controller = new AbortController();
	let finalizing = false;
	const cancel = (code: number) => {
		if (!finalizing) controller.abort(new CampaignCancelled(code));
	};
	const interrupt = () => cancel(130);
	const terminate = () => cancel(143);
	process.on("SIGINT", interrupt);
	process.on("SIGTERM", terminate);
	try {
		const code = await run(controller.signal, () => {
			finalizing = true;
		});
		return controller.signal.aborted ? controller.signal.reason.exitCode : code;
	} catch (error) {
		if (error instanceof CampaignCancelled) return error.exitCode;
		throw error;
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", terminate);
	}
}
