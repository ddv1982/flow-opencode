import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { writeExclusive } from "./lib/exclusive-json.js";

const Model = z.string().regex(/^[^\s/]+\/[^\s]+$/);
const Authorization = z
	.object({
		schemaVersion: z.literal(1),
		purpose: z.string().trim().min(1),
		models: z.array(Model).min(1),
		maxDispatches: z.number().int().positive().max(100000),
		expiresAt: z.string().datetime(),
	})
	.strict();
const Claim = z
	.object({
		model: Model,
		kind: z.enum(["probe", "command", "prompt", "canary"]),
		at: z.string().datetime(),
	})
	.strict();
export type PaidAuthorization = z.infer<typeof Authorization>;
export type PaidDispatch = Pick<z.infer<typeof Claim>, "model" | "kind">;

export async function authorizePaidRun(
	directory: string,
	input: PaidAuthorization,
): Promise<void> {
	const authorization = Authorization.parse(input);
	if (Date.parse(authorization.expiresAt) <= Date.now())
		throw new Error("Authorization must expire in the future.");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await writeExclusive(join(directory, "authorization.json"), authorization);
}

export async function paidRunStatus(directory: string) {
	const authorization = Authorization.parse(
		JSON.parse(await readFile(join(directory, "authorization.json"), "utf8")),
	);
	const claims = (await readdir(directory)).filter((name) =>
		/^dispatch-\d+\.json$/.test(name),
	);
	for (const name of claims) {
		const slot = Number(name.slice(9, -5));
		if (
			name !== `dispatch-${slot}.json` ||
			slot < 0 ||
			slot >= authorization.maxDispatches
		)
			throw new Error("Invalid authorization slot.");
		Claim.parse(JSON.parse(await readFile(join(directory, name), "utf8")));
	}
	return {
		authorization,
		consumed: claims.length,
		remaining: authorization.maxDispatches - claims.length,
	};
}

export async function requirePaidAuthorization(
	directory = process.env.FLOW_EVAL_AUTHORIZATION,
) {
	if (!directory)
		throw new Error(
			"Paid model work requires FLOW_EVAL_AUTHORIZATION. Create an explicit budget with scripts/paid-budget.ts authorize.",
		);
	const status = await paidRunStatus(directory);
	if (Date.parse(status.authorization.expiresAt) <= Date.now())
		throw new Error("Paid-run authorization expired.");
	if (status.remaining <= 0)
		throw new Error(
			"Paid-run dispatch budget exhausted. Previous starts remain consumed after failure or restart.",
		);
	return { directory, ...status };
}

export async function consumePaidDispatch(
	dispatch: PaidDispatch,
	directory = process.env.FLOW_EVAL_AUTHORIZATION,
): Promise<void> {
	const checked = await requirePaidAuthorization(directory);
	directory = checked.directory;
	const authorization = checked.authorization;
	const claim = Claim.parse({ ...dispatch, at: new Date().toISOString() });
	if (!authorization.models.includes(dispatch.model))
		throw new Error(`Model ${dispatch.model} is not authorized.`);
	for (let slot = 0; slot < authorization.maxDispatches; slot++) {
		try {
			await writeExclusive(join(directory, `dispatch-${slot}.json`), claim);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new Error(
		"Paid-run dispatch budget exhausted. Previous starts remain consumed after failure or restart.",
	);
}

async function main(args: string[]) {
	const [command, directory, ...options] = args;
	if (command === "--help" || !command) {
		console.log(
			"paid-budget authorize <directory> --models <provider/model,...> --max-dispatches <n> --purpose <text> --expires <ISO> | status <directory>",
		);
		return;
	}
	if (!directory) throw new Error("Authorization directory is required.");
	if (command === "status") {
		if (options.length) throw new Error("Unexpected options.");
		console.log(
			JSON.stringify(await paidRunStatus(resolve(directory)), null, 2),
		);
		return;
	}
	if (command !== "authorize") throw new Error("Unknown budget command.");
	const values = new Map<string, string>();
	for (let index = 0; index < options.length; index += 2) {
		const key = options[index];
		const value = options[index + 1];
		if (
			!key ||
			!["--models", "--max-dispatches", "--purpose", "--expires"].includes(
				key,
			) ||
			!value ||
			values.has(key)
		)
			throw new Error("Invalid authorization options.");
		values.set(key, value);
	}
	await authorizePaidRun(
		resolve(directory),
		Authorization.parse({
			schemaVersion: 1,
			models: values
				.get("--models")
				?.split(",")
				.map((model) => model.trim()),
			maxDispatches: Number(values.get("--max-dispatches")),
			purpose: values.get("--purpose"),
			expiresAt: values.get("--expires"),
		}),
	);
	console.log("Authorization created. This command did not start model work.");
}
if (import.meta.main)
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
