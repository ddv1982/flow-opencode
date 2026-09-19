import { spawnSync } from "node:child_process";

export const REPLAY_SCRIPT = "evals/replay-run.ts";
export const JEV_SCRIPT = "evals/alignment-corpus/jev-run.ts";

export type CheapCommandResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type CheapRun = (
	script: string,
	env: NodeJS.ProcessEnv,
) => CheapCommandResult | Promise<CheapCommandResult>;

export type CheapJev =
	| {
			readonly kind: "skipped";
			readonly reason: "missing-key" | "replay-failed";
	  }
	| { readonly kind: "ran"; readonly exitCode: number };

export type CheapReport = {
	readonly replay: { readonly exitCode: number };
	readonly jev: CheapJev;
	readonly exitCode: number;
};

function defaultRun(
	script: string,
	env: NodeJS.ProcessEnv,
): CheapCommandResult {
	const result = spawnSync(process.execPath, [script], {
		encoding: "utf8",
		env,
	});
	return {
		exitCode: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export async function runEvalCheap(
	options: {
		readonly env?: NodeJS.ProcessEnv;
		readonly run?: CheapRun;
		readonly write?: (text: string) => void;
	} = {},
): Promise<CheapReport> {
	const env = options.env ?? process.env;
	const run = options.run ?? defaultRun;
	const write = options.write ?? ((text) => process.stdout.write(text));
	const replay = await run(REPLAY_SCRIPT, env);
	if (replay.stdout.length > 0) write(replay.stdout);
	if (replay.stderr.length > 0) write(replay.stderr);
	if (replay.exitCode !== 0) {
		const report: CheapReport = {
			replay: { exitCode: replay.exitCode },
			jev: { kind: "skipped", reason: "replay-failed" },
			exitCode: replay.exitCode,
		};
		write(
			`${JSON.stringify({ jev: report.jev, exitCode: report.exitCode })}\n`,
		);
		return report;
	}
	const apiKey = env.TYPESAFE_API_KEY;
	if (apiKey === undefined || apiKey.length === 0) {
		const report: CheapReport = {
			replay: { exitCode: 0 },
			jev: { kind: "skipped", reason: "missing-key" },
			exitCode: 0,
		};
		write(`${JSON.stringify({ jev: report.jev, exitCode: 0 })}\n`);
		return report;
	}
	const jev = await run(JEV_SCRIPT, env);
	if (jev.stdout.length > 0) write(jev.stdout);
	if (jev.stderr.length > 0) write(jev.stderr);
	return {
		replay: { exitCode: 0 },
		jev: { kind: "ran", exitCode: jev.exitCode },
		exitCode: jev.exitCode,
	};
}

if (import.meta.main) {
	const report = await runEvalCheap();
	process.exitCode = report.exitCode;
}
